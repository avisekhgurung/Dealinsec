import { describe, expect, it } from "vitest";
import { addBusinessDays, followupDueAt, followupPolicy } from "./followup-policy";

const at = (s: string) => new Date(s);

describe("business days (Mon–Fri, UTC, no holidays)", () => {
  it("skips weekends and keeps the time of day", () => {
    expect(addBusinessDays(at("2026-10-12T09:30:00Z"), 3).toISOString()).toBe("2026-10-15T09:30:00.000Z"); // Mon → Thu
    expect(addBusinessDays(at("2026-10-16T16:00:00Z"), 3).toISOString()).toBe("2026-10-21T16:00:00.000Z"); // Fri → Wed
    expect(addBusinessDays(at("2026-10-17T10:00:00Z"), 1).toISOString()).toBe("2026-10-19T10:00:00.000Z"); // Sat → Mon
    expect(addBusinessDays(at("2026-10-14T10:00:00Z"), 5).toISOString()).toBe("2026-10-21T10:00:00.000Z"); // a full week
  });
  it("is UTC: a send late Friday in New York (Saturday UTC) counts from Monday", () => {
    expect(addBusinessDays(at("2026-10-17T01:00:00Z"), 3).toISOString()).toBe("2026-10-21T01:00:00.000Z");
  });
});

describe("the follow-up policy", () => {
  it("defaults to 3 then 5 business days, two follow-ups at most", () => {
    const p = followupPolicy(undefined);
    expect(p).toEqual({ gaps: [3, 5], problem: null });
    expect(followupDueAt(p, 1, at("2026-10-12T09:00:00Z"))?.toISOString()).toBe("2026-10-15T09:00:00.000Z");
    expect(followupDueAt(p, 2, at("2026-10-15T09:00:00Z"))?.toISOString()).toBe("2026-10-22T09:00:00.000Z");
    expect(followupDueAt(p, 3, at("2026-10-22T09:00:00Z"))).toBeNull();
  });
  it("is configurable, can be switched off, and a malformed value falls back loudly (a problem to log)", () => {
    expect(followupPolicy("2,4,6").gaps).toEqual([2, 4, 6]);
    expect(followupPolicy("off").gaps).toEqual([]);
    for (const bad of ["3,x", "0,3", "1,2,3,4,5,6", "40", "3;5"]) {
      const p = followupPolicy(bad);
      expect(p.gaps, bad).toEqual([3, 5]);
      expect(p.problem, bad).toMatch(/OUTREACH_FOLLOWUP_BUSINESS_DAYS/);
    }
  });
});
