/**
 * A coworker reads their finished reply aloud, in their own voice (shared/voice-profiles.ts), while The Nest's sound
 * is on. Sarvam's neural voice through our /api/voice/speak route when the server has it, sentence by sentence (the
 * same tested speaker as Agent mode's calls); otherwise the browser's own voice with the coworker's pitch and pace.
 *
 * Only a reply that has really finished is read, once, and never an error. A new message, turning sound off, leaving
 * the chat or switching coworker stops it at once. `speaking` drives the plush character's talking bob.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { speakable, splitSentences } from "@shared/voice";
import { createNeuralSpeaker } from "@shared/neural-speech";
import { VOICE_PROFILES } from "@shared/voice-profiles";
import type { Bot } from "@shared/ai-league";
import { createBrowserNeuralDeps, neuralVoiceAvailable } from "@/lib/neural-voice";
import type { ThreadMessage } from "@/hooks/use-agent";

/** One sentence in the browser's voice, preferring an Indian voice when the device has one. */
function browserSay(text: string, bot: Bot): Promise<void> {
  return new Promise((resolve) => {
    try {
      const synth = window.speechSynthesis;
      const u = new SpeechSynthesisUtterance(text);
      const p = VOICE_PROFILES[bot].browser;
      u.pitch = p.pitch; u.rate = p.rate;
      const voices = synth.getVoices();
      const v = voices.find((x) => x.lang === "hi-IN") ?? voices.find((x) => x.lang === "en-IN") ?? null;
      if (v) { u.voice = v; u.lang = v.lang; }
      u.onend = () => resolve(); u.onerror = () => resolve();
      synth.speak(u);
    } catch { resolve(); }
  });
}

export function useCoworkerVoice(bot: Bot, agent: { running: boolean; messages: ThreadMessage[] }, on: boolean) {
  const [speaking, setSpeaking] = useState(false);
  const speaker = useRef<ReturnType<typeof createNeuralSpeaker> | null>(null);
  const neural = useRef(false);
  const token = useRef(0);
  const spokenKey = useRef<string | null>(null);
  const wasRunning = useRef(agent.running);

  const stop = useCallback(() => {
    token.current++;
    speaker.current?.cancel();
    try { window.speechSynthesis?.cancel(); } catch { /* nothing speaking */ }
    setSpeaking(false);
  }, []);

  // The neural pipeline lives while sound is on, for this coworker.
  useEffect(() => {
    if (!on) { stop(); return; }
    const d = createBrowserNeuralDeps(bot);
    speaker.current = createNeuralSpeaker(d.deps);
    void neuralVoiceAvailable().then((v) => { neural.current = v; });
    // Whatever is already on screen when sound is turned on has been "heard": only new replies are read.
    spokenKey.current = [...agent.messages].reverse().find((m) => m.role === "assistant")?.key ?? null;
    return () => { stop(); d.dispose(); speaker.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, bot, stop]);

  useEffect(() => {
    const was = wasRunning.current;
    wasRunning.current = agent.running;
    if (!on) return;
    if (agent.running) { if (!was) stop(); return; }   // a new message: stop talking over it
    if (!was) return;                                   // only a reply that has just finished
    const last = [...agent.messages].reverse().find((m) => m.role === "assistant");
    if (!last || last.error || !last.content.trim() || last.key === spokenKey.current) return;
    spokenKey.current = last.key;
    const parts = splitSentences(speakable(last.content));
    if (!parts.length) return;
    const mine = ++token.current;
    setSpeaking(true);
    const done = () => { if (mine === token.current) setSpeaking(false); };
    if (neural.current && speaker.current && !speaker.current.disabled) {
      speaker.current.speak(parts, { fallback: (t) => browserSay(t, bot), onDone: done });
    } else {
      void (async () => { for (const t of parts) { if (mine !== token.current) return; await browserSay(t, bot); } done(); })();
    }
  }, [agent.running, agent.messages, on, bot, stop]);

  return { speaking, stop };
}
