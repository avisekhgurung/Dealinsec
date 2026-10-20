/**
 * The funnel's SQL (server/outbound/funnel.ts queryFunnel) against a REAL Postgres: each stage counts companies of the
 * caller's workspace only, through its own prospects, in the window. Runs only with OUTREACH_PG_TEST_URL set to a
 * disposable LOCAL database with the schema (a non-loopback host is refused). Each test uses fresh organization ids and
 * deletes only its own rows.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const URL_ = process.env.OUTREACH_PG_TEST_URL;
const loopback = (u?: string) => { try { return !!u && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(u).hostname); } catch { return false; } };

describe.skipIf(!URL_ || !loopback(URL_))("research → revenue funnel (real Postgres)", () => {
  let queryFunnel: typeof import("./funnel").queryFunnel;
  let c: any, userId = "";
  const orgs: string[] = [];
  beforeAll(async () => {
    process.env.DATABASE_URL = URL_!;
    ({ queryFunnel } = await import("./funnel"));
    const { default: pg } = await import("pg");
    c = new pg.Client({ connectionString: URL_ }); await c.connect();
    userId = (await c.query(`INSERT INTO users DEFAULT VALUES RETURNING id`)).rows[0].id;   // a deal needs a real owner
  });
  afterAll(async () => {
    for (const o of orgs) for (const t of ["outreach_events", "lead_events", "lead_messages", "channel_messages", "prospects", "deals", "leads"]) await c.query(`DELETE FROM ${t} WHERE organization_id = $1`, [o]).catch(() => {});
    if (userId) await c.query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => {});
    await c?.end();
  });

  const org = () => { const o = `fun-${randomUUID()}`; orgs.push(o); return o; };
  let n = 0;
  async function company(o: string, x: { researchedDaysAgo?: number; angle?: boolean; lead?: string | null; message?: string | null; replied?: boolean; dealMinor?: number } = {}) {
    n++;
    let leadId: number | null = null;
    if (x.lead) {
      let dealId: number | null = null;
      if (x.dealMinor) dealId = (await c.query(`INSERT INTO deals (organization_id, user_id, brand_name, deal_title, deal_amount, start_date, end_date, deliverables) VALUES ($1, $3, 'C', 'Deal', $2, now(), now(), '[]') RETURNING id`, [o, x.dealMinor, userId]).catch((e: Error) => { throw new Error(`deal insert: ${e.message}`); })).rows[0].id;
      leadId = (await c.query(`INSERT INTO leads (organization_id, owner_user_id, company_name, domain, source, status, converted_deal_id, created_at, updated_at) VALUES ($1, 'u1', $2, $3, 'outbound', $4, $5, now(), now()) RETURNING id`, [o, `Co ${n}`, `co${n}.test`, x.lead, dealId])).rows[0].id;
      if (x.message) {
        const m = (await c.query(`INSERT INTO lead_messages (lead_id, organization_id, direction, channel, subject, body, body_hash, to_address, to_source, status, claim_ids, created_by, created_at, updated_at) VALUES ($1, $2, 'out', 'manual', 's', 'b', $3, 'a@co.test', 'site', $4, '[]', 'user', now(), now()) RETURNING id`, [leadId, o, "0".repeat(64), x.message])).rows[0].id;
        if (x.replied) await c.query(`INSERT INTO outreach_events (organization_id, lead_id, message_id, kind, source, created_at) VALUES ($1, $2, $3, 'replied', 'manual', now())`, [o, leadId, m]);
      }
    }
    const at = new Date(Date.now() - (x.researchedDaysAgo ?? 1) * 86_400_000);
    await c.query(`INSERT INTO prospects (organization_id, domain, name, website, status, angle, researched_at, lead_id, created_at, updated_at) VALUES ($1, $2, $3, $4, 'ready', $5, $6, $7, now(), now())`,
      [o, `co${n}.test`, `Co ${n}`, `https://co${n}.test`, x.angle ? JSON.stringify({ problem: "p" }) : null, at, leadId]);
  }

  it("counts each stage as companies of this workspace's cohort, and never another workspace's", async () => {
    const mine = org(), theirs = org();
    await company(mine, { angle: true });                                                  // researched, opportunity
    await company(mine, { angle: true, lead: "contacted", message: "draft" });              // … lead, drafted
    await company(mine, { angle: true, lead: "replied", message: "sent", replied: true });  // … sent, replied
    await company(mine, { lead: "won", message: "sent", replied: true, dealMinor: 5_000_000 }); // … won, ₹50,000
    await company(mine, { researchedDaysAgo: 200, lead: "won", message: "sent", dealMinor: 9_900_000 }); // outside the window
    await company(theirs, { angle: true, lead: "won", message: "sent", replied: true, dealMinor: 7_700_000 });
    const since = new Date(Date.now() - 90 * 86_400_000);
    const r = await queryFunnel(mine, since);
    expect(r.counts).toMatchObject({ researched: 4, opportunity: 3, lead: 3, drafted: 3, approved: 2, sent: 2, replied: 2, meeting: 1, proposal: 1, won: 1, lost: 0 });
    expect(r.revenueMinor).toBe(5_000_000);
    const t = await queryFunnel(theirs, since);
    expect(t.counts).toMatchObject({ researched: 1, won: 1 });
    expect(t.revenueMinor).toBe(7_700_000);
    // History: a lead that reached a meeting and a proposal and was then lost still counts at both stages.
    const hist = org();
    await company(hist, { angle: true, lead: "lost", message: "sent", replied: true });
    const lostLead = (await c.query(`SELECT id FROM leads WHERE organization_id = $1`, [hist])).rows[0].id;
    for (const [from, to] of [["contacted", "replied"], ["replied", "meeting"], ["meeting", "proposal"], ["proposal", "lost"]])
      await c.query(`INSERT INTO lead_events (lead_id, organization_id, kind, data, actor) VALUES ($1, $2, 'status_changed', $3, 'user')`, [lostLead, hist, JSON.stringify({ from, to })]);
    expect((await queryFunnel(hist, since)).counts).toMatchObject({ replied: 1, meeting: 1, proposal: 1, won: 0, lost: 1 });
    // An unknown workspace sees nothing.
    expect((await queryFunnel(`fun-none-${randomUUID()}`, since)).counts.researched).toBe(0);
  });
});
