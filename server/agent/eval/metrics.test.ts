import { describe, expect, it } from "vitest";
import type { AssertionResult } from "./assertions";
import { compare, formatReport, percentile, repeatedCalls, summarize, type RunRecord } from "./metrics";
import { DEFAULT_PRICES, estimateCostUsd, pricesFromEnv } from "./pricing";
import { promptFingerprint } from "./results";

const a = (pass: boolean, safety = false, type: any = "calledTool"): AssertionResult => ({ type, pass, safety, detail: "" });
const rec = (caseId: string, repeat: number, assertions: AssertionResult[], over: Partial<RunRecord> = {}): RunRecord => ({
  caseId, repeat, assertions, tools: [], steps: 2, modelCalls: 2, tokensIn: 1000, tokensOut: 100, latencyMs: 1000, failed: false, costUsd: 0.001, ...over,
});

describe("percentile", () => {
  it("is nearest-rank and handles empty and single values", () => {
    expect(percentile([], 50)).toBe(0);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
  });
});

describe("repeatedCalls", () => {
  it("counts the same tool with the same arguments again, not different arguments", () => {
    const t = (name: string, argsKey: string) => ({ name, risk: "READ_ONLY", status: "ok", argsKey });
    expect(repeatedCalls([t("a", "1"), t("a", "1"), t("a", "2"), t("b", "1"), t("a", "1")])).toBe(2);
  });
});

describe("summarize", () => {
  const records = [
    rec("alpha", 0, [a(true), a(true, true, "noExecutedMutation")]),
    rec("alpha", 1, [a(true), a(true, true, "noExecutedMutation")]),
    rec("beta", 0, [a(true), a(false)]),
    rec("beta", 1, [a(true), a(true)]),
    rec("gamma", 0, [a(false, true, "worldUnchanged")], { tools: [{ name: "x", risk: "READ_ONLY", status: "invalid", argsKey: "{}" }, { name: "x", risk: "READ_ONLY", status: "invalid", argsKey: "{}" }] }),
    rec("skipped", 0, [], { skipped: true }),
  ];
  const s = summarize(records);

  it("pass rate is the share of runs where every assertion held", () => {
    expect(s.overall.runs).toBe(5);
    expect(s.overall.skipped).toBe(1);
    expect(s.overall.passRate).toBeCloseTo(3 / 5);
    expect(s.cases.find((c) => c.id === "alpha")!.passRate).toBe(1);
    expect(s.cases.find((c) => c.id === "beta")!.passRate).toBe(0.5);
  });
  it("a safety failure is counted on its own and never averaged away", () => {
    expect(s.overall.safetyFailureRuns).toBe(1);
    expect(s.cases.find((c) => c.id === "gamma")!.safetyFailures).toBe(1);
  });
  it("flaky means some repeats passed and some failed", () => {
    expect(s.cases.find((c) => c.id === "beta")!.flaky).toBe(true);
    expect(s.cases.find((c) => c.id === "alpha")!.flaky).toBe(false);
    expect(s.overall.flakyCases).toBe(1);
  });
  it("counts invalid and repeated tool calls, and which assertion kinds failed", () => {
    const g = s.cases.find((c) => c.id === "gamma")!;
    expect(g.invalidCalls).toBe(2);
    expect(g.repeatedCalls).toBe(1);
    expect(g.failedAssertions).toEqual({ worldUnchanged: 1 });
  });
  it("aggregates tokens, cost and latency", () => {
    expect(s.overall.tokensIn).toBe(5000);
    expect(s.overall.costUsd).toBeCloseTo(0.005);
    expect(s.overall.p50Ms).toBe(1000);
  });
  it("an empty record set summarizes to zeros", () => {
    expect(summarize([]).overall).toMatchObject({ runs: 0, passRate: 0, safetyFailureRuns: 0 });
  });
});

describe("compare and the report", () => {
  const before = summarize([rec("x", 0, [a(false)]), rec("y", 0, [a(true)]), rec("z", 0, [a(true)])]);
  const after = summarize([rec("x", 0, [a(true)]), rec("y", 0, [a(false)]), rec("z", 0, [a(true)]), rec("new", 0, [a(true)])]);
  const cmp = compare(before, after);
  it("lists improved and regressed cases, and ignores cases present in only one report", () => {
    expect(cmp.improved.map((c) => c.id)).toEqual(["x"]);
    expect(cmp.regressed.map((c) => c.id)).toEqual(["y"]);
  });
  it("the report shows before → after, names failing cases, and says when safety is clean", () => {
    const text = formatReport(after, cmp);
    expect(text).toMatch(/Pass rate:\s+67% → 75%/);
    expect(text).toMatch(/SAFETY failures:\s+0 runs\s+✓ none/);
    expect(text).toMatch(/Regressed: y 100%→0%/);
    expect(text).toMatch(/Improved: x 0%→100%/);
  });
  it("the report says a safety failure MUST BE ZERO", () => {
    const bad = summarize([rec("s", 0, [a(false, true, "noExecutedMutation")])]);
    expect(formatReport(bad)).toMatch(/MUST BE ZERO/);
    expect(formatReport(bad)).toMatch(/\[SAFETY\]/);
  });
});

describe("pricing", () => {
  it("estimates from list prices and reads overrides from the environment", () => {
    expect(estimateCostUsd(1_000_000, 1_000_000)).toBeCloseTo(DEFAULT_PRICES.inputPerM + DEFAULT_PRICES.outputPerM);
    expect(estimateCostUsd(0, 0)).toBe(0);
    expect(pricesFromEnv({ EVAL_PRICE_IN: "1", EVAL_PRICE_OUT: "2" })).toEqual({ inputPerM: 1, outputPerM: 2 });
    expect(pricesFromEnv({ EVAL_PRICE_IN: "nope" })).toEqual(DEFAULT_PRICES);
  });
});

describe("promptFingerprint", () => {
  it("changes when the prompt or a tool description changes, and is stable otherwise", () => {
    const tools = [{ name: "a", description: "one" }];
    const base = promptFingerprint("prompt", tools);
    expect(promptFingerprint("prompt", tools)).toBe(base);
    expect(promptFingerprint("prompt!", tools)).not.toBe(base);
    expect(promptFingerprint("prompt", [{ name: "a", description: "two" }])).not.toBe(base);
    expect(base).toHaveLength(12);
  });
});
