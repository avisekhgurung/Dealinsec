/**
 * Reply-to-Deal against a REAL Postgres: an interested reply becomes ONE deal (whatever the clicks, tabs or teammates),
 * linked to its lead, conversation, reply and prospect; a won lead's follow-ups stop and can't be sent; the lead and
 * deal timelines show what happened by ids and labels only; and each organization, role and mailbox sees only its own.
 * No AI model is called anywhere along the way.
 *
 * Runs only with MAILBOX_PG_TEST_URL set to a disposable LOCAL database with the full schema and the outreach,
 * mailbox and reply-sync migrations applied. Fresh organization ids per case; only their rows are deleted.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadKeyring } from "./token-crypto";

const modelCalls = vi.hoisted(() => ({ n: 0 }));
vi.mock("../llm/traced", async (orig) => ({
  ...(await orig<typeof import("../llm/traced")>()),
  tracedChat: vi.fn(async () => { modelCalls.n++; throw new Error("a model was called"); }),
}));

const URL_ = process.env.MAILBOX_PG_TEST_URL;
const loopback = (u?: string) => { try { return !!u && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(u).hostname); } catch { return false; } };

describe.skipIf(!URL_ || !loopback(URL_))("reply to deal (real Postgres)", () => {
  let pg: any, q: any;
  let messages: typeof import("../sales/message-store").messageStore;
  let store: typeof import("./sync-store-pg").pgSyncStore;
  let mailbox: typeof import("./mailbox-store-pg").pgMailboxStore;
  let apply: typeof import("./reply-apply");
  let followups: typeof import("../sales/followups");
  let inbox: typeof import("./inbox");
  let leadsSvc: typeof import("../services/leads");
  let sends: typeof import("./send-store-pg").pgSendStore;
  let storage: typeof import("../storage").storage;
  const orgs: string[] = [];
  const keyring = loadKeyring({ MAILBOX_TOKEN_KEYS: `1:${randomBytes(32).toString("base64")}`, MAILBOX_TOKEN_KEY_CURRENT: "1" });
  const deps = { now: () => new Date(), log: () => {} };
  const fdeps = { ...deps, senderName: async () => "Ana Silva" };

  beforeAll(async () => {
    process.env.DATABASE_URL = URL_!;
    messages = (await import("../sales/message-store")).messageStore;
    store = (await import("./sync-store-pg")).pgSyncStore;
    mailbox = (await import("./mailbox-store-pg")).pgMailboxStore;
    apply = await import("./reply-apply");
    followups = await import("../sales/followups");
    inbox = await import("./inbox");
    leadsSvc = await import("../services/leads");
    sends = (await import("./send-store-pg")).pgSendStore;
    storage = (await import("../storage")).storage;
    ({ default: pg } = await import("pg"));
    q = new pg.Client({ connectionString: URL_ }); await q.connect();
  });
  afterAll(async () => {
    for (const o of orgs) for (const t of ["outreach_followups", "mail_messages", "mail_threads", "mail_sync_state", "mail_send_jobs", "mailbox_connections", "outreach_events", "outreach_suppressions", "lead_tickets", "lead_events", "lead_messages", "prospects", "deals", "leads", "activity_logs", "users"]) {
      await q.query(`DELETE FROM ${t} WHERE organization_id = $1`, [o]).catch(() => {});
    }
    await q?.end();
    expect(modelCalls.n).toBe(0);
  });

  const rows = async (sqlText: string, ...p: unknown[]) => (await q.query(sqlText, p)).rows;
  /** A member as the session loads them (the conversion reads plan, role and locale from the row). */
  const member = async (id: string) => (await storage.getUser(id)) as any;

  /** An organization (its owner on Pro, so no credit is spent), the owner's Gmail, a lead at Acme found by AI Outbound, and an outreach sent `sentAt`. */
  async function seed(o: { sentAt?: Date; estValueMinor?: number } = {}) {
    const org = `t-${randomBytes(5).toString("hex")}`; orgs.push(org);
    const ana = `u-${randomBytes(4).toString("hex")}`;
    await q.query(`INSERT INTO users (id, email, organization_id, org_role, member_status, first_name, plan, plan_expires_at) VALUES ($1, $2, $3, 'OWNER', 'active', 'Ana', 'pro', now() + interval '30 days')`, [ana, `${ana}@example.test`, org]);
    const conn = await mailbox.save({ orgId: org, userId: ana, provider: "fake", account: { sub: `g-${ana}`, email: `${ana}@agency.test` }, scopes: ["email", "openid", "https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.readonly"], refreshToken: "rt", keyring, now: new Date() });
    if (!conn.ok) throw new Error(conn.code);
    const to = `jo-${randomBytes(3).toString("hex")}@acme.test`;
    const lead = (await q.query(`INSERT INTO leads (organization_id, owner_user_id, company_name, domain, source, status, do_not_contact, contact_name, est_value_minor, currency, created_at, updated_at) VALUES ($1, $2, 'Acme Foods', $3, 'outbound', 'qualified', false, 'Jo Bloggs', $4, 'INR', now(), now()) RETURNING id`, [org, ana, `${org}.test`, o.estValueMinor ?? null])).rows[0].id;
    const prospect = (await q.query(`INSERT INTO prospects (organization_id, domain, name, website, status, lead_id, created_at, updated_at) VALUES ($1, $2, 'Acme Foods', $3, 'qualified', $4, now(), now()) RETURNING id`, [org, `${org}.test`, `https://${org}.test`, lead])).rows[0].id;
    const draft = await messages.create({ orgId: org, leadId: lead, subject: "A quick idea for Acme", body: "Hi Jo, …", bodyHash: "h", toAddress: to, toSource: "lead", researchId: null, claimIds: [], promptVersion: "t", by: "user", userId: ana, now: new Date() });
    await q.query(`UPDATE lead_messages SET status = 'approved', approved_by = $2, approved_at = now() WHERE id = $1`, [draft.id, ana]);
    const sentAt = o.sentAt ?? new Date();
    const rec = await messages.recordSentIfAllowed({ orgId: org, id: draft.id, now: sentAt, keys: [{ kind: "email", value: to }, { kind: "domain", value: to.split("@")[1] }], outbox: { userId: ana } });
    if (rec.result !== "sent") throw new Error(rec.result);
    await messages.completeAfterSend({ orgId: org, messageId: draft.id, now: sentAt });
    return { org, ana, connId: conn.connection.id, lead, prospect, root: draft.id, to };
  }
  type Seed = Awaited<ReturnType<typeof seed>>;

  /** A reply in the conversation's thread, stored and applied; returns the mail message and its thread. */
  async function reply(s: Seed, text: string) {
    const { classifyReply } = await import("./reply-rules");
    const r = await store.storeMessage({
      orgId: s.org, connectionId: s.connId, providerMessageId: `m-${randomBytes(4).toString("hex")}`, providerThreadId: "t-main",
      link: { leadId: s.lead, leadMessageId: s.root, toAddress: s.to }, adoptThread: { source: "adopted" }, linked: true,
      direction: "in", kind: "reply", match: "thread", review: null, fromAddress: s.to, fromName: "Jo", to: ["ana@agency.test"],
      subject: "Re: A quick idea for Acme", bodyText: text, bodyTrimmed: false, rfcMessageId: null, inReplyTo: null, sentAt: new Date(), now: new Date(),
      classification: classifyReply({ kind: "reply", subject: "Re: A quick idea", text }),
    });
    await apply.applyReply(s.org, r.id!, deps);
    const [t] = await rows(`SELECT id FROM mail_threads WHERE organization_id = $1`, s.org);
    return { mailMessageId: r.id!, threadId: Number(t.id) };
  }

  it("an interested reply becomes ONE deal, linked to the lead, the conversation, the reply and the prospect", async () => {
    const s = await seed();
    const { mailMessageId, threadId } = await reply(s, "Sounds good, let's talk next week.");
    const ana = await member(s.ana);
    const r = await inbox.createDealFromConversation(ana, threadId, { dealTitle: "Acme website", dealAmount: 50000 });
    expect(r).toMatchObject({ ok: true, existing: false });
    const dealId = (r as any).dealId as number;
    const [deal] = await rows(`SELECT organization_id, brand_name, deal_title, deal_amount::int AS deal_amount_minor FROM deals WHERE id = $1`, dealId);
    expect(deal).toEqual({ organization_id: s.org, brand_name: "Acme Foods", deal_title: "Acme website", deal_amount_minor: 5000000 });
    const [lead] = await rows(`SELECT status, converted_deal_id, converting FROM leads WHERE id = $1`, s.lead);
    expect(lead).toEqual({ status: "won", converted_deal_id: dealId, converting: false });
    const [ev] = await rows(`SELECT data FROM lead_events WHERE organization_id = $1 AND kind = 'converted'`, s.org);
    expect(ev.data).toEqual({ dealId, via: "inbox", threadId, mailMessageId, prospectId: s.prospect });
    // Asking again (a second tab, a refresh) answers with the same deal.
    expect(await inbox.createDealFromConversation(ana, threadId, { dealAmount: 1 })).toMatchObject({ ok: true, dealId, existing: true });
    expect(await rows(`SELECT count(*)::int n FROM deals WHERE organization_id = $1`, s.org)).toEqual([{ n: 1 }]);
  });

  it("six requests at once (double clicks, two tabs, a teammate): exactly one deal, no error", async () => {
    const s = await seed();
    const { threadId } = await reply(s, "We're interested. Can we book a call?");
    const ana = await member(s.ana);
    const ben = `u-${randomBytes(4).toString("hex")}`;
    await q.query(`INSERT INTO users (id, email, organization_id, org_role, member_status) VALUES ($1, $2, $3, 'SALES', 'active')`, [ben, `${ben}@example.test`, s.org]);
    const benRow = await member(ben);
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => inbox.createDealFromConversation(i % 2 ? benRow : ana, threadId, { dealAmount: 1000 })));
    // Each answer is the deal, or "being created right now" (a lost claim): never a second deal, never a 500.
    for (const r of results) expect(r.ok || (r as any).code === "busy").toBe(true);
    const ids = new Set(results.filter((r) => r.ok).map((r) => (r as any).dealId));
    expect(ids.size).toBe(1);
    expect(await rows(`SELECT count(*)::int n FROM deals WHERE organization_id = $1`, s.org)).toEqual([{ n: 1 }]);
    expect(await rows(`SELECT count(*)::int n FROM lead_events WHERE organization_id = $1 AND kind = 'converted'`, s.org)).toEqual([{ n: 1 }]);
  });

  it("only an Interested conversation, only in your organization, only for a role that may create deals", async () => {
    const s = await seed();
    const { threadId } = await reply(s, "How much would this cost?"); // more information: not a yes
    const ana = await member(s.ana);
    expect(await inbox.createDealFromConversation(ana, threadId, { dealAmount: 1000 })).toMatchObject({ ok: false, status: 409, code: "not_interested" });

    const other = await seed();
    const outsider = await member(other.ana);
    expect(await inbox.createDealFromConversation(outsider, threadId, { dealAmount: 1000 })).toMatchObject({ ok: false, status: 404 });

    // Built-in Accounts and a quotations-only custom role may read deals but not create them; an invoices-only custom role
    // can't even read leads.
    const quoter = `u-${randomBytes(4).toString("hex")}`, accounts = `u-${randomBytes(4).toString("hex")}`;
    await q.query(`INSERT INTO users (id, email, organization_id, org_role, member_status) VALUES ($1, $2, $3, 'ACCOUNTS', 'active')`, [accounts, `${accounts}@example.test`, s.org]);
    await q.query(`INSERT INTO users (id, email, organization_id, org_role, member_status) VALUES ($1, $2, $3, 'CUSTOM', 'active')`, [quoter, `${quoter}@example.test`, s.org]);
    await q.query(`UPDATE mail_threads SET status = 'interested' WHERE id = $1`, [threadId]);
    expect(await inbox.createDealFromConversation({ ...(await member(quoter)), customPermissions: ["quotations.create"] }, threadId, { dealAmount: 1000 })).toMatchObject({ ok: false, status: 403 });
    expect(await inbox.createDealFromConversation(await member(accounts), threadId, { dealAmount: 1000 })).toMatchObject({ ok: false, status: 403 });
    expect(await inbox.dealEmailActivity({ ...(await member(quoter)), customPermissions: ["invoices.create"] }, 1)).toMatchObject({ ok: false, status: 403 });
    // A bad amount is refused before anything is claimed.
    expect(await inbox.createDealFromConversation(ana, threadId, { dealAmount: -5 })).toMatchObject({ ok: false, status: 400 });
    expect(await rows(`SELECT count(*)::int n FROM deals WHERE organization_id = $1`, s.org)).toEqual([{ n: 0 }]);
    expect((await rows(`SELECT converting FROM leads WHERE id = $1`, s.lead))[0].converting).toBe(false);
  });

  it("a won lead stops chasing: scheduled and drafted follow-ups cancel, the task closes, and a drafted one can't be sent", async () => {
    const s = await seed({ sentAt: new Date(Date.now() - 10 * 86_400_000), estValueMinor: 2500000 });
    await followups.draftDueFollowups(fdeps, { limit: 200 });
    const [f] = await rows(`SELECT id, status, draft_message_id FROM outreach_followups WHERE organization_id = $1`, s.org);
    expect(f.status).toBe("drafted");
    await q.query(`UPDATE lead_messages SET status = 'approved', approved_by = $2, approved_at = now() WHERE id = $1`, [f.draft_message_id, s.ana]);
    // Won from the lead page (no reply at all): the lead's own conversion.
    const r = await leadsSvc.convertToDeal(await member(s.ana), s.lead, {});
    expect(r.ok).toBe(true);
    expect(await rows(`SELECT status, reason FROM outreach_followups WHERE organization_id = $1`, s.org)).toEqual([{ status: "cancelled", reason: "won" }]);
    expect((await rows(`SELECT status FROM lead_messages WHERE id = $1`, f.draft_message_id))[0].status).toBe("cancelled");
    expect(await rows(`SELECT status FROM lead_tickets WHERE organization_id = $1 AND kind = 'follow_up' AND status = 'open'`, s.org)).toEqual([]);
    expect(await rows(`SELECT data FROM lead_events WHERE organization_id = $1 AND kind = 'draft_cancelled'`, s.org)).toEqual([{ data: { messageId: f.draft_message_id, why: "won" } }]);
    // Even if the draft were somehow approved again, its send is refused for a converted lead.
    await q.query(`UPDATE lead_messages SET status = 'approved' WHERE id = $1`, [f.draft_message_id]);
    await q.query(`UPDATE outreach_followups SET status = 'drafted' WHERE organization_id = $1`, [s.org]);
    const [m] = await rows(`SELECT body_hash FROM lead_messages WHERE id = $1`, f.draft_message_id);
    const res = await sends.reserve({ orgId: s.org, userId: s.ana, messageId: f.draft_message_id, expectedHash: m.body_hash, connectionId: s.connId, provider: "fake", checkList: true, dailyCap: 50, now: new Date(), leaseMs: 60_000, newRfcMessageId: `<t-${randomBytes(4).toString("hex")}@x.test>` });
    expect(res).toMatchObject({ ok: false, code: "followup_stopped" });
  });

  it("the same reply applied over and over, at once (duplicate sync events): one 'replied', one timeline entry, one stage move", async () => {
    const s = await seed();
    const { classifyReply } = await import("./reply-rules");
    const r = await store.storeMessage({
      orgId: s.org, connectionId: s.connId, providerMessageId: `m-${randomBytes(4).toString("hex")}`, providerThreadId: "t-dup",
      link: { leadId: s.lead, leadMessageId: s.root, toAddress: s.to }, adoptThread: { source: "adopted" }, linked: true,
      direction: "in", kind: "reply", match: "thread", review: null, fromAddress: s.to, fromName: "Jo", to: ["ana@agency.test"],
      subject: "Re: A quick idea", bodyText: "Sounds great, let's talk.", bodyTrimmed: false, rfcMessageId: null, inReplyTo: null, sentAt: new Date(), now: new Date(),
      classification: classifyReply({ kind: "reply", subject: "Re", text: "Sounds great, let's talk." }),
    });
    const outcomes = await Promise.all(Array.from({ length: 6 }, () => apply.applyReply(s.org, r.id!, deps)));
    expect(outcomes.filter((o) => o === "applied")).toHaveLength(1);
    expect(await rows(`SELECT count(*)::int n FROM outreach_events WHERE organization_id = $1 AND kind = 'replied'`, s.org)).toEqual([{ n: 1 }]);
    expect(await rows(`SELECT count(*)::int n FROM lead_events WHERE organization_id = $1 AND kind = 'outreach_replied'`, s.org)).toEqual([{ n: 1 }]);
    expect(await rows(`SELECT count(*)::int n FROM lead_events WHERE organization_id = $1 AND kind = 'status_changed'`, s.org)).toEqual([{ n: 2 }]); // qualified→contacted (sent), contacted→replied
  });

  it("an opt-out after interest still wins: on the list, do-not-contact, and the conversation can't become a deal", async () => {
    const s = await seed();
    const { threadId } = await reply(s, "Sounds good, let's talk.");
    await reply(s, "Actually, please remove me from your list.");
    expect((await rows(`SELECT status FROM mail_threads WHERE id = $1`, threadId))[0].status).toBe("opted_out");
    expect((await rows(`SELECT do_not_contact FROM leads WHERE id = $1`, s.lead))[0].do_not_contact).toBe(true);
    expect(await rows(`SELECT reason FROM outreach_suppressions WHERE organization_id = $1 AND kind = 'email'`, s.org)).toEqual([{ reason: "opt_out" }]);
    expect(await inbox.createDealFromConversation(await member(s.ana), threadId, { dealAmount: 1000 })).toMatchObject({ ok: false, code: "not_interested" });
  });

  it("the deal's email activity: its lead, prospect, conversation and timeline (ids and labels only); nothing for another organization", async () => {
    const s = await seed();
    const { threadId } = await reply(s, "We're interested, let's talk.");
    const ana = await member(s.ana);
    const r = await inbox.createDealFromConversation(ana, threadId, { dealAmount: 1000 });
    const dealId = (r as any).dealId as number;
    const a = await inbox.dealEmailActivity(ana, dealId);
    expect(a).toMatchObject({ ok: true, lead: { id: s.lead, company: "Acme Foods", status: "won" }, prospect: { id: s.prospect, name: "Acme Foods" }, inboxAvailable: true });
    expect((a as any).conversations).toEqual([expect.objectContaining({ threadId, status: "interested", subject: "A quick idea for Acme", contact: s.to, replies: 1 })]);
    const kinds = (a as any).events.map((e: any) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(["converted", "outreach_replied", "message_sent", "status_changed"]));
    expect((a as any).events.find((e: any) => e.kind === "outreach_replied").data).toMatchObject({ label: "interested", threadId });
    expect(JSON.stringify(a)).not.toMatch(/let's talk/); // the reply's words are not part of the deal's activity
    const other = await seed();
    expect(await inbox.dealEmailActivity(await member(other.ana), dealId)).toMatchObject({ ok: true, lead: null, conversations: [], events: [] });
  });

  it("a person's label change and review decisions are on the lead's timeline (who and which message, no text)", async () => {
    const s = await seed();
    const { mailMessageId } = await reply(s, "How much would this cost?");
    const ana = await member(s.ana);
    expect(await inbox.relabelMessage(ana, mailMessageId, { label: "interested" }, deps)).toMatchObject({ ok: true, label: "interested" });
    expect(await inbox.relabelMessage(ana, mailMessageId, { label: "interested" }, deps)).toMatchObject({ ok: true }); // no change: no second entry
    const ev = await rows(`SELECT data, actor_user_id FROM lead_events WHERE organization_id = $1 AND kind = 'reply_labelled'`, s.org);
    expect(ev).toEqual([{ data: { mailMessageId, from: "more_info", to: "interested" }, actor_user_id: s.ana }]);
    expect((await rows(`SELECT status FROM mail_threads WHERE organization_id = $1`, s.org))[0].status).toBe("interested");
  });
});
