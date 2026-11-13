import { describe, expect, it } from "vitest";
import { isFirstRun } from "./first-run";

describe("the dashboard's first-run rule", () => {
  it("either side counts as having started: leads alone, or deals alone", () => {
    // The bug this prevents: a working find-clients account with no deals, stuck on the setup screen.
    expect(isFirstRun({ leadTotal: 3, dealsKnown: true, dealCount: 0 })).toBe(false);
    expect(isFirstRun({ leadTotal: 0, dealsKnown: true, dealCount: 1 })).toBe(false);
    expect(isFirstRun({ leadTotal: 0, dealsKnown: true, dealCount: 0 })).toBe(true);
  });
  it("a count that hasn't loaded is never read as 'none yet'", () => {
    expect(isFirstRun({ leadTotal: null, dealsKnown: true, dealCount: 0 })).toBe(true); // deals answered: none
    expect(isFirstRun({ leadTotal: null, dealsKnown: true, dealCount: 2 })).toBe(false);
    expect(isFirstRun({ leadTotal: null, dealsKnown: false, dealCount: 0 })).toBe(false); // neither answered
    expect(isFirstRun({ leadTotal: 0, dealsKnown: false, dealCount: 0 })).toBe(true); // leads answered: none
  });
});
