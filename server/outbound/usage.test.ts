/** The usage view shown before a search: exact workspace counts, the platform only as a state, unknown when uncounted. */
import { describe, expect, it, vi } from "vitest";
// Everything is injected below; these only keep the real database and providers from loading.
vi.mock("../db", () => ({ db: {} }));
vi.mock("./pipeline", () => ({ pipelineDeps: () => { throw new Error("not in tests"); } }));
import { outboundUsage, type UsageDeps } from "./usage";

const NOW = new Date("2026-10-16T10:00:00Z");
const HOUR = 3_600_000;
const ana = { id: "ana", organizationId: "org-a", memberStatus: "active", orgRole: "SALES" } as any;

function deps(over: Partial<UsageDeps> = {}) {
  const calls: { orgId?: string; operation: string; since: Date }[] = [];
  const d: Partial<UsageDeps> = {
    now: () => NOW,
    tablesReady: async () => true,
    searchReady: async () => true,
    contactReady: () => false,
    recentRuns: async () => [],
    countProviderCalls: async (o) => { calls.push(o); return 0; },
    platformSpend: async () => ({ all: 0, pool: 0 }),
    tier: async () => "pro",
    prospectsHeld: async () => 0,
    aiDrafts: async () => 0,
    gmailSends: async () => 0,
    workspaceSpend: async () => 0,
    ...over,
  };
  return { d, calls };
}
const ok = (r: any) => { if (!r.ok) throw new Error(JSON.stringify(r)); return r.usage; };

describe("AI Outbound usage: the plan's 30-day allowance (one credit = one search that ran)", () => {
  const DAY = 24 * HOUR;
  const ran = (daysAgo: number) => ({ status: "done", counters: { searched: 8 }, createdAt: new Date(NOW.getTime() - daysAgo * DAY) });

  it("each plan shows its own four allowances, the most companies a search may look for, and the spend share", async () => {
    const free = (n: number) => ({ used: 0, limit: n, remaining: n, nextFreesAt: null });
    for (const [tier, limit, maxCompanies, label, prospects, drafts, sends] of [["free", 3, 10, "Free plan", 30, 3, 3], ["trial", 10, 10, "Pro trial", 100, 10, 10], ["pro", 10, 10, "Pro", 100, 10, 10]] as const) {
      const u = ok(await outboundUsage(ana, deps({ tier: async () => tier }).d));
      expect(u.plan).toEqual({ tier, label, searches: free(limit), maxCompanies, windowDays: 30, prospects: free(prospects), drafts: free(drafts), sends: free(sends), spendPercent: 0 });
    }
  });

  it("prospects, drafts and sends are counted separately, and the spend shows as a share of the ceiling, never dollars", async () => {
    const u = ok(await outboundUsage(ana, deps({ prospectsHeld: async () => 37, aiDrafts: async () => 10, gmailSends: async () => 4, workspaceSpend: async () => 750_000 }).d));
    expect(u.plan.prospects).toMatchObject({ used: 37, limit: 100, remaining: 63 });
    expect(u.plan.drafts).toMatchObject({ used: 10, limit: 10, remaining: 0 });
    expect(u.plan.sends).toMatchObject({ used: 4, limit: 10, remaining: 6 });
    expect(u.plan.spendPercent).toBe(50); // $0.75 of the $1.50 default
    const unknown = ok(await outboundUsage(ana, deps({ aiDrafts: async () => { throw new Error("db"); } }).d));
    expect(unknown.plan.drafts).toBeNull(); // couldn't be counted: unknown, never "plenty left"
  });

  it("free: three searches in 30 days use it up, and it says when the next frees up", async () => {
    const runs = [ran(2), ran(10), ran(25), { status: "done", counters: { searched: 0 }, createdAt: new Date(NOW.getTime() - DAY) }];
    const u = ok(await outboundUsage(ana, deps({ tier: async () => "free", recentRuns: async () => runs as any }).d));
    expect(u.plan.searches).toEqual({ used: 3, limit: 3, remaining: 0, nextFreesAt: new Date(NOW.getTime() + 5 * DAY).toISOString() });
  });

  it("a plan that can't be read counts as the free plan (never more than paid for)", async () => {
    const u = ok(await outboundUsage(ana, deps({ tier: async () => { throw new Error("db"); } }).d));
    expect(u.plan.tier).toBe("free");
  });
});

describe("AI Outbound usage before a search", () => {
  it("a fresh workspace: every allowance available, included in the plan, the platform available", async () => {
    const u = ok(await outboundUsage(ana, deps().d));
    expect(u).toMatchObject({ charge: "included", searchReady: true, perSearch: { webSearches: 8 }, platform: { state: "available", resetsAt: "2026-10-17T00:00:00.000Z" } });
    expect(u.workspace.searches).toEqual({ used: 0, limit: 5, remaining: 5, nextFreesAt: null });
    expect(u.workspace.webSearches).toMatchObject({ used: 0, limit: 60, remaining: 60 });
    expect(u.workspace.contactLookups).toBeNull(); // no contact provider connected: not shown at all
  });

  it("counts only searches that did work, and says when the next one frees up once the allowance is used", async () => {
    const runs = [
      ...[1, 2, 3, 4].map((h) => ({ status: "done", counters: { searched: 8 }, createdAt: new Date(NOW.getTime() - h * HOUR) })),
      { status: "running", counters: {}, createdAt: new Date(NOW.getTime() - 20 * HOUR) },
      { status: "done", counters: { searched: 0, stoppedBy: "global_limit" }, createdAt: new Date(NOW.getTime() - 30 * 60_000) },
    ];
    const u = ok(await outboundUsage(ana, deps({ recentRuns: async () => runs as any }).d));
    expect(u.workspace.searches).toEqual({ used: 5, limit: 5, remaining: 0, nextFreesAt: new Date(NOW.getTime() + 4 * HOUR).toISOString() });
  });

  it("asks only about this workspace for its own allowances (orgId always the caller's)", async () => {
    const seen: string[] = [];
    const { d, calls } = deps({ recentRuns: async (orgId) => { seen.push(orgId); return []; } });
    ok(await outboundUsage(ana, d));
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((o) => o === "org-a")).toBe(true); // today's count and the plan's 30-day count, both its own
    const own = calls.filter((c) => c.orgId);
    expect(own.every((c) => c.orgId === "org-a")).toBe(true);
    // the platform count is the only one without a workspace, and it uses the UTC day
    expect(calls.filter((c) => !c.orgId)).toEqual([{ operation: "search", since: new Date("2026-10-16T00:00:00Z") }]);
  });

  it("the platform is a state, never numbers: limited when a full search no longer fits, paused when used up", async () => {
    const limited = ok(await outboundUsage(ana, deps({ countProviderCalls: async (o) => (o.orgId ? 0 : 25) }).d));
    expect(limited.platform.state).toBe("limited");
    const paused = ok(await outboundUsage(ana, deps({ platformSpend: async () => ({ all: 100_000, pool: 500_000 }) }).d));
    expect(paused.platform.state).toBe("paused");
    expect(Object.keys(paused.platform).sort()).toEqual(["resetsAt", "state"]); // no counts, no money
  });

  it("a count that fails makes only its own part unknown (never zero, never 'available')", async () => {
    const u = ok(await outboundUsage(ana, deps({
      recentRuns: async () => { throw new Error("db"); },
      platformSpend: async () => { throw new Error("db"); },
    }).d));
    expect(u.workspace.searches).toBeNull();
    expect(u.workspace.webSearches).not.toBeNull();
    expect(u.platform.state).toBe("unknown");
  });

  it("says whether local business search is configured (off unless a source is)", async () => {
    expect(ok(await outboundUsage(ana, deps().d)).localReady).toBe(false);
    expect(ok(await outboundUsage(ana, deps({ localReady: () => true }).d)).localReady).toBe(true);
  });

  it("contact lookups are shown when a contact provider is connected", async () => {
    const u = ok(await outboundUsage(ana, deps({ contactReady: () => true, countProviderCalls: async (o) => (o.operation === "contact" ? 7 : 0) }).d));
    expect(u.workspace.contactLookups).toMatchObject({ used: 7, limit: 30, remaining: 23 });
  });

  it("refuses without leads access or before AI Outbound is set up", async () => {
    expect(await outboundUsage({ id: "x", organizationId: null } as any, deps().d)).toMatchObject({ ok: false, status: 403 });
    expect(await outboundUsage(ana, deps({ tablesReady: async () => false }).d)).toMatchObject({ ok: false, status: 503 });
  });
});
