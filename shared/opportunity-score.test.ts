import { describe, expect, it } from "vitest";
import { DEFAULT_WEIGHTS, scoreOpportunity, weightsFrom, type CitedFinding } from "./opportunity-score";
import type { OpportunityPlan } from "./prospect-intel";

const plan = (o: Partial<OpportunityPlan> = {}): OpportunityPlan => ({
  solution: "Set up a simple outbound sequence", value: "A first pipeline for the new service", impact: "high", effort: "small", serviceMatch: "direct",
  confirmIf: "They say so", disproveIf: "They don't", nextAction: "Ask one question",
  demo: { title: "Sample sequence", scope: "Three sample emails", effort: "small", assumptions: [], exclusions: [], needs: [] }, ...o,
});
const hiring = (id: number, o: Partial<CitedFinding> = {}): CitedFinding => ({ id, kind: "signal", type: "HIRING", status: "confirmed", url: `https://acme.com/careers/${id}`, quote: "We are hiring a PPC lead", dated: true, timing: "strong", ...o });
const guess = (id: number): CitedFinding => ({ id, kind: "opportunity", type: "opportunity", status: "inferred", url: null, quote: null, dated: false });
const pts = (s: ReturnType<typeof scoreOpportunity>, k: string) => s.components.find((c) => c.key === k)!.points;

describe("opportunity score", () => {
  it("is 100 points over the five parts, with the brief's weights, and the same input always gives the same score", () => {
    const i = { cited: [hiring(1), hiring(2)], fitVerdict: "strong", plan: plan() };
    const a = scoreOpportunity(i), b = scoreOpportunity(i);
    expect(a).toEqual(b);
    expect(a.components.map((c) => [c.key, c.max])).toEqual([["evidence", 30], ["fit", 25], ["value", 20], ["timing", 15], ["feasibility", 10]]);
    expect(a.total).toBeGreaterThanOrEqual(90);
    expect(a.confidence).toBe("high");
    expect(a.components.every((c) => c.reasons.length > 0)).toBe(true);
  });
  it("no confirmed evidence can't score high, however confident the plan sounds", () => {
    const s = scoreOpportunity({ cited: [guess(1), guess(2)], fitVerdict: "strong", plan: plan({ impact: "high" }) });
    expect(pts(s, "evidence")).toBeLessThanOrEqual(9);
    expect(pts(s, "value")).toBeLessThanOrEqual(8);   // a big claim on a guess stays small
    expect(pts(s, "timing")).toBe(0);
    expect(s.confidence).toBe("low");
    expect(s.total).toBeLessThan(55);
    expect(s.limits.join(" ")).toMatch(/Nothing the angle rests on is confirmed/);
  });
  it("confidence and value are separate: a high-value idea on one undated fact is medium confidence", () => {
    const s = scoreOpportunity({ cited: [hiring(1, { dated: false, timing: "undated" })], fitVerdict: "partial", plan: plan({ impact: "high" }) });
    expect(s.confidence).toBe("medium");
    expect(pts(s, "value")).toBe(20);
    expect(pts(s, "timing")).toBe(3);
  });
  it("without a plan, the plan's parts score nothing and it says what to do", () => {
    const s = scoreOpportunity({ cited: [hiring(1)], fitVerdict: "strong", plan: null });
    expect(pts(s, "feasibility")).toBe(0);
    expect(s.limits.join(" ")).toMatch(/Generate the angle again/);
  });
  it("a solution that isn't what you sell, or a large effort with no sample, scores low on fit and feasibility", () => {
    const s = scoreOpportunity({ cited: [hiring(1)], fitVerdict: "strong", plan: plan({ serviceMatch: "none", effort: "large", demo: null }) });
    expect(pts(s, "fit")).toBe(15);
    expect(pts(s, "feasibility")).toBe(1);
  });
  it("weights are configurable, and a malformed setting falls back to the defaults", () => {
    expect(weightsFrom("40,20,20,10,10")).toEqual({ evidence: 40, fit: 20, value: 20, timing: 10, feasibility: 10 });
    expect(weightsFrom("1,2,3")).toEqual(DEFAULT_WEIGHTS);
    expect(weightsFrom(undefined)).toEqual(DEFAULT_WEIGHTS);
    const s = scoreOpportunity({ cited: [hiring(1)], fitVerdict: "strong", plan: plan(), weights: weightsFrom("40,20,20,10,10") });
    expect(s.components.find((c) => c.key === "evidence")!.max).toBe(40);
  });
  it("two confirmed but undated findings on two pages are medium confidence, not high (live review, Oct 20)", () => {
    const s = scoreOpportunity({ cited: [hiring(1, { dated: false, timing: "undated", type: "NEW_SERVICE" }), hiring(2, { dated: false, timing: "undated", type: "NEW_SERVICE" })], fitVerdict: "partial", plan: plan() });
    expect(s.confidence).toBe("medium");
    expect(scoreOpportunity({ cited: [hiring(1, { timing: "context" }), hiring(2, { dated: false, timing: "undated" })], fitVerdict: "partial", plan: plan() }).confidence).toBe("high");
  });
  it("a workspace that hasn't said what it sells gets no fit points for the solution, and is told why", () => {
    const s = scoreOpportunity({ cited: [hiring(1)], fitVerdict: "strong", plan: plan({ serviceMatch: "unknown", demo: null }) });
    expect(pts(s, "fit")).toBe(15);
    expect(s.limits.join(" ")).toMatch(/Describe what you sell/);
  });
});
