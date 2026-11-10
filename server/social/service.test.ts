/**
 * Social Intent's service against an in-memory store and fake sources. No network, no model, no database.
 * The rules worth guarding here are about money and honesty: what a scan is charged for, what it refuses to keep,
 * and what a lead saved from a post is allowed to claim.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("../db", () => ({ db: {} }));
import type { OpportunityPost } from "@shared/opportunity-sources";
import type { SocialOpportunityRow, SocialProfileRow } from "@shared/schema";
import { DiscoveryError, type OpportunitySource, type ScanOptions } from "../discovery/types";
import type { SocialDeps } from "./service";
import type { SocialStore } from "./store";

let svc: typeof import("./service");
let sched: typeof import("./schedule");
beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgresql://unused:unused@localhost:5432/unused";
  svc = await import("./service");
  sched = await import("./schedule");
});

const NOW = new Date("2026-11-10T12:00:00Z");
const DAY = 86_400_000;
const ana = { id: "ana", organizationId: "org-a", memberStatus: "active", orgRole: "SALES" } as any;
const viewer = { id: "vic", organizationId: "org-a", memberStatus: "active", orgRole: "VIEWER" } as any;

const post = (over: Partial<OpportunityPost> = {}): OpportunityPost => ({
  source: "hn", threadTitle: "Ask HN: Freelancer? Seeking freelancer?", title: "SEEKING FREELANCER: web design for our studio",
  url: "https://news.ycombinator.com/item?id=1", text: "SEEKING FREELANCER: web design for our studio, paid project, budget $2,000", postedAt: new Date(NOW.getTime() - 2 * DAY).toISOString(), companyUrl: null, ...over,
});
const source = (name: string, posts: OpportunityPost[] | Error, paid = false): OpportunitySource & { seen: ScanOptions[] } => {
  const seen: ScanOptions[] = [];
  return { name, label: name, paid, seen, scan: async (o: ScanOptions = {}) => {
    seen.push(o);
    if (posts instanceof Error) throw posts;
    if (paid) { const r = await o.paidCall?.("tavily", async () => posts); return r ?? []; }
    return posts;
  } };
};

function memoryStore() {
  const opps: SocialOpportunityRow[] = [], profiles: SocialProfileRow[] = [];
  const scans: any[] = [];
  let id = 1;
  const store: SocialStore = {
    async reserveScan(r) { if (scans.filter((s) => s.organizationId === r.orgId).length >= r.max) return null; const row = { id: id++, organizationId: r.orgId, profileId: r.profileId, trigger: r.trigger, createdAt: r.now }; scans.push(row); return row as any; },
    async finishScan(i, r) { Object.assign(scans.find((s) => s.id === i), r); },
    async dropScan(i) { scans.splice(scans.findIndex((s) => s.id === i), 1); },
    async countScansSince(orgId) { return scans.filter((s) => s.organizationId === orgId).length; },
    async oldestScanSince() { return scans[0]?.createdAt ?? null; },
    async upsertOpportunity(orgId, o, now) {
      const cur = opps.find((x) => x.organizationId === orgId && x.url === o.url);
      if (cur) { Object.assign(cur, { title: o.title, excerpt: o.excerpt, intent: o.intent, score: o.score, scoreDetail: o.scoreDetail, lastSeenAt: now }); return { id: cur.id, fresh: false }; }
      const row = { id: id++, organizationId: orgId, ...o, discoveredAt: now, lastSeenAt: now, status: "new", leadId: null, createdAt: now, updatedAt: now } as unknown as SocialOpportunityRow;
      opps.push(row); return { id: row.id, fresh: true };
    },
    async listOpportunities(orgId, f) { const rows = opps.filter((x) => x.organizationId === orgId && (!f.status?.length || f.status.includes(x.status))); return { rows, total: rows.length }; },
    async stats(orgId, high) { const mine = opps.filter((x) => x.organizationId === orgId); return { total: mine.filter((x) => x.status !== "ignored").length, fresh: mine.filter((x) => x.status === "new").length, high: mine.filter((x) => x.status === "new" && x.score >= high).length, saved: mine.filter((x) => ["saved", "contacted"].includes(x.status)).length }; },
    async getOpportunity(orgId, i) { return opps.find((x) => x.organizationId === orgId && x.id === i) ?? null; },
    async setOpportunity(orgId, i, patch) { const r = opps.find((x) => x.organizationId === orgId && x.id === i); if (r) Object.assign(r, patch); return r ?? null; },
    async deleteOpportunity(orgId, i) { const k = opps.findIndex((x) => x.organizationId === orgId && x.id === i); if (k < 0) return false; opps.splice(k, 1); return true; },
    async countManualSince(orgId) { return opps.filter((x) => x.organizationId === orgId && x.origin === "manual").length; },
    async purgeExpired() { return 0; },
    async listProfiles(orgId) { return profiles.filter((p) => p.organizationId === orgId); },
    async getProfile(orgId, i) { return profiles.find((p) => p.organizationId === orgId && p.id === i) ?? null; },
    async createProfile(orgId, userId, f, now) { const row = { id: id++, organizationId: orgId, createdByUser: userId, ...f, lastRunAt: null, createdAt: now, updatedAt: now } as unknown as SocialProfileRow; profiles.push(row); return row; },
    async updateProfile(orgId, i, f) { const r = profiles.find((p) => p.organizationId === orgId && p.id === i); if (r) Object.assign(r, f); return r ?? null; },
    async deleteProfile(orgId, i) { const k = profiles.findIndex((p) => p.organizationId === orgId && p.id === i); if (k < 0) return false; profiles.splice(k, 1); return true; },
    async markProfileRun(orgId, i, now) { const r = profiles.find((p) => p.organizationId === orgId && p.id === i); if (r) r.lastRunAt = now; },
    async claimDueProfile() { return null; },
    async nextDue() { return null; },
  };
  return { store, opps, profiles, scans };
}

function harness(sources: OpportunitySource[], over: Partial<SocialDeps> = {}) {
  const m = memoryStore();
  const search = { reserved: [] as any[], settled: [] as any[], recorded: [] as any[], cap: null as null | "workspace" | "global", usedToday: 0 };
  const leads = { created: [] as any[], claims: [] as any[], byUrl: [] as { leadId: number; url: string }[] };
  const deps: Partial<SocialDeps> = {
    store: m.store, now: () => NOW, ready: async () => true, tier: async () => "pro", sources: async () => sources,
    savedServices: async () => ["web design"], scheduleEnabled: () => false, onProfilesChanged: () => {},
    search: {
      countProviderCalls: async () => search.usedToday,
      reserveSearch: async (r: any) => { if (search.cap === "global") return null; if (search.cap === "workspace") return "workspace"; search.reserved.push(r); return search.reserved.length; },
      settleProviderCall: async (i: number, r: any) => { search.settled.push({ id: i, ...r }); },
      recordProviderCall: async (r: any) => { search.recorded.push(r); },
    } as any,
    leads: { leadIdsByEvidenceUrls: async (_o: string, urls: string[]) => leads.byUrl.filter((x) => urls.includes(x.url)) } as any,
    createLead: (async (_u: any, raw: any, opts: any) => { leads.created.push({ raw, opts }); return { ok: true, lead: { id: 900 + leads.created.length } }; }) as any,
    addClaim: (async (_u: any, leadId: number, raw: any) => { leads.claims.push({ leadId, ...raw }); return { ok: true, claim: {} }; }) as any,
    ...over,
  };
  return { deps, ...m, search, leads };
}
const scanOf = (r: any) => { if (!r.ok) throw new Error(JSON.stringify(r)); return r.scan; };

describe("a scan", () => {
  it("keeps real asks about the person's services, and drops everything else", async () => {
    const h = harness([source("hn", [
      post(), // an ask for web design
      post({ url: "https://news.ycombinator.com/item?id=2", title: "x", text: "SEEKING FREELANCER: Rust compiler engineer for our team" }), // an ask, but not for this person
      post({ url: "https://news.ycombinator.com/item?id=3", title: "x", text: "[For Hire] web design, 6 years experience, hire me" }), // a competitor
      post({ url: "https://news.ycombinator.com/item?id=4", title: "x", text: "Thoughts on web design trends this year?" }), // talk
    ])]);
    const s = scanOf(await svc.scan(ana, { services: ["web design"] }, {}, h.deps));
    expect(s).toMatchObject({ read: 4, kept: 1, fresh: 1 });
    expect(h.opps).toHaveLength(1);
    expect(h.opps[0]).toMatchObject({ intent: "hiring", service: "web design", source: "hn", origin: "scan", status: "new" });
    expect(h.opps[0].score).toBeGreaterThan(60);
    expect(h.opps[0].expiresAt?.getTime()).toBe(NOW.getTime() + 60 * DAY);
  });

  it("one post returned by two sources is one opportunity", async () => {
    const same = post({ source: "reddit", url: "https://www.reddit.com/r/forhire/comments/1/x/", text: "[Hiring] web design freelancer for our store" });
    const h = harness([source("reddit", [same]), source("web", [{ ...same, source: "web", url: "https://www.reddit.com/r/forhire/comments/1/x/?utm_source=share" }])]);
    const s = scanOf(await svc.scan(ana, { services: ["web design"] }, {}, h.deps));
    expect(s.kept).toBe(1);
    expect(h.opps).toHaveLength(1);
  });

  it("a post seen again is not fresh, and the person's decision on it survives the rescan", async () => {
    const h = harness([source("hn", [post()])]);
    await svc.scan(ana, { services: ["web design"] }, {}, h.deps);
    await svc.setStatus(ana, h.opps[0].id, "ignored", h.deps);
    const s = scanOf(await svc.scan(ana, { services: ["web design"] }, {}, h.deps));
    expect(s).toMatchObject({ kept: 1, fresh: 0 });
    expect(h.opps[0].status).toBe("ignored");
  });

  it("without services it refuses before using a scan", async () => {
    const h = harness([source("hn", [post()])]);
    const r = await svc.scan(ana, { services: [] }, {}, h.deps);
    expect(r).toMatchObject({ ok: false, status: 422, code: "no_services" });
    expect(h.scans).toHaveLength(0);
  });

  it("a failing source is reported and the others are kept; the scan is charged because it delivered", async () => {
    const h = harness([source("reddit", new DiscoveryError("auth", "nope")), source("hn", [post()])]);
    const s = scanOf(await svc.scan(ana, { services: ["web design"] }, {}, h.deps));
    expect(s.sources).toEqual([{ name: "reddit", ok: false, posts: 0, error: "auth" }, { name: "hn", ok: true, posts: 1 }]);
    expect(s.kept).toBe(1);
    expect(h.scans).toHaveLength(1);
  });

  // The person got nothing, so they are charged nothing.
  it("when no source answers, the scan is not counted and the reply says why", async () => {
    const h = harness([source("hn", new DiscoveryError("unavailable", "down")), source("reddit", new DiscoveryError("rate_limited", "busy"))]);
    const r: any = await svc.scan(ana, { services: ["web design"] }, {}, h.deps);
    expect(r).toMatchObject({ ok: false, status: 502, code: "sources_failed" });
    expect(r.message).toContain("It wasn't counted");
    expect(r.message).not.toContain("down"); // never a source's own error text
    expect(h.scans).toHaveLength(0);
  });

  it("the plan's allowance is enforced: free gets the upgrade answer, Pro is told when it frees up", async () => {
    const h = harness([source("hn", [post()])], { tier: async () => "free" });
    for (let i = 0; i < 3; i++) scanOf(await svc.scan(ana, { services: ["web design"] }, {}, h.deps));
    expect(await svc.scan(ana, { services: ["web design"] }, {}, h.deps)).toMatchObject({ ok: false, status: 402, code: "NO_CREDITS", feature: "outbound" });
    const pro = harness([source("hn", [post()])], { tier: async () => "pro" });
    for (let i = 0; i < 30; i++) scanOf(await svc.scan(ana, { services: ["web design"] }, {}, pro.deps));
    expect(await svc.scan(ana, { services: ["web design"] }, {}, pro.deps)).toMatchObject({ ok: false, status: 429, code: "monthly_limit" });
  });

  it("only the platforms that were picked are scanned", async () => {
    const hn = source("hn", [post()]), reddit = source("reddit", []);
    const h = harness([hn, reddit]);
    await svc.scan(ana, { services: ["web design"], platforms: ["hn", "linkedin"] }, {}, h.deps); // linkedin can't be searched: ignored
    expect(hn.seen).toHaveLength(1);
    expect(reddit.seen).toHaveLength(0);
  });

  it("someone who may only view can't scan", async () => {
    const h = harness([source("hn", [post()])]);
    expect(await svc.scan(viewer, { services: ["web design"] }, {}, h.deps)).toMatchObject({ ok: false, status: 403 });
  });
});

describe("the paid source and the search budget", () => {
  const web = () => source("web", [post({ source: "web", url: "https://www.reddit.com/r/a/comments/9/x/", text: "Looking to hire a web design agency for our startup", postedAt: null })], true);

  it("each billed search is reserved against the same budgets as a Client Radar search, then settled", async () => {
    const h = harness([web()]);
    const s = scanOf(await svc.scan(ana, { services: ["web design"] }, {}, h.deps));
    expect(s.kept).toBe(1);
    expect(h.search.reserved).toHaveLength(1);
    expect(h.search.reserved[0]).toMatchObject({ orgId: "org-a", provider: "tavily", runId: null });
    expect(h.search.reserved[0].workspace.maxMicroUsd).toBeGreaterThan(0);
    expect(h.search.settled[0]).toMatchObject({ ok: true });
  });
  it("at the platform's daily cap it makes no search, reports the limit, and (being the only source) isn't charged", async () => {
    const h = harness([web()]);
    h.search.cap = "global";
    const r: any = await svc.scan(ana, { services: ["web design"] }, {}, h.deps);
    expect(r).toMatchObject({ ok: false, status: 429, code: "sources_failed" });
    expect(h.search.settled).toEqual([]);
    expect(h.scans).toHaveLength(0);
  });
  it("at the workspace's spend ceiling the free sources still deliver", async () => {
    const h = harness([web(), source("hn", [post()])]);
    h.search.cap = "workspace";
    const s = scanOf(await svc.scan(ana, { services: ["web design"] }, {}, h.deps));
    expect(s.sources).toEqual([{ name: "web", ok: false, posts: 0, error: "workspace_budget" }, { name: "hn", ok: true, posts: 1 }]);
  });
  it("an unattended scan never uses a paid source", async () => {
    const paid = web(), hn = source("hn", [post()]);
    const h = harness([paid, hn]);
    scanOf(await svc.scan(ana, { services: ["web design"] }, { trigger: "scheduled", freeOnly: true }, h.deps));
    expect(paid.seen).toHaveLength(0);
    expect(h.search.reserved).toEqual([]);
  });
});

describe("a post the person found themselves", () => {
  it("is read by the same rules, filed under its platform, and nothing is fetched", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const h = harness([]);
    const r: any = await svc.addManual(ana, { url: "https://www.linkedin.com/posts/someone_activity-1?utm_source=share", text: "We're looking to hire a web design freelancer for our clinic's new site. Budget around $3,000." }, h.deps);
    expect(r.ok).toBe(true);
    expect(r.opportunity).toMatchObject({ source: "linkedin", sourceLabel: "LinkedIn", origin: "manual", intent: "hiring", service: "web design", postedAt: null });
    expect(r.opportunity.url).not.toContain("utm_source");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
  it("a post that reads as plain talk is kept — the person chose it — and labelled as talk", async () => {
    const h = harness([]);
    const r: any = await svc.addManual(ana, { url: "https://www.facebook.com/groups/1/posts/2", text: "What does everyone think about web design trends this year?" }, h.deps);
    expect(r.opportunity).toMatchObject({ source: "facebook", intent: "discussion", highIntent: false });
  });
  it("needs a real link and real text", async () => {
    const h = harness([]);
    expect(await svc.addManual(ana, { url: "javascript:alert(1)", text: "Looking to hire a web designer for our shop" }, h.deps)).toMatchObject({ ok: false, status: 400 });
    expect(await svc.addManual(ana, { url: "https://x.com/a/status/1", text: "hi" }, h.deps)).toMatchObject({ ok: false, status: 400 });
  });
});

describe("an opportunity becomes a lead", () => {
  async function one(over: Partial<OpportunityPost> = {}) {
    const h = harness([source("reddit", [post({ source: "reddit", threadTitle: "r/smallbusiness", url: "https://www.reddit.com/r/smallbusiness/comments/1/x/", title: "Looking to hire a web design freelancer", text: "Looking to hire a web design freelancer for our bakery's site", ...over })])]);
    await svc.scan(ana, { services: ["web design"] }, {}, h.deps);
    return h;
  }
  // What a lead saved from a post is allowed to claim: that they ASKED is a fact with a link; what they need is our reading.
  it("the ask is a confirmed claim with the post as evidence; the need is only inferred", async () => {
    const h = await one();
    const r: any = await svc.saveToLeads(ana, h.opps[0].id, {}, h.deps);
    expect(r).toMatchObject({ ok: true, existing: false });
    expect(h.leads.created[0]).toMatchObject({ opts: { source: "outbound" } });
    expect(h.leads.claims[0]).toMatchObject({ field: "hiring", status: "confirmed", evidenceUrl: "https://www.reddit.com/r/smallbusiness/comments/1/x" });
    expect(h.leads.claims[0].evidenceSnippet).toContain("bakery");
    expect(h.leads.claims[1]).toMatchObject({ field: "opportunity", status: "inferred" });
    expect(h.leads.claims[1].value).toContain("not something they confirmed");
    expect(h.opps[0]).toMatchObject({ status: "saved", leadId: 901, expiresAt: null });
  });
  // The break this guards: a claim filed under a name the draft doesn't read is saved and then never used, so the
  // message would say nothing about the post. This runs the REAL draft rule over the claims a saved post leaves.
  it("a message can be drafted from a saved ask: the post lands in fields the draft actually reads", async () => {
    const { draftFacts } = await import("../sales/outreach");
    const h = await one();
    await svc.saveToLeads(ana, h.opps[0].id, {}, h.deps);
    const { facts, angles } = draftFacts(h.leads.claims.map((c: any, i: number) => ({ id: i + 1, field: c.field, value: c.value, status: c.status, evidenceUrl: c.evidenceUrl })));
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ field: "hiring", label: "Hiring" });
    expect(facts[0].value).toContain("Looking to hire a web design freelancer");
    expect(angles.map((a) => a.field)).toEqual(["opportunity"]);
  });
  it("a stated problem is an angle, not a fact about the company: a message still needs research first", async () => {
    const { draftFacts } = await import("../sales/outreach");
    const h = await one({ title: "Our website isn't converting", text: "Our website isn't converting and web design is the issue, we think" });
    await svc.saveToLeads(ana, h.opps[0].id, {}, h.deps);
    const { facts, angles } = draftFacts(h.leads.claims.map((c: any, i: number) => ({ id: i + 1, field: c.field, value: c.value, status: c.status, evidenceUrl: c.evidenceUrl })));
    expect(facts).toEqual([]);
    expect(angles.map((a) => a.field).sort()).toEqual(["opportunity", "pain_point"]);
  });

  it("is named after the company's site when the post links one, otherwise described — never a guess at who posted", async () => {
    const linked = await one({ companyUrl: "https://www.sweet-crumbs.com/about" });
    await svc.saveToLeads(ana, linked.opps[0].id, {}, linked.deps);
    expect(linked.leads.created[0].raw).toEqual({ companyName: "sweet-crumbs.com", website: "https://sweet-crumbs.com" });
    const bare = await one();
    await svc.saveToLeads(ana, bare.opps[0].id, {}, bare.deps);
    expect(bare.leads.created[0].raw.companyName).toBe("Post in r/smallbusiness: Looking to hire a web design freelancer");
    const named = await one();
    await svc.saveToLeads(ana, named.opps[0].id, { name: "Sweet Crumbs Bakery" }, named.deps);
    expect(named.leads.created[0].raw.companyName).toBe("Sweet Crumbs Bakery");
  });
  it("saving twice, or a post already cited by a lead, makes no second lead", async () => {
    const h = await one();
    await svc.saveToLeads(ana, h.opps[0].id, {}, h.deps);
    expect(await svc.saveToLeads(ana, h.opps[0].id, {}, h.deps)).toMatchObject({ ok: true, existing: true, leadId: 901 });
    expect(h.leads.created).toHaveLength(1);
    const k = await one();
    k.leads.byUrl.push({ leadId: 77, url: k.opps[0].url });
    expect(await svc.saveToLeads(ana, k.opps[0].id, {}, k.deps)).toMatchObject({ ok: true, existing: true, leadId: 77 });
    expect(k.leads.created).toHaveLength(0);
  });
  it("another workspace's opportunity is not found", async () => {
    const h = await one();
    const bob = { ...ana, id: "bob", organizationId: "org-b" };
    expect(await svc.saveToLeads(bob, h.opps[0].id, {}, h.deps)).toMatchObject({ ok: false, status: 404 });
    expect(await svc.setStatus(bob, h.opps[0].id, "ignored", h.deps)).toMatchObject({ ok: false, status: 404 });
    expect(await svc.remove(bob, h.opps[0].id, h.deps)).toMatchObject({ ok: false, status: 404 });
  });
});

describe("what is kept, and for how long", () => {
  it("contacted is the person's own record and stops ageing out; ignored ages out again", async () => {
    const h = harness([source("hn", [post()])]);
    await svc.scan(ana, { services: ["web design"] }, {}, h.deps);
    await svc.setStatus(ana, h.opps[0].id, "contacted", h.deps);
    expect(h.opps[0].expiresAt).toBeNull();
    await svc.setStatus(ana, h.opps[0].id, "ignored", h.deps);
    expect(h.opps[0].expiresAt?.getTime()).toBe(NOW.getTime() + 60 * DAY);
  });
  it("an opportunity can be removed for good", async () => {
    const h = harness([source("hn", [post()])]);
    await svc.scan(ana, { services: ["web design"] }, {}, h.deps);
    expect(await svc.remove(ana, h.opps[0].id, h.deps)).toEqual({ ok: true, deleted: true });
    expect(h.opps).toHaveLength(0);
  });
});

describe("the overview", () => {
  it("shows a source as connected only when it really is, and says what can't be searched", async () => {
    const h = harness([source("hn", [])]);
    const r: any = await svc.overview(ana, h.deps);
    const by = Object.fromEntries(r.overview.platforms.map((p: any) => [p.id, p.connected]));
    expect(by).toEqual({ hn: true, reddit: false, web: false, linkedin: false, facebook: false, instagram: false, x: false });
    expect(r.overview.platforms.find((p: any) => p.id === "linkedin")).toMatchObject({ mode: "manual" });
    expect(r.overview.allowance).toMatchObject({ used: 0, limit: 30, remaining: 30, tier: "pro" });
    expect(r.overview.services).toEqual(["web design"]);
  });
  it("an allowance that can't be counted is unknown, never “plenty left”", async () => {
    const h = harness([]);
    h.store.countScansSince = async () => { throw new Error("db"); };
    expect(((await svc.overview(ana, h.deps)) as any).overview.allowance).toBeNull();
  });
});

describe("saved searches", () => {
  const body = { name: "React work", services: ["React development"], keywords: ["Next.js"], platforms: ["hn", "reddit", "linkedin"], schedule: "daily" };
  // A schedule on a server that runs no schedules would be a promise nothing keeps.
  it("with scheduling switched off on this server, a schedule is stored as off", async () => {
    const h = harness([]);
    const r: any = await svc.createProfile(ana, body, h.deps);
    expect(r.profile).toMatchObject({ name: "React work", schedule: "off", nextRunAt: null, platforms: ["hn", "reddit"] });
  });
  it("with it on, the next run is set; pausing clears it; resuming sets it again; renaming doesn't move it", async () => {
    const h = harness([], { scheduleEnabled: () => true });
    const made: any = await svc.createProfile(ana, body, h.deps);
    expect(made.profile.nextRunAt).toBe(new Date(NOW.getTime() + DAY).toISOString());
    const id = made.profile.id;
    expect(((await svc.updateProfile(ana, id, { status: "paused" }, h.deps)) as any).profile).toMatchObject({ status: "paused", nextRunAt: null });
    expect(((await svc.updateProfile(ana, id, { status: "active", schedule: "weekly" }, h.deps)) as any).profile.nextRunAt).toBe(new Date(NOW.getTime() + 7 * DAY).toISOString());
    h.profiles[0].nextRunAt = new Date("2026-11-12T00:00:00Z");
    expect(((await svc.updateProfile(ana, id, { name: "Renamed" }, h.deps)) as any).profile).toMatchObject({ name: "Renamed", nextRunAt: "2026-11-12T00:00:00.000Z" });
  });
  it("a copy starts unscheduled; a saved search runs with its own services; deleting it keeps what it found", async () => {
    const hn = source("hn", [post({ text: "SEEKING FREELANCER: React development for our app, paid" })]);
    const h = harness([hn], { scheduleEnabled: () => true });
    const made: any = await svc.createProfile(ana, body, h.deps);
    expect(((await svc.duplicateProfile(ana, made.profile.id, h.deps)) as any).profile).toMatchObject({ name: "React work (copy)", schedule: "off", nextRunAt: null });
    scanOf(await svc.scan(ana, { profileId: made.profile.id }, {}, h.deps));
    expect(hn.seen[0]).toMatchObject({ services: ["React development"], keywords: ["Next.js"] });
    expect(h.opps[0].profileId).toBe(made.profile.id);
    expect(h.profiles[0].lastRunAt).toEqual(NOW);
    expect(await svc.deleteProfile(ana, made.profile.id, h.deps)).toEqual({ ok: true, deleted: true });
    expect(h.opps).toHaveLength(1);
  });
  it("needs a name and at least one service, and is capped per workspace", async () => {
    const h = harness([]);
    expect(await svc.createProfile(ana, { name: "x", services: [] }, h.deps)).toMatchObject({ ok: false, status: 400 });
    for (let i = 0; i < 10; i++) await svc.createProfile(ana, { name: `p${i}`, services: ["seo"] }, h.deps);
    expect(await svc.createProfile(ana, { name: "one more", services: ["seo"] }, h.deps)).toMatchObject({ ok: false, status: 409, code: "too_many" });
  });
});

describe("the scheduler", () => {
  const profile = { id: 5, organizationId: "org-a", createdByUser: "ana", name: "React work" } as SocialProfileRow;
  const wf = (over: any = {}) => {
    const calls = { scan: [] as any[], notify: [] as any[] };
    const w = sched.socialScheduleWorkflow({
      enabled: () => true, ready: async () => true, claim: async () => profile, nextDue: async () => NOW, loadUser: async () => ana,
      scan: (async (...a: any[]) => { calls.scan.push(a); return { ok: true, scan: { id: 1, read: 5, kept: 2, fresh: 2, sources: [], purged: 0 } }; }) as any,
      notify: async (p: any, n: number) => { calls.notify.push([p.id, n]); }, ...over,
    });
    return { w, calls };
  };
  it("switched off, it claims nothing and wakes for nothing", async () => {
    const { w } = wf({ enabled: () => false });
    expect(await w.claim(NOW)).toBeNull();
    expect(await w.nextWake!(NOW)).toBeNull();
  });
  it("runs the saved search as its owner, free sources only, and tells them when it found something new", async () => {
    const { w, calls } = wf();
    expect(await w.step((await w.claim(NOW))!, 0)).toBe("done");
    expect(calls.scan[0]).toEqual([ana, { profileId: 5 }, { trigger: "scheduled", freeOnly: true }]);
    expect(calls.notify).toEqual([[5, 2]]);
  });
  it("nothing new, nothing said", async () => {
    const { w, calls } = wf({ scan: async () => ({ ok: true, scan: { fresh: 0 } }) });
    await w.step(profile, 0);
    expect(calls.notify).toEqual([]);
  });
  it("an owner who has left the workspace: nothing runs in their name", async () => {
    for (const loadUser of [async () => undefined, async () => ({ ...ana, organizationId: "org-z" })]) {
      const { w, calls } = wf({ loadUser });
      expect(await w.step(profile, 0)).toBe("done");
      expect(calls.scan).toEqual([]);
    }
  });
});
