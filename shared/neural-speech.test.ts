import { describe, expect, it } from "vitest";
import { VoiceFetchError, createNeuralSpeaker, type NeuralDeps } from "./neural-speech";

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 20; i++) await tick(); };

function rig(over: Partial<NeuralDeps> = {}) {
  const log: string[] = [];
  const fetches: { text: string; resolve: (b: Blob) => void; reject: (e: unknown) => void; signal: AbortSignal }[] = [];
  const plays: { url: string; end: () => void; fail: () => void }[] = [];
  const deps: NeuralDeps = {
    fetchAudio: (text, signal) => new Promise((resolve, reject) => { log.push(`fetch ${text}`); fetches.push({ text, resolve, reject, signal }); }),
    createUrl: (b) => { log.push(`create ${(b as any).name}`); return `blob:${(b as any).name}`; },
    revokeUrl: (u) => log.push(`revoke ${u}`),
    play: (url) => new Promise<void>((resolve, reject) => { log.push(`play ${url}`); plays.push({ url, end: resolve, fail: () => reject(new Error("x")) }); }),
    stopPlayback: () => log.push("stop"),
    ...over,
  };
  const blob = (n: string) => Object.assign(new Blob(["x"]), { name: n });
  const handlers = (): { fallback(t: string): Promise<void>; onDone(): void; said: string[]; done: number } => {
    const h = { said: [] as string[], done: 0, fallback: async (t: string) => { h.said.push(t); log.push(`fallback ${t}`); }, onDone: () => { h.done++; log.push("done"); } };
    return h;
  };
  return { log, fetches, plays, deps, blob, handlers };
}

describe("createNeuralSpeaker", () => {
  it("plays sentences in order, fetching the next while the current one plays, and says done once", async () => {
    const r = rig(); const s = createNeuralSpeaker(r.deps); const h = r.handlers();
    s.speak(["One.", "Two.", "Three."], h);
    await settle();
    expect(r.fetches.map((f) => f.text)).toEqual(["One.", "Two."]);          // the first and one ahead
    r.fetches[0].resolve(r.blob("a")); await settle();
    expect(r.plays.map((p) => p.url)).toEqual(["blob:a"]);
    expect(r.fetches.map((f) => f.text)).toEqual(["One.", "Two.", "Three."]); // the third is requested as the first starts
    r.fetches[1].resolve(r.blob("b")); r.fetches[2].resolve(r.blob("c"));
    r.plays[0].end(); await settle(); r.plays[1].end(); await settle(); r.plays[2].end(); await settle();
    expect(r.plays.map((p) => p.url)).toEqual(["blob:a", "blob:b", "blob:c"]);
    expect(h.done).toBe(1); expect(h.said).toEqual([]);
  });

  it("speaks a sentence that failed to fetch with the fallback, in its place, and carries on", async () => {
    const r = rig(); const s = createNeuralSpeaker(r.deps); const h = r.handlers();
    s.speak(["One.", "Two."], h);
    await settle();
    r.fetches[0].resolve(r.blob("a")); r.fetches[1].reject(new VoiceFetchError(502, "upstream")); await settle();
    r.plays[0].end(); await settle();
    expect(h.said).toEqual(["Two."]); expect(h.done).toBe(1);
    expect(r.plays).toHaveLength(1);
    expect(r.log.indexOf("play blob:a")).toBeLessThan(r.log.indexOf("fallback Two."));
  });

  it("falls back when a sentence fetched but cannot be played", async () => {
    const r = rig(); const s = createNeuralSpeaker(r.deps); const h = r.handlers();
    s.speak(["One."], h); await settle();
    r.fetches[0].resolve(r.blob("a")); await settle();
    r.plays[0].fail(); await settle();
    expect(h.said).toEqual(["One."]); expect(h.done).toBe(1);
  });

  it("gives up on the neural voice for the rest of the call when it is not set up or the allowance is used, and stops asking", async () => {
    for (const code of ["VOICE_NOT_CONFIGURED", "daily_cap"]) {
      const r = rig(); const s = createNeuralSpeaker(r.deps); const h = r.handlers();
      s.speak(["One.", "Two.", "Three."], h); await settle();
      r.fetches[0].reject(new VoiceFetchError(503, code)); await settle();
      expect(s.disabled, code).toBe(true);
      expect(h.said, code).toEqual(["One.", "Two.", "Three."]);
      expect(r.fetches.length, code).toBeLessThanOrEqual(2); // only what was already in flight
      const again = r.handlers(); s.speak(["Four."], again); await settle();
      expect(again.said).toEqual(["Four."]); expect(r.fetches.length).toBeLessThanOrEqual(2);
    }
  });

  it("does not give up for an ordinary failure: the next call to speak tries the neural voice again", async () => {
    const r = rig(); const s = createNeuralSpeaker(r.deps);
    s.speak(["One."], r.handlers()); await settle();
    r.fetches[0].reject(new VoiceFetchError(502, "upstream")); await settle();
    expect(s.disabled).toBe(false);
  });

  it("cancel is immediate and final: nothing speaks, falls back or reports done afterwards, requests are aborted and files released", async () => {
    const r = rig(); const s = createNeuralSpeaker(r.deps); const h = r.handlers();
    s.speak(["One.", "Two.", "Three."], h); await settle();
    r.fetches[0].resolve(r.blob("a")); await settle();
    expect(r.plays).toHaveLength(1);
    s.cancel();
    expect(r.fetches.every((f) => f.signal.aborted)).toBe(true);
    expect(r.log).toContain("stop"); expect(r.log).toContain("revoke blob:a");
    r.fetches[1].resolve(r.blob("b")); r.plays[0].end(); await settle();
    expect(r.plays).toHaveLength(1); expect(h.said).toEqual([]); expect(h.done).toBe(0);
    expect(r.log.filter((l) => l === "revoke blob:b")).toHaveLength(0); // a late answer after cancel is never turned into a file
  });

  it("cancelling during the LAST sentence never reports done, however the playback ends", async () => {
    for (const how of ["end", "fail"] as const) {
      const r = rig(); const s = createNeuralSpeaker(r.deps); const h = r.handlers();
      s.speak(["Only."], h); await settle();
      r.fetches[0].resolve(r.blob("a")); await settle();
      s.cancel();
      r.plays[0][how](); await settle();
      expect(h.done, how).toBe(0); expect(h.said, how).toEqual([]);
    }
  });
  it("an answer that arrives after a cancel is never turned into a file or played", async () => {
    const r = rig(); const s = createNeuralSpeaker(r.deps); const h = r.handlers();
    s.speak(["One."], h); await settle();
    s.cancel();
    r.fetches[0].resolve(r.blob("late")); await settle();
    expect(r.log.some((l) => l.startsWith("create"))).toBe(false);
    expect(r.plays).toHaveLength(0); expect(h.done).toBe(0);
  });
  it("a new speak replaces the old one: the old one never reports done or speaks", async () => {
    const r = rig(); const s = createNeuralSpeaker(r.deps); const old = r.handlers(), fresh = r.handlers();
    s.speak(["Old."], old); await settle();
    s.speak(["New."], fresh); await settle();
    const newFetch = r.fetches.find((f) => f.text === "New.")!; newFetch.resolve(r.blob("n")); await settle();
    r.fetches[0].resolve(r.blob("o")); await settle();
    r.plays.forEach((p) => p.end()); await settle();
    expect(old.done).toBe(0); expect(old.said).toEqual([]);
    expect(fresh.done).toBe(1);
    expect(r.plays.map((p) => p.url)).toEqual(["blob:n"]);
  });

  it("nothing to say finishes at once", async () => {
    const r = rig(); const s = createNeuralSpeaker(r.deps); const h = r.handlers();
    s.speak([], h); await settle();
    expect(h.done).toBe(1); expect(r.fetches).toHaveLength(0);
  });

  it("never has more than the current sentence and one ahead requested", async () => {
    const r = rig(); const s = createNeuralSpeaker(r.deps); const h = r.handlers();
    s.speak(Array.from({ length: 8 }, (_, i) => `S${i}.`), h); await settle();
    expect(r.fetches).toHaveLength(2);
    r.fetches[0].resolve(r.blob("0")); await settle();
    expect(r.fetches).toHaveLength(3);
  });
});
