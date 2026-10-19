/**
 * Listening for a voice call through our own microphone recording and Sarvam speech to text (server/voice/stt.ts),
 * instead of the browser's built-in recogniser: the mic is opened with echo cancellation, noise suppression and
 * automatic gain, then boosted and compressed, so a quiet voice or a phone held at arm's length is still heard; and
 * Sarvam hears Indian English, Hindi and Hinglish.
 *
 * Turn-taking (shared/turn-detector.ts): the room is measured when the mic first opens; speech starts a turn; at a
 * pause, what was said so far is transcribed, and the words decide how much longer to wait (endpointDelay: "…and",
 * "…matlab" or "um" wait longer), so a thinking pause doesn't cut a question in half. Speaking again keeps the turn
 * going. While the assistant speaks, sustained speech is reported as a barge-in (desktop only). Two failed
 * transcriptions in a row hand back to the browser's recogniser (onFailed).
 *
 * On a phone an open microphone quiets the assistant's voice, so there (`holdMic: false`) the mic is opened for each
 * turn and released while the assistant speaks; elsewhere it stays open for the call (and feeds the orb's level).
 */
import { endpointDelay, isUtterance, type Patience } from "@shared/voice-call";
import { calibrateNoise, freshTurn, turnStep, type TurnState } from "@shared/turn-detector";

const TICK_MS = 50;
const CALIBRATE_MS = 500;
const MIC_BOOST = 2.2;
/** A turn this long is sent as it is, whatever the pauses (Sarvam's quick endpoint is for clips under 30 s). */
const MAX_TURN_MS = 25_000;
const BARGE_MS = 350;

export interface ServerListener {
  listen(): void;
  pause(): void;
  watchBargeIn(on: boolean): void;
  setMuted(m: boolean): void;
  level(): number;
  dispose(): void;
}

/** The server can transcribe (Sarvam is set up and today's allowance isn't used). */
export async function sttAvailable(): Promise<boolean> {
  try { const r = await fetch("/api/voice/status", { credentials: "include" }); if (!r.ok) return false; return !!(await r.json())?.stt; } catch { return false; }
}

export const recordingMime = (): string | null => {
  const MR = typeof window === "undefined" ? null : (window as any).MediaRecorder;
  if (!MR) return null;
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) { try { if (MR.isTypeSupported?.(m)) return m; } catch { /* next */ } }
  return null;
};

/** The browser can record the microphone for transcription. */
export const canRecord = (): boolean =>
  typeof window !== "undefined" && !!recordingMime() && !!(window.AudioContext || (window as any).webkitAudioContext) && !!navigator.mediaDevices?.getUserMedia;

/** Made inside the tap that starts the call (a context made later may never be allowed to run on a phone). */
export function createListenerContext(): AudioContext | null {
  if (!canRecord()) return null;
  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    const ctx: AudioContext = new AC();
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    return ctx;
  } catch { return null; }
}

async function transcribeClip(blob: Blob, signal: AbortSignal): Promise<string | null> {
  try {
    const r = await fetch("/api/voice/transcribe", { method: "POST", credentials: "include", headers: { "Content-Type": blob.type.split(";")[0] || "audio/webm" }, body: blob, signal });
    if (!r.ok) return null;
    const j = await r.json();
    return typeof j?.text === "string" ? j.text : "";
  } catch { return null; }
}

const openStream = async (): Promise<MediaStream | "blocked" | "failed"> => {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  } catch (e: any) {
    return e?.name === "NotAllowedError" || e?.name === "SecurityError" ? "blocked" : "failed";
  }
};

export async function openServerListener(ctx: AudioContext, o: {
  holdMic: boolean;
  patience: () => Patience;
  onSpeech: () => void;
  onInterim: (text: string) => void;
  onUtterance: (text: string) => void;
  onBargeIn: () => void;
  onBlocked: () => void;
  onFailed: () => void;
}): Promise<ServerListener | "blocked" | "unsupported"> {
  const mime = recordingMime();
  if (!mime) return "unsupported";
  // Asked for once up front, so the permission prompt comes at the start of the call, not mid-sentence.
  const first = await openStream();
  if (first === "blocked") return "blocked";
  if (first === "failed") return "unsupported";

  // One graph for the call: mic → boost → compressor → recorder (and the level meter).
  const gain = ctx.createGain(); gain.gain.value = MIC_BOOST;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -26; comp.knee.value = 10; comp.ratio.value = 3; comp.attack.value = 0.005; comp.release.value = 0.2;
  const analyser = ctx.createAnalyser(); analyser.fftSize = 1024;
  const dest = ctx.createMediaStreamDestination();
  gain.connect(comp).connect(dest);
  comp.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);

  let mic: { stream: MediaStream; src: MediaStreamAudioSourceNode } | null = null;
  let opening: Promise<boolean> | null = null;
  let muted = false;
  let disposed = false;
  const attach = (stream: MediaStream) => {
    const src = ctx.createMediaStreamSource(stream);
    src.connect(gain);
    stream.getAudioTracks().forEach((t) => { t.enabled = !muted; });
    mic = { stream, src };
  };
  const releaseMic = () => {
    const m = mic; mic = null;
    if (!m) return;
    try { m.src.disconnect(); } catch { /* gone */ }
    m.stream.getTracks().forEach((t) => t.stop());
  };
  const ensureMic = (): Promise<boolean> => {
    if (mic) return Promise.resolve(true);
    if (!opening) {
      opening = openStream().then((s) => {
        opening = null;
        if (typeof s === "string") { if (s === "blocked") o.onBlocked(); return false; }
        if (disposed) { s.getTracks().forEach((t) => t.stop()); return false; }
        attach(s);
        return true;
      });
    }
    return opening;
  };
  attach(first);
  if (!o.holdMic) releaseMic();   // reopened when the first turn starts

  let rms = 0;
  let noise = 0.004;
  const calib: number[] = [];
  let calibrateUntil = 0;         // set when the mic first carries sound

  // The current turn
  let active = false;
  let ts: TurnState = freshTurn(noise);
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let startedAt = 0;
  let pauseId = 0;
  let decideT: number | undefined;
  let inflight: AbortController | null = null;
  let failures = 0;
  let capping = false;
  let listenId = 0;
  // Barge-in while the assistant speaks
  let barge = false;
  let bargeLoud = 0;

  const stopRecorder = () => { try { if (recorder && recorder.state !== "inactive") recorder.stop(); } catch { /* stopped */ } recorder = null; };
  const clearPending = () => { window.clearTimeout(decideT); decideT = undefined; inflight?.abort(); inflight = null; };

  const startRecorder = () => {
    chunks = [];
    try {
      recorder = new MediaRecorder(dest.stream, { mimeType: mime });
      recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      recorder.start(250);
      startedAt = Date.now();
    } catch { recorder = null; }
  };

  /** Everything recorded in this turn so far, as one clip (the recorder's pieces join into a valid file). */
  const snapshot = async (): Promise<Blob> => {
    try { recorder?.requestData(); } catch { /* not recording */ }
    await new Promise((r) => setTimeout(r, 60));
    return new Blob(chunks, { type: mime });
  };

  const endTurn = () => {
    active = false;
    clearPending();
    stopRecorder();
    if (!o.holdMic) releaseMic();
  };

  const finish = (text: string) => {
    if (!active) return;
    endTurn();
    if (isUtterance(text)) o.onUtterance(text.trim());
    else if (!disposed) api.listen();   // only noise: keep listening
  };

  /** A transcription failed; twice in a row, the call goes back to the browser's recogniser. */
  const failed = (): boolean => {
    failures++;
    if (failures < 2) return false;
    endTurn();
    o.onFailed();
    return true;
  };

  /** At a pause: read what was said, and wait longer if it sounds unfinished. */
  const onPause = async () => {
    const id = ++pauseId;
    clearPending();
    const clip = await snapshot();
    if (!active || id !== pauseId) return;
    const ac = new AbortController(); inflight = ac;
    const text = await transcribeClip(clip, ac.signal);
    if (!active || id !== pauseId) return;
    inflight = null;
    if (text === null) { if (!failed()) finish(""); return; }
    failures = 0;
    if (text) o.onInterim(text);
    const left = endpointDelay(text, o.patience()) - ts.quiet;
    if (left <= 0) finish(text);
    else decideT = window.setTimeout(() => { if (active && id === pauseId && ts.paused) finish(text); }, left);
  };

  /** A very long turn is sent as it stands. */
  const cap = async () => {
    capping = true;
    pauseId++;
    clearPending();
    const clip = await snapshot();
    if (!active) return;
    const text = await transcribeClip(clip, new AbortController().signal);
    if (text === null && failed()) return;
    finish(text ?? "");
  };

  const tick = window.setInterval(() => {
    if (disposed) return;
    if (!mic || muted) { rms = 0; return; }
    analyser.getFloatTimeDomainData(buf as any);
    let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    rms = Math.sqrt(sum / buf.length);
    if (!calibrateUntil) calibrateUntil = Date.now() + CALIBRATE_MS;
    if (calib && Date.now() < calibrateUntil) { calib.push(rms); return; }
    if (calib.length) { noise = calibrateNoise(calib); calib.length = 0; if (!ts.started) ts = { ...ts, noise }; }
    if (barge && !active) {
      if (rms > Math.max(0.03, noise * 5)) { bargeLoud += TICK_MS; if (bargeLoud >= BARGE_MS) { barge = false; bargeLoud = 0; o.onBargeIn(); } }
      else bargeLoud = 0;
      return;
    }
    if (!active) return;
    const r = turnStep(ts, rms, TICK_MS);
    ts = r.state;
    if (!ts.started) noise = ts.noise;
    if (r.event === "speech_start" || r.event === "speech_resume") { pauseId++; clearPending(); o.onSpeech(); }
    else if (r.event === "pause") void onPause();
    if (ts.started && !capping && Date.now() - startedAt > MAX_TURN_MS) void cap();
  }, TICK_MS);

  const api: ServerListener = {
    listen() {
      if (disposed) return;
      const id = ++listenId;
      barge = false; bargeLoud = 0;
      clearPending(); stopRecorder();
      if (ctx.state === "suspended") void ctx.resume().catch(() => {});
      void ensureMic().then((ok) => {
        if (!ok || disposed || id !== listenId) return;
        ts = freshTurn(noise);
        capping = false;
        active = true;
        startRecorder();
      });
    },
    pause() { listenId++; endTurn(); },
    watchBargeIn(on) {
      barge = on && o.holdMic; bargeLoud = 0;
      if (barge && ctx.state === "suspended") void ctx.resume().catch(() => {});
    },
    setMuted(m) { muted = m; mic?.stream.getAudioTracks().forEach((t) => { t.enabled = !m; }); },
    level: () => Math.min(1, rms * 6),
    dispose() {
      disposed = true; active = false; listenId++;
      window.clearInterval(tick); clearPending(); stopRecorder(); releaseMic();
      try { gain.disconnect(); comp.disconnect(); } catch { /* gone */ }
    },
  };
  return api;
}
