import { describe, expect, it } from "vitest";
import { speakable } from "./voice";

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
