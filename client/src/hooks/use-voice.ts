/**
 * Voice in the chat box.
 *   - useSpeechInput  : dictate into the message box. The text is only ever put in
 *                       the box for the person to read and send; nothing is sent by voice.
 *                       Through our own boosted mic recording and Sarvam speech to text when
 *                       the server has it (lib/dictation.ts: louder, and it hears Hinglish);
 *                       else, or after Sarvam fails, the browser's own recogniser.
 *   - useSpeechOutput : read the agent's replies aloud (off by default, remembered).
 * Approvals are never given by voice: they stay a deliberate tap on the card.
 * Note: some browsers (Chrome) send dictation audio to their own speech service.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { speakable } from "@shared/voice";
import { startDictation, type Dictation } from "@/lib/dictation";
import { canRecord, sttAvailable } from "@/lib/server-listener";

/** Whether the server transcribes, asked once and remembered for a few minutes (it can turn off at the daily cap). */
let sttCache: { at: number; ok: Promise<boolean> } | null = null;
const serverStt = (): Promise<boolean> => {
  if (!sttCache || Date.now() - sttCache.at > 5 * 60_000) sttCache = { at: Date.now(), ok: sttAvailable() };
  return sttCache.ok;
};

type Recognition = any;
const getCtor = (): (new () => Recognition) | null =>
  typeof window === "undefined" ? null : (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;

export function useSpeechInput({ lang, onTranscript }: { lang: string; onTranscript: (text: string) => void }) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const cb = useRef(onTranscript);
  cb.current = onTranscript;
  // Sarvam, when the server has it: known before the first tap, so the tap itself opens the mic.
  const [server, setServer] = useState(false);
  const broken = useRef(false);
  const dict = useRef<Dictation | null>(null);
  const opening = useRef(false);
  /** A stop or cancel tapped while the mic was still opening. */
  const early = useRef<"stop" | "cancel" | null>(null);
  useEffect(() => { if (!canRecord()) return; let live = true; void serverStt().then((ok) => { if (live) setServer(ok); }); return () => { live = false; }; }, []);
  const useServer = server && !broken.current;
  const supported = !!getCtor() || useServer;

  const stop = useCallback(() => {
    if (dict.current) { dict.current.stop(); return; }
    if (opening.current) { early.current = "stop"; return; }
    try { rec.current?.stop(); } catch { /* already stopped */ }
  }, []);

  /** Stop without taking any more words (the message is being sent). */
  const cancel = useCallback(() => {
    if (dict.current) { dict.current.cancel(); return; }
    if (opening.current) { early.current = "cancel"; return; }
    try { rec.current?.abort(); } catch { /* already stopped */ }
  }, []);

  const startServer = () => {
    if (dict.current || opening.current) return;
    setError(null);
    opening.current = true;
    early.current = null;
    setListening(true);
    void startDictation({
      onText: (t) => cb.current(t),
      onEnd: () => { dict.current = null; setListening(false); },
      onError: (message, isBroken) => {
        setError(message);
        if (isBroken && getCtor()) { broken.current = true; setServer(false); }
      },
    }).then((d) => {
      opening.current = false;
      if (d === "blocked") { setListening(false); setError("Microphone access is blocked. Allow it in your browser's site settings."); return; }
      if (d === "unsupported") { setListening(false); if (getCtor()) { broken.current = true; setServer(false); } setError("Voice typing couldn't start."); return; }
      dict.current = d;
      if (early.current) { const e = early.current; early.current = null; if (e === "stop") d.stop(); else d.cancel(); }
    });
  };

  const start = useCallback(() => {
    if (useServer) { startServer(); return; }
    const Ctor = getCtor();
    if (!Ctor || rec.current) return;
    setError(null);
    const r: Recognition = new Ctor();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e: any) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      cb.current(text.trim());
    };
    r.onerror = (e: any) => {
      const code = String(e?.error ?? "");
      if (code === "not-allowed" || code === "service-not-allowed") setError("Microphone access is blocked. Allow it in your browser's site settings.");
      else if (code === "no-speech") setError("I didn't hear anything. Try again.");
      else if (code !== "aborted") setError("Voice typing isn't available right now.");
    };
    r.onend = () => { rec.current = null; setListening(false); };
    rec.current = r;
    try { r.start(); setListening(true); } catch { rec.current = null; setError("Voice typing couldn't start."); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, useServer]);

  useEffect(() => () => { dict.current?.cancel(); try { rec.current?.abort(); } catch { /* gone */ } }, []);
  /** provider: who turns the audio into words, for the button's hint. */
  return { supported, listening, error, start, stop, cancel, toggle: () => (listening ? stop() : start()), provider: useServer ? ("sarvam" as const) : ("browser" as const) };
}

const OUT_KEY = "dis-voice-out";
const synth = (): SpeechSynthesis | null => (typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null);

export function useSpeechOutput(lang: string) {
  const supported = !!synth();
  const [enabled, setEnabledState] = useState(() => { try { return window.localStorage.getItem(OUT_KEY) === "1"; } catch { return false; } });
  const setEnabled = useCallback((v: boolean) => {
    setEnabledState(v);
    try { window.localStorage.setItem(OUT_KEY, v ? "1" : "0"); } catch { /* not remembered */ }
    if (!v) synth()?.cancel();
  }, []);
  const cancel = useCallback(() => synth()?.cancel(), []);
  const speak = useCallback((text: string) => {
    const s = synth();
    const t = speakable(text);
    if (!s || !t) return;
    s.cancel();
    const u = new SpeechSynthesisUtterance(t);
    u.lang = lang;
    s.speak(u);
  }, [lang]);
  useEffect(() => () => synth()?.cancel(), []);
  return { supported, enabled, setEnabled, speak, cancel };
}
