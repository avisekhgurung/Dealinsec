import { describe, expect, it, vi } from "vitest";
vi.mock("../db", () => ({ db: {}, pool: {} }));
const { getFunnel } = await import("./funnel");
type FunnelQuery = import("./funnel").FunnelQuery;

const counts = { researched: 3, opportunity: 2, lead: 1, drafted: 1, approved: 1, sent: 1, replied: 0, meeting: 0, proposal: 0, won: 0, lost: 0, optedOut: 0 };
const deps = (seen: { org?: string; since?: Date }) => ({
  ready: async () => true, now: () => new Date("2026-10-20T00:00:00Z"), currency: async () => "INR",
  query: (async (orgId, since) => { seen.org = orgId; seen.since = since; return { counts, revenueMinor: 0 }; }) as FunnelQuery,
});

describe("GET /api/outbound/funnel", () => {
  it("counts for the caller's own workspace, over an offered window only", async () => {
    const seen: { org?: string; since?: Date } = {};
    const r = await getFunnel({ id: "u1", organizationId: "org-a", orgRole: "OWNER" } as any, "30", deps(seen)) as any;
    expect(r.ok).toBe(true);
    expect(seen.org).toBe("org-a");
    expect(seen.since!.toISOString()).toBe("2026-09-20T00:00:00.000Z");
    expect(r.funnel.stages[0]).toMatchObject({ key: "researched", count: 3 });
    await getFunnel({ id: "u1", organizationId: "org-a", orgRole: "OWNER" } as any, "9999", deps(seen));
    expect(seen.since!.toISOString()).toBe("2026-07-22T00:00:00.000Z");   // anything else is 90 days
  });
  it("no workspace, or a role that can't read leads, gets nothing; a failed count is an error, not zeros", async () => {
    const seen: { org?: string } = {};
    expect(await getFunnel({ id: "u1", organizationId: null } as any, "30", deps(seen))).toMatchObject({ ok: false, code: "no_organization" });
    expect(await getFunnel({ id: "u1", organizationId: "org-a", orgRole: "CUSTOM", customPermissions: [] } as any, "30", deps(seen))).toMatchObject({ ok: false, code: "forbidden" });
    expect(seen.org).toBeUndefined();
    const broken = { ...deps({}), query: (async () => { throw new Error("relation does not exist"); }) as FunnelQuery };
    expect(await getFunnel({ id: "u1", organizationId: "org-a", orgRole: "OWNER" } as any, "30", broken)).toMatchObject({ ok: false, code: "FUNNEL_UNAVAILABLE" });
  });
});
