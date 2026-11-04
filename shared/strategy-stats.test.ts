import { describe, expect, it } from "vitest";
import { MIN_TO_COMPARE, chosenShare, parseStrategyWindow, replyShare, sampleNote } from "./strategy-stats";

describe("the window", () => {
  it("is 30 days unless 90 is asked for, whatever arrives", () => {
    expect(parseStrategyWindow("90")).toBe(90);
    expect(parseStrategyWindow(90)).toBe(90);
    expect(parseStrategyWindow("30")).toBe(30);
    expect(parseStrategyWindow(undefined)).toBe(30);
    expect(parseStrategyWindow("365")).toBe(30);
    expect(parseStrategyWindow("x; DROP TABLE")).toBe(30);
  });
});

describe("shares name their denominator and hold back on small samples", () => {
  it("reply share is replies over SENT, whole percent", () => {
    expect(replyShare({ sent: 10, replied: 3 })).toBe(30);
    expect(replyShare({ sent: 6, replied: 1 })).toBe(17);
    expect(replyShare({ sent: MIN_TO_COMPARE, replied: 0 })).toBe(0);
  });
  it(`no reply share below ${MIN_TO_COMPARE} sent — three messages prove nothing`, () => {
    expect(replyShare({ sent: MIN_TO_COMPARE - 1, replied: 4 })).toBeNull();
    expect(replyShare({ sent: 0, replied: 0 })).toBeNull();
  });
  it("chosen share is picks over SHOWN, held back the same way", () => {
    expect(chosenShare({ shown: 10, chosen: 4 })).toBe(40);
    expect(chosenShare({ shown: 4, chosen: 4 })).toBeNull();
  });
});

describe("no winner is declared off a small sample", () => {
  it("the caution stays while fewer than two strategies have enough sent", () => {
    expect(sampleNote([])).toMatch(/plain counts/);
    expect(sampleNote([{ sent: 50 }])).toMatch(/plain counts/); // one strategy alone is no comparison
    expect(sampleNote([{ sent: 50 }, { sent: MIN_TO_COMPARE - 1 }, { sent: 2 }])).toMatch(/plain counts/);
  });
  it("it clears once two strategies can honestly be compared", () => {
    expect(sampleNote([{ sent: MIN_TO_COMPARE }, { sent: MIN_TO_COMPARE }, { sent: 0 }])).toBeNull();
  });
});
