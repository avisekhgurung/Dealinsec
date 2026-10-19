import { describe, expect, it } from "vitest";
import { CHIRPS, chirpLength, type ChirpBot, type ChirpKind } from "./chirps";

const BOTS: ChirpBot[] = ["nibo", "mika", "zee"];
const KINDS: ChirpKind[] = ["hello", "start", "done", "needsYou"];

describe("The Nest chirps", () => {
  it("every coworker has a sound for every moment", () => {
    for (const b of BOTS) for (const k of KINDS) expect(CHIRPS[b][k].length, `${b}.${k}`).toBeGreaterThan(0);
  });
  it("are short, soft and within comfortable hearing", () => {
    for (const b of BOTS) for (const k of KINDS) {
      const notes = CHIRPS[b][k];
      expect(chirpLength(notes), `${b}.${k}`).toBeLessThanOrEqual(0.8);
      for (const x of notes) {
        expect(x.gain).toBeGreaterThan(0); expect(x.gain).toBeLessThanOrEqual(0.12);
        for (const f of [x.freq, x.to ?? x.freq]) { expect(f).toBeGreaterThanOrEqual(300); expect(f).toBeLessThanOrEqual(2200); }
      }
    }
  });
  it("each coworker sounds like themself: Zee lower and slower than Nibo", () => {
    const avg = (b: ChirpBot) => { const all = KINDS.flatMap((k) => CHIRPS[b][k]); return all.reduce((s, x) => s + x.freq, 0) / all.length; };
    expect(avg("zee")).toBeLessThan(avg("mika"));
    expect(avg("mika")).toBeLessThan(avg("nibo"));
    expect(chirpLength(CHIRPS.zee.done)).toBeGreaterThan(chirpLength(CHIRPS.nibo.done) - 0.1);
  });
});
