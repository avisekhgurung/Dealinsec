import { describe, expect, it } from "vitest";
import { platformState, runCountsTowardLimit } from "./outbound-usage";

describe("a search counts against the daily allowance only if it did work", () => {
  it("running searches count; finished ones count only after at least one web search", () => {
    expect(runCountsTowardLimit({ status: "running", counters: {} })).toBe(true);
    expect(runCountsTowardLimit({ status: "done", counters: { searched: 3 } })).toBe(true);
    expect(runCountsTowardLimit({ status: "failed", counters: { searched: 1 } })).toBe(true);
    // stopped by a platform cap, cancelled at once, or failed before searching: no cost, not held against the person
    for (const status of ["done", "failed", "cancelled"]) {
      expect(runCountsTowardLimit({ status, counters: { searched: 0, stoppedBy: "global_limit" } }), status).toBe(false);
      expect(runCountsTowardLimit({ status, counters: {} }), status).toBe(false);
      expect(runCountsTowardLimit({ status, counters: null }), status).toBe(false);
    }
  });
});

describe("the platform's safety caps, as a state", () => {
  const base = { searchesLeft: 20, perSearch: 8, poolLimit: 500_000, poolSpent: 0, overallLimit: 1_000_000, overallSpent: 0 };
  it("available while a full search fits in both caps", () => expect(platformState(base)).toBe("available"));
  it("limited when a full search no longer fits (it may stop early)", () => {
    expect(platformState({ ...base, searchesLeft: 7 })).toBe("limited");
    expect(platformState({ ...base, poolSpent: 410_000 })).toBe("limited");
    expect(platformState({ ...base, overallSpent: 950_000 })).toBe("limited");
  });
  it("paused when either cap is used up", () => {
    expect(platformState({ ...base, searchesLeft: 0 })).toBe("paused");
    expect(platformState({ ...base, poolSpent: 500_000 })).toBe("paused");
    expect(platformState({ ...base, overallSpent: 1_000_001 })).toBe("paused");
  });
  it("unknown when anything couldn't be counted, never 'available'", () => {
    expect(platformState({ ...base, poolSpent: NaN })).toBe("unknown");
  });
});
