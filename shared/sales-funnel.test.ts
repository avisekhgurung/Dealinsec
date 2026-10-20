import { describe, expect, it } from "vitest";
import { funnelDays, funnelView, type FunnelCounts } from "./sales-funnel";

const counts = (o: Partial<FunnelCounts> = {}): FunnelCounts => ({ researched: 40, opportunity: 20, lead: 10, drafted: 8, approved: 6, sent: 5, replied: 2, meeting: 1, proposal: 1, won: 0, lost: 1, optedOut: 1, ...o });

describe("sales funnel", () => {
  it("stages in order, each with its rate from the one before", () => {
    const f = funnelView(counts(), 0, 90);
    expect(f.stages.map((s) => s.count)).toEqual([40, 20, 10, 8, 6, 5, 2, 1, 1, 0]);
    expect(f.stages[0].fromPrevious).toBeNull();
    expect(f.stages[1].fromPrevious).toBe(50);
    expect(f.stages[9].fromPrevious).toBe(0);
  });
  it("a stage never exceeds the one before (a reply to a mail sent outside the app), and a 0 stage has no rate after it", () => {
    const f = funnelView(counts({ sent: 0, replied: 3 }), 0, 90);
    expect(f.stages.find((s) => s.key === "replied")!.count).toBe(0);
    expect(f.stages.find((s) => s.key === "replied")!.fromPrevious).toBeNull();
  });
  it("says when there are too few companies to read rates from", () => {
    expect(funnelView(counts({ researched: 6 }), 0, 30).notes.join(" ")).toMatch(/Only 6 researched companies/);
    expect(funnelView(counts(), 0, 30).notes.join(" ")).not.toMatch(/too few/);
  });
  it("only the offered windows", () => {
    expect(funnelDays("30")).toBe(30);
    expect(funnelDays("7")).toBe(90);
    expect(funnelDays(undefined)).toBe(90);
  });
});
