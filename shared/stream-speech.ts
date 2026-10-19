/**
 * Speaking a reply WHILE it is still being written: sentences are pushed as the model finishes them, fetched as neural
 * audio one ahead of the one playing, and played back to back; a ready-made clip (a filler like "Hmm, let me check…")
 * can go first so the call never sits in silence. finish() says no more is coming; onDone fires once everything pushed
 * has been said. cancel() is immediate and final for this stream.
 *
 * Pure logic over injected pieces (shared with shared/neural-speech.ts: fetch, object URLs, play, stop), so ordering,
 * prefetch, fallback and cancel are tested without a browser. When the neural voice is off (`neural()` false, or it
 * refused because it isn't set up or today's allowance is used), each sentence is said by the fallback (the browser's
 * own voice) instead.
 */
import { VoiceFetchError, type NeuralDeps } from "./neural-speech";

const SWITCH_OFF = new Set(["VOICE_NOT_CONFIGURED", "daily_cap"]);

type Item = { kind: "text"; text: string; url?: Promise<string | null> } | { kind: "clip"; blob: Blob };

export function createStreamSpeaker(deps: NeuralDeps, o: { neural: () => boolean; fallback: (text: string) => Promise<void>; ahead?: number }) {
  const ahead = o.ahead ?? 1;
  const items: Item[] = [];
  let next = 0;                 // the item playing (or about to)
  let finished = false;
  let cancelled = false;
  let off = false;
  let onDone: (() => void) | null = null;
  let wake: (() => void) | null = null;
  let running = false;
  const controllers: AbortController[] = [];
  const urls: string[] = [];
  let spokeAny = false;

  const fetchFor = (it: Extract<Item, { kind: "text" }>) => {
    if (it.url || off || !o.neural()) return;
    const ac = new AbortController();
    controllers.push(ac);
    it.url = deps.fetchAudio(it.text, ac.signal).then(
      (blob) => { if (cancelled) return null; const u = deps.createUrl(blob); urls.push(u); return u; },
      (e) => { if (e instanceof VoiceFetchError && SWITCH_OFF.has(e.code)) off = true; return null; },
    );
  };
  const prefetch = () => {
    for (let i = next; i < Math.min(items.length, next + ahead + 1); i++) { const it = items[i]; if (it.kind === "text") fetchFor(it); }
  };

  const loop = async () => {
    if (running) return;
    running = true;
    while (!cancelled) {
      if (next >= items.length) {
        if (finished) { running = false; const d = onDone; onDone = null; d?.(); return; }
        await new Promise<void>((r) => { wake = r; });
        wake = null;
        continue;
      }
      prefetch();
      const it = items[next];
      try {
        if (it.kind === "clip") {
          const u = deps.createUrl(it.blob); urls.push(u);
          await deps.play(u);
        } else {
          const u = it.url ? await it.url : null;
          if (cancelled) break;
          if (u) await deps.play(u); else await o.fallback(it.text);
        }
      } catch {
        if (!cancelled && it.kind === "text") await o.fallback(it.text).catch(() => {});
      }
      if (cancelled) break;
      spokeAny = true;
      next++;
    }
    running = false;
  };

  const kick = () => { if (cancelled) return; prefetch(); if (wake) wake(); else void loop(); };

  return {
    /** Sentences pushed so far (fillers not counted). */
    get pushed() { return items.filter((i) => i.kind === "text").length; },
    /** Whether anything has been said yet in this stream. */
    get started() { return spokeAny || next > 0 || (running && items.length > 0); },
    get disabled() { return off; },
    push(text: string) {
      const t = text.trim();
      if (!t || cancelled || finished) return;
      items.push({ kind: "text", text: t });
      kick();
    },
    /** A ready-made clip, played in turn (a filler before the first sentence). */
    pushClip(blob: Blob) {
      if (cancelled || finished) return;
      items.push({ kind: "clip", blob });
      kick();
    },
    /** Nothing more is coming; `done` runs once everything pushed has been said (at once if nothing was). */
    finish(done: () => void) {
      if (cancelled) return;
      finished = true;
      onDone = done;
      if (!running) void loop(); else if (wake) wake();
    },
    cancel() {
      cancelled = true;
      controllers.forEach((c) => c.abort());
      urls.forEach((u) => deps.revokeUrl(u));
      deps.stopPlayback();
      if (wake) wake();
      onDone = null;
    },
  };
}

/** The finished sentences in text that is still arriving: everything up to the last sentence end followed by a space. */
export function completedPrefix(text: string): string {
  const m = text.match(/^[\s\S]*[.!?…]["')\]]*(?=\s)/);
  return m ? m[0] : "";
}
