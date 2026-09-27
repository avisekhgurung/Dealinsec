/**
 * The invoice due date calculator's arithmetic, tested on the exact string the
 * browser runs (CORE_JS) — not a TypeScript copy of it. Expected dates were
 * worked out independently (Python's datetime), not by this code.
 */
import { describe, expect, it } from "vitest";
import { CORE_JS, TERMS } from "./invoice-due-date";

type Result = {
  ok: boolean;
  error?: string;
  raw: string;
  due: string;
  weekend: boolean;
  shifted: boolean;
  rawWeekday: number;
  dueWeekday: number;
  daysFromToday: number | null;
};
const { ddCalc, ddExplain } = new Function(`${CORE_JS}; return { ddCalc: ddCalc, ddExplain: ddExplain };`)() as {
  ddCalc: (invoiceIso: unknown, days: unknown, rule: string, todayIso?: string) => Result;
  ddExplain: (r: Result, fmt: (iso: string) => string) => string[];
};
const KEEP = "keep";
const MOVE = "next-business-day";
const iso = (s: string) => s;

describe("net terms count calendar days from the invoice date", () => {
  // Monday 28 Sep 2026: none of these land on a weekend.
  it.each([
    [7, "2026-10-05"],
    [15, "2026-10-13"],
    [30, "2026-10-28"],
    [45, "2026-11-12"],
    [60, "2026-11-27"],
  ])("Net %i", (days, due) => {
    const r = ddCalc("2026-09-28", days, KEEP);
    expect(r.ok).toBe(true);
    expect(r.due).toBe(due);
    expect(r.shifted).toBe(false);
  });

  it("the brief's example: Net 30 on 27 Sep 2026 is due 27 Oct 2026", () => {
    expect(ddCalc("2026-09-27", 30, KEEP).due).toBe("2026-10-27");
  });

  it("due on receipt is the invoice date itself", () => {
    const r = ddCalc("2026-09-28", 0, KEEP);
    expect(r.due).toBe("2026-09-28");
    expect(r.raw).toBe("2026-09-28");
  });

  it("crosses month, year and leap-day boundaries", () => {
    expect(ddCalc("2028-02-15", 15, KEEP).due).toBe("2028-03-01"); // 2028 has 29 Feb
    expect(ddCalc("2027-12-20", 15, KEEP).due).toBe("2028-01-04");
  });

  it("is not shifted by a daylight-saving change (UTC arithmetic)", () => {
    // Spans the late-March DST switch in Europe.
    expect(ddCalc("2026-03-20", 15, KEEP).due).toBe("2026-04-04");
  });

  it("offers exactly the six terms on the page", () => {
    expect(TERMS.map((t) => t.days)).toEqual([0, 7, 15, 30, 45, 60]);
  });
});

describe("weekend handling", () => {
  it("Saturday: kept by default, moved two days to Monday on request", () => {
    const keep = ddCalc("2026-10-01", 30, KEEP);
    expect(keep.due).toBe("2026-10-31");
    expect(keep.dueWeekday).toBe(6);
    expect(keep.weekend).toBe(true);
    expect(keep.shifted).toBe(false);

    const moved = ddCalc("2026-10-01", 30, MOVE);
    expect(moved.raw).toBe("2026-10-31");
    expect(moved.due).toBe("2026-11-02");
    expect(moved.dueWeekday).toBe(1);
    expect(moved.shifted).toBe(true);
  });

  it("Sunday: kept by default, moved one day to Monday on request", () => {
    expect(ddCalc("2026-10-01", 45, KEEP).due).toBe("2026-11-15");
    const moved = ddCalc("2026-10-01", 45, MOVE);
    expect(moved.due).toBe("2026-11-16");
    expect(moved.dueWeekday).toBe(1);
  });

  it("the next-business-day rule leaves a weekday due date alone", () => {
    for (const days of [7, 15, 60]) {
      const r = ddCalc("2026-10-01", days, MOVE);
      expect(r.shifted, `Net ${days}`).toBe(false);
      expect(r.due).toBe(ddCalc("2026-10-01", days, KEEP).due);
    }
  });

  it("due on receipt on a Saturday invoice date moves to Monday only when asked", () => {
    expect(ddCalc("2026-10-03", 0, KEEP).due).toBe("2026-10-03");
    expect(ddCalc("2026-10-03", 0, MOVE).due).toBe("2026-10-05");
  });
});

describe("days from today", () => {
  it("counts forward, zero on the day, negative once past", () => {
    expect(ddCalc("2026-09-27", 30, KEEP, "2026-09-27").daysFromToday).toBe(30);
    expect(ddCalc("2026-09-27", 30, KEEP, "2026-10-27").daysFromToday).toBe(0);
    expect(ddCalc("2026-09-27", 30, KEEP, "2026-10-28").daysFromToday).toBe(-1);
  });

  it("is measured to the moved date when the weekend rule applies", () => {
    expect(ddCalc("2026-10-01", 30, MOVE, "2026-10-31").daysFromToday).toBe(2);
  });

  it("is null when no today is given", () => {
    expect(ddCalc("2026-09-27", 30, KEEP).daysFromToday).toBeNull();
  });
});

describe("invalid or missing input", () => {
  it.each([[""], [null], [undefined], ["abc"], ["2026-02-30"], ["2026-13-01"], ["2026-00-10"], ["26-01-01"], ["0026-01-01"], ["2026-9-7"]])(
    "rejects the invoice date %s",
    (d) => {
      expect(ddCalc(d, 30, KEEP)).toEqual({ ok: false, error: "date" });
    },
  );

  it.each([[90], [-1], [NaN], ["thirty"]])("rejects the term %s", (t) => {
    expect(ddCalc("2026-09-27", t, KEEP)).toEqual({ ok: false, error: "terms" });
  });

  it("accepts a term passed as a string, as a form value is", () => {
    expect(ddCalc("2026-09-27", "30", KEEP).due).toBe("2026-10-27");
  });
});

describe("explanation text", () => {
  it("states the counting rule for a net term", () => {
    const [first] = ddExplain(ddCalc("2026-09-28", 30, KEEP), iso);
    expect(first).toBe(
      "With Net 30 terms, payment is due 30 calendar days after the invoice date. Weekends and public holidays count as days.",
    );
  });

  it("explains due on receipt without inventing a grace period", () => {
    const [first] = ddExplain(ddCalc("2026-09-28", 0, KEEP), iso);
    expect(first).toMatch(/as soon as the client receives the invoice/);
  });

  it("says why a date moved, naming the weekday and both dates", () => {
    const lines = ddExplain(ddCalc("2026-10-01", 30, MOVE), iso);
    expect(lines[1]).toContain("Day 30 is Saturday, 2026-10-31");
    expect(lines[1]).toContain("becomes Monday, 2026-11-02");
    // Each weekday is named once — the formatter the page passes is date-only.
    expect(lines[1]).not.toMatch(/(Saturday|Monday), (Saturday|Monday)/);
  });

  it("points out a weekend due date that was kept, without claiming a legal rule", () => {
    const lines = ddExplain(ddCalc("2026-10-01", 45, KEEP), iso);
    expect(lines[1]).toContain("Sunday");
    expect(lines[1]).toMatch(/If your agreement moves weekend due dates/);
    expect(lines.join(" ")).not.toMatch(/\b(law|legal|must)\b/i);
  });

  it("adds nothing extra for a weekday due date", () => {
    expect(ddExplain(ddCalc("2026-09-28", 30, KEEP), iso)).toHaveLength(1);
  });
});
