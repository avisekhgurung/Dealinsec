/**
 * A voice call with the agent, hands-free: it listens, notices when you have
 * finished a sentence, thinks, answers aloud in a gentleman's voice, and listens
 * again; you can interrupt at any time. The turn-taking itself is the pure state
 * machine in shared/voice-call.ts (tested); this hook only carries out its
 * effects against the browser's microphone and speech.
 *
 * Half-duplex: the recogniser is off while the agent speaks, so it never hears
 * itself. A tap interrupts. Interrupting by voice (a level meter on a microphone
 * stream with echo cancellation, checked by shared/voice.ts's detector) is
 * opt-in, because whether a given device cancels its own speaker's echo can't be
 * known in advance.
 *
 * The call lives and dies with the component that uses this hook: on unmount
 * everything is released (recogniser, speech, microphone, wake lock).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createBargeInDetector, pickGentlemanVoice, speakable, splitSentences } from "@shared/voice";
import { initialCall, isUtterance, reduceCall, type CallEffect, type CallEvent, type CallState } from "@shared/voice-call";
import type { useAgent } from "@/hooks/use-agent";

type Agent = ReturnType<typeof useAgent>;

/** How long a pause means "I've finished my sentence". */
const SILENCE_MS = 1200;
/** How long of nothing before "are you still there?" */
const IDLE_MS = 30_000;

const Recognition = (): (new () => any) | null =>
  typeof window === "undefined" ? null : (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;

export const voiceCallSupported = (): boolean => !!Recognition() && typeof window !== "undefined" && "speechSynthesis" in window;

const isIOS = () => typeof navigator !== "undefined" && /iP(hone|ad|od)/.test(navigator.userAgent);

export function useVoiceCall(o: { agent: Agent; lang: string; greeting: string; bargeIn: boolean }) {
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
  const meter = useRef<{ stream: MediaStream; ctx: AudioContext; raf: number } | null>(null);
  const wake = useRef<any>(null);
  const dispatchRef = useRef<(e: CallEvent) => void>(() => {});

  // ── speaking ────────────────────────────────────────────────────────────
  const cancelSpeech = () => {
    speakToken.current++;
    speakingNow.current = false;
    try { window.speechSynthesis.cancel(); } catch { /* nothing speaking */ }
  };

  const speak = (text: string) => {
    const synth = window.speechSynthesis;
    const parts = splitSentences(speakable(text, 900));
    cancelSpeech();
    if (!parts.length) { dispatchRef.current({ type: "speech_done" }); return; }
    const token = speakToken.current;
    speakingNow.current = true;
    const voices = synth.getVoices();
    const vi = pickGentlemanVoice(voices, o.lang);
    const voice = vi >= 0 ? voices[vi] : null;
    let i = 0;
    const next = () => {
      if (token !== speakToken.current || dead.current) return;
      if (i >= parts.length) { speakingNow.current = false; dispatchRef.current({ type: "speech_done" }); return; }
      const u = new SpeechSynthesisUtterance(parts[i++]);
      if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = o.lang;
      u.rate = 0.98;   // unhurried
      u.pitch = 0.9;   // a little lower: measured, not chirpy
      u.onend = next;
      u.onerror = next;
      synth.speak(u);
    };
    // A beat after cancel(): some browsers drop a speak() issued in the same tick.
    window.setTimeout(next, 80);
  };

  // ── listening ───────────────────────────────────────────────────────────
  const armIdle = () => {
    window.clearTimeout(idleT.current);
    idleT.current = window.setTimeout(() => dispatchRef.current({ type: "idle_timeout" }), IDLE_MS);
  };
  const armEndpoint = () => {
    window.clearTimeout(endpointT.current);
    endpointT.current = window.setTimeout(() => {
      const t = transcript.current;
      if (isUtterance(t)) { transcript.current = ""; dispatchRef.current({ type: "utterance", text: t }); }
    }, SILENCE_MS);
  };

  const stopRecognition = () => {
    wantListen.current = false;
    window.clearTimeout(endpointT.current);
    window.clearTimeout(idleT.current);
    const r = rec.current;
    rec.current = null;
    try { r?.abort(); } catch { /* already stopped */ }
  };

  const startRecognition = () => {
    if (dead.current || stateRef.current.muted) return;
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
      transcript.current = t.trim();
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
    if (isIOS() || !navigator.mediaDevices?.getUserMedia) return "skipped";
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (dead.current) { stream.getTracks().forEach((t) => t.stop()); return "skipped"; }
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx: AudioContext = new Ctx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const detector = createBargeInDetector();
      let smooth = 0, last = 0, lastPhase = "";
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
        const rms = Math.sqrt(sum / buf.length);
        smooth = smooth * 0.7 + rms * 0.3;
        const now = performance.now();
        if (now - last > 60) { last = now; setLevel(Math.min(1, smooth * 5)); }
        const st = stateRef.current;
        if (st.phase !== lastPhase) { lastPhase = st.phase; detector.reset(); }
        if (bargeRef.current && st.phase === "speaking" && !st.muted && detector.push(now, rms)) dispatchRef.current({ type: "interrupt" });
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
      case "speak": speak(fx.text); break;
      case "cancel_speech": cancelSpeech(); break;
      case "send":
        awaiting.current = { sawRunning: false, at: Date.now() };
        void agentRef.current.send(fx.text);
        break;
      case "stop_run":
        awaiting.current = null;
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
    const text = speakable(reply?.content ?? "", 900);
    const needsTap = !!reply?.cards.some((c) => c.kind === "approval");
    if (isUtterance(text)) dispatchRef.current({ type: "reply", text });
    else if (needsTap) dispatchRef.current({ type: "reply", text: "That is ready for your approval on your screen, whenever you are." });
    else dispatchRef.current({ type: "reply_empty" });
  }, [running, messages]);

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
    (async () => {
      if (!voiceCallSupported()) { dispatchRef.current({ type: "error", code: "unsupported" }); return; }
      const m = await startMeter();
      if (dead.current) return;
      if (m === "blocked") { dispatchRef.current({ type: "error", code: "mic_blocked" }); return; }
      try { wake.current = await (navigator as any).wakeLock?.request?.("screen"); } catch { /* the screen may dim; fine */ }
      // Voices load lazily in some browsers: nudge the list before the first word.
      try { window.speechSynthesis.getVoices(); } catch { /* none */ }
      dispatchRef.current({ type: "started", greeting: o.greeting });
    })();
    tick = window.setInterval(() => { if (stateRef.current.phase !== "ended") setSeconds((s) => s + 1); }, 1000);
    return () => {
      dead.current = true;
      window.clearInterval(tick);
      stopRecognition();
      cancelSpeech();
      stopMeter();
      if (awaiting.current) { awaiting.current = null; agentRef.current.stop(); }
      try { wake.current?.release?.(); } catch { /* released */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Muting also silences the microphone track itself, so the browser's indicator reflects it.
  useEffect(() => { meter.current?.stream.getAudioTracks().forEach((t) => { t.enabled = !state.muted; }); }, [state.muted]);

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
  return { state, level, seconds, finished, dispatch: send };
}
