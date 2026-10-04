/**
 * Speaking a reply with the neural voice, sentence by sentence, without gaps and without
 * ever going silent. Pure logic over injected pieces (network, audio, the browser-voice
 * fallback), so the ordering, prefetch, cancel and fallback rules are tested without a browser.
 *
 *  - Sentences are fetched ahead (`ahead` of them), while the current one plays.
 *  - A sentence that cannot be fetched is spoken by the fallback (the browser's voice) instead.
 *  - Two kinds of failure switch the neural voice off for the rest of the call: it is not set
 *    up, or today's allowance is used up (no point asking again for every sentence).
 *  - cancel() is immediate and final: nothing started before it can speak or call back after it.
 */
export class VoiceFetchError extends Error {
  constructor(public status: number, public code: string) { super(`voice ${status} ${code}`); }
}

export interface NeuralDeps {
  /** One sentence to audio; rejects with VoiceFetchError (or anything) on failure; honours the abort signal. */
  fetchAudio(text: string, signal: AbortSignal): Promise<Blob>;
  createUrl(blob: Blob): string;
  revokeUrl(url: string): void;
  /** Plays one audio URL; resolves when it has ended, rejects if it cannot play. */
  play(url: string): Promise<void>;
  stopPlayback(): void;
}
export interface SpeakHandlers {
  /** Speak this sentence some other way (the browser's voice); resolves when it has been said. */
  fallback(text: string): Promise<void>;
  /** Everything has been said (never after cancel). */
  onDone(): void;
}

const SWITCH_OFF = new Set(["VOICE_NOT_CONFIGURED", "daily_cap"]);

export function createNeuralSpeaker(deps: NeuralDeps, opts: { ahead?: number } = {}) {
  const ahead = opts.ahead ?? 1;
  let token = 0;
  let off = false;
  let controllers: AbortController[] = [];
  let urls: string[] = [];

  const cleanup = () => {
    controllers.forEach((c) => c.abort());
    controllers = [];
    urls.forEach((u) => deps.revokeUrl(u));
    urls = [];
  };

  return {
    /** True once the neural voice has been given up for this call. */
    get disabled() { return off; },
    cancel() {
      token++;
      cleanup();
      deps.stopPlayback();
    },
    speak(parts: string[], h: SpeakHandlers) {
      token++;
      cleanup();
      const mine = token;
      const live = () => mine === token;
      const pending = new Map<number, Promise<string | null>>();

      const start = (i: number) => {
        if (i >= parts.length || pending.has(i) || off) return;
        const ac = new AbortController();
        controllers.push(ac);
        pending.set(i, deps.fetchAudio(parts[i], ac.signal).then(
          (blob) => { if (!live()) return null; const u = deps.createUrl(blob); urls.push(u); return u; },
          (e) => {
            if (!live()) return null;
            if (e instanceof VoiceFetchError && SWITCH_OFF.has(e.code)) off = true;
            return null;
          },
        ));
      };

      (async () => {
        for (let i = 0; i < Math.min(parts.length, ahead + 1); i++) start(i);
        for (let i = 0; i < parts.length; i++) {
          if (!live()) return;
          start(i);               // in case a switch-off was lifted, or this one was never started
          const url = off ? null : await pending.get(i);
          if (!live()) return;
          for (let k = i + 1; k <= i + 1 + ahead; k++) start(k);
          let spoken = false;
          if (url) {
            try { await deps.play(url); spoken = true; } catch { /* could not play: say it the other way */ }
            if (!live()) return;
          }
          if (!spoken) { await h.fallback(parts[i]).catch(() => {}); if (!live()) return; }
        }
        if (live()) h.onDone();
      })();
    },
  };
}
