/**
 * A voice call with the agent, hands-free: it listens, notices when you have
 * finished a sentence, thinks, answers aloud in a gentleman's voice, and listens
 * again; you can interrupt at any time. The turn-taking itself is the pure state
 * machine in shared/voice-call.ts (tested); this hook only carries out its
 * effects against the browser's microphone and speech.
 *
 * The person comes first: while the assistant speaks, the recogniser keeps
 * listening, and anything that isn't the assistant's own echo (isPersonTalking:
 * new words, or "stop" / "wait") cuts it off at once. That can be switched off
 * for a loudspeaker that fools it; a tap always interrupts.
 *
 * Approving by voice: the read-back comes from the server-checked approval card,
 * the answer is classified by code, and the approval goes through agent.approve,
 * the same single-use endpoint as a tap.
 *
 * The call lives and dies with the component that uses this hook: on unmount
 * everything is released (recogniser, speech, microphone, wake lock).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { isPhoneDevice, pickGentlemanVoice, speakable, splitSentences } from "@shared/voice";
import { createNeuralSpeaker } from "@shared/neural-speech";
import { createBrowserNeuralDeps, neuralVoiceAvailable, setAudioSession } from "@/lib/neural-voice";
import { canRecord, createListenerContext, openServerListener, sttAvailable, type ServerListener } from "@/lib/server-listener";
import { createStreamSpeaker, speakUpTo } from "@shared/stream-speech";
import { endpointDelay, type Patience } from "@shared/voice-call";
import { speedCommand, speedKey, stepSpeed } from "@shared/voice-speed";
import type { NeuralDeps } from "@shared/neural-speech";
import { VOICE_PROFILES, type VoiceKey } from "@shared/voice-profiles";
import { approvalReadback, initialCall, isPersonTalking, isUtterance, reduceCall, type CallEffect, type CallEvent, type CallState, type PendingApproval } from "@shared/voice-call";
import type { useAgent } from "@/hooks/use-agent";

type Agent = ReturnType<typeof useAgent>;

/** A filler ("Hmm, let me check…") plays if nothing has been said this long after the person stops talking. */
const FILLER_AFTER_MS = 550;
/** Replies are spoken in full up to this length (voice replies are short; this only bounds a runaway). */
const SPOKEN_MAX = 4000;
/** Stand-in pieces when the neural voice isn't on: nothing is fetched or played by them. */
const NO_NEURAL: NeuralDeps = { fetchAudio: () => Promise.reject(new Error("off")), createUrl: () => "", revokeUrl: () => {}, play: () => Promise.resolve(), stopPlayback: () => {} };
/** How long of nothing before "are you still there?" */
const IDLE_MS = 30_000;

const Recognition = (): (new () => any) | null =>
  typeof window === "undefined" ? null : (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;

/** A call needs speech out, and a way to hear: our own recording (Sarvam speech to text) or the browser's recogniser. */
export const voiceCallSupported = (): boolean => (!!Recognition() || canRecord()) && typeof window !== "undefined" && "speechSynthesis" in window;

const isIOS = () => typeof navigator !== "undefined" && /iP(hone|ad|od)/.test(navigator.userAgent);
/** On a phone, an open microphone or a running recogniser silences or ducks the assistant's voice: it listens only between turns there. */
export const onPhone = (): boolean => typeof navigator !== "undefined" && isPhoneDevice(navigator.userAgent, navigator.maxTouchPoints ?? 0);

/** Phones only let speech start from a tap: say nothing, silently, inside the tap that starts the call, so the real greeting is allowed. */
const warmUpSpeech = () => {
  try {
    const synth = window.speechSynthesis;
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    synth.speak(u);
  } catch { /* no speech on this device; the call says so */ }
};

/** `voice`: whose voice answers (Agent mode's gentleman by default, or a coworker's: shared/voice-profiles.ts). */
export function useVoiceCall(o: { agent: Agent; lang: string; greeting: string; bargeIn: boolean; voice?: VoiceKey; patience?: Patience }) {
  const [state, setState] = useState<CallState>(initialCall);
  const [level, setLevel] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [finished, setFinished] = useState(false);

  const stateRef = useRef(state);
  const agentRef = useRef(o.agent);
  agentRef.current = o.agent;
  const bargeRef = useRef(o.bargeIn);
  bargeRef.current = o.bargeIn;
  const dead = useRef(false);

  const rec = useRef<any>(null);
  const wantListen = useRef(false);
  const transcript = useRef("");
  const endpointT = useRef<number | undefined>(undefined);
  const idleT = useRef<number | undefined>(undefined);
  const awaiting = useRef<{ sawRunning: boolean; at: number } | null>(null);
  const speakToken = useRef(0);
  const speakingNow = useRef(false);
  const speakingText = useRef("");
  const meter = useRef<{ stream: MediaStream; ctx: AudioContext; raf: number } | null>(null);
  // Our own recording + Sarvam speech to text, when the server has it (else the browser's recogniser above).
  const listener = useRef<ServerListener | null>(null);
  const wake = useRef<any>(null);
  const dispatchRef = useRef<(e: CallEvent) => void>(() => {});
  // The neural voice, when the server has one: sentences fetched ahead and played; the browser's voice covers any that fail.
  const neural = useRef<{ speaker: ReturnType<typeof createNeuralSpeaker>; audio: ReturnType<typeof createBrowserNeuralDeps> } | null>(null);
  const voiceKey: VoiceKey = o.voice ?? "agent";
  const patienceRef = useRef<Patience>(o.patience ?? "normal");
  patienceRef.current = o.patience ?? "normal";

  // ── the person's speed for this voice (button or "speak faster" / "dheere bolo"), remembered ──────────────
  const readSpeed = () => { try { const v = Number(window.localStorage.getItem(speedKey(voiceKey))); return v >= 0.5 && v <= 2 ? v : 1; } catch { return 1; } };
  const speedRef = useRef<number>(readSpeed());
  const [speed, setSpeedState] = useState(speedRef.current);
  const applySpeed = useCallback((v: number) => {
    speedRef.current = v; setSpeedState(v);
    try { window.localStorage.setItem(speedKey(voiceKey), String(v)); } catch { /* not remembered */ }
    neural.current?.audio.setRate(v);
  }, [voiceKey]);

  // ── this turn's reply, spoken while it is written (and a filler first) ──────────────────────────────
  const turn = useRef<{ stream: ReturnType<typeof createStreamSpeaker>; consumed: string; step: number; fillerT?: number } | null>(null);
  const fillers = useRef<Blob[]>([]);
  const [early, setEarly] = useState(false);

  // ── speaking ────────────────────────────────────────────────────────────
  const cancelSpeech = () => {
    cancelTurn();
    speakToken.current++;
    speakingNow.current = false;
    neural.current?.speaker.cancel();
    try { window.speechSynthesis.cancel(); } catch { /* nothing speaking */ }
  };

  /** The browser's voice for this call: the coworker's pitch and pace (or Agent mode's gentleman), at the person's speed. */
  const browserSayer = () => {
    const synth = window.speechSynthesis;
    const voices = synth.getVoices();
    const coworker = o.voice && o.voice !== "agent" ? VOICE_PROFILES[o.voice].browser : null;
    const vi = coworker ? voices.findIndex((x) => x.lang === "hi-IN" || x.lang === "en-IN") : pickGentlemanVoice(voices, o.lang);
    const voice = vi >= 0 ? voices[vi] : null;
    const pitch = coworker?.pitch ?? 0.9, rate = (coworker?.rate ?? 0.98) * speedRef.current;
    return (part: string) => new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(part);
      if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = o.lang;
      u.rate = rate; u.pitch = pitch; u.volume = 1;
      u.onend = () => resolve(); u.onerror = () => resolve();
      synth.speak(u);
    });
  };

  const cancelTurn = () => {
    const t = turn.current;
    turn.current = null;
    if (t) { window.clearTimeout(t.fillerT); t.stream.cancel(); }
    setEarly(false);
  };

  /** The person has finished: a fresh stream for the reply, with a filler if the reply takes a moment. */
  const startTurn = () => {
    cancelTurn();
    const say = browserSayer();
    const stream = createStreamSpeaker(neural.current?.audio.deps ?? NO_NEURAL, { neural: () => !!neural.current && !neural.current.speaker.disabled, fallback: say });
    const t: NonNullable<typeof turn.current> = { stream, consumed: "", step: -1 };
    turn.current = t;
    t.fillerT = window.setTimeout(() => {
      if (turn.current !== t || stateRef.current.phase !== "thinking" || stream.pushed > 0) return;
      const clip = fillers.current.length ? fillers.current[Math.floor(Math.random() * fillers.current.length)] : null;
      if (clip) stream.pushClip(clip);
      else if (!neural.current) { const f = VOICE_PROFILES[voiceKey].fillers; stream.push(f[Math.floor(Math.random() * f.length)]); }
      else return;
      setAudioSession("playback"); speakingNow.current = true; setEarly(true);
    }, FILLER_AFTER_MS);
  };

  const speak = (text: string) => {
    // This turn has been speaking as the reply was written: say only what's left, then hand back to listening.
    const t = turn.current;
    if (t) {
      window.clearTimeout(t.fillerT);
      const full = speakable(text, SPOKEN_MAX);
      let rest = full;
      if (t.consumed) {
        if (full.startsWith(t.consumed)) rest = full.slice(t.consumed.length);
        else { const tail = t.consumed.slice(-40); const at = full.indexOf(tail); rest = at >= 0 ? full.slice(at + tail.length) : full; }
      }
      speakingText.current = text;
      for (const p of splitSentences(rest)) t.stream.push(p);
      speakingNow.current = true; setAudioSession("playback");
      t.stream.finish(() => {
        if (turn.current !== t || dead.current) return;
        turn.current = null; setEarly(false);
        speakingNow.current = false; restartFresh(); dispatchRef.current({ type: "speech_done" });
      });
      return;
    }
    const synth = window.speechSynthesis;
    const parts = splitSentences(speakable(text, 900));
    cancelSpeech();
    try { synth.resume(); } catch { /* not paused */ }   // Chrome on Android can be left paused
    speakingText.current = text;
    if (!parts.length) { dispatchRef.current({ type: "speech_done" }); return; }
    const token = speakToken.current;
    speakingNow.current = true;
    setAudioSession("playback");   // loudspeaker, full media volume (iPhone)
    const sayWithBrowser = browserSayer();
    const finished = () => { if (token !== speakToken.current || dead.current) return; speakingNow.current = false; restartFresh(); dispatchRef.current({ type: "speech_done" }); };
    if (neural.current && !neural.current.speaker.disabled) {
      neural.current.speaker.speak(parts, { fallback: sayWithBrowser, onDone: finished });
      return;
    }
    let i = 0;
    const next = () => {
      if (token !== speakToken.current || dead.current) return;
      if (i >= parts.length) { speakingNow.current = false; restartFresh(); dispatchRef.current({ type: "speech_done" }); return; }
      void sayWithBrowser(parts[i++]).then(next);
    };
    // A beat after cancel(): some browsers drop a speak() issued in the same tick.
    window.setTimeout(next, 80);
  };

  // ── listening ───────────────────────────────────────────────────────────
  const armIdle = () => {
    window.clearTimeout(idleT.current);
    idleT.current = window.setTimeout(() => dispatchRef.current({ type: "idle_timeout" }), IDLE_MS);
  };
  /** The person's turn, finished: a speed request ("speak faster", "dheere bolo") is applied, then it is answered. */
  const deliver = (t: string) => {
    if (!isUtterance(t)) return;
    transcript.current = "";
    const cmd = speedCommand(t);
    if (cmd) applySpeed(stepSpeed(speedRef.current, cmd));
    dispatchRef.current({ type: "utterance", text: t });
  };
  const armEndpoint = () => {
    window.clearTimeout(endpointT.current);
    // A pause after an unfinished thought ("…and", "…matlab", "um") waits longer, so thinking doesn't cut a question in half.
    endpointT.current = window.setTimeout(() => deliver(transcript.current), endpointDelay(transcript.current, patienceRef.current));
  };

  const stopRecognition = () => {
    wantListen.current = false;
    window.clearTimeout(endpointT.current);
    window.clearTimeout(idleT.current);
    listener.current?.pause();
    const r = rec.current;
    rec.current = null;
    try { r?.abort(); } catch { /* already stopped */ }
  };

  const restartFresh = () => {
    const r = rec.current;
    rec.current = null;
    transcript.current = "";
    try { r?.abort(); } catch { /* gone */ }
  };

  /** Listening while the assistant speaks, so the person can cut in. */
  const listenWhileSpeaking = () => {
    if (onPhone()) return;
    const on = bargeRef.current && !stateRef.current.muted;
    if (listener.current) { listener.current.watchBargeIn(on && stateRef.current.phase === "speaking"); return; }
    if (on) startRecognition();
  };

  const startRecognition = () => {
    setAudioSession("auto");   // the microphone needs the recording route; speaking switches back to the loudspeaker
    if (dead.current || stateRef.current.muted) return;
    if (listener.current) { transcript.current = ""; listener.current.listen(); armIdle(); return; }
    const Ctor = Recognition();
    if (!Ctor) { dispatchRef.current({ type: "error", code: "unsupported" }); return; }
    wantListen.current = true;
    if (rec.current) return;
    transcript.current = "";
    const r = new Ctor();
    r.lang = o.lang;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.onresult = (e: any) => {
      if (rec.current !== r) return;
      let t = "";
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      t = t.trim();
      if (stateRef.current.phase === "speaking") {
        // The assistant is talking: is this the person, or the assistant's own voice coming back?
        if (isPersonTalking(t, speakingText.current)) {
          // Start the person's turn on a clean recogniser, so none of the echo ends up in what they said.
          restartFresh();
          dispatchRef.current({ type: "interrupt" });
        }
        return;
      }
      transcript.current = t;
      dispatchRef.current({ type: "interim", text: transcript.current });
      armEndpoint();
      armIdle();
    };
    r.onerror = (e: any) => {
      if (rec.current !== r) return;
      const code = String(e?.error ?? "");
      if (code === "not-allowed" || code === "service-not-allowed" || code === "audio-capture") dispatchRef.current({ type: "error", code: "mic_blocked" });
      // no-speech / network / aborted: onend restarts listening.
    };
    r.onend = () => {
      if (rec.current !== r) return;           // an old recogniser we already replaced
      rec.current = null;
      if (wantListen.current && !dead.current) window.setTimeout(() => { if (wantListen.current && !rec.current) startRecognition(); }, 250);
    };
    rec.current = r;
    try { r.start(); } catch { rec.current = null; }
    armIdle();
  };

  // ── the microphone level (for the orb, and for interrupting by voice) ────
  const startMeter = async (): Promise<"ok" | "blocked" | "skipped"> => {
    // The level meter holds the microphone open, which on a phone quiets the assistant: not there.
    if (isIOS() || onPhone() || !navigator.mediaDevices?.getUserMedia) return "skipped";
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (dead.current) { stream.getTracks().forEach((t) => t.stop()); return "skipped"; }
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx: AudioContext = new Ctx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      let smooth = 0, last = 0;
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
        const rms = Math.sqrt(sum / buf.length);
        smooth = smooth * 0.7 + rms * 0.3;
        const now = performance.now();
        if (now - last > 60) { last = now; setLevel(Math.min(1, smooth * 5)); }
        if (meter.current) meter.current.raf = requestAnimationFrame(tick);
      };
      meter.current = { stream, ctx, raf: requestAnimationFrame(tick) };
      return "ok";
    } catch (e) {
      const name = (e as { name?: string })?.name;
      return name === "NotAllowedError" || name === "SecurityError" ? "blocked" : "skipped";
    }
  };
  const stopMeter = () => {
    const m = meter.current;
    meter.current = null;
    if (!m) return;
    cancelAnimationFrame(m.raf);
    m.stream.getTracks().forEach((t) => t.stop());
    void m.ctx.close().catch(() => {});
  };

  // ── carrying out the machine's effects ───────────────────────────────────
  const run = (fx: CallEffect) => {
    switch (fx.kind) {
      case "listen": startRecognition(); break;
      case "stop_listening": stopRecognition(); break;
      case "speak":
        speak(fx.text);
        // The person comes first: keep an ear open while speaking.
        window.setTimeout(listenWhileSpeaking, 300);
        break;
      case "approve":
        void agentRef.current.approve(fx.approvalId, fx.tool);
        break;
      case "reject":
        void agentRef.current.reject(fx.approvalId, fx.tool);
        break;
      case "cancel_speech": cancelSpeech(); break;
      case "send":
        awaiting.current = { sawRunning: false, at: Date.now() };
        startTurn();
        void agentRef.current.send(fx.text);
        break;
      case "stop_run":
        awaiting.current = null;
        cancelTurn();
        agentRef.current.stop();
        break;
    }
  };

  dispatchRef.current = (e: CallEvent) => {
    if (dead.current) return;
    const r = reduceCall(stateRef.current, e);
    stateRef.current = r.state;
    setState(r.state);
    r.effects.forEach(run);
  };

  // ── the agent's answer: when its run ends, speak what it said ───────────
  const { running, messages } = o.agent;
  useEffect(() => {
    const a = awaiting.current;
    if (!a) return;
    const last = messages[messages.length - 1];
    if (last?.role === "assistant" && last.error) { awaiting.current = null; dispatchRef.current({ type: "error", code: "agent_failed" }); return; }
    if (running) { a.sawRunning = true; return; }
    if (!a.sawRunning) return;
    awaiting.current = null;
    const reply = [...messages].reverse().find((m) => m.role === "assistant");
    const text = speakable(reply?.content ?? "", SPOKEN_MAX);
    const pending: PendingApproval[] = (reply?.cards ?? [])
      .filter((c) => c.kind === "approval" && typeof c.data.approvalId === "string")
      .map((c) => ({ approvalId: String(c.data.approvalId), tool: String(c.data.tool ?? ""), risk: String(c.data.risk ?? "SAFE_MUTATION"), readback: approvalReadback((c.data.preview ?? {}) as any, String(c.data.risk ?? "")) }));
    if (pending.length) dispatchRef.current({ type: "reply", text: isUtterance(text) ? text : "", approvals: pending });
    else if (isUtterance(text)) dispatchRef.current({ type: "reply", text });
    else dispatchRef.current({ type: "reply_empty" });
  }, [running, messages]);

  // The reply as it is written: each finished sentence (or, in a long sentence, each clause) is spoken straight away,
  // so the voice keeps pace with the text; the rest when the run ends.
  const { live, liveStep } = o.agent;
  useEffect(() => {
    const t = turn.current;
    if (!t || stateRef.current.phase !== "thinking" || !live) return;
    // A new model step: the text before it ("Let me check…") was a preamble before a tool, already spoken; follow the new one.
    if (liveStep !== t.step) { t.step = liveStep; t.consumed = ""; }
    const upTo = speakUpTo(speakable(live, SPOKEN_MAX), t.consumed);
    if (upTo.length <= t.consumed.length) return;
    const fresh = upTo.slice(t.consumed.length);
    t.consumed = upTo;
    window.clearTimeout(t.fillerT);
    for (const p of splitSentences(fresh)) t.stream.push(p);
    speakingNow.current = true; setAudioSession("playback"); setEarly(true);
  }, [live, liveStep]);

  // An action approved or declined, by voice or by a tap on the card: say how it went.
  const { approvals } = o.agent;
  const settled = useRef(new Set<string>());
  useEffect(() => {
    const c = stateRef.current.confirming;
    const ids = [c?.approvalId, ...stateRef.current.queue.map((q) => q.approvalId)].filter(Boolean) as string[];
    for (const id of ids) {
      const v = approvals[id];
      if (!v || v.status === "pending" || v.status === "executing" || settled.current.has(id)) continue;
      settled.current.add(id);
      const ok = v.status === "done";
      const message = ok ? speakable(v.message ?? "Done.", 300)
        : v.status === "declined" ? "Very well, I've left that alone."
        : `That didn't go through. ${speakable(v.message ?? "Nothing was changed.", 200)}`;
      dispatchRef.current({ type: "approval_settled", approvalId: id, ok, message });
    }
  }, [approvals]);

  // A send that never started a run (the request failed before streaming) must not leave the call thinking forever.
  useEffect(() => {
    if (state.phase !== "thinking") return;
    const t = window.setTimeout(() => {
      const a = awaiting.current;
      if (a && !a.sawRunning) { awaiting.current = null; dispatchRef.current({ type: "error", code: "agent_failed" }); }
    }, 10_000);
    return () => window.clearTimeout(t);
  }, [state.phase]);

  // ── lifecycle ───────────────────────────────────────────────────────────
  useEffect(() => {
    dead.current = false;
    let tick: number | undefined;
    // Created and unlocked right away, while the tap that started the call still counts, so later sounds are allowed.
    const audio = createBrowserNeuralDeps(o.voice ?? "agent");
    audio.unlock();
    warmUpSpeech();
    const micCtx = createListenerContext();
    (async () => {
      if (!voiceCallSupported()) { audio.dispose(); dispatchRef.current({ type: "error", code: "unsupported" }); return; }
      // Hearing: our own recording through Sarvam when the server has it, else the browser's recogniser and level meter.
      if (micCtx && await sttAvailable()) {
        if (dead.current) return;
        const l = await openServerListener(micCtx, {
          holdMic: !(isIOS() || onPhone()),
          patience: () => patienceRef.current,
          onSpeech: () => { armIdle(); if (!stateRef.current.interim) dispatchRef.current({ type: "interim", text: "…" }); },
          onInterim: (t) => { transcript.current = t; armIdle(); dispatchRef.current({ type: "interim", text: t }); },
          onUtterance: (t) => { window.clearTimeout(idleT.current); deliver(t); },
          onBargeIn: () => { if (stateRef.current.phase === "speaking") dispatchRef.current({ type: "interrupt" }); },
          onBlocked: () => dispatchRef.current({ type: "error", code: "mic_blocked" }),
          // Transcription keeps failing: back to the browser's recogniser for the rest of the call, if there is one.
          onFailed: () => {
            if (!Recognition()) { listener.current?.listen(); return; }
            listener.current?.dispose(); listener.current = null;
            if (stateRef.current.phase === "listening" && !stateRef.current.muted) startRecognition();
          },
        });
        if (dead.current) { if (typeof l !== "string") l.dispose(); return; }
        if (l === "blocked") { dispatchRef.current({ type: "error", code: "mic_blocked" }); return; }
        if (l !== "unsupported") listener.current = l;
      }
      if (!listener.current) {
        void micCtx?.close().catch(() => {});
        if (!Recognition()) { audio.dispose(); dispatchRef.current({ type: "error", code: "unsupported" }); return; }
        const m = await startMeter();
        if (dead.current) return;
        if (m === "blocked") { dispatchRef.current({ type: "error", code: "mic_blocked" }); return; }
      }
      try { wake.current = await (navigator as any).wakeLock?.request?.("screen"); } catch { /* the screen may dim; fine */ }
      // Voices load lazily in some browsers: nudge the list before the first word.
      try { window.speechSynthesis.getVoices(); } catch { /* none */ }
      if (await neuralVoiceAvailable()) {
        if (dead.current) return;
        neural.current = { speaker: createNeuralSpeaker(audio.deps), audio };
        audio.setRate(speedRef.current);
        // Two of this voice's fillers, made now so one can play the instant the person stops talking.
        const pool = [...VOICE_PROFILES[voiceKey].fillers].sort(() => Math.random() - 0.5).slice(0, 2);
        for (const f of pool) { const ac = new AbortController(); void audio.deps.fetchAudio(f, ac.signal).then((b) => { if (!dead.current) fillers.current.push(b); }, () => {}); }
      }
      else audio.dispose();
      if (dead.current) return;
      dispatchRef.current({ type: "started", greeting: o.greeting });
    })();
    tick = window.setInterval(() => { if (stateRef.current.phase !== "ended") setSeconds((s) => s + 1); }, 1000);
    // The orb follows the recording's level when we record ourselves.
    const levelT = window.setInterval(() => { if (listener.current) setLevel(listener.current.level()); }, 80);
    return () => {
      dead.current = true;
      window.clearInterval(tick);
      window.clearInterval(levelT);
      stopRecognition();
      listener.current?.dispose(); listener.current = null;
      void micCtx?.close().catch(() => {});
      cancelSpeech();
      audio.dispose();
      stopMeter();
      if (awaiting.current) { awaiting.current = null; agentRef.current.stop(); }
      try { wake.current?.release?.(); } catch { /* released */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Muting also silences the microphone track itself, so the browser's indicator reflects it.
  useEffect(() => { meter.current?.stream.getAudioTracks().forEach((t) => { t.enabled = !state.muted; }); listener.current?.setMuted(state.muted); }, [state.muted]);

  // The call is over once its phase says so and any last words (the goodbye) have been spoken.
  useEffect(() => {
    if (state.phase !== "ended") return;
    let waited = 0;
    const iv = window.setInterval(() => {
      waited += 200;
      if (!speakingNow.current || waited > 6000) { window.clearInterval(iv); setFinished(true); }
    }, 200);
    return () => window.clearInterval(iv);
  }, [state.phase]);

  const send = useCallback((e: CallEvent) => dispatchRef.current(e), []);
  /** speakingEarly: the reply (or a filler) is being spoken while it is still being written. */
  return { state, level, seconds, finished, dispatch: send, speed, setSpeed: applySpeed, speakingEarly: early };
}
