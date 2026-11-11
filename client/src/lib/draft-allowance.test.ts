import { describe, expect, it } from "vitest";
import { draftAllowanceNote, type DraftPlan } from "./draft-allowance";

const plan = (over: Partial<DraftPlan> = {}): DraftPlan => ({ tier: "free", label: "Free", windowDays: 30, drafts: { limit: 3, remaining: 2 }, ...over });

describe("the AI-draft allowance, said before the click", () => {
  it("says how many are left while there are some, and blocks nothing", () => {
    expect(draftAllowanceNote(plan())).toEqual({ out: false, upgrade: false, text: "2 of 3 AI drafts left in this 30-day period." });
    expect(draftAllowanceNote(plan({ tier: "pro", label: "Pro", drafts: { limit: 10, remaining: 1 } }))!.text).toBe("1 of 10 AI drafts left in this 30-day period.");
  });

  it("the free plan, used up: says so and offers the plans page", () => {
    expect(draftAllowanceNote(plan({ drafts: { limit: 3, remaining: 0 } }))).toEqual({ out: true, upgrade: true, text: "You've used the free plan's 3 AI drafts for this 30-day period." });
  });

  it("a paid plan, used up: says when more come back, and offers no upgrade", () => {
    const n = draftAllowanceNote(plan({ tier: "pro", label: "Pro", drafts: { limit: 10, remaining: 0 } }))!;
    expect(n.out).toBe(true);
    expect(n.upgrade).toBe(false);
    expect(n.text).toBe("You've used the 10 AI drafts included in Pro for this 30-day period. More become available as earlier drafts pass 30 days.");
  });

  it("says nothing when there is no limit, or the numbers couldn't be read: the server decides", () => {
    expect(draftAllowanceNote(plan({ tier: "unlimited", drafts: { limit: 1_000_000, remaining: 1_000_000 } }))).toBeNull();
    expect(draftAllowanceNote(plan({ drafts: null }))).toBeNull();
    expect(draftAllowanceNote(plan({ drafts: undefined }))).toBeNull();
    expect(draftAllowanceNote(null)).toBeNull();
    expect(draftAllowanceNote(undefined)).toBeNull();
    expect(draftAllowanceNote(plan({ drafts: { limit: 0, remaining: 0 } }))).toBeNull();
    expect(draftAllowanceNote(plan({ drafts: { limit: Number.NaN, remaining: 1 } }))).toBeNull();
  });

  it("odd numbers never read as more than the plan gives, or less than none", () => {
    expect(draftAllowanceNote(plan({ drafts: { limit: 3, remaining: -2 } }))!.out).toBe(true);
    expect(draftAllowanceNote(plan({ drafts: { limit: 3, remaining: 7 } }))!.text).toMatch(/^3 of 3 AI drafts left/);
    expect(draftAllowanceNote(plan({ drafts: { limit: 1, remaining: 1 } }))!.text).toBe("1 of 1 AI draft left in this 30-day period.");
  });
});
