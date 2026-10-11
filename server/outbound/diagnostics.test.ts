import { describe, expect, it } from "vitest";
import { failureCode, failureLine, failureReport, readFailureReport, retryCode, splitFailureCode } from "./diagnostics";
import { ERROR_CODE_MAX, clipCode } from "@shared/error-code";

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

describe("readFailureReport (both benchmark scripts call it before cleaning up)", () => {
  it("selects codes, counts and timings only, scoped to the one workspace; never a text column", async () => {
    const seen: { text: string; params: unknown[] }[] = [];
    const query = async (text: string, params: unknown[]) => {
      seen.push({ text, params });
      return /prospect_run_items/.test(text)
        ? { rows: [{ domain: "a.com", stage: "failed", error_code: "research:timeout", attempts: 3 }, { domain: "b.com", stage: "done", error_code: null, attempts: 0 }] }
        : { rows: [{ task: "signals", ok: false, error_code: "timeout", n: 3, lat: 45000, maxout: null }] };
    };
    const r = await readFailureReport(query, "org-bench");
    expect(r.byCode).toEqual({ "research:timeout": 1 });
    expect(r.calls).toEqual([{ task: "signals", ok: false, errorCode: "timeout", n: 3, avgLatencyMs: 45000, maxTokensOut: null }]);
    expect(seen.every((q) => q.params[0] === "org-bench" && /organization_id = \$1/.test(q.text))).toBe(true);
    for (const q of seen) expect(q.text).not.toMatch(/\b(quote|value|meta|content|prompt|email|name|title)\b/i);
    expect(failureLine(r)).toBe(`failures: 1 failed, 0 still retrying {"research:timeout":1}; model calls ["signals/timeout=3"]`);
  });
});

describe("B1: every stored error code fits the database column (30 characters)", () => {
  const PAGE = ["blocked", "unreachable", "bad_response", "too_big", "unsupported", "not_html", "unreadable", "provider"];
  const MODEL = ["timeout", "rate_limited", "upstream", "invalid_response", "aborted", "cap_unavailable"];
  it("every step with every page, model and unexpected-error reason fits, keeps its step, and stays readable", () => {
    for (const step of ["verify", "enrich", "research"]) {
      for (const why of [...PAGE.map((c) => `page_error:${c}`), ...MODEL, "page_error", "unreachable", "error:TypeError", "error:AVeryLongCustomErrorNameThatGoesOnAndOn"]) {
        const c = failureCode(step, why);
        expect(c.length, c).toBeLessThanOrEqual(ERROR_CODE_MAX);
        expect(splitFailureCode(c).step, c).toBe(step);
      }
    }
    expect(failureCode("research", "page_error:bad_response")).toBe("research:page:bad_response");
    expect(failureCode("research", "invalid_response")).toBe("research:invalid_response");
    expect(failureCode("research", "error:AVeryLongCustomErrorNameThatGoesOnAndOn")).toBe("research:error:AVeryLongCusto");
    expect(retryCode("error:AVeryLongCustomErrorNameThatGoesOnAndOn").length).toBeLessThanOrEqual(ERROR_CODE_MAX);
    expect(retryCode("page_error:bad_response")).toBe("page:bad_response");
  });
  it("clipCode makes anything safe for the column: never longer, never empty, only plain characters", () => {
    expect(clipCode("x".repeat(100))).toHaveLength(ERROR_CODE_MAX);
    expect(clipCode("")).toBe("error");
    expect(clipCode("<script>alert(1)</script> page text")).toBe("scriptalert1scriptpagetext");
    expect(ERROR_CODE_MAX).toBe(30);
  });
});
