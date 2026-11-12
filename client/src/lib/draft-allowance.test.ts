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

describe("with purchased draft credits and the 80% / 100% notices", () => {
  const warn = { percent: 80, warn: true, exhausted: true };
  const pro = (remaining: number) => plan({ tier: "pro", label: "Pro", drafts: { limit: 10, remaining } });
  const credits = (balance: number, cost = 1) => ({ balance, cost, nextExpiry: null });

  it("is unchanged when the credit context is absent (older server)", () => {
    expect(draftAllowanceNote(pro(1))).toEqual({ out: false, upgrade: false, text: "1 of 10 AI drafts left in this 30-day period." });
  });
  it("warns at the threshold, keeps drafting open, and offers a top-up", () => {
    const n = draftAllowanceNote(pro(2), { credits: credits(0), warn })!;
    expect(n).toMatchObject({ out: false, warn: true, topUp: true });
    expect(n.text).toMatch(/2 of 10 AI drafts left.*80% of them/);
    expect(draftAllowanceNote(pro(3), { credits: credits(0), warn })).toEqual({ out: false, upgrade: false, text: "3 of 10 AI drafts left in this 30-day period." });
  });
  it("does not warn when the admin turned warnings off", () => {
    expect(draftAllowanceNote(pro(1), { credits: credits(0), warn: { ...warn, warn: false } })).not.toHaveProperty("warn");
  });
  it("at 100% with purchased credits it is NOT blocked, and says what the next draft costs", () => {
    const n = draftAllowanceNote(pro(0), { credits: credits(4, 1), warn })!;
    expect(n).toMatchObject({ out: false, credits: true });
    expect(n.text).toMatch(/next draft uses 1 of your 4 purchased AI draft credits/);
  });
  it("at 100% without credits only drafting is blocked and the top-up is offered; free also offers Pro", () => {
    expect(draftAllowanceNote(pro(0), { credits: credits(0), warn })).toMatchObject({ out: true, topUp: true, upgrade: false });
    expect(draftAllowanceNote(plan({ drafts: { limit: 3, remaining: 0 } }), { credits: credits(0), warn })).toMatchObject({ out: true, topUp: true, upgrade: true });
  });
  it("does not offer the top-up when the admin turned the 100% notice off, but is still blocked", () => {
    const n = draftAllowanceNote(pro(0), { credits: credits(0), warn: { ...warn, exhausted: false } })!;
    expect(n.out).toBe(true);
    expect(n).not.toHaveProperty("topUp");
  });
  it("mentions purchased credits kept in reserve while the plan still has drafts", () => {
    expect(draftAllowanceNote(pro(9), { credits: credits(5), warn })!.text).toMatch(/You also have 5 purchased AI draft credits/);
  });
});
