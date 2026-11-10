/**
 * Which saved client profile's tone and note a draft follows, against a REAL Postgres: the join from a lead to the
 * search that found it, "newest search wins", a deleted profile, an unreadable saved value, and workspace isolation.
 *
 * Runs only with MAILBOX_PG_TEST_URL set to a disposable LOCAL database with the profile and Client Radar tables.
 * Fresh organization ids per case; only their rows are deleted.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const URL_ = process.env.MAILBOX_PG_TEST_URL;
const loopback = (u?: string) => { try { return !!u && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(u).hostname); } catch { return false; } };

describe.skipIf(!URL_ || !loopback(URL_))("a draft's style from a saved client profile (real Postgres)", () => {
  let q: any;
  let mod: typeof import("./style");
  const orgs: string[] = [];
  const org = () => { const o = `t-${randomBytes(5).toString("hex")}`; orgs.push(o); return o; };
  const NOW = new Date("2026-11-11T12:00:00Z");
  beforeAll(async () => {
    process.env.DATABASE_URL = URL_!;
    mod = await import("./style");
    const { default: pg } = await import("pg");
    q = new pg.Client({ connectionString: URL_ }); await q.connect();
  });
  afterAll(async () => {
    for (const o of orgs) for (const t of ["prospect_run_items", "prospect_runs", "prospects", "acquisition_profiles", "leads"]) await q.query(`DELETE FROM ${t} WHERE organization_id = $1`, [o]).catch(() => {});
    await q?.end();
  });
  const lead = async (o: string, name: string) => Number((await q.query(`INSERT INTO leads (organization_id, owner_user_id, company_name, status, source) VALUES ($1, 'u', $2, 'new', 'outbound') RETURNING id`, [o, name])).rows[0].id);
  const profile = async (o: string, name: string, outreach: unknown) => Number((await q.query(
    `INSERT INTO acquisition_profiles (organization_id, created_by_user, name, name_key, kind, outreach, created_at, updated_at) VALUES ($1, 'u', $2, $3, 'custom', $4, $5, $5) RETURNING id`,
    [o, name, name.toLowerCase(), JSON.stringify(outreach), NOW])).rows[0].id);
  const prospect = async (o: string, leadId: number) => Number((await q.query(
    `INSERT INTO prospects (organization_id, domain, name, website, status, ready, lead_id, created_at, updated_at) VALUES ($1, $2, 'P', 'https://p.example', 'ready', true, $3, $4, $4) RETURNING id`,
    [o, `p${leadId}-${randomBytes(3).toString("hex")}.example`, leadId, NOW])).rows[0].id);
  /** A search that found `prospectId`, started from the profile `p` (or typed, with none), `minutesAgo` before NOW. */
  const run = async (o: string, prospectId: number, p: { id: number; name: string } | null, minutesAgo = 0) => {
    const id = `pr_t${randomBytes(8).toString("hex")}`, at = new Date(NOW.getTime() - minutesAgo * 60_000);
    await q.query(`INSERT INTO prospect_runs (id, organization_id, created_by_user, request, icp, quantity, status, stage, idem_key, created_at, updated_at) VALUES ($1, $2, 'u', 'x', $3, 5, 'done', 'done', $1, $4, $4)`,
      [id, o, JSON.stringify({ industry: "D2C brand", ...(p ? { profile: p } : {}) }), at]);
    await q.query(`INSERT INTO prospect_run_items (run_id, organization_id, prospect_id, stage, updated_at) VALUES ($1, $2, $3, 'done', $4)`, [id, o, prospectId, at]);
  };

  it("a lead follows the profile its search started from; a typed search and a lead added by hand follow none", async () => {
    const o = org();
    const brands = await profile(o, "Brands", { channels: ["email"], tone: "direct", note: "Mention our Shopify work." });
    const found = await lead(o, "Found"), typed = await lead(o, "Typed"), byHand = await lead(o, "ByHand");
    await run(o, await prospect(o, found), { id: brands, name: "Brands" });
    await run(o, await prospect(o, typed), null);
    expect(await mod.styleForDraft(o, found)).toEqual({ profileId: brands, profileName: "Brands", tone: "direct", note: "Mention our Shopify work." });
    expect(await mod.styleForDraft(o, typed)).toBeNull();
    expect(await mod.styleForDraft(o, byHand)).toBeNull();
  });

  it("the newest search wins, and a campaign's own profile wins over the lead's", async () => {
    const o = org();
    const older = await profile(o, "Older", { tone: "formal", note: "" }), newer = await profile(o, "Newer", { tone: "friendly", note: "Keep it light." });
    const l = await lead(o, "Twice");
    const p = await prospect(o, l);
    await run(o, p, { id: older, name: "Older" }, 60);
    await run(o, p, { id: newer, name: "Newer" }, 5);
    expect(await mod.profileIdForLead(o, l)).toBe(newer);
    expect(await mod.styleForDraft(o, l)).toMatchObject({ profileName: "Newer", tone: "friendly" });
    expect(await mod.styleForDraft(o, l, older)).toMatchObject({ profileName: "Older", tone: "formal", note: "" });
  });

  it("the profile is read as it is NOW: edited, it changes the next draft; deleted, the draft falls back or has no style", async () => {
    const o = org();
    const a = await profile(o, "A", { tone: "friendly", note: "" }), b = await profile(o, "B", { tone: "direct", note: "" });
    const l = await lead(o, "L");
    await run(o, await prospect(o, l), { id: a, name: "A" });
    await q.query(`UPDATE acquisition_profiles SET outreach = $1 WHERE id = $2`, [JSON.stringify({ tone: "formal", note: "No small talk." }), a]);
    expect(await mod.styleForDraft(o, l)).toMatchObject({ tone: "formal", note: "No small talk." });
    // The campaign's profile was deleted: the lead's own profile is used instead.
    await q.query(`DELETE FROM acquisition_profiles WHERE id = $1`, [b]);
    expect(await mod.styleForDraft(o, l, b)).toMatchObject({ profileName: "A" });
    await q.query(`DELETE FROM acquisition_profiles WHERE id = $1`, [a]);
    expect(await mod.styleForDraft(o, l)).toBeNull();
  });

  it("a saved value from before the fields existed gets the defaults; one that can't be read is no style", async () => {
    const o = org();
    const empty = await profile(o, "Empty", {}), odd = await profile(o, "Odd", { tone: "shouty", note: 5 });
    expect(await mod.styleFromProfile(o, empty)).toEqual({ profileId: empty, profileName: "Empty", tone: "friendly", note: "" });
    expect(await mod.styleFromProfile(o, odd)).toBeNull();
    for (const bad of [0, -1, 1.5, NaN, null, undefined]) expect(await mod.styleFromProfile(o, bad as any)).toBeNull();
  });

  it("another workspace's profile and searches are never read", async () => {
    const o = org(), other = org();
    const theirs = await profile(other, "Theirs", { tone: "direct", note: "Their private note." });
    const mine = await lead(o, "Mine"), theirLead = await lead(other, "TheirLead");
    await run(other, await prospect(other, theirLead), { id: theirs, name: "Theirs" });
    // My search claims their profile's id (a stale or forged value in the search): it is not mine, so no style.
    await run(o, await prospect(o, mine), { id: theirs, name: "Theirs" });
    expect(await mod.styleForDraft(o, mine)).toBeNull();
    expect(await mod.styleFromProfile(o, theirs)).toBeNull();
    expect(await mod.styleForDraft(o, theirLead)).toBeNull();
    expect(await mod.styleForDraft(other, theirLead)).toMatchObject({ profileName: "Theirs" });
  });
});
