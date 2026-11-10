/**
 * The Social Intent store against a REAL Postgres: the things a fake can't prove — the allowance lock under
 * concurrency, one row per workspace and post, workspace isolation in SQL, and the scheduler's claim.
 *
 * Runs only with MAILBOX_PG_TEST_URL set to a disposable LOCAL database with the social tables
 * (script/migrate-social-intent.ts). Fresh organization ids per case; only their rows are deleted.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const URL_ = process.env.MAILBOX_PG_TEST_URL;
const loopback = (u?: string) => { try { return !!u && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(u).hostname); } catch { return false; } };

describe.skipIf(!URL_ || !loopback(URL_))("Social Intent store (real Postgres)", () => {
  let q: any;
  let mod: typeof import("./store");
  const orgs: string[] = [];
  const org = () => { const o = `t-${randomBytes(5).toString("hex")}`; orgs.push(o); return o; };
  const NOW = new Date("2026-11-10T12:00:00Z");
  const DAY = 86_400_000;
  beforeAll(async () => {
    process.env.DATABASE_URL = URL_!;
    mod = await import("./store");
    const { default: pg } = await import("pg");
    q = new pg.Client({ connectionString: URL_ }); await q.connect();
  });
  afterAll(async () => {
    for (const o of orgs) for (const t of ["social_opportunities", "social_scans", "social_profiles"]) await q.query(`DELETE FROM ${t} WHERE organization_id = $1`, [o]).catch(() => {});
    await q?.end();
  });

  const opp = (url: string, over: Record<string, unknown> = {}) => ({
    profileId: null, source: "hn", origin: "scan" as const, url, community: "Ask HN", title: "Looking to hire", excerpt: "Looking to hire a web designer", postedAt: new Date(NOW.getTime() - DAY),
    intent: "hiring", intentMatched: "Looking to hire", service: "web design", signals: {}, score: 70, scoreDetail: { total: 70 }, companyUrl: null, expiresAt: new Date(NOW.getTime() + 60 * DAY), ...over,
  });

  it("twelve scans started at once against an allowance of 3 start exactly 3", async () => {
    const o = org();
    const out = await Promise.all(Array.from({ length: 12 }, () => mod.socialStore.reserveScan({ orgId: o, userId: "u", profileId: null, trigger: "manual", since: new Date(NOW.getTime() - 30 * DAY), max: 3, now: NOW })));
    expect(out.filter(Boolean)).toHaveLength(3);
    expect(await mod.socialStore.countScansSince(o, new Date(NOW.getTime() - 30 * DAY))).toBe(3);
  });

  it("a dropped scan frees its place; a scan older than the window doesn't count", async () => {
    const o = org();
    const since = new Date(NOW.getTime() - 30 * DAY);
    const a = await mod.socialStore.reserveScan({ orgId: o, userId: "u", profileId: null, trigger: "manual", since, max: 1, now: NOW });
    expect(await mod.socialStore.reserveScan({ orgId: o, userId: "u", profileId: null, trigger: "manual", since, max: 1, now: NOW })).toBeNull();
    await mod.socialStore.dropScan(a!.id);
    expect(await mod.socialStore.reserveScan({ orgId: o, userId: "u", profileId: null, trigger: "manual", since, max: 1, now: NOW })).not.toBeNull();
    const later = new Date(NOW.getTime() + 31 * DAY);
    expect(await mod.socialStore.reserveScan({ orgId: o, userId: "u", profileId: null, trigger: "manual", since: new Date(later.getTime() - 30 * DAY), max: 1, now: later })).not.toBeNull();
  });

  it("one row per workspace and post: seen again it is not fresh, takes the new reading and keeps the person's decision", async () => {
    const o = org();
    const first = await mod.socialStore.upsertOpportunity(o, opp("https://news.ycombinator.com/item?id=1"), NOW);
    expect(first.fresh).toBe(true);
    await mod.socialStore.setOpportunity(o, first.id, { status: "saved", leadId: 42, expiresAt: null }, NOW);
    const later = new Date(NOW.getTime() + DAY);
    const again = await mod.socialStore.upsertOpportunity(o, opp("https://news.ycombinator.com/item?id=1", { score: 85, title: "Edited title", expiresAt: new Date(later.getTime() + 60 * DAY) }), later);
    expect(again).toEqual({ id: first.id, fresh: false });
    const row = (await mod.socialStore.getOpportunity(o, first.id))!;
    expect(row).toMatchObject({ score: 85, title: "Edited title", status: "saved", leadId: 42, expiresAt: null });
    expect(row.discoveredAt.toISOString()).toBe(NOW.toISOString());
    expect(row.lastSeenAt.toISOString()).toBe(later.toISOString());
  });

  it("the same post in two workspaces is two rows, and neither can read, change or delete the other's", async () => {
    const a = org(), b = org();
    const ra = await mod.socialStore.upsertOpportunity(a, opp("https://www.reddit.com/r/x/comments/1/y"), NOW);
    const rb = await mod.socialStore.upsertOpportunity(b, opp("https://www.reddit.com/r/x/comments/1/y"), NOW);
    expect(rb.fresh).toBe(true);
    expect(await mod.socialStore.getOpportunity(b, ra.id)).toBeNull();
    expect(await mod.socialStore.setOpportunity(b, ra.id, { status: "ignored" }, NOW)).toBeNull();
    expect(await mod.socialStore.deleteOpportunity(b, ra.id)).toBe(false);
    expect((await mod.socialStore.listOpportunities(a, { limit: 30, offset: 0 })).total).toBe(1);
    expect((await mod.socialStore.getOpportunity(a, ra.id))!.status).toBe("new");
  });

  it("lists by score, filters, counts, and purges only what nobody acted on", async () => {
    const o = org();
    const hi = await mod.socialStore.upsertOpportunity(o, opp("https://a.example/1", { score: 90 }), NOW);
    const lo = await mod.socialStore.upsertOpportunity(o, opp("https://a.example/2", { score: 30, intent: "problem", expiresAt: new Date(NOW.getTime() - DAY) }), NOW);
    const kept = await mod.socialStore.upsertOpportunity(o, opp("https://a.example/3", { score: 50, expiresAt: new Date(NOW.getTime() - DAY) }), NOW);
    await mod.socialStore.setOpportunity(o, kept.id, { status: "contacted" }, NOW); // expired by date, but the person acted on it
    const all = await mod.socialStore.listOpportunities(o, { limit: 30, offset: 0 });
    expect(all.rows.map((r) => r.id)).toEqual([hi.id, kept.id, lo.id]);
    expect((await mod.socialStore.listOpportunities(o, { intent: ["problem"], limit: 30, offset: 0 })).rows.map((r) => r.id)).toEqual([lo.id]);
    expect((await mod.socialStore.listOpportunities(o, { minScore: 60, limit: 30, offset: 0 })).total).toBe(1);
    expect(await mod.socialStore.stats(o, 70)).toEqual({ total: 3, fresh: 2, high: 1, saved: 1 });
    expect(await mod.socialStore.purgeExpired(o, NOW)).toBe(1);
    expect((await mod.socialStore.listOpportunities(o, { limit: 30, offset: 0 })).rows.map((r) => r.id)).toEqual([hi.id, kept.id]);
  });

  // The scheduler's promise: a due search runs once per period, whatever crashes or races.
  it("a due saved search is claimed once, and its next run has already moved on", async () => {
    const o = org();
    const f = { name: "React work", services: ["react"], keywords: [], platforms: [], minScore: 0, status: "active" };
    const daily = await mod.socialStore.createProfile(o, "u", { ...f, schedule: "daily", nextRunAt: new Date(NOW.getTime() - 60_000) }, NOW);
    await mod.socialStore.createProfile(o, "u", { ...f, name: "paused", schedule: "daily", status: "paused", nextRunAt: new Date(NOW.getTime() - 60_000) }, NOW);
    await mod.socialStore.createProfile(o, "u", { ...f, name: "off", schedule: "off", nextRunAt: null }, NOW);
    await mod.socialStore.createProfile(o, "u", { ...f, name: "later", schedule: "weekly", nextRunAt: new Date(NOW.getTime() + DAY) }, NOW);
    // Other tests' and other workspaces' due rows may exist in a shared local database: claim until ours comes up or nothing is left.
    const claimed: number[] = [];
    const both = await Promise.all([mod.socialStore.claimDueProfile(NOW), mod.socialStore.claimDueProfile(NOW)]);
    for (const c of both) if (c?.organizationId === o) claimed.push(c.id);
    for (let i = 0; i < 20 && !claimed.length; i++) { const c = await mod.socialStore.claimDueProfile(NOW); if (!c) break; if (c.organizationId === o) claimed.push(c.id); }
    expect(claimed).toEqual([daily.id]);
    const row = (await mod.socialStore.getProfile(o, daily.id))!;
    expect(row.nextRunAt!.toISOString()).toBe(new Date(NOW.getTime() + DAY).toISOString());
    expect(row.lastRunAt!.toISOString()).toBe(NOW.toISOString());
    // Nothing of ours is due any more.
    const again = await mod.socialStore.claimDueProfile(NOW);
    expect(again?.organizationId === o).toBe(false);
  });
});
