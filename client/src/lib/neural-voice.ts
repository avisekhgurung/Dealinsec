/** The browser side of the neural voice: our own /api/voice routes, and one reusable audio element. */
import { VoiceFetchError, type NeuralDeps } from "@shared/neural-speech";

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

export function createBrowserNeuralDeps(): { deps: NeuralDeps; unlock: () => void; dispose: () => void } {
  const audio = new Audio();
  audio.preload = "auto";
  let settle: { resolve: () => void; reject: (e: Error) => void } | null = null;
  audio.onended = () => { const s = settle; settle = null; s?.resolve(); };
  audio.onerror = () => { const s = settle; settle = null; s?.reject(new Error("audio error")); };
  const deps: NeuralDeps = {
    async fetchAudio(text, signal) {
      const r = await fetch("/api/voice/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }), credentials: "include", signal });
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
    unlock: () => { try { audio.src = SILENT_WAV; void audio.play().catch(() => {}); } catch { /* the first real sound may be refused; the fallback speaks it */ } },
    dispose: () => deps.stopPlayback(),
  };
}
