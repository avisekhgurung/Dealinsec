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
import { pickGentlemanVoice, speakable, splitSentences } from "@shared/voice";
import { createNeuralSpeaker } from "@shared/neural-speech";
import { createBrowserNeuralDeps, neuralVoiceAvailable } from "@/lib/neural-voice";
import { approvalReadback, initialCall, isPersonTalking, isUtterance, reduceCall, type CallEffect, type CallEvent, type CallState, type PendingApproval } from "@shared/voice-call";
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
  const speakingText = useRef("");
  const meter = useRef<{ stream: MediaStream; ctx: AudioContext; raf: number } | null>(null);
  const wake = useRef<any>(null);
  const dispatchRef = useRef<(e: CallEvent) => void>(() => {});
  // The neural voice, when the server has one: sentences fetched ahead and played; the browser's voice covers any that fail.
  const neural = useRef<{ speaker: ReturnType<typeof createNeuralSpeaker>; audio: ReturnType<typeof createBrowserNeuralDeps> } | null>(null);

  // ── speaking ────────────────────────────────────────────────────────────
  const cancelSpeech = () => {
    speakToken.current++;
    speakingNow.current = false;
    neural.current?.speaker.cancel();
    try { window.speechSynthesis.cancel(); } catch { /* nothing speaking */ }
  };

  const speak = (text: string) => {
    const synth = window.speechSynthesis;
    const parts = splitSentences(speakable(text, 900));
    cancelSpeech();
    speakingText.current = text;
    if (!parts.length) { dispatchRef.current({ type: "speech_done" }); return; }
    const token = speakToken.current;
    speakingNow.current = true;
    const voices = synth.getVoices();
    const vi = pickGentlemanVoice(voices, o.lang);
    const voice = vi >= 0 ? voices[vi] : null;
    const sayWithBrowser = (part: string) => new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(part);
      if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = o.lang;
      u.rate = 0.98; u.pitch = 0.9;
      u.onend = () => resolve(); u.onerror = () => resolve();
      synth.speak(u);
    });
    const finished = () => { if (token !== speakToken.current || dead.current) return; speakingNow.current = false; restartFresh(); dispatchRef.current({ type: "speech_done" }); };
    if (neural.current && !neural.current.speaker.disabled) {
      neural.current.speaker.speak(parts, { fallback: sayWithBrowser, onDone: finished });
      return;
    }
    let i = 0;
    const next = () => {
      if (token !== speakToken.current || dead.current) return;
      if (i >= parts.length) { speakingNow.current = false; restartFresh(); dispatchRef.current({ type: "speech_done" }); return; }
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

  const restartFresh = () => {
    const r = rec.current;
    rec.current = null;
    transcript.current = "";
    try { r?.abort(); } catch { /* gone */ }
  };

  /** Listening while the assistant speaks, so the person can cut in. */
  const listenWhileSpeaking = () => { if (bargeRef.current && !stateRef.current.muted) startRecognition(); };

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
    const pending: PendingApproval[] = (reply?.cards ?? [])
      .filter((c) => c.kind === "approval" && typeof c.data.approvalId === "string")
      .map((c) => ({ approvalId: String(c.data.approvalId), tool: String(c.data.tool ?? ""), risk: String(c.data.risk ?? "SAFE_MUTATION"), readback: approvalReadback((c.data.preview ?? {}) as any, String(c.data.risk ?? "")) }));
    if (pending.length) dispatchRef.current({ type: "reply", text: isUtterance(text) ? text : "", approvals: pending });
    else if (isUtterance(text)) dispatchRef.current({ type: "reply", text });
    else dispatchRef.current({ type: "reply_empty" });
  }, [running, messages]);

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
    const audio = createBrowserNeuralDeps();
    audio.unlock();
    (async () => {
      if (!voiceCallSupported()) { audio.dispose(); dispatchRef.current({ type: "error", code: "unsupported" }); return; }
      const m = await startMeter();
      if (dead.current) return;
      if (m === "blocked") { dispatchRef.current({ type: "error", code: "mic_blocked" }); return; }
      try { wake.current = await (navigator as any).wakeLock?.request?.("screen"); } catch { /* the screen may dim; fine */ }
      // Voices load lazily in some browsers: nudge the list before the first word.
      try { window.speechSynthesis.getVoices(); } catch { /* none */ }
      if (await neuralVoiceAvailable()) { if (dead.current) return; neural.current = { speaker: createNeuralSpeaker(audio.deps), audio }; }
      else audio.dispose();
      if (dead.current) return;
      dispatchRef.current({ type: "started", greeting: o.greeting });
    })();
    tick = window.setInterval(() => { if (stateRef.current.phase !== "ended") setSeconds((s) => s + 1); }, 1000);
    return () => {
      dead.current = true;
      window.clearInterval(tick);
      stopRecognition();
      cancelSpeech();
      audio.dispose();
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
