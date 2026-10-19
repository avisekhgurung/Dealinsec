/**
 * "Read aloud" on one reply, on request (like a chat app's speaker button): the voice of whoever wrote it
 * (shared/voice-profiles.ts: Agent mode, Nibo, Mika or Zee). The neural voice through our /api/voice/speak route when
 * the server has one (Sarvam first), sentence by sentence with the tested speaker; otherwise the browser's own voice in
 * that coworker's pitch and pace. One reply at a time: starting another, pressing stop, or leaving the chat stops it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { speakable, splitSentences } from "@shared/voice";
import { createNeuralSpeaker } from "@shared/neural-speech";
import { VOICE_PROFILES, type VoiceKey } from "@shared/voice-profiles";
import { createBrowserNeuralDeps, neuralVoiceAvailable, setAudioSession } from "@/lib/neural-voice";

function browserSay(text: string, voice: VoiceKey): Promise<void> {
  return new Promise((resolve) => {
    try {
      const synth = window.speechSynthesis;
      const u = new SpeechSynthesisUtterance(text);
      const p = VOICE_PROFILES[voice].browser;
      u.pitch = p.pitch; u.rate = p.rate; u.volume = 1;
      const voices = synth.getVoices();
      const v = voices.find((x) => x.lang === "hi-IN") ?? voices.find((x) => x.lang === "en-IN") ?? null;
      if (v) { u.voice = v; u.lang = v.lang; }
      u.onend = () => resolve(); u.onerror = () => resolve();
      synth.speak(u);
    } catch { resolve(); }
  });
}

export function useReadAloud(voice: VoiceKey) {
  const [playing, setPlaying] = useState<string | null>(null);
  const pipe = useRef<{ speaker: ReturnType<typeof createNeuralSpeaker>; audio: ReturnType<typeof createBrowserNeuralDeps>; neural: Promise<boolean> } | null>(null);
  const token = useRef(0);

  const stop = useCallback(() => {
    token.current++;
    pipe.current?.speaker.cancel();
    try { window.speechSynthesis?.cancel(); } catch { /* nothing speaking */ }
    setPlaying(null);
  }, []);

  // A new voice (another coworker's chat) starts fresh; leaving releases everything.
  useEffect(() => () => { stop(); pipe.current?.audio.dispose(); pipe.current = null; }, [voice, stop]);

  /** Starts reading this reply, or stops it if it is the one playing. Call from a tap (browsers allow sound then). */
  const toggle = useCallback((key: string, text: string) => {
    if (playing === key) { stop(); return; }
    stop();
    const parts = splitSentences(speakable(text));
    if (!parts.length) return;
    if (!pipe.current) {
      const audio = createBrowserNeuralDeps(voice);
      pipe.current = { audio, speaker: createNeuralSpeaker(audio.deps), neural: neuralVoiceAvailable() };
    }
    pipe.current.audio.unlock();   // inside the tap: loudspeaker route, louder graph, permission to play
    setAudioSession("playback");
    const mine = ++token.current;
    setPlaying(key);
    const done = () => { if (mine === token.current) setPlaying(null); };
    const p = pipe.current;
    void p.neural.then((neural) => {
      if (mine !== token.current) return;
      if (neural && !p.speaker.disabled) p.speaker.speak(parts, { fallback: (t) => browserSay(t, voice), onDone: done });
      else void (async () => { for (const t of parts) { if (mine !== token.current) return; await browserSay(t, voice); } done(); })();
    });
  }, [playing, stop, voice]);

  return { playing, toggle, stop };
}
