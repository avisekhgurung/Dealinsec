import { describe, expect, it } from "vitest";
import { failureReport, splitFailureCode } from "./diagnostics";

describe("failure report (kept by the benchmark before its rows are cleaned up)", () => {
  it("splits the step from the code; an older code without a step is 'unknown', never guessed", () => {
    expect(splitFailureCode("research:invalid_response")).toEqual({ step: "research", code: "invalid_response" });
    expect(splitFailureCode("research:page_error:unreachable")).toEqual({ step: "research", code: "page_error:unreachable" });
    expect(splitFailureCode("enrich:error:TypeError")).toEqual({ step: "enrich", code: "error:TypeError" });
    expect(splitFailureCode("timeout")).toEqual({ step: "unknown", code: "timeout" });
    expect(splitFailureCode(null)).toEqual({ step: "unknown", code: "unknown" });
  });
  it("lists failed and still-retrying companies with counts per step and code, and the model calls by outcome", () => {
    const r = failureReport([
      { domain: "a.com", stage: "failed", errorCode: "research:invalid_response", attempts: 3 },
      { domain: "b.com", stage: "failed", errorCode: "research:invalid_response", attempts: 3 },
      { domain: "c.com", stage: "failed", errorCode: "enrich:timeout", attempts: 3 },
      { domain: "d.com", stage: "enriched", errorCode: "timeout", attempts: 1 }, // waiting for its retry when the run ended
      { domain: "e.com", stage: "done", errorCode: "timeout", attempts: 1 }, // recovered: not a failure
      { domain: "f.com", stage: "rejected", errorCode: "poor_fit", attempts: 0 }, // set aside, not failed
    ], [{ task: "signals", ok: false, errorCode: "timeout", n: 2, avgLatencyMs: 30000, maxTokensOut: null }, { task: "signals", ok: true, errorCode: null, n: 40 }]);
    expect(r.failed.map((f) => f.domain)).toEqual(["a.com", "b.com", "c.com"]);
    expect(r.byCode).toEqual({ "research:invalid_response": 2, "enrich:timeout": 1 });
    expect(r.retrying).toEqual([{ domain: "d.com", step: "research", code: "timeout", attempts: 1 }]);
    expect(r.calls).toEqual([{ task: "signals", ok: false, errorCode: "timeout", n: 2, avgLatencyMs: 30000, maxTokensOut: null }, { task: "signals", ok: true, errorCode: null, n: 40, avgLatencyMs: null, maxTokensOut: null }]);
  });
  it("holds codes and counts only: no field for page text, quotes, names or messages", () => {
    const r = failureReport([{ domain: "a.com", stage: "failed", errorCode: "research:invalid_response", attempts: 3 }], []);
    expect(Object.keys(r.failed[0]).sort()).toEqual(["attempts", "code", "domain", "step"]);
  });
});
