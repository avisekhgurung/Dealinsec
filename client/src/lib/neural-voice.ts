/** The browser side of the neural voice: our own /api/voice routes, and one reusable audio element. */
import { VoiceFetchError, type NeuralDeps } from "@shared/neural-speech";
import type { VoiceKey } from "@shared/voice-profiles";

/**
 * Where the sound goes, on phones. iOS (Safari 17+) has an Audio Session API: "playback" plays through the loudspeaker
 * at full media volume, even with the ring/silent switch on; while the microphone is listening it must be
 * "play-and-record" (or "auto"), which is also what sends speech to the quiet earpiece-level output. So: playback while
 * speaking, auto while listening. Elsewhere this does nothing.
 */
export function setAudioSession(type: "playback" | "auto") {
  try { const s = (navigator as any).audioSession; if (s && s.type !== type) s.type = type; } catch { /* not supported */ }
}

const isIOS = () => typeof navigator !== "undefined" && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
const isPhone = () => typeof navigator !== "undefined" && (isIOS() || /Android|Mobi/i.test(navigator.userAgent));
/** How much louder the voice plays (after a compressor, so peaks never clip): phones are the quiet case. */
export const VOICE_BOOST = { phone: 2.2, desktop: 1.4 } as const;

/** A silent 0.1 s WAV, played once inside the call's start so the browser allows later sounds (iOS/Safari autoplay rule). */
const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAABErAAABAAgAZGF0YQAAAAA=";

export async function neuralVoiceAvailable(): Promise<boolean> {
  try {
    const r = await fetch("/api/voice/status", { credentials: "include" });
    if (!r.ok) return false;
    const j = await r.json();
    return !!j?.neural && (j.remainingChars ?? 0) > 0;
  } catch { return false; }
}

/** `voice`: whose voice the server speaks in (Agent mode's by default, or a coworker's). */
export function createBrowserNeuralDeps(voice: VoiceKey = "agent"): { deps: NeuralDeps; unlock: () => void; dispose: () => void } {
  const audio = new Audio();
  audio.preload = "auto";
  audio.volume = 1;
  // Louder: the element through a compressor and a gain (an <audio> element alone stops at volume 1). Not on an iPhone
  // without the Audio Session API: there Web Audio obeys the silent switch, and a quiet voice beats a silent one.
  let ctx: AudioContext | null = null;
  const boost = () => {
    if (ctx || (isIOS() && !(navigator as any).audioSession)) return;
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    try {
      ctx = new AC();
      const src = ctx.createMediaElementSource(audio);
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -20; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.25;
      const gain = ctx.createGain();
      gain.gain.value = isPhone() ? VOICE_BOOST.phone : VOICE_BOOST.desktop;
      src.connect(comp).connect(gain).connect(ctx.destination);
    } catch { ctx = null; /* plays at normal volume */ }
  };
  let settle: { resolve: () => void; reject: (e: Error) => void } | null = null;
  audio.onended = () => { const s = settle; settle = null; s?.resolve(); };
  audio.onerror = () => { const s = settle; settle = null; s?.reject(new Error("audio error")); };
  const deps: NeuralDeps = {
    async fetchAudio(text, signal) {
      const r = await fetch("/api/voice/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, voice }), credentials: "include", signal });
      if (!r.ok) {
        let code = "upstream";
        try { code = (await r.json())?.code ?? code; } catch { /* not json */ }
        throw new VoiceFetchError(r.status, code);
      }
      return r.blob();
    },
    createUrl: (b) => URL.createObjectURL(b),
    revokeUrl: (u) => URL.revokeObjectURL(u),
    play(url) {
      return new Promise<void>((resolve, reject) => {
        settle = { resolve, reject };
        setAudioSession("playback");
        if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => {});
        audio.src = url;
        audio.play().catch((e) => { const s = settle; settle = null; s?.reject(e); });
      });
    },
    stopPlayback() {
      const s = settle; settle = null;
      try { audio.pause(); audio.removeAttribute("src"); audio.load(); } catch { /* nothing playing */ }
      s?.resolve();   // settle so nothing waits forever; the speaker ignores it once cancelled
    },
  };
  return {
    deps,
    unlock: () => {
      // Inside the person's tap: the loudspeaker route, the louder graph, and permission to play later.
      setAudioSession("playback");
      boost();
      if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => {});
      try { audio.src = SILENT_WAV; void audio.play().catch(() => {}); } catch { /* the first real sound may be refused; the fallback speaks it */ }
    },
    dispose: () => { deps.stopPlayback(); try { void ctx?.close(); } catch { /* already closed */ } ctx = null; },
  };
}
