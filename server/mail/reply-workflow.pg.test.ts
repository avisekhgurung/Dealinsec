/**
 * The reply-driven workflow against a REAL Postgres: a sent outreach schedules its follow-ups; a synced reply, opt-out
 * or bounce stops them (and the do-not-contact list, the lead and its tasks follow); a match awaiting review holds
 * them; a due follow-up becomes a draft for review; a follow-up can't be sent once the conversation was answered;
 * the inbox shows each person only what they may see. And no AI model is called anywhere along the way.
 *
 * Runs only with MAILBOX_PG_TEST_URL set to a disposable LOCAL database with the full schema and the outreach,
 * mailbox and reply-sync migrations applied. Fresh organization ids per case; only their rows are deleted.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadKeyring } from "./token-crypto";

// Gmail content must never reach a model: any model call in these flows fails the suite.
const modelCalls = vi.hoisted(() => ({ n: 0 }));
vi.mock("../llm/traced", async (orig) => ({
  ...(await orig<typeof import("../llm/traced")>()),
  tracedChat: vi.fn(async () => { modelCalls.n++; throw new Error("a model was called"); }),
}));

const URL_ = process.env.MAILBOX_PG_TEST_URL;
const loopback = (u?: string) => { try { return !!u && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(u).hostname); } catch { return false; } };

describe.skipIf(!URL_ || !loopback(URL_))("reply workflow (real Postgres)", () => {
  let pg: any, q: any;
  let messages: typeof import("../sales/message-store").messageStore;
  let store: typeof import("./sync-store-pg").pgSyncStore;
  let mailbox: typeof import("./mailbox-store-pg").pgMailboxStore;
  let apply: typeof import("./reply-apply");
  let followups: typeof import("../sales/followups");
  let inbox: typeof import("./inbox");
  let sends: typeof import("./send-store-pg").pgSendStore;
  const orgs: string[] = [];
  const keyring = loadKeyring({ MAILBOX_TOKEN_KEYS: `1:${randomBytes(32).toString("base64")}`, MAILBOX_TOKEN_KEY_CURRENT: "1" });
  const logs: string[] = [];
  const deps = { now: () => new Date(), log: (e: string, f?: object) => logs.push(JSON.stringify({ e, ...f })) };
  const fdeps = { ...deps, senderName: async () => "Ana Silva" };

  beforeAll(async () => {
    process.env.DATABASE_URL = URL_!;
    messages = (await import("../sales/message-store")).messageStore;
    store = (await import("./sync-store-pg")).pgSyncStore;
    mailbox = (await import("./mailbox-store-pg")).pgMailboxStore;
    apply = await import("./reply-apply");
    followups = await import("../sales/followups");
    inbox = await import("./inbox");
    sends = (await import("./send-store-pg")).pgSendStore;
    ({ default: pg } = await import("pg"));
    q = new pg.Client({ connectionString: URL_ }); await q.connect();
  });
  afterAll(async () => {
    for (const o of orgs) for (const t of ["outreach_followups", "mail_messages", "mail_threads", "mail_sync_state", "mail_send_jobs", "mailbox_connections", "outreach_events", "outreach_suppressions", "lead_tickets", "lead_events", "lead_messages", "leads", "activity_logs", "users"]) {
      await q.query(`DELETE FROM ${t} WHERE organization_id = $1`, [o]).catch(() => {});
    }
    await q?.end();
    expect(modelCalls.n).toBe(0);
  });

  const member = (org: string, id: string, role = "SALES") => ({ id, organizationId: org, memberStatus: "active", orgRole: role } as any);

  /** An organization, Ana's connected mailbox, a lead at Acme, and an outreach sent at `sentAt` (with its after-send work done). */
  async function seed(o: { sentAt?: Date; to?: string } = {}) {
    const org = `t-${randomBytes(5).toString("hex")}`; orgs.push(org);
    const ana = `u-${randomBytes(4).toString("hex")}`;
    await q.query(`INSERT INTO users (id, email, organization_id, org_role, member_status, first_name) VALUES ($1, $2, $3, 'SALES', 'active', 'Ana')`, [ana, `${ana}@example.test`, org]);
    const conn = await mailbox.save({ orgId: org, userId: ana, provider: "fake", account: { sub: `g-${ana}`, email: `${ana}@agency.test` }, scopes: ["email", "openid", "https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.readonly"], refreshToken: "rt", keyring, now: new Date() });
    if (!conn.ok) throw new Error(conn.code);
    const to = o.to ?? `jo-${randomBytes(3).toString("hex")}@acme.test`;
    const lead = (await q.query(`INSERT INTO leads (organization_id, owner_user_id, company_name, domain, source, status, do_not_contact, contact_name, created_at, updated_at) VALUES ($1, $2, 'Acme Foods', $3, 'outbound', 'qualified', false, 'Jo Bloggs', now(), now()) RETURNING id`, [org, ana, `${org}.test`])).rows[0].id;
    const draft = await messages.create({ orgId: org, leadId: lead, subject: "A quick idea for Acme", body: "Hi Jo, …", bodyHash: "h", toAddress: to, toSource: "lead", researchId: null, claimIds: [], promptVersion: "t", by: "user", userId: ana, now: new Date() });
    await q.query(`UPDATE lead_messages SET status = 'approved', approved_by = $2, approved_at = now() WHERE id = $1`, [draft.id, ana]);
    const sentAt = o.sentAt ?? new Date();
    const rec = await messages.recordSentIfAllowed({ orgId: org, id: draft.id, now: sentAt, keys: [{ kind: "email", value: to }, { kind: "domain", value: to.split("@")[1] }], outbox: { userId: ana } });
    if (rec.result !== "sent") throw new Error(rec.result);
    await messages.completeAfterSend({ orgId: org, messageId: draft.id, now: sentAt });
    return { org, ana, connId: conn.connection.id, lead, root: draft.id, to };
  }
  type Seed = Awaited<ReturnType<typeof seed>>;
  const rows = async (sqlText: string, ...p: unknown[]) => (await q.query(sqlText, p)).rows;
  const fu = (s: Seed) => rows(`SELECT step, status, reason, due_at, draft_message_id FROM outreach_followups WHERE organization_id = $1 ORDER BY step`, s.org);

  /** A message synced into the conversation's thread (or, with review, matched by address only), stored and applied. */
  async function reply(s: Seed, o: { text?: string; from?: string; kind?: "reply" | "auto_reply" | "bounce"; review?: "address_only" | "other_sender"; label?: string } = {}) {
    const { classifyReply } = await import("./reply-rules");
    const kind = o.kind ?? "reply";
    const r = await store.storeMessage({
      orgId: s.org, connectionId: s.connId, providerMessageId: `m-${randomBytes(4).toString("hex")}`, providerThreadId: o.review === "address_only" ? `t-${randomBytes(3).toString("hex")}` : "t-main",
      link: { leadId: s.lead, leadMessageId: s.root, toAddress: s.to }, adoptThread: o.review === "address_only" ? null : { source: "adopted" }, linked: o.review !== "address_only",
      direction: "in", kind, match: o.review === "address_only" ? "address" : "thread", review: o.review ?? null, fromAddress: o.from ?? s.to, fromName: "Jo", to: ["ana@agency.test"],
      subject: "Re: A quick idea for Acme", bodyText: o.text ?? "Sounds good, let's talk.", bodyTrimmed: false, rfcMessageId: null, inReplyTo: null, sentAt: new Date(), now: new Date(),
      classification: (o.label as any) ?? classifyReply({ kind, subject: "Re: A quick idea", text: o.text ?? "Sounds good, let's talk." }),
    });
    expect(await apply.applyReply(s.org, r.id!, deps)).toBe("applied");
    expect(await apply.applyReply(s.org, r.id!, deps)).toBe("already"); // once
    return r.id!;
  }

  it("a sent outreach schedules the first follow-up 3 business days on, with its task due then", async () => {
    const s = await seed({ sentAt: new Date("2026-10-16T16:00:00Z") }); // a Friday
    // Read as text: timestamps are stored as UTC wall-clock (node-postgres would turn them into local time).
    expect(await rows(`SELECT step, status, due_at::text AS due FROM outreach_followups WHERE organization_id = $1`, s.org)).toEqual([{ step: 1, status: "scheduled", due: "2026-10-21 16:00:00" }]);
    const [t] = await rows(`SELECT kind, status, due_at::text AS due FROM lead_tickets WHERE organization_id = $1`, s.org);
    expect(t).toEqual({ kind: "follow_up", status: "open", due: "2026-10-21 16:00:00" });
  });

  it("a reply: replied on the outreach (once), lead moves to replied, follow-ups and their task cancelled, conversation interested", async () => {
    const s = await seed();
    await reply(s, { text: "Sounds good, let's talk next week." });
    expect(await rows(`SELECT kind, source, provider FROM outreach_events WHERE organization_id = $1 AND kind = 'replied'`, s.org)).toEqual([{ kind: "replied", source: "provider", provider: "gmail" }]);
    expect((await rows(`SELECT status FROM leads WHERE id = $1`, s.lead))[0].status).toBe("replied");
    expect(await fu(s)).toMatchObject([{ status: "cancelled", reason: "replied" }]);
    expect((await rows(`SELECT status FROM lead_tickets WHERE organization_id = $1`, s.org))[0].status).toBe("cancelled");
    expect((await rows(`SELECT status FROM mail_threads WHERE organization_id = $1`, s.org))[0].status).toBe("interested");
    // The timeline carries ids only: nothing from the email (the AI agent reads the timeline).
    const ev = await rows(`SELECT kind, data FROM lead_events WHERE organization_id = $1 AND kind LIKE 'outreach_%'`, s.org);
    // The rules' label and the conversation's ids, for the lead and deal timelines; never the words themselves.
    expect(ev).toEqual([{ kind: "outreach_replied", data: { messageId: s.root, via: "gmail_sync", label: "interested", threadId: expect.any(Number), mailMessageId: expect.any(Number) } }]);
    expect(JSON.stringify(await rows(`SELECT data FROM lead_events WHERE organization_id = $1`, s.org))).not.toMatch(/talk|Sounds/);
  });

  it("an opt-out: the address goes on the list, the lead is do-not-contact, unsent messages to it are cancelled, follow-ups stop", async () => {
    const s = await seed();
    // Another lead's unsent draft to the same address must be cancelled too.
    const other = (await q.query(`INSERT INTO leads (organization_id, owner_user_id, company_name, source, status, created_at, updated_at) VALUES ($1, $2, 'Acme 2', 'manual', 'qualified', now(), now()) RETURNING id`, [s.org, s.ana])).rows[0].id;
    const d = await messages.create({ orgId: s.org, leadId: other, subject: "x", body: "y", bodyHash: "h", toAddress: s.to, toSource: "lead", researchId: null, claimIds: [], promptVersion: "t", by: "user", userId: s.ana, now: new Date() });
    await reply(s, { text: "Please remove me from your list." });
    expect(await rows(`SELECT kind, value, reason FROM outreach_suppressions WHERE organization_id = $1`, s.org)).toEqual([{ kind: "email", value: s.to, reason: "opt_out" }]);
    expect((await rows(`SELECT do_not_contact FROM leads WHERE id = $1`, s.lead))[0].do_not_contact).toBe(true);
    expect((await rows(`SELECT status FROM lead_messages WHERE id = $1`, d.id))[0].status).toBe("cancelled");
    expect(await fu(s)).toMatchObject([{ status: "cancelled", reason: "opted_out" }]);
    expect((await rows(`SELECT status FROM mail_threads WHERE organization_id = $1`, s.org))[0].status).toBe("opted_out");
  });

  it("a bounce puts the outreach address on the list; an out-of-office changes nothing", async () => {
    const a = await seed();
    await reply(a, { kind: "auto_reply", text: "I'm out of the office until Monday." });
    expect(await fu(a)).toMatchObject([{ status: "scheduled" }]);
    expect((await rows(`SELECT status FROM leads WHERE id = $1`, a.lead))[0].status).toBe("contacted");
    const b = await seed();
    await reply(b, { kind: "bounce", from: "mailer-daemon@googlemail.com", text: "Address not found" });
    expect(await rows(`SELECT value, reason FROM outreach_suppressions WHERE organization_id = $1`, b.org)).toEqual([{ value: b.to, reason: "bounce" }]);
    expect(await fu(b)).toMatchObject([{ status: "cancelled", reason: "bounced" }]);
  });

  it("a match awaiting review holds follow-ups; dismissing releases them; confirming applies the reply", async () => {
    const s = await seed();
    const id = await reply(s, { review: "address_only", text: "Quick question about your services" });
    expect(await fu(s)).toMatchObject([{ status: "held", reason: "review" }]);
    expect((await rows(`SELECT status FROM leads WHERE id = $1`, s.lead))[0].status).toBe("contacted"); // nothing changed on the lead
    // Only Ana (whose mailbox it came from) can see or decide it.
    const ben = member(s.org, "ben"); await q.query(`INSERT INTO users (id, email, organization_id, org_role, member_status) VALUES ($1, $2, $3, 'SALES', 'active') ON CONFLICT DO NOTHING`, [`ben-${s.org}`, `ben-${s.org}@x.test`, s.org]);
    ben.id = `ben-${s.org}`;
    expect(await inbox.reviewQueue(ben)).toMatchObject({ ok: true, items: [] });
    expect(await inbox.reviewMessage(ben, id, { decision: "confirm" }, deps)).toMatchObject({ ok: false, code: "not_found" });
    expect((await inbox.reviewQueue(member(s.org, s.ana)) as any).items.map((i: any) => i.mailMessageId)).toEqual([id]);
    expect(await inbox.reviewMessage(member(s.org, s.ana), id, { decision: "dismiss" }, deps)).toMatchObject({ ok: true, state: "dismissed" });
    expect(await fu(s)).toMatchObject([{ status: "scheduled", reason: null }]);

    const id2 = await reply(s, { review: "address_only", text: "Yes please, let's talk." });
    expect(await inbox.reviewMessage(member(s.org, s.ana), id2, { decision: "confirm" }, deps)).toMatchObject({ ok: true, state: "confirmed" });
    expect(await fu(s)).toMatchObject([{ status: "cancelled", reason: "replied" }]);
    expect((await rows(`SELECT status FROM leads WHERE id = $1`, s.lead))[0].status).toBe("replied");
  });

  it("an opt-out from the address we wrote to is honoured even before its match is reviewed", async () => {
    const s = await seed();
    await reply(s, { review: "address_only", text: "unsubscribe" });
    expect(await rows(`SELECT reason FROM outreach_suppressions WHERE organization_id = $1`, s.org)).toEqual([{ reason: "opt_out" }]);
    expect(await fu(s)).toMatchObject([{ status: "cancelled", reason: "opted_out" }]);
  });

  it("a due follow-up becomes a draft for review (a template from the lead, no model call); the next step comes after it is sent", async () => {
    const s = await seed({ sentAt: new Date(Date.now() - 10 * 86_400_000) });
    const counts = await followups.draftDueFollowups(fdeps);
    expect(counts.drafted).toBeGreaterThanOrEqual(1);
    const [f] = await fu(s);
    expect(f).toMatchObject({ step: 1, status: "drafted" });
    const [d] = await rows(`SELECT subject, body, status, to_address, prompt_version FROM lead_messages WHERE id = $1`, f.draft_message_id);
    expect(d).toMatchObject({ subject: "Re: A quick idea for Acme", status: "draft", to_address: s.to, prompt_version: "followup-t1" });
    expect(d.body).toMatch(/^Hi Jo,/);
    expect(d.body).toMatch(/won't follow up again/);
    // Approved and sent (by hand here): step 2 is scheduled 5 business days on; after it, nothing more.
    await q.query(`UPDATE lead_messages SET status = 'approved', approved_by = $2, approved_at = now() WHERE id = $1`, [f.draft_message_id, s.ana]);
    const sent = new Date();
    await messages.recordSentIfAllowed({ orgId: s.org, id: f.draft_message_id, now: sent, keys: [], outbox: { userId: s.ana } });
    await messages.completeAfterSend({ orgId: s.org, messageId: f.draft_message_id, now: sent });
    const after = await fu(s);
    expect(after.map((x: any) => [x.step, x.status])).toEqual([[1, "sent"], [2, "scheduled"]]);
    const { addBusinessDays } = await import("@shared/followup-policy");
    const [due2] = await rows(`SELECT to_char(due_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS d FROM outreach_followups WHERE organization_id = $1 AND step = 2`, s.org);
    expect(due2.d).toBe(addBusinessDays(sent, 5).toISOString());
    expect(await rows(`SELECT status FROM lead_tickets WHERE organization_id = $1 ORDER BY id`, s.org)).toEqual([{ status: "done" }, { status: "open" }]);
  });

  it("a follow-up isn't drafted once the conversation was answered, and a drafted one can't be sent after a reply", async () => {
    const s = await seed({ sentAt: new Date(Date.now() - 10 * 86_400_000) });
    await followups.draftDueFollowups(fdeps);
    const [f] = await fu(s);
    await q.query(`UPDATE lead_messages SET status = 'approved', approved_by = $2, approved_at = now() WHERE id = $1`, [f.draft_message_id, s.ana]);
    await reply(s, { text: "Thanks, we're interested." });
    expect((await rows(`SELECT status FROM lead_messages WHERE id = $1`, f.draft_message_id))[0].status).toBe("cancelled");
    expect(await fu(s)).toMatchObject([{ status: "cancelled", reason: "replied" }]);
    // Even if the draft were somehow still approved, reserving its send refuses.
    await q.query(`UPDATE lead_messages SET status = 'approved' WHERE id = $1`, [f.draft_message_id]);
    await q.query(`UPDATE outreach_followups SET status = 'drafted' WHERE organization_id = $1`, [s.org]);
    const [m] = await rows(`SELECT body_hash FROM lead_messages WHERE id = $1`, f.draft_message_id);
    const r = await sends.reserve({ orgId: s.org, userId: s.ana, messageId: f.draft_message_id, expectedHash: m.body_hash, connectionId: s.connId, provider: "fake", checkList: true, dailyCap: 50, now: new Date(), leaseMs: 60_000, newRfcMessageId: `<t-${randomBytes(4).toString("hex")}@x.test>` });
    expect(r).toMatchObject({ ok: false, code: "followup_stopped" });
  });

  it("a reply racing a follow-up draft: whichever commits second sees the other (no follow-up survives a reply)", async () => {
    for (let i = 0; i < 5; i++) {
      const s = await seed({ sentAt: new Date(Date.now() - 10 * 86_400_000) });
      await Promise.all([followups.draftDueFollowups(fdeps, { limit: 50 }), reply(s, { text: "Not interested, thanks." })]);
      const [f] = await fu(s);
      expect(f.status).toBe("cancelled");
      if (f.draft_message_id) expect((await rows(`SELECT status FROM lead_messages WHERE id = $1`, f.draft_message_id))[0].status).toBe("cancelled");
    }
  });

  it("the inbox: filters with counts, a conversation's messages in order, and a person's correction applied", async () => {
    const s = await seed();
    const id = await reply(s, { text: "Who is this?" }); // rules: needs review
    const ana = member(s.org, s.ana);
    const list = await inbox.listInbox(ana, { filter: "needs_review" }) as any;
    expect(list.ok).toBe(true);
    expect(list.items.map((i: any) => [i.company, i.status, i.lastLabel])).toEqual([["Acme Foods", "needs_review", "needs_review"]]);
    expect(list.counts).toMatchObject({ all: 1, needs_review: 1, awaiting: 0 });
    expect((await inbox.listInbox(ana, { q: "nothing-like-this" }) as any).items).toEqual([]);
    const conv = await inbox.conversation(ana, list.items[0].threadId) as any;
    expect(conv.messages.map((m: any) => [m.direction, m.kind])).toEqual([["out", "outreach"], ["in", "reply"]]);
    expect(conv.thread.gmailUrl).toMatch(/^https:\/\/mail\.google\.com\//); // the mailbox owner may open it in Gmail
    const viewer = member(s.org, "someone-else");
    expect((await inbox.conversation(viewer, list.items[0].threadId) as any).thread.gmailUrl).toBeNull();
    expect(await inbox.conversation(member("other-org", "x"), list.items[0].threadId)).toMatchObject({ ok: false, code: "not_found" });
    // Corrected to an opt-out: it takes effect.
    expect(await inbox.relabelMessage(ana, id, { label: "opt_out" }, deps)).toMatchObject({ ok: true, label: "opt_out" });
    expect(await rows(`SELECT reason FROM outreach_suppressions WHERE organization_id = $1`, s.org)).toEqual([{ reason: "opt_out" }]);
    expect((await rows(`SELECT status FROM mail_threads WHERE organization_id = $1`, s.org))[0].status).toBe("opted_out");
  });

  it("retention: text older than the period is deleted, the rest of the message stays", async () => {
    const s = await seed();
    const id = await reply(s, { text: "old text" });
    await q.query(`UPDATE mail_messages SET sent_at = now() - interval '400 days' WHERE id = $1`, [id]);
    const { purgeExpiredBodies, retentionDays } = await import("./sync-store-pg");
    expect(retentionDays(undefined)).toEqual({ days: 365, problem: null });
    expect(retentionDays("10").problem).toMatch(/MAIL_SYNC_RETENTION_DAYS/);
    expect(await purgeExpiredBodies(365, new Date())).toBeGreaterThanOrEqual(1);
    const [m] = await rows(`SELECT body_text, body_removed_at, from_address FROM mail_messages WHERE id = $1`, id);
    expect(m.body_text).toBeNull();
    expect(m.body_removed_at).not.toBeNull();
    expect(m.from_address).toBe(s.to);
  });

  it("logs carry ids and codes only", () => {
    const text = logs.join("\n");
    for (const leak of ["Sounds good", "remove me", "@acme.test", "Acme Foods"]) expect(text).not.toContain(leak);
  });
});
