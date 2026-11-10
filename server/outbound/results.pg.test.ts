/**
 * The two results queries against a REAL Postgres: the SQL itself — which companies count at each discovery stage,
 * which findings count as a way in, what a campaign's numbers are, and that another workspace's rows never leak in.
 *
 * Runs only with MAILBOX_PG_TEST_URL set to a disposable LOCAL database with the Client Radar, outreach and campaign
 * tables. Fresh organization ids per case; only their rows are deleted.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const URL_ = process.env.MAILBOX_PG_TEST_URL;
const loopback = (u?: string) => { try { return !!u && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(u).hostname); } catch { return false; } };

describe.skipIf(!URL_ || !loopback(URL_))("results queries (real Postgres)", () => {
  let q: any;
  let mod: typeof import("./results");
  const orgs: string[] = [];
  const org = () => { const o = `t-${randomBytes(5).toString("hex")}`; orgs.push(o); return o; };
  // Fixed instants, written as UTC text so the test means the same on a machine in any time zone.
  const T = "2026-11-10 12:00:00", OLD = "2026-01-01 00:00:00";
  const SINCE = new Date("2026-10-11T12:00:00Z");
  beforeAll(async () => {
    process.env.DATABASE_URL = URL_!;
    mod = await import("./results");
    const { default: pg } = await import("pg");
    q = new pg.Client({ connectionString: URL_ }); await q.connect();
  });
  afterAll(async () => {
    for (const o of orgs) for (const t of ["campaign_members", "campaigns", "outreach_events", "lead_events", "lead_messages", "leads", "prospect_findings", "prospects"]) await q.query(`DELETE FROM ${t} WHERE organization_id = $1`, [o]).catch(() => {});
    await q?.end();
  });
  let seq = 0;
  const prospect = async (o: string, v: { verified?: boolean; status?: string; verdict?: string | null; ready?: boolean; researched?: boolean; leadId?: number | null; at?: string } = {}) => {
    const r = await q.query(
      `INSERT INTO prospects (organization_id, domain, name, website, status, fit, ready, verified_at, researched_at, lead_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamp, $9::timestamp, $10, $11::timestamp, $11::timestamp) RETURNING id`,
      [o, `c${++seq}-${o}.example`, `Company ${seq}`, `https://c${seq}.example`, v.status ?? "enriched", v.verdict ? JSON.stringify({ verdict: v.verdict }) : null, !!v.ready, v.verified === false ? null : T, v.researched ? T : null, v.leadId ?? null, v.at ?? T]);
    return Number(r.rows[0].id);
  };
  const finding = (o: string, prospectId: number, kind: string, type: string, status = "confirmed", meta: Record<string, unknown> = {}) =>
    q.query(`INSERT INTO prospect_findings (organization_id, prospect_id, kind, type, value, status, source_type, batch, retrieved_at, meta) VALUES ($1, $2, $3, $4, 'x', $5, 'site', 'enrich', $6::timestamp, $7)`, [o, prospectId, kind, type, status, T, JSON.stringify(meta)]);
  const lead = async (o: string, status = "new") => Number((await q.query(`INSERT INTO leads (organization_id, owner_user_id, company_name, status) VALUES ($1, 'u', 'Lead', $2) RETURNING id`, [o, status])).rows[0].id);
  const message = async (o: string, leadId: number, status: string) => Number((await q.query(`INSERT INTO lead_messages (lead_id, organization_id, direction, subject, body, body_hash, status, created_at, updated_at) VALUES ($1, $2, 'out', 's', 'b', $3, $4, $5::timestamp, $5::timestamp) RETURNING id`, [leadId, o, randomBytes(32).toString("hex"), status, T])).rows[0].id);
  const event = (o: string, leadId: number, messageId: number, kind: string) => q.query(`INSERT INTO outreach_events (organization_id, lead_id, message_id, kind, source, created_at) VALUES ($1, $2, $3, $4, 'manual', $5::timestamp)`, [o, leadId, messageId, kind, T]);
  const moved = (o: string, leadId: number, to: string) => q.query(`INSERT INTO lead_events (lead_id, organization_id, kind, data) VALUES ($1, $2, 'status_changed', $3)`, [leadId, o, JSON.stringify({ to })]);
  const campaign = async (o: string, name: string, profile: string | null, at = T, status = "active") => Number((await q.query(`INSERT INTO campaigns (organization_id, created_by_user, name, profile_name, status, created_at, updated_at) VALUES ($1, 'u', $2, $3, $4, $5::timestamp, $5::timestamp) RETURNING id`, [o, name, profile, status, at])).rows[0].id);
  const member = (o: string, campaignId: number, leadId: number, messageId: number | null) => q.query(`INSERT INTO campaign_members (campaign_id, organization_id, lead_id, message_id, state, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6::timestamp, $6::timestamp)`, [campaignId, o, leadId, messageId, messageId ? "drafted" : "queued", T]);

  it("discovery: each stage counts the right companies, only this workspace's, only inside the window", async () => {
    const o = org(), other = org();
    await prospect(o, { verified: false });                                   // found, site never reached
    await prospect(o, { status: "rejected" });                                // reached, but set aside: not a real company
    await prospect(o, { verdict: "weak", researched: true });                 // real, researched, not a fit
    const fits = await prospect(o, { verdict: "partial", researched: true }); // real and fits
    const best = await prospect(o, { verdict: "strong", ready: true, researched: true, leadId: 1 });
    const plain = await prospect(o, {});                                      // real, never researched (a bulk list)
    await prospect(o, { verdict: "strong", ready: true, at: OLD });           // before the window
    await prospect(other, { verdict: "strong", ready: true, researched: true });
    // Ways in. An unconfirmed contact page, an inferred email and an unverified person's email are NOT a way in.
    await finding(o, fits, "decision_maker", "CEO", "confirmed", { email: "a@x.example", emailStatus: "unverified" });
    await finding(o, fits, "fact", "contact_form", "confirmed", {});
    await finding(o, fits, "fact", "business_email", "inferred");
    await finding(o, best, "decision_maker", "Founder", "confirmed", { email: "b@x.example", emailStatus: "verified" });
    await finding(o, best, "fact", "business_email", "confirmed");
    await finding(o, plain, "fact", "contact_form", "confirmed", { detectedBy: "form" });
    expect(await mod.queryDiscovery(o, SINCE)).toEqual({ discovered: 6, verified: 4, qualified: 2, ready: 1, researched: 3, leads: 1, person: 2, publicRoute: 2, verifiedEmail: 1 });
    expect(await mod.queryDiscovery(org(), SINCE)).toEqual({ discovered: 0, verified: 0, qualified: 0, ready: 0, researched: 0, leads: 0, person: 0, publicRoute: 0, verifiedEmail: 0 });
  });

  it("campaigns: sent and what came back, stages reached, per campaign; other workspaces and older campaigns stay out", async () => {
    const o = org(), other = org();
    const c1 = await campaign(o, "Diwali", "Brands");
    const l1 = await lead(o, "meeting"), l2 = await lead(o, "lost"), l3 = await lead(o), l4 = await lead(o), l5 = await lead(o, "won");
    const m1 = await message(o, l1, "sent"), m2 = await message(o, l2, "sent"), m3 = await message(o, l3, "sent"), m4 = await message(o, l4, "approved"), m5 = await message(o, l5, "draft");
    for (const [l, m] of [[l1, m1], [l2, m2], [l3, m3], [l4, m4], [l5, m5]] as const) await member(o, c1, l, m);
    await member(o, c1, await lead(o), null);                 // still waiting for a draft
    await event(o, l1, m1, "replied"); await event(o, l1, m1, "sent");
    await event(o, l2, m2, "replied"); await moved(o, l2, "proposal"); // lost now, but it reached proposal
    await event(o, l3, m3, "bounced");
    await event(o, l5, m5, "replied");                          // a reply on a message that was never sent is not a campaign reply
    const c2 = await campaign(o, "Empty", null);
    await campaign(o, "Old one", "Brands", OLD);
    const c3 = await campaign(o, "Archived", "Brands", T, "archived");
    const oc = await campaign(other, "Theirs", "Brands");
    const ol = await lead(other, "won"); await member(other, oc, ol, await message(other, ol, "sent"));
    const rows = (await mod.queryCampaigns(o, SINCE))!;
    expect(rows.map((r) => r.name).sort()).toEqual(["Archived", "Diwali", "Empty"]);
    const by = new Map(rows.map((r) => [r.id, r]));
    expect(by.get(c1)).toMatchObject({ name: "Diwali", profileName: "Brands", archived: false, createdAt: "2026-11-10T12:00:00.000Z", members: 6, sent: 3, replied: 2, interested: 0, bounced: 1, optedOut: 0, meeting: 2, proposal: 1, won: 0, wonValueMinor: 0 });
    expect(by.get(c2)).toMatchObject({ members: 0, sent: 0, replied: 0, profileName: null });
    expect(by.get(c3)).toMatchObject({ archived: true, members: 0 });
    expect(await mod.queryCampaigns(other, SINCE)).toHaveLength(1);
    expect((await mod.queryCampaigns(other, SINCE))![0]).toMatchObject({ name: "Theirs", sent: 1, won: 1, meeting: 1, proposal: 1 });
  });

  it("the whole endpoint, against the database, for a workspace with nothing in it", async () => {
    const o = org();
    const r: any = await mod.getResults({ id: "u", organizationId: o, memberStatus: "active", orgRole: "OWNER" } as any, 30, { now: () => new Date("2026-11-10T12:00:00Z"), currency: async () => "INR" });
    expect(r).toMatchObject({ ok: true, results: { days: 30, discovery: { coverageBase: 0, notes: [] }, campaigns: { rows: [], totals: { campaigns: 0, sent: 0, replyRate: null } } } });
  });
});
