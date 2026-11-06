/**
 * The Phase 3B demand scan against a fake store: what it seeds, what it keeps as direct asks, and what it never
 * does (no sources, no services, a failing source). Pure unit test — no network, no model, no database.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { icpSchema } from "@shared/icp";
import type { OpportunityPost } from "@shared/opportunity-sources";
import type { PipelineDeps, RunCountersExt } from "./pipeline";

// pipeline.ts transitively imports the db module, which refuses to load without a DATABASE_URL. The fake store
// below means no query ever runs, so a placeholder satisfies the import guard.
let opportunityScan: typeof import("./pipeline").opportunityScan;
beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgresql://unused:unused@localhost:5432/unused";
  ({ opportunityScan } = await import("./pipeline"));
});

const NOW = new Date("2026-11-10T12:00:00Z");
const post = (over: Partial<OpportunityPost>): OpportunityPost => ({
  source: "hn", threadTitle: "Ask HN: Freelancer? Seeking freelancer? (November 2026)",
  title: "SEEKING FREELANCER: brand design for our studio", url: "https://news.ycombinator.com/item?id=1",
  text: "SEEKING FREELANCER: brand design for our studio, paid project", postedAt: "2026-11-05T09:00:00.000Z", companyUrl: null, ...over,
});

function harness(posts: OpportunityPost[] | Error, sources = true) {
  const calls: Record<string, any[]> = { upsert: [], items: [], steps: [], provider: [] };
  let nextId = 100;
  const deps = {
    now: () => NOW,
    opportunitySources: () => (sources ? [{ name: "hn", label: "Hacker News", paid: false, scan: async () => { if (posts instanceof Error) throw posts; return posts; } }] : []),
    store: {
      upsertProspect: async (_org: string, c: any) => { calls.upsert.push(c); return { id: nextId++, domain: c.domain }; },
      addRunItem: async (i: any) => { calls.items.push(i); },
      saveStep: async (o: any) => { calls.steps.push(o); return []; },
      recordProviderCall: async (o: any) => { calls.provider.push(o); },
    },
  } as unknown as PipelineDeps;
  return { deps, calls };
}
const run = { id: "pr_test", organizationId: "org-3b" };
const icp = (over: object = {}) => icpSchema.parse({ industry: "digital agency", services: ["brand design"], ...over });

describe("the demand scan", () => {
  it("a post that links a company site seeds it, carrying the post as a confirmed dated outside-help signal", async () => {
    const { deps, calls } = harness([post({ companyUrl: "https://example-studio.com/" })]);
    const counters: RunCountersExt = {} as RunCountersExt;
    await opportunityScan(run, icp(), counters, deps);
    expect(counters.opportunityScan).toMatchObject({ done: true, posts: 1 });
    expect(calls.upsert[0]).toMatchObject({ domain: "example-studio.com", name: "example-studio.com", website: "https://example-studio.com" });
    expect(calls.upsert[0].sources[0]).toMatchObject({ provider: "hn", url: "https://example-studio.com" });
    expect(calls.items[0]).toMatchObject({ runId: "pr_test", orgId: "org-3b", prospectId: 100, stage: "found" });
    const f = calls.steps[0].findings[0];
    expect(calls.steps[0].batch).toBe("opportunity");
    expect(f).toMatchObject({ kind: "signal", type: "HIRING", status: "confirmed", sourceType: "post", sourceUrl: "https://news.ycombinator.com/item?id=1", confidence: "high" });
    expect(f.meta).toMatchObject({ hiringKind: "outside_help", datePrecision: "day", source: "hn" });
    expect(f.observedAt?.toISOString()).toBe("2026-11-05T09:00:00.000Z");
    expect(counters.directAsks ?? []).toEqual([]);
    // The free scan is recorded as its own operation, never against the web-search allowance.
    expect(calls.provider[0]).toMatchObject({ provider: "hn", operation: "opportunity", ok: true });
  });
  it("a post with no site — or one linking a blocked or excluded site — stays a read-only direct ask", async () => {
    const { deps, calls } = harness([
      post({ url: "https://news.ycombinator.com/item?id=2" }),
      post({ url: "https://news.ycombinator.com/item?id=3", companyUrl: "https://medium.com/@someone" }),
      post({ url: "https://news.ycombinator.com/item?id=4", companyUrl: "https://casino-brand.example/", text: "SEEKING FREELANCER: brand design for our online gambling site" }),
    ]);
    const counters = {} as RunCountersExt;
    await opportunityScan(run, icp({ exclusions: ["gambling"] }), counters, deps);
    expect(calls.upsert).toEqual([]);
    expect(counters.directAsks!.map((a) => a.url)).toEqual(["https://news.ycombinator.com/item?id=2", "https://news.ycombinator.com/item?id=3", "https://news.ycombinator.com/item?id=4"]);
    expect(counters.opportunityScan).toMatchObject({ done: true, asks: 3 });
  });
  it("posts that never mention the services are ignored entirely", async () => {
    const { deps, calls } = harness([post({ text: "SEEKING FREELANCER: Rust compiler work", companyUrl: "https://example.com/" })]);
    const counters = {} as RunCountersExt;
    await opportunityScan(run, icp(), counters, deps);
    expect(calls.upsert).toEqual([]);
    expect(counters.directAsks ?? []).toEqual([]);
  });
  it("no configured source, or an ICP without services, marks the scan done and touches nothing", async () => {
    for (const [deps, calls, theIcp] of [
      [...Object.values(harness([post({})], false)), icp()] as const,
      [...Object.values(harness([post({})])), icp({ services: [] })] as const,
    ] as any[]) {
      const counters = {} as RunCountersExt;
      await opportunityScan(run, theIcp, counters, deps);
      expect(counters.opportunityScan).toEqual({ done: true });
      expect(calls.upsert).toEqual([]);
      expect(calls.provider).toEqual([]);
    }
  });
  it("a failing source records its error and never throws out of the scan", async () => {
    const { deps } = harness(new Error("boom"));
    const counters = {} as RunCountersExt;
    await expect(opportunityScan(run, icp(), counters, deps)).resolves.toBeUndefined();
    expect(counters.opportunityScan).toMatchObject({ done: true, error: "error" });
  });
});
