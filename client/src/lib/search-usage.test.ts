import { describe, expect, it } from "vitest";
import { searchBlockedReason, searchTopUpOffered, type OutboundUsage } from "./search-usage";

const al = (used: number, limit: number) => ({ used, limit, remaining: Math.max(0, limit - used), nextFreesAt: used >= limit ? "2026-12-10T00:00:00.000Z" : null });
const usage = (opts: { searches?: ReturnType<typeof al>; tier?: "free" | "pro"; prospects?: ReturnType<typeof al>; credits?: number } = {}): OutboundUsage => ({
  asOf: "2026-11-12T00:00:00.000Z", searchReady: true, localReady: true, charge: "included",
  workspace: { searches: al(0, 5), webSearches: null, contactLookups: null },
  plan: { tier: opts.tier ?? "pro", label: opts.tier === "free" ? "Free plan" : "Pro", searches: opts.searches ?? al(2, 10), maxCompanies: 10, windowDays: 30, prospects: opts.prospects ?? al(10, 200), spendPercent: 10 },
  perSearch: { webSearches: 6 },
  credits: { search: { balance: opts.credits ?? 0, cost: 1, nextExpiry: null }, draft: { balance: 0, cost: 1, nextExpiry: null } },
  warn: { percent: 80, warn: true, exhausted: true },
  platform: { state: "available", resetsAt: "2026-11-13T00:00:00.000Z" },
} as OutboundUsage);

describe("a search blocked by the plan, and unblocked by purchased credits", () => {
  it("is not blocked with room in the plan", () => {
    expect(searchBlockedReason(usage())).toBeNull();
  });
  it("plan searches used up and no credits: only searching is blocked, with the free plan's upgrade wording", () => {
    expect(searchBlockedReason(usage({ tier: "free", searches: al(3, 3) }))).toMatch(/used the free plan's 3 Client Radar searches.*Upgrade to Pro/);
    expect(searchBlockedReason(usage({ searches: al(10, 10) }))).toMatch(/used the 10 searches included in Pro.*next one frees up/);
  });
  it("plan searches used up but purchased credits cover it: NOT blocked", () => {
    expect(searchBlockedReason(usage({ searches: al(10, 10), credits: 3 }))).toBeNull();
  });
  it("researched prospects used up is also paid by a credit, and blocks without one", () => {
    expect(searchBlockedReason(usage({ prospects: al(200, 200) }))).toMatch(/researched prospects/);
    expect(searchBlockedReason(usage({ prospects: al(200, 200), credits: 1 }))).toBeNull();
  });
  it("a credit does not lift a platform or setup block", () => {
    expect(searchBlockedReason({ ...usage({ searches: al(10, 10), credits: 5 }), searchReady: false })).toMatch(/isn't set up/);
    expect(searchBlockedReason({ ...usage({ credits: 5 }), platform: { state: "paused", resetsAt: "2026-11-13T00:00:00.000Z" } })).toMatch(/today's limit across DealInSec/);
  });
});

describe("when the top-up offer belongs under the note", () => {
  it("at the warning threshold, when the plan is used up without credits, and not otherwise", () => {
    expect(searchTopUpOffered(usage({ searches: al(2, 10) }))).toBe(false);
    expect(searchTopUpOffered(usage({ searches: al(8, 10) }))).toBe(true);
    expect(searchTopUpOffered(usage({ searches: al(10, 10) }))).toBe(true);
    expect(searchTopUpOffered(usage({ searches: al(10, 10), credits: 2 }))).toBe(false);
  });
  it("respects the admin's notification switches", () => {
    expect(searchTopUpOffered({ ...usage({ searches: al(8, 10) }), warn: { percent: 80, warn: false, exhausted: true } })).toBe(false);
    expect(searchTopUpOffered({ ...usage({ searches: al(10, 10) }), warn: { percent: 80, warn: true, exhausted: false } })).toBe(false);
  });
  it("never offers it to an unlimited workspace or when the numbers couldn't be read", () => {
    expect(searchTopUpOffered(undefined)).toBe(false);
    expect(searchTopUpOffered({ ...usage(), plan: { ...usage().plan!, tier: "unlimited" } })).toBe(false);
  });
});
