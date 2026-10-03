/**
 * Voice, using the browser's own speech services (no server, no new account).
 *   - useSpeechInput  : dictate into the message box. The text is only ever put in
 *                       the box for the person to read and send; nothing is sent by voice.
 *   - useSpeechOutput : read the agent's replies aloud (off by default, remembered).
 * Approvals are never given by voice: they stay a deliberate tap on the card.
 * Note: some browsers (Chrome) send dictation audio to their own speech service.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { speakable } from "@shared/voice";

type Recognition = any;
const getCtor = (): (new () => Recognition) | null =>
  typeof window === "undefined" ? null : (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;

export function useSpeechInput({ lang, onTranscript }: { lang: string; onTranscript: (text: string) => void }) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const cb = useRef(onTranscript);
  cb.current = onTranscript;
  const supported = !!getCtor();

  const stop = useCallback(() => { try { rec.current?.stop(); } catch { /* already stopped */ } }, []);

  const start = useCallback(() => {
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
  }, [lang]);

  useEffect(() => () => { try { rec.current?.abort(); } catch { /* gone */ } }, []);
  return { supported, listening, error, start, stop, toggle: () => (listening ? stop() : start()) };
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
