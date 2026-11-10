/** GET /api/outbound/results, the rules: who may read it, the window it asks the database for, and what happens when a half can't be counted. */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { EMPTY_DISCOVERY } from "@shared/outreach-results";

vi.mock("../db", () => ({ db: {} }));
let mod: typeof import("./results");
beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgresql://unused:unused@localhost:5432/unused";
  mod = await import("./results");
}, 60_000);

const NOW = new Date("2026-11-10T12:00:00Z");
const ana = { id: "ana", organizationId: "org-a", memberStatus: "active", orgRole: "SALES" } as any;
const viewer = { id: "vic", organizationId: "org-a", memberStatus: "active", orgRole: "VIEWER" } as any;
function deps(over: Record<string, unknown> = {}) {
  const asked: any[] = [];
  const d = {
    ready: async () => true, now: () => NOW, currency: async () => "INR",
    discovery: async (orgId: string, since: Date) => { asked.push(["discovery", orgId, since.toISOString()]); return { ...EMPTY_DISCOVERY, discovered: 40, verified: 30, qualified: 12, ready: 3, researched: 30, person: 9, publicRoute: 20 }; },
    campaigns: async (orgId: string, since: Date) => { asked.push(["campaigns", orgId, since.toISOString()]); return [{ id: 1, name: "Diwali", profileName: "Brands", archived: false, createdAt: "2026-11-01T00:00:00.000Z", members: 10, sent: 8, replied: 2, interested: 1, bounced: 0, optedOut: 0, meeting: 1, proposal: 0, won: 0, wonValueMinor: 0 }]; },
    ...over,
  };
  return { d, asked };
}

describe("the results endpoint", () => {
  it("counts only the caller's workspace, over the window asked for", async () => {
    const { d, asked } = deps();
    const r: any = await mod.getResults(ana, "30", d as any);
    expect(r).toMatchObject({ ok: true, results: { days: 30, currency: "INR", discovery: { coverageBase: 30 }, campaigns: { totals: { sent: 8, replyRate: 25 } } } });
    expect(asked).toEqual([["discovery", "org-a", "2026-10-11T12:00:00.000Z"], ["campaigns", "org-a", "2026-10-11T12:00:00.000Z"]]);
    expect(r.results.discovery.stages.map((s: any) => s.count)).toEqual([40, 30, 12, 3]);
  });
  it("a window that isn't offered falls back to 90 days", async () => {
    const { d, asked } = deps();
    expect((await mod.getResults(ana, "7", d as any) as any).results.days).toBe(90);
    expect(asked[0][2]).toBe("2026-08-12T12:00:00.000Z");
  });
  it("a viewer may read it; someone with no workspace may not", async () => {
    expect((await mod.getResults(viewer, 90, deps().d as any)).ok).toBe(true);
    expect(await mod.getResults({ id: "x", organizationId: null } as any, 90, deps().d as any)).toMatchObject({ ok: false, status: 403 });
  });
  it("without campaigns on the server, or when they can't be counted, that half is left out and the rest stands", async () => {
    for (const campaigns of [async () => null, async () => { throw new Error("db"); }]) {
      const r: any = await mod.getResults(ana, 90, deps({ campaigns }).d as any);
      expect(r).toMatchObject({ ok: true, results: { campaigns: null, discovery: { coverageBase: 30 } } });
    }
  });
  it("says so when Client Radar isn't set up or its numbers can't be counted, and never guesses", async () => {
    expect(await mod.getResults(ana, 90, deps({ ready: async () => false }).d as any)).toMatchObject({ ok: false, status: 503, code: "OUTBOUND_NOT_SETUP" });
    expect(await mod.getResults(ana, 90, deps({ ready: async () => { throw new Error("db"); } }).d as any)).toMatchObject({ ok: false, status: 503, code: "OUTBOUND_NOT_SETUP" });
    expect(await mod.getResults(ana, 90, deps({ discovery: async () => { throw new Error("db"); } }).d as any)).toMatchObject({ ok: false, status: 503, code: "RESULTS_UNAVAILABLE" });
  });
  it("a currency that can't be read falls back to rupees rather than failing the page", async () => {
    expect((await mod.getResults(ana, 90, deps({ currency: async () => { throw new Error("db"); } }).d as any) as any).results.currency).toBe("INR");
  });
});
