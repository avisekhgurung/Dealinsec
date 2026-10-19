/**
 * Dictating into a message box through our own microphone recording and Sarvam speech to text (the same boosted mic
 * as a voice call: lib/server-listener.ts). The words only ever go into the box, for the person to read and send.
 *
 * While the person talks, what they've said so far is transcribed every couple of seconds so the box fills in as they
 * speak. It stops on a tap, or by itself after a long silence once they've spoken (or if nothing is heard at all).
 * Sarvam's quick endpoint takes clips under 30 seconds, so a long dictation is recorded in pieces and joined.
 */
import { calibrateNoise, freshTurn, turnStep, type TurnState } from "@shared/turn-detector";
import { canRecord, micGraph, openStream, readLevel, recordingMime, transcribeClip } from "@/lib/server-listener";

const TICK_MS = 50;
const CALIBRATE_MS = 300;
const UPDATE_MS = 2500;
const PIECE_MS = 25_000;
const SILENCE_STOP_MS = 6000;
const NOTHING_STOP_MS = 8000;

export interface Dictation { stop(): void; cancel(): void }

export async function startDictation(o: {
  onText: (text: string) => void;
  onEnd: () => void;
  /** `broken`: transcription itself failed (the caller can use the browser's recogniser next time). */
  onError: (message: string, broken: boolean) => void;
}): Promise<Dictation | "unsupported" | "blocked"> {
  const mime = recordingMime();
  if (!mime || !canRecord()) return "unsupported";
  // Made before anything is awaited, inside the tap, so a phone lets it run.
  const AC = window.AudioContext || (window as any).webkitAudioContext;
  let ctx: AudioContext;
  try { ctx = new AC(); if (ctx.state === "suspended") void ctx.resume().catch(() => {}); } catch { return "unsupported"; }
  const stream = await openStream();
  if (typeof stream === "string") { void ctx.close().catch(() => {}); return stream === "blocked" ? "blocked" : "unsupported"; }

  const { gain, analyser, dest } = micGraph(ctx);
  const src = ctx.createMediaStreamSource(stream);
  src.connect(gain);
  const buf = new Float32Array(analyser.fftSize);

  const openedAt = Date.now();
  const calib: number[] = [];
  let ts: TurnState = freshTurn();
  let calibrated = false;
  let done = "";              // text of finished pieces
  let pieceText = "";         // the latest reading of the piece being recorded
  let heardInPiece = false;
  let freshAudio = false;     // speech since the last reading
  let lastUpdate = Date.now();
  let inflight = false;
  let ended = false;
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let pieceAt = 0;
  let rolling = false;
  let pieceNo = 0;
  /** Finished pieces still being read, in order; false if one failed. */
  let pending: Promise<boolean> = Promise.resolve(true);
  const ac = new AbortController();

  const joined = (piece: string) => [done, piece].filter(Boolean).join(" ").trim();

  const startPiece = () => {
    chunks = []; pieceText = ""; heardInPiece = false; pieceNo++;
    recorder = new MediaRecorder(dest.stream, { mimeType: mime });
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.start(250);
    pieceAt = Date.now();
  };
  const clip = async (): Promise<Blob> => {
    try { recorder?.requestData(); } catch { /* not recording */ }
    await new Promise((r) => setTimeout(r, 60));
    return new Blob(chunks, { type: mime });
  };
  const release = () => {
    window.clearInterval(tick);
    try { if (recorder && recorder.state !== "inactive") recorder.stop(); } catch { /* stopped */ }
    recorder = null;
    try { src.disconnect(); } catch { /* gone */ }
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close().catch(() => {});
  };

  /** Read the piece so far and show it. */
  const update = async () => {
    inflight = true; freshAudio = false; lastUpdate = Date.now();
    const piece = pieceNo;
    const text = await transcribeClip(await clip(), ac.signal);
    inflight = false;
    if (ended || text === null || piece !== pieceNo) return;
    pieceText = text;
    o.onText(joined(pieceText));
  };

  /** A finished piece's words join what's done, after any piece before it. */
  const readPiece = (blob: Blob) => {
    const before = pending;
    pending = (async () => {
      const ok = await before;
      const text = await transcribeClip(blob, ac.signal);
      if (text === null) return false;
      done = [done, text].filter(Boolean).join(" ").trim();
      return ok;
    })();
    return pending;
  };

  /** A long dictation: the piece so far is read while the next one records, with no gap. */
  const roll = async () => {
    rolling = true;
    const blob = await clip();
    try { if (recorder && recorder.state !== "inactive") recorder.stop(); } catch { /* stopped */ }
    if (ended) return;
    startPiece();
    rolling = false;
    void readPiece(blob).then((ok) => { if (ended) return; if (!ok) void finish(); else o.onText(joined(pieceText)); });
  };

  const finish = async () => {
    if (ended) return;
    ended = true;
    const last = heardInPiece ? await clip() : null;
    release();
    const ok = await (last ? readPiece(last) : pending);
    if (!ok) { o.onError("Voice typing isn't available right now.", true); if (done) o.onText(done); }
    else if (!done) o.onError("I didn't hear anything. Try again.", false);
    else o.onText(done);
    o.onEnd();
  };

  const tick = window.setInterval(() => {
    if (ended) return;
    const rms = readLevel(analyser, buf);
    if (!calibrated) {
      calib.push(rms);
      if (Date.now() - openedAt < CALIBRATE_MS) return;
      calibrated = true; ts = freshTurn(calibrateNoise(calib));
    }
    const r = turnStep(ts, rms, TICK_MS);
    ts = r.state;
    if (r.event === "speech_start" || r.event === "speech_resume") { heardInPiece = true; }
    if (ts.loud > 0 && ts.started) freshAudio = true;
    if (!ts.started && Date.now() - openedAt > NOTHING_STOP_MS) { void finish(); return; }
    if (ts.started && ts.quiet >= SILENCE_STOP_MS) { void finish(); return; }
    if (rolling) return;
    if (heardInPiece && Date.now() - pieceAt > PIECE_MS) { void roll(); return; }
    if (inflight) return;
    if (freshAudio && heardInPiece && Date.now() - lastUpdate > UPDATE_MS) void update();
  }, TICK_MS);

  try { startPiece(); } catch { release(); return "unsupported"; }

  return {
    stop: () => { void finish(); },
    cancel: () => { if (ended) return; ended = true; ac.abort(); release(); o.onEnd(); },
  };
}
