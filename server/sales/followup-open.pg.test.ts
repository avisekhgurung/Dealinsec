/**
 * The lead's next open follow-up, against a REAL Postgres: which steps count as open, the earliest first, the draft's
 * status, the moment as UTC text, and workspace isolation.
 *
 * Runs only with MAILBOX_PG_TEST_URL set to a disposable LOCAL database with the outreach tables. Fresh organization
 * ids per case; only their rows are deleted.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const URL_ = process.env.MAILBOX_PG_TEST_URL;
const loopback = (u?: string) => { try { return !!u && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(u).hostname); } catch { return false; } };

describe.skipIf(!URL_ || !loopback(URL_))("a lead's next open follow-up (real Postgres)", () => {
  let q: any;
  let mod: typeof import("./followups");
  const orgs: string[] = [];
  const org = () => { const o = `t-${randomBytes(5).toString("hex")}`; orgs.push(o); return o; };
  const NOW = new Date("2026-11-11T12:00:00Z");
  const DAY = 86_400_000;
  beforeAll(async () => {
    process.env.DATABASE_URL = URL_!;
    mod = await import("./followups");
    const { default: pg } = await import("pg");
    q = new pg.Client({ connectionString: URL_ }); await q.connect();
  });
  afterAll(async () => {
    for (const o of orgs) for (const t of ["outreach_followups", "lead_messages", "leads"]) await q.query(`DELETE FROM ${t} WHERE organization_id = $1`, [o]).catch(() => {});
    await q?.end();
  });
  const lead = async (o: string) => Number((await q.query(`INSERT INTO leads (organization_id, owner_user_id, company_name, status, source) VALUES ($1, 'u', 'Acme', 'contacted', 'manual') RETURNING id`, [o])).rows[0].id);
  const message = async (o: string, leadId: number, status: string) => Number((await q.query(
    `INSERT INTO lead_messages (lead_id, organization_id, direction, subject, body, body_hash, to_address, status, created_at, updated_at) VALUES ($1, $2, 'out', 'Hello', 'Body', $3, 'a@x.example', $4, $5, $5) RETURNING id`,
    [leadId, o, randomBytes(32).toString("hex"), status, NOW])).rows[0].id);
  // The due moment is written as UTC text into the zone-less column, exactly as the app writes it.
  const followUp = (o: string, leadId: number, root: number, step: number, status: string, due: Date, draft: number | null = null) => q.query(
    `INSERT INTO outreach_followups (organization_id, lead_id, root_message_id, after_message_id, step, due_at, status, draft_message_id, created_at, updated_at) VALUES ($1, $2, $3, $3, $4, $5::timestamp, $6, $7, $8::timestamp, $8::timestamp)`,
    [o, leadId, root, step, due.toISOString(), status, draft, NOW.toISOString()]);

  it("a planned step is returned with its due moment in UTC; a lead with none has none", async () => {
    const o = org();
    const a = await lead(o), b = await lead(o);
    const due = new Date(NOW.getTime() + 4 * DAY);
    await followUp(o, a, await message(o, a, "sent"), 1, "scheduled", due);
    expect(await mod.openFollowUpForLead(o, a)).toEqual({ status: "scheduled", dueAt: due.toISOString(), draftStatus: null });
    expect(await mod.openFollowUpForLead(o, b)).toBeNull();
  });

  it("sent, cancelled and skipped steps are history; of the open ones the earliest is returned, with its draft's status", async () => {
    const o = org();
    const l = await lead(o);
    const root = await message(o, l, "sent"), draft = await message(o, l, "draft");
    await followUp(o, l, root, 1, "sent", new Date(NOW.getTime() - 4 * DAY));
    expect(await mod.openFollowUpForLead(o, l)).toBeNull();
    await followUp(o, l, root, 2, "drafted", new Date(NOW.getTime() - DAY), draft);
    await followUp(o, l, root, 3, "scheduled", new Date(NOW.getTime() + 5 * DAY));
    expect(await mod.openFollowUpForLead(o, l)).toMatchObject({ status: "drafted", draftStatus: "draft" });
    await q.query(`UPDATE outreach_followups SET status = 'cancelled' WHERE organization_id = $1 AND step = 2`, [o]);
    expect(await mod.openFollowUpForLead(o, l)).toMatchObject({ status: "scheduled", draftStatus: null });
    await q.query(`UPDATE outreach_followups SET status = 'skipped' WHERE organization_id = $1 AND step = 3`, [o]);
    expect(await mod.openFollowUpForLead(o, l)).toBeNull();
  });

  it("a planned step stops counting once the job would skip it: the lead moved on, was archived, marked do-not-contact or became a deal", async () => {
    const o = org();
    const due = new Date(NOW.getTime() + 4 * DAY);
    const planned = async () => { const l = await lead(o); await followUp(o, l, await message(o, l, "sent"), 1, "scheduled", due); return l; };
    const set = (l: number, sqlSet: string) => q.query(`UPDATE leads SET ${sqlSet} WHERE organization_id = $1 AND id = $2`, [o, l]);

    // Every stage the job still writes to keeps the plan; every later stage drops it, and moving back restores it.
    const l = await planned();
    for (const stage of ["contacted", "qualified", "new", "researching"]) { await set(l, `status = '${stage}'`); expect(await mod.openFollowUpForLead(o, l), stage).toMatchObject({ status: "scheduled" }); }
    for (const stage of ["replied", "meeting", "proposal", "won", "lost"]) { await set(l, `status = '${stage}'`); expect(await mod.openFollowUpForLead(o, l), stage).toBeNull(); }
    await set(l, `status = 'contacted'`);
    expect(await mod.openFollowUpForLead(o, l)).toMatchObject({ status: "scheduled", dueAt: due.toISOString() });

    for (const closed of ["archived_at = now()", "do_not_contact = true", "converting = true"]) {
      const c = await planned();
      await set(c, closed);
      expect(await mod.openFollowUpForLead(o, c), closed).toBeNull();
    }
  });

  it("a held step or a waiting draft is still shown after the lead moved on: it is something to act on", async () => {
    const o = org();
    const a = await lead(o), b = await lead(o);
    await followUp(o, a, await message(o, a, "sent"), 1, "held", new Date(NOW.getTime() + DAY));
    await followUp(o, b, await message(o, b, "sent"), 1, "drafted", new Date(NOW.getTime() - DAY), await message(o, b, "draft"));
    for (const l of [a, b]) await q.query(`UPDATE leads SET status = 'replied' WHERE organization_id = $1 AND id = $2`, [o, l]);
    expect(await mod.openFollowUpForLead(o, a)).toMatchObject({ status: "held" });
    expect(await mod.openFollowUpForLead(o, b)).toMatchObject({ status: "drafted", draftStatus: "draft" });
  });

  it("another workspace's follow-up is never read, even for the same lead id", async () => {
    const o = org(), other = org();
    const theirs = await lead(other);
    await followUp(other, theirs, await message(other, theirs, "sent"), 1, "held", new Date(NOW.getTime() + DAY));
    expect(await mod.openFollowUpForLead(o, theirs)).toBeNull();
    expect(await mod.openFollowUpForLead(other, theirs)).toMatchObject({ status: "held" });
  });
});
