import { describe, expect, it } from "vitest";
import { completedPrefix, createStreamSpeaker } from "./stream-speech";
import { VoiceFetchError, type NeuralDeps } from "./neural-speech";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function fakeDeps(o: { fail?: (t: string) => unknown; slow?: number } = {}) {
  const log: string[] = [];
  const fetched: string[] = [];
  const deps: NeuralDeps = {
    async fetchAudio(text) { fetched.push(text); await tick(o.slow ?? 1); const f = o.fail?.(text); if (f) throw f; return new Blob([text]); },
    createUrl: (b) => `url:${(b as any).size}:${Math.random()}`,
    revokeUrl: () => {},
    async play(url) { log.push(`play ${url.split(":")[1]}`); await tick(2); },
    stopPlayback: () => { log.push("stop"); },
  };
  return { deps, log, fetched };
}

describe("speaking a reply while it is written", () => {
  it("plays a filler clip first, then sentences in order as they arrive, then says it's done", async () => {
    const { deps, log } = fakeDeps();
    const said: string[] = [];
    const s = createStreamSpeaker(deps, { neural: () => true, fallback: async (t) => { said.push(t); } });
    s.pushClip(new Blob(["hmm"]));        // size 3
    s.push("First sentence.");            // size 15
    await tick(5);
    s.push("Second one!");                // size 11
    let done = false;
    s.finish(() => { done = true; });
    await tick(40);
    expect(log.filter((l) => l.startsWith("play")).map((l) => l.split(" ")[1])).toEqual(["3", "15", "11"]);
    expect(done).toBe(true);
    expect(said).toEqual([]);
  });

  it("finishing with nothing pushed is done at once", async () => {
    const { deps } = fakeDeps();
    let done = false;
    createStreamSpeaker(deps, { neural: () => true, fallback: async () => {} }).finish(() => { done = true; });
    await tick(1);
    expect(done).toBe(true);
  });

  it("a sentence the voice service can't make is said by the fallback; 'not set up' switches the neural voice off", async () => {
    const { deps, fetched } = fakeDeps({ fail: (t) => (t.startsWith("Bad") ? new Error("x") : t.startsWith("Off") ? new VoiceFetchError(503, "VOICE_NOT_CONFIGURED") : null) });
    const said: string[] = [];
    const s = createStreamSpeaker(deps, { neural: () => true, fallback: async (t) => { said.push(t); } });
    s.push("Bad one.");
    s.push("Off now.");
    await tick(20);
    s.push("Later sentence.");
    let done = false;
    s.finish(() => { done = true; });
    await tick(40);
    expect(said).toEqual(["Bad one.", "Off now.", "Later sentence."]);
    expect(fetched).not.toContain("Later sentence.");
    expect(s.disabled).toBe(true);
    expect(done).toBe(true);
  });

  it("without the neural voice, everything goes to the fallback", async () => {
    const { deps, fetched } = fakeDeps();
    const said: string[] = [];
    const s = createStreamSpeaker(deps, { neural: () => false, fallback: async (t) => { said.push(t); } });
    s.push("One."); s.push("Two.");
    s.finish(() => {});
    await tick(10);
    expect(said).toEqual(["One.", "Two."]);
    expect(fetched).toEqual([]);
  });

  it("cancel stops at once: nothing more plays and done never fires", async () => {
    const { deps, log } = fakeDeps({ slow: 10 });
    let done = false;
    const s = createStreamSpeaker(deps, { neural: () => true, fallback: async () => {} });
    s.push("One."); s.push("Two.");
    s.finish(() => { done = true; });
    await tick(3);
    s.cancel();
    await tick(40);
    expect(log.filter((l) => l.startsWith("play"))).toEqual([]);
    expect(log).toContain("stop");
    expect(done).toBe(false);
  });
});

describe("completedPrefix", () => {
  it("keeps only finished sentences of text still arriving", () => {
    expect(completedPrefix("Hello there. How are")).toBe("Hello there.");
    expect(completedPrefix("Done! Next one? Still typ")).toBe("Done! Next one?");
    expect(completedPrefix("No end yet")).toBe("");
    expect(completedPrefix("Ends here.")).toBe("");   // the last sentence may still grow ("Ends here.com")
  });
});
