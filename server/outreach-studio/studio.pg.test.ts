/**
 * The Outreach Studio's records and numbers, against a REAL Postgres: copied/opened never moves the lead in the list,
 * follow-ups are the lead's own tickets at noon UTC, a reply note keeps the person's words, and the overview counts
 * only what happened (sent from Gmail vs marked sent by you), per workspace.
 *
 * Runs only with MAILBOX_PG_TEST_URL set to a disposable LOCAL database with the leads, outreach and channel tables.
 * Fresh organization ids per case; only their rows are deleted.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const URL_ = process.env.MAILBOX_PG_TEST_URL;
const loopback = (u?: string) => { try { return !!u && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(u).hostname); } catch { return false; } };

describe.skipIf(!URL_ || !loopback(URL_))("Outreach Studio records and overview (real Postgres)", () => {
  let q: any, svc: typeof import("./service");
  const orgs: string[] = [];
  const org = () => { const o = `t-studio-${randomBytes(5).toString("hex")}`; orgs.push(o); return o; };
  const owner = (o: string) => ({ id: "u-studio", organizationId: o, orgRole: "OWNER", firstName: "Asha", lastName: "Rao", customPermissions: null }) as any;
  const NOW = new Date("2026-11-12T10:00:00Z");
  beforeAll(async () => {
    process.env.DATABASE_URL = URL_!;
    svc = await import("./service");
    const { default: pg } = await import("pg");
    q = new pg.Client({ connectionString: URL_ }); await q.connect();
  });
  afterAll(async () => {
    for (const o of orgs) for (const t of ["lead_events", "lead_tickets", "lead_claims", "channel_messages", "outreach_events", "lead_messages", "leads"]) await q.query(`DELETE FROM ${t} WHERE organization_id = $1`, [o]).catch(() => {});
    await q?.end();
  });
  const lead = async (o: string, over: { status?: string; email?: string | null } = {}) => Number((await q.query(
    `INSERT INTO leads (organization_id, owner_user_id, company_name, status, source, contact_email, do_not_contact, updated_at) VALUES ($1, 'u-studio', 'Casa Alma', $2, 'manual', $3, false, $4) RETURNING id`,
    [o, over.status ?? "qualified", over.email === undefined ? "owner@casaalma.test" : over.email, new Date("2026-11-01T00:00:00Z")])).rows[0].id);
  const updatedAt = async (o: string, id: number) => new Date((await q.query(`SELECT updated_at FROM leads WHERE organization_id = $1 AND id = $2`, [o, id])).rows[0].updated_at).toISOString();
  const events = async (o: string, id: number) => (await q.query(`SELECT kind, data FROM lead_events WHERE organization_id = $1 AND lead_id = $2 ORDER BY id`, [o, id])).rows;

  it("copied and opened are recorded on the lead, never as a send, and don't move the lead to the top of the list", async () => {
    const o = org(), l = await lead(o);
    const before = await updatedAt(o, l);
    expect(await svc.recordHandoff(owner(o), l, { channel: "whatsapp", action: "opened", messageId: 9 })).toEqual({ ok: true, recorded: true });
    expect(await svc.recordHandoff(owner(o), l, { channel: "instagram", action: "copied" })).toMatchObject({ ok: true });
    expect(await updatedAt(o, l)).toBe(before);
    expect((await events(o, l)).map((e: any) => [e.kind, e.data])).toEqual([["outreach_opened", { channel: "whatsapp", messageId: 9 }], ["outreach_copied", { channel: "instagram" }]]);
    expect(await svc.recordHandoff(owner(o), l, { channel: "fax", action: "opened" })).toMatchObject({ ok: false, status: 400 });
    expect(await svc.recordHandoff(owner(org()), l, { channel: "email", action: "copied" })).toMatchObject({ ok: false, status: 404 }); // another workspace
  });

  it("a follow-up is the lead's own reminder at noon UTC, today or later; done closes it and says so", async () => {
    const o = org(), l = await lead(o);
    expect(await svc.scheduleFollowUp(owner(o), l, { channel: "linkedin", dueOn: "2026-11-11" }, NOW)).toMatchObject({ ok: false, status: 400 }); // yesterday
    const r: any = await svc.scheduleFollowUp(owner(o), l, { channel: "linkedin", dueOn: "2026-11-15", note: "ask about the Pune office" }, NOW);
    expect(r).toMatchObject({ ok: true, dueOn: "2026-11-15" });
    const t = (await q.query(`SELECT title, kind, status, to_char(due_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS due FROM lead_tickets WHERE organization_id = $1 AND id = $2`, [o, r.ticketId])).rows[0];
    expect(t).toMatchObject({ title: "Follow up on LinkedIn: ask about the Pune office", kind: "follow_up", status: "open" });
    expect(t.due).toBe("2026-11-15T12:00:00"); // stored as UTC wall time, like every timestamp here
    expect(await svc.completeFollowUp(owner(o), l, r.ticketId)).toEqual({ ok: true, done: true });
    expect((await q.query(`SELECT status FROM lead_tickets WHERE id = $1`, [r.ticketId])).rows[0].status).toBe("done");
    const kinds = (await events(o, l)).map((e: any) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(["followup_scheduled", "followup_done"]));
  });

  it("a reply note keeps the outcome and the person's words, labelled as theirs", async () => {
    const o = org(), l = await lead(o);
    expect(await svc.recordReplyNote(owner(o), l, { channel: "whatsapp", outcome: "interested", note: "Wants a call on Monday" })).toEqual({ ok: true, recorded: true });
    expect((await events(o, l)).at(-1)).toEqual({ kind: "reply_recorded", data: { channel: "whatsapp", outcome: "interested", note: "Wants a call on Monday" } });
    expect(await svc.recordReplyNote(owner(o), l, { channel: "whatsapp", outcome: "loves_it" })).toMatchObject({ ok: false, status: 400 });
  });

  it("the overview counts what happened, keeping Gmail sends apart from sends you recorded, for this workspace only", async () => {
    const o = org(), other = org();
    const ready = await lead(o);                          // qualified with an address: ready to contact
    await lead(o, { email: null });                       // no address: not ready
    const won = await lead(o, { status: "won" });         // past first contact: not ready
    await lead(other);                                    // another workspace
    const ev = (lid: number, kind: string, data: object, at = "2026-11-10T09:00:00Z") =>
      q.query(`INSERT INTO lead_events (organization_id, lead_id, kind, data, actor, created_at) VALUES ($1, $2, $3, $4, 'user', $5)`, [o, lid, kind, JSON.stringify(data), at]);
    await ev(ready, "message_sent", { messageId: 1, channel: "manual" });
    await ev(ready, "message_sent", { messageId: 2, channel: "gmail" });
    await ev(ready, "message_sent", { messageId: 3, channel: "manual" }, "2026-09-01T09:00:00Z"); // outside 30 days
    await ev(ready, "reply_recorded", { channel: "whatsapp", outcome: "interested" });
    await ev(won, "status_changed", { from: "proposal", to: "meeting" });
    await q.query(`INSERT INTO lead_tickets (organization_id, lead_id, title, kind, status, due_at, created_by) VALUES ($1, $2, 'Follow up on WhatsApp', 'follow_up', 'open', $3, 'user')`, [o, ready, "2026-11-12T12:00:00Z"]);
    await q.query(`INSERT INTO lead_tickets (organization_id, lead_id, title, kind, status, due_at, created_by) VALUES ($1, $2, 'Follow up later', 'follow_up', 'open', $3, 'user')`, [o, ready, "2026-11-20T12:00:00Z"]);
    await q.query(`INSERT INTO channel_messages (organization_id, lead_id, channel, kind, direction, body, body_hash, status, sent_via, sent_at, created_at, updated_at) VALUES ($1, $2, 'instagram', 'ig_dm', 'out', 'Hi', $3, 'sent', 'manual', $4, $4, $4)`, [o, ready, "a".repeat(64), "2026-11-11T09:00:00Z"]);
    await q.query(`INSERT INTO channel_messages (organization_id, lead_id, channel, kind, direction, body, body_hash, status, created_at, updated_at) VALUES ($1, $2, 'linkedin', 'message', 'out', 'Hello', $3, 'draft', $4, $4)`, [o, won, "b".repeat(64), "2026-11-11T09:00:00Z"]);

    const r: any = await svc.outreachOverview(owner(o), { days: 30 }, NOW);
    expect(r.ok).toBe(true);
    expect(r.overview).toMatchObject({
      days: 30, readyToContact: 1, draftsWaiting: 1, markedSentByYou: 2, sentFromGmail: 1, repliesRecordedByYou: 0,
      followUpsDue: 1, interested: 1, meetings: 1,
    });
    expect(r.overview.byChannel.find((c: any) => c.channel === "instagram")).toEqual({ channel: "instagram", drafts: 0, markedSent: 1, replies: 0 });
    expect(r.overview.byChannel.find((c: any) => c.channel === "linkedin")).toMatchObject({ drafts: 1 });
    expect(r.overview.byChannel[0]).toMatchObject({ channel: "email", markedSent: 2 });
    // The other workspace sees none of it.
    expect((await svc.outreachOverview(owner(other), {}, NOW) as any).overview).toMatchObject({ draftsWaiting: 0, markedSentByYou: 0, interested: 0 });
  });
});
