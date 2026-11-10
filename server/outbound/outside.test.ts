/**
 * Outside research: one web search for what OTHER sites say about a company.
 *
 * The promise this file guards is isolation. A headline from a page we never opened must not be able to do anything
 * a verified finding can do: make a prospect "Ready", give it timing, move its score, or reach a drafted message.
 * No network, no model, no database.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { OUTSIDE_KIND } from "@shared/outside-research";
import { findingsAsClaims, readiness, timingOf, type FindingLike } from "@shared/prospect";

vi.mock("../db", () => ({ db: {} }));
// The real store module needs a database; the service only uses it for the tables check, which this replaces.
vi.mock("./store", async (orig) => ({ ...(await orig<typeof import("./store")>()), prospectsTablesReady: async () => true, outboundStore: {} }));

let svc: typeof import("./service");
beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgresql://unused:unused@localhost:5432/unused";
  svc = await import("./service");
});

const NOW = new Date("2026-11-10T12:00:00Z");
const ana = { id: "ana", organizationId: "org-a", memberStatus: "active", orgRole: "SALES" } as any;
const viewer = { id: "vic", organizationId: "org-a", memberStatus: "active", orgRole: "VIEWER" } as any;
const prospect = (over: Record<string, unknown> = {}) => ({ id: 7, organizationId: "org-a", domain: "acmerobotics.com", name: "Acme Robotics", website: "https://acmerobotics.com/", status: "verified", rejectReason: null, sources: [], profile: {}, fit: null, score: null, angle: null, ready: false, leadId: null, ...over });

function harness(results: unknown[] | Error = [
  { url: "https://technews.example/acme", title: "Acme Robotics raises $12 million Series A", snippet: "Published 3 November 2026. The round was led by…" },
  { url: "https://acmerobotics.com/news", title: "Acme Robotics launches a robot", snippet: "our own page" },
  { url: "https://other.example/x", title: "Robotics startup raises money", snippet: "someone else entirely" },
], over: { reservation?: number | null | "workspace"; usedToday?: number; prospect?: any; providers?: any[] } = {}) {
  const calls = { search: [] as any[], reserve: [] as any[], settle: [] as any[], saved: [] as any[] };
  const stored: any[] = [];
  const provider = { name: "tavily", label: "Tavily", paid: true, supportsCountry: false, search: async (q: string, o: any) => { calls.search.push({ q, o }); if (results instanceof Error) throw results; return results as any; } };
  const deps: any = {
    now: () => NOW, contact: null,
    searchProviders: async () => over.providers ?? [provider],
    store: {
      getProspect: async (orgId: string, id: number) => (orgId === "org-a" && id === 7 ? (over.prospect === undefined ? prospect() : over.prospect) : null),
      countProviderCalls: async () => over.usedToday ?? 0,
      reserveSearch: async (r: any) => { calls.reserve.push(r); return over.reservation === undefined ? 55 : over.reservation; },
      settleProviderCall: async (id: number, r: any) => { calls.settle.push({ id, ...r }); },
      saveStep: async (o: any) => { calls.saved.push(o); stored.length = 0; o.findings.forEach((f: any, i: number) => stored.push({ id: 100 + i, organizationId: o.orgId, prospectId: o.prospectId, batch: o.batch, retrievedAt: o.now, supportingIds: [], ...f })); return stored; },
      findings: async () => stored,
    },
  };
  return { deps, calls, stored };
}

describe("looking outside a company's website", () => {
  it("makes one search for the company by name, limited to the last year, and keeps only results that name it and describe an event", async () => {
    const h = harness();
    const r: any = await svc.researchOutside(ana, 7, h.deps);
    expect(r).toMatchObject({ ok: true, found: 1, read: 3 });
    expect(h.calls.search).toHaveLength(1);
    expect(h.calls.search[0].q).toContain('"Acme Robotics"');
    expect(h.calls.search[0].o).toMatchObject({ recency: "year" });
    expect(h.calls.saved[0]).toMatchObject({ orgId: "org-a", prospectId: 7, batch: "outside" });
    expect(h.calls.saved[0].findings).toHaveLength(1);
    expect(h.calls.saved[0].findings[0]).toMatchObject({ kind: "outside", type: "FUNDING", status: "inferred", sourceType: "web", sourceUrl: "https://technews.example/acme", confidence: "low" });
    expect(h.calls.saved[0].findings[0].meta).toMatchObject({ publisher: "technews.example", datePrecision: "day" });
  });

  it("is shown in the brief on its own, never among the facts, signals or inferences", async () => {
    const h = harness();
    const r: any = await svc.researchOutside(ana, 7, h.deps);
    expect(r.brief.outside).toHaveLength(1);
    expect(r.brief.outside[0]).toMatchObject({ kind: "outside", label: "Funding", value: "Acme Robotics raises $12 million Series A", url: "https://technews.example/acme" });
    expect(r.brief.outside[0].meta).toMatchObject({ publisher: "technews.example" });
    expect(r.brief.facts).toEqual([]);
    expect(r.brief.signals).toEqual([]);
    expect(r.brief.inferences).toEqual([]);
    // The card counts VERIFIED evidence; an unverified headline is not in that number.
    expect(r.brief.prospect.evidenceCount).toBe(0);
    expect(r.brief.prospect.ready).toBe(false);
    expect(r.brief.prospect.whyNow).toBeNull();
  });

  it("the search is reserved against the shared budgets first and settled after", async () => {
    const h = harness();
    await svc.researchOutside(ana, 7, h.deps);
    expect(h.calls.reserve[0]).toMatchObject({ orgId: "org-a", runId: null, provider: "tavily" });
    expect(h.calls.reserve[0].workspace.maxMicroUsd).toBeGreaterThan(0);
    expect(h.calls.settle[0]).toMatchObject({ id: 55, ok: true });
  });
  it("at any limit it searches nothing and changes nothing", async () => {
    for (const [over, code] of [[{ reservation: null }, "global_limit"], [{ reservation: "workspace" }, "workspace_budget"], [{ usedToday: 60 }, "daily_limit"]] as const) {
      const h = harness(undefined, over as any);
      expect(await svc.researchOutside(ana, 7, h.deps)).toMatchObject({ ok: false, status: 429, code });
      expect(h.calls.search).toEqual([]);
      expect(h.calls.saved).toEqual([]);
    }
  });
  it("a failed search is settled as failed, says so without the provider's words, and leaves the last look in place", async () => {
    const h = harness(new Error("provider said: secret detail"));
    const r: any = await svc.researchOutside(ana, 7, h.deps);
    expect(r).toMatchObject({ ok: false, status: 502, code: "search_unavailable" });
    expect(r.message).not.toContain("secret detail");
    expect(h.calls.settle[0]).toMatchObject({ ok: false });
    expect(h.calls.saved).toEqual([]);
  });
  it("finding nothing is an answer, and replaces an older look", async () => {
    const h = harness([{ url: "https://x.example/1", title: "Unrelated robotics news", snippet: "" }]);
    expect(await svc.researchOutside(ana, 7, h.deps)).toMatchObject({ ok: true, found: 0 });
    expect(h.calls.saved[0]).toMatchObject({ batch: "outside", findings: [] });
  });
  it("refuses a company that was set aside, one in another workspace, a viewer, and a server with no search", async () => {
    expect(await svc.researchOutside(ana, 7, harness(undefined, { prospect: prospect({ status: "rejected", rejectReason: "not_a_company" }) }).deps)).toMatchObject({ ok: false, status: 409 });
    expect(await svc.researchOutside({ ...ana, organizationId: "org-b" }, 7, harness().deps)).toMatchObject({ ok: false, status: 404 });
    expect(await svc.researchOutside(viewer, 7, harness().deps)).toMatchObject({ ok: false, status: 403 });
    expect(await svc.researchOutside(ana, 7, harness(undefined, { providers: [] }).deps)).toMatchObject({ ok: false, status: 503 });
  });
});

// The isolation, proved against the real rules rather than asserted in a comment.
describe("an outside finding can do nothing a verified finding can", () => {
  const headline: FindingLike = { id: 1, kind: OUTSIDE_KIND, type: "FUNDING", value: "Acme Robotics raises $12 million Series A", status: "inferred", sourceUrl: "https://technews.example/acme", observedAt: new Date("2026-11-08T00:00:00Z"), retrievedAt: NOW, meta: { datePrecision: "day" } };
  // The same event, had the company's own site said it: this is what the outside finding must NOT be treated as.
  const verified: FindingLike = { ...headline, id: 2, kind: "signal", status: "confirmed" };
  const person: FindingLike = { id: 3, kind: "decision_maker", type: "CEO", value: "Jane Doe, CEO", status: "confirmed", meta: { name: "Jane Doe", title: "CEO", senior: true, rank: 0, staffEvidence: true } };

  it("gives no timing", () => {
    expect(timingOf([headline], NOW).timing).toBe("none");
    expect(timingOf([verified], NOW).timing).toBe("strong");
  });
  it("is not a claim the score reads", () => {
    expect(findingsAsClaims([headline], NOW)).toEqual([]);
    expect(findingsAsClaims([verified], NOW).length).toBeGreaterThan(0);
  });
  it("cannot make a prospect Ready, where the same event from their own site would", () => {
    const base = { verified: true, fitVerdict: "strong", now: NOW };
    expect(readiness({ ...base, findings: [verified, person] })).toMatchObject({ ready: true });
    const r = readiness({ ...base, findings: [headline, person] });
    expect(r.ready).toBe(false);
    expect(r.missing.join(" ")).toContain("a dated reason to get in touch");
  });
});
