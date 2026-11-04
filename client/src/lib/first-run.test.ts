import { describe, expect, it } from "vitest";
import { isFirstRun } from "./first-run";

describe("the dashboard's first-run rule", () => {
  it("with the deal suite hidden, leads decide: an account with leads sees its insights even with zero deals", () => {
    expect(isFirstRun({ suiteHidden: true, leadTotal: 3, dealsKnown: true, dealCount: 0 })).toBe(false);
    expect(isFirstRun({ suiteHidden: true, leadTotal: 0, dealsKnown: true, dealCount: 0 })).toBe(true);
  });
  it("a lead count that hasn't loaded is not 'none yet': the deals rule stands", () => {
    expect(isFirstRun({ suiteHidden: true, leadTotal: null, dealsKnown: true, dealCount: 0 })).toBe(true);
    expect(isFirstRun({ suiteHidden: true, leadTotal: null, dealsKnown: true, dealCount: 2 })).toBe(false);
    expect(isFirstRun({ suiteHidden: true, leadTotal: null, dealsKnown: false, dealCount: 0 })).toBe(false);
  });
  it("with the suite visible, deals decide, and loading or failed deals are never read as none", () => {
    expect(isFirstRun({ suiteHidden: false, leadTotal: 5, dealsKnown: true, dealCount: 0 })).toBe(true);
    expect(isFirstRun({ suiteHidden: false, leadTotal: 0, dealsKnown: true, dealCount: 1 })).toBe(false);
    expect(isFirstRun({ suiteHidden: false, leadTotal: 0, dealsKnown: false, dealCount: 0 })).toBe(false);
  });
});
