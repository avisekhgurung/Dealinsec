import { describe, expect, it } from "vitest";
import { createBargeInDetector, pickGentlemanVoice, speakable, splitSentences } from "./voice";

describe("speakable", () => {
  it("drops markdown marks and list bullets", () => {
    expect(speakable("**Found 3** companies:\n- Northwind\n- Alpha\n\n# Next")).toBe("Found 3 companies: Northwind Alpha Next");
  });
  it("keeps link text and drops the address; never reads a bare URL or a code block", () => {
    expect(speakable("See [the lead](https://app.example/leads/4) now")).toBe("See the lead now");
    expect(speakable("Visit https://example.com/x today")).toBe("Visit today");
    expect(speakable("Before ```const a = 1;``` after")).toBe("Before after");
  });
  it("is short enough to listen to, and cuts at a word", () => {
    const long = Array.from({ length: 300 }, (_, i) => `word${i}`).join(" ");
    const out = speakable(long, 100);
    expect(out.length).toBeLessThanOrEqual(101);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/word\d+…$/.test(out) && /wor…$/);
  });
  it("empty in, empty out", () => {
    expect(speakable("")).toBe("");
    expect(speakable(undefined as unknown as string)).toBe("");
  });
});

describe("splitSentences", () => {
  it("speaks a reply a sentence at a time", () => {
    const parts = splitSentences("I found three firms. Two have their own websites! Shall I add them?");
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => /[.!?]$/.test(p))).toBe(true);
    expect(splitSentences("I found three firms. Two have their own websites! Shall I add them?").join(" ")).toBe("I found three firms. Two have their own websites! Shall I add them?");
  });
  it("never splits inside a web address, a decimal or an abbreviation without a space", () => {
    const parts = splitSentences("I've added Northwind with northwind.com as its website. The estimate is 1.5 lakh rupees.");
    expect(parts.join(" ")).toContain("northwind.com");
    expect(parts.join(" ")).toContain("1.5 lakh");
    expect(parts.some((p) => /northwind\.\s/.test(p))).toBe(false);
  });
  it("joins very short fragments to their neighbour", () => {
    const parts = splitSentences("Yes. I have prepared the search for your approval on screen.");
    expect(parts).toHaveLength(1);
  });
  it("cuts an overlong sentence at a comma or a space, never mid-word", () => {
    const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(", ");
    const parts = splitSentences(long, 100);
    expect(parts.every((p) => p.length <= 100)).toBe(true);
    expect(parts.join(" ").replace(/\s+/g, " ")).toContain("word59");
  });
  it("empty in, empty out", () => {
    expect(splitSentences("")).toEqual([]);
    expect(splitSentences("   ")).toEqual([]);
  });
});

describe("pickGentlemanVoice", () => {
  const V = (name: string, lang: string, localService = true, def = false) => ({ name, lang, localService, default: def });
  it("prefers a natural male British voice for English", () => {
    const voices = [V("Samantha", "en-US"), V("Google US English", "en-US", false), V("Daniel", "en-GB"), V("Google UK English Female", "en-GB", false), V("Google UK English Male", "en-GB", false)];
    expect(voices[pickGentlemanVoice(voices, "en-IN")].name).toBe("Google UK English Male");
  });
  it("never picks a female voice when a male one exists in the language", () => {
    const voices = [V("Microsoft Aria Online (Natural)", "en-GB", false), V("Microsoft Ryan Online (Natural)", "en-GB", false), V("Microsoft Zira", "en-US")];
    expect(voices[pickGentlemanVoice(voices, "en-US")].name).toMatch(/Ryan/);
  });
  it("falls back to the best available English voice, and to none when there is no voice in the language", () => {
    const only = [V("Samantha", "en-US")];
    expect(pickGentlemanVoice(only, "en-GB")).toBe(0);
    expect(pickGentlemanVoice([V("Amelie", "fr-FR")], "en-US")).toBe(-1);
    expect(pickGentlemanVoice([], "en-US")).toBe(-1);
  });
  it("other languages keep their own language", () => {
    const voices = [V("Daniel", "en-GB"), V("Thomas", "fr-FR"), V("Amelie", "fr-FR")];
    expect(voices[pickGentlemanVoice(voices, "fr-FR")].name).toBe("Thomas");
  });
});

describe("createBargeInDetector", () => {
  /** Feed a level for a duration at 20 ms steps; returns the first time it fires, or null. */
  const feed = (d: ReturnType<typeof createBargeInDetector>, from: number, ms: number, rms: number) => {
    for (let t = from; t < from + ms; t += 20) if (d.push(t, rms)) return t;
    return null;
  };
  it("the agent's own echo, however steady, never interrupts it", () => {
    const d = createBargeInDetector();
    expect(feed(d, 0, 4000, 0.06)).toBeNull();
  });
  it("a person clearly louder than the echo, sustained, does", () => {
    const d = createBargeInDetector();
    expect(feed(d, 0, 500, 0.05)).toBeNull();
    expect(feed(d, 500, 600, 0.25)).not.toBeNull();
  });
  it("a short bump (a click, a cough) does not", () => {
    const d = createBargeInDetector();
    feed(d, 0, 500, 0.02);
    expect(feed(d, 500, 120, 0.4)).toBeNull();
    expect(feed(d, 620, 500, 0.02)).toBeNull();
  });
  it("in a quiet room a normal voice is enough, but background hum is not", () => {
    const d = createBargeInDetector();
    feed(d, 0, 500, 0.004);
    expect(feed(d, 500, 1000, 0.03)).toBeNull();
    expect(feed(d, 1500, 600, 0.12)).not.toBeNull();
  });
  it("can be reset for the next utterance", () => {
    const d = createBargeInDetector();
    feed(d, 0, 500, 0.3);
    d.reset();
    expect(feed(d, 10_000, 500, 0.05)).toBeNull();
    expect(feed(d, 10_500, 600, 0.3)).not.toBeNull();
  });
});
