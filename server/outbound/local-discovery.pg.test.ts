/**
 * The store queries local business discovery adds, against a REAL Postgres: a finished run (a local search's credit),
 * a run held from the runner until its companies are attached, a separate daily cap for local searches, and the
 * "already in this workspace" lookups (by domain, by the place ID inside a prospect's sources, by a lead's listing link).
 *
 * Runs only with MAILBOX_PG_TEST_URL set to a disposable LOCAL database with the full schema and the prospect tables.
 * Fresh organization ids per case; only their rows are deleted.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const URL_ = process.env.MAILBOX_PG_TEST_URL;
const loopback = (u?: string) => { try { return !!u && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(u).hostname); } catch { return false; } };

describe.skipIf(!URL_ || !loopback(URL_))("local discovery store queries (real Postgres)", () => {
  let q: any;
  let outbound: typeof import("./store");
  let leads: typeof import("../leads/store");
  const orgs: string[] = [];
  const org = () => { const o = `t-${randomBytes(5).toString("hex")}`; orgs.push(o); return o; };
  const NOW = () => new Date();

  beforeAll(async () => {
    const utc = new URL(URL_!); utc.searchParams.set("options", "-c TimeZone=UTC");
    process.env.DATABASE_URL = utc.toString();
    outbound = await import("./store");
    leads = await import("../leads/store");
    const { default: pg } = await import("pg");
    q = new pg.Client({ connectionString: process.env.DATABASE_URL }); await q.connect();
  });
  afterAll(async () => {
    for (const o of orgs) {
      for (const t of ["prospect_run_items", "provider_calls", "prospect_runs", "prospects", "lead_claims", "lead_events"]) await q.query(`DELETE FROM ${t} WHERE organization_id = $1`, [o]).catch(() => {});
      await q.query(`DELETE FROM leads WHERE organization_id = $1`, [o]).catch(() => {});
    }
    await q?.end();
  });
  const run = (orgId: string, over: Record<string, unknown> = {}) => outbound.outboundStore.createRun({
    id: `pr_${randomUUID()}`, orgId, userId: "u", by: "user", request: "dentists in Siliguri", icp: {}, quantity: 10, idemKey: randomUUID(), queries: [], now: NOW(), limits: [], ...over,
  } as any);

  it("a finished run is done at once (the runner never claims it) and only its counters can be settled afterwards", async () => {
    const o = org();
    const r = await run(o, { finished: { counters: { searched: 1, mode: "local" } } });
    expect(r).toMatchObject({ status: "done", stage: "done" });
    expect(r.finishedAt).not.toBeNull();
    await outbound.outboundStore.settleFinishedRun(o, r.id, { searched: 0, mode: "local" }, "search_unavailable");
    expect(await outbound.outboundStore.getRun(o, r.id)).toMatchObject({ counters: { searched: 0 }, errorCode: "search_unavailable" });
    // Another workspace can't settle it; a running run can't be settled this way.
    await outbound.outboundStore.settleFinishedRun(org(), r.id, { searched: 9 }, null);
    expect((await outbound.outboundStore.getRun(o, r.id))!.counters).toMatchObject({ searched: 0 });
    const live = await run(o);
    await outbound.outboundStore.settleFinishedRun(o, live.id, { searched: 9 }, null);
    expect((await outbound.outboundStore.getRun(o, live.id))!.counters).toEqual({});
  });

  it("a held run isn't claimed by the runner until it is released", async () => {
    const o = org();
    const r = await run(o, { holdUntil: new Date(Date.now() + 5 * 60_000) });
    const { rows: [held] } = await q.query(`SELECT lease_until > now() AS held FROM prospect_runs WHERE id = $1`, [r.id]);
    expect(held.held).toBe(true);
    expect(await outbound.outboundStore.setLease(r.id, r.attempts, null)).toBe(true);
    const { rows: [freed] } = await q.query(`SELECT lease_until FROM prospect_runs WHERE id = $1`, [r.id]);
    expect(freed.lease_until).toBeNull();
  });

  it("local searches have their own daily platform cap, separate from web searches", async () => {
    const o = org();
    const since = new Date(Date.now() - 60_000);
    const base = { orgId: o, runId: null, provider: "google_places", costMicroUsd: 35_000, since, now: NOW() };
    const { rows: [c] } = await q.query(`SELECT count(*)::int AS n FROM provider_calls WHERE operation = 'local_search' AND created_at >= $1`, [since]);
    const limit = c.n + 1;
    expect(typeof (await outbound.outboundStore.reserveSearch({ ...base, limit, operation: "local_search" }))).toBe("number");
    expect(await outbound.outboundStore.reserveSearch({ ...base, limit, operation: "local_search" })).toBeNull();
    const { rows: [w] } = await q.query(`SELECT count(*)::int AS n FROM provider_calls WHERE operation = 'search' AND created_at >= $1`, [since]);
    expect(typeof (await outbound.outboundStore.reserveSearch({ ...base, provider: "tavily", limit: w.n + 1 }))).toBe("number"); // web searches unaffected
  });

  it("finds this workspace's prospects by domain and by a place ID inside their sources, never another's", async () => {
    const [o, other] = [org(), org()];
    const src = (placeId?: string) => [{ provider: placeId ? "google_places" : "tavily", query: "", url: "https://x", title: "", at: NOW().toISOString(), ...(placeId ? { placeId } : {}) }];
    const a = await outbound.outboundStore.upsertProspect(o, { domain: "smile-pg.in", name: "smile-pg.in", website: "https://smile-pg.in/", sources: src("ChIJpgtest00001") }, NOW());
    const b = await outbound.outboundStore.upsertProspect(o, { domain: "pearl-pg.in", name: "pearl-pg.in", website: "https://pearl-pg.in/", sources: src() }, NOW());
    await outbound.outboundStore.upsertProspect(other, { domain: "other-pg.in", name: "other-pg.in", website: "https://other-pg.in/", sources: src("ChIJpgtest00002") }, NOW());
    expect(await outbound.outboundStore.prospectsByPlaceIds(o, ["ChIJpgtest00001", "ChIJpgtest00002"])).toEqual([{ id: a.id, placeId: "ChIJpgtest00001", leadId: null }]);
    expect((await outbound.outboundStore.prospectsByDomains(o, ["pearl-pg.in", "other-pg.in"])).map((x) => x.id)).toEqual([b.id]);
    expect(await outbound.outboundStore.prospectsByPlaceIds(o, [])).toEqual([]);
  });

  it("finds this workspace's live leads by a listing link, not an archived one or another workspace's", async () => {
    const [o, other] = [org(), org()];
    const link = "https://www.google.com/maps/place/?q=place_id:ChIJpgtest00003";
    const mk = async (orgId: string) => {
      const l = await leads.leadsStore.insert(orgId, { ownerUserId: "u", companyName: `Hill ${randomBytes(3).toString("hex")}`, source: "outbound" } as any);
      await leads.leadsStore.addClaim(orgId, l.id, { field: "listing", value: "Google Maps listing", status: "unknown", evidenceUrl: link, source: "user" } as any);
      return l;
    };
    const mine = await mk(o);
    await mk(other);
    expect(await leads.leadsStore.leadIdsByEvidenceUrls(o, [link])).toEqual([{ leadId: mine.id, url: link }]);
    await q.query(`UPDATE leads SET archived_at = now() WHERE id = $1`, [mine.id]);
    expect(await leads.leadsStore.leadIdsByEvidenceUrls(o, [link])).toEqual([]);
  });
});
