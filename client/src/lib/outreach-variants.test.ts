import { describe, expect, it } from "vitest";
import { chipText, chipTone, pendingVariants, shortcomings } from "./outreach-variants";

describe("which versions the picker shows", () => {
  it("only the versions awaiting a choice, in the order they were written", () => {
    const messages = [
      { id: 9, status: "sent" },
      { id: 12, status: "variant" },
      { id: 10, status: "variant" },
      { id: 11, status: "variant" },
      { id: 13, status: "draft" },
      { id: 14, status: "cancelled" },
    ];
    expect(pendingVariants(messages).map((m) => m.id)).toEqual([10, 11, 12]);
  });
  it("no versions, no picker", () => {
    expect(pendingVariants([{ id: 1, status: "draft" }, { id: 2, status: "sent" }])).toEqual([]);
    expect(pendingVariants([])).toEqual([]);
  });
});

describe("how a scorecard chip reads", () => {
  it("earned in full, in part, or not at all", () => {
    expect(chipTone({ points: 2, max: 2 })).toBe("full");
    expect(chipTone({ points: 1, max: 1 })).toBe("full");
    expect(chipTone({ points: 1, max: 2 })).toBe("partial");
    expect(chipTone({ points: 0, max: 2 })).toBe("none");
    expect(chipTone({ points: 0, max: 1 })).toBe("none");
  });
  it("a fraction where there are degrees, a plain label where it's all or nothing", () => {
    expect(chipText({ label: "Right length", points: 1, max: 2 })).toBe("Right length 1/2");
    expect(chipText({ label: "Greets by name", points: 1, max: 1 })).toBe("Greets by name");
    expect(chipText({ label: "No tired phrases", points: 0, max: 1 })).toBe("No tired phrases");
  });
  it("only what earned nothing is spelled out under the chips", () => {
    const components = [
      { key: "greeting", label: "Greets by name", points: 1, max: 1, reason: "Opens to Marta." },
      { key: "ask", label: "One clear ask", points: 0, max: 2, reason: "Asks nothing: give the reader one easy question." },
      { key: "length", label: "Right length", points: 1, max: 2, reason: "45 words (60–150 reads best)." },
      { key: "fresh", label: "No tired phrases", points: 0, max: 1, reason: 'Reads like every other cold email ("quick question").' },
    ];
    expect(shortcomings(components).map((c) => c.key)).toEqual(["ask", "fresh"]);
  });
});
