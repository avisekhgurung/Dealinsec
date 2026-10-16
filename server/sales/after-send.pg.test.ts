/**
 * A send's follow-up (timeline entry, stage moves, follow-up ticket) against a REAL Postgres: durable and done once,
 * through crashes, retries, concurrent completions and a late provider confirmation.
 *
 * The outbox: "follow_due" is written in the same transaction that records the send (by hand: recordSentIfAllowed; from
 * Gmail: finishSent or a person's "it was sent"), and completeAfterSend does the work and writes "follow_done" in one
 * transaction under the message row's lock.
 *
 * Runs only with MAILBOX_PG_TEST_URL set to a disposable LOCAL database with the full schema (drizzle-kit push) and
 * script/migrate-lead-messages.ts, migrate-outreach-safety.ts and migrate-mailbox.ts applied. Fresh organization ids per
 * case; only their rows are deleted. A non-loopback host is refused.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashDraft } from "@shared/outreach-hash";
import { loadKeyring } from "../mail/token-crypto";

const URL_ = process.env.MAILBOX_PG_TEST_URL;
const loopback = (u?: string) => { try { return !!u && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(u).hostname); } catch { return false; } };

describe.skipIf(!URL_ || !loopback(URL_))("a send's follow-up, durable and once (real Postgres)", () => {
  let store: typeof import("./message-store").messageStore;
  let sends: typeof import("../mail/send-store-pg").pgSendStore;
  let mailbox: typeof import("../mail/mailbox-store-pg").pgMailboxStore;
  let pg: any, q: any;
  const orgs: string[] = [];
  const keyring = loadKeyring({ MAILBOX_TOKEN_KEYS: `1:${randomBytes(32).toString("base64")}`, MAILBOX_TOKEN_KEY_CURRENT: "1" });

  beforeAll(async () => {
    process.env.DATABASE_URL = URL_!;
    store = (await import("./message-store")).messageStore;
    sends = (await import("../mail/send-store-pg")).pgSendStore;
    mailbox = (await import("../mail/mailbox-store-pg")).pgMailboxStore;
    ({ default: pg } = await import("pg"));
    q = new pg.Client({ connectionString: URL_ }); await q.connect();
  });
  afterAll(async () => {
    for (const o of orgs) for (const t of ["mail_send_jobs", "mailbox_connections", "outreach_events", "lead_tickets", "lead_events", "lead_messages", "leads", "users"]) await q.query(`DELETE FROM ${t} WHERE organization_id = $1`, [o]);
    await q?.end();
  });

  const now = () => new Date();
  /** A lead (stage `status`) with an approved message, in a fresh organization with one sales member. */
  async function seed(status = "new", opts: { archived?: boolean } = {}) {
    const org = `t-${randomBytes(5).toString("hex")}`; orgs.push(org);
    const user = `u-${randomBytes(5).toString("hex")}`;
    await q.query(`INSERT INTO users (id, email, organization_id, org_role, member_status) VALUES ($1, $2, $3, 'SALES', 'active')`, [user, `${user}@example.test`, org]);
    const lead = (await q.query(`INSERT INTO leads (organization_id, owner_user_id, company_name, domain, source, status, do_not_contact, archived_at, created_at, updated_at) VALUES ($1, $2, 'Acme', 'acme.test', 'outbound', $3, false, $4, now(), now()) RETURNING id`, [org, user, status, opts.archived ? new Date() : null])).rows[0].id;
    const hash = hashDraft("Hello", "Body text");
    const msg = (await q.query(`INSERT INTO lead_messages (lead_id, organization_id, direction, channel, subject, body, body_hash, to_address, to_source, status, claim_ids, created_by, created_at, updated_at) VALUES ($1, $2, 'out', 'manual', 'Hello', 'Body text', $3, 'jo@acme.test', 'site', 'approved', '[]', 'user', now(), now()) RETURNING id`, [lead, org, hash])).rows[0].id;
    return { org, user, lead, msg, hash };
  }
  type Seed = Awaited<ReturnType<typeof seed>>;
  const sentByHand = (s: Seed) => store.recordSentIfAllowed({ orgId: s.org, id: s.msg, now: now(), keys: [], outbox: { userId: s.user } });
  const count = async (sql: string, ...p: unknown[]) => (await q.query(sql, p)).rows[0].n as number;
  const tickets = (s: Seed) => count(`SELECT count(*)::int n FROM lead_tickets WHERE organization_id = $1 AND lead_id = $2 AND kind = 'follow_up'`, s.org, s.lead);
  const timeline = async (s: Seed) => (await q.query(`SELECT kind FROM lead_events WHERE organization_id = $1 AND lead_id = $2 ORDER BY id`, [s.org, s.lead])).rows.map((r: any) => r.kind);
  const marks = async (s: Seed) => (await q.query(`SELECT kind FROM outreach_events WHERE organization_id = $1 AND message_id = $2 ORDER BY id`, [s.org, s.msg])).rows.map((r: any) => r.kind);
  const leadStatus = async (s: Seed) => (await q.query(`SELECT status FROM leads WHERE id = $1`, [s.lead])).rows[0].status;

  it("recording a send by hand writes its outbox entry in the same transaction; finishing it does the work once", async () => {
    const s = await seed("new");
    expect((await sentByHand(s)).result).toBe("sent");
    expect(await marks(s)).toEqual(["sent", "follow_due"]);
    expect(await store.pendingAfterSend({ orgId: s.org, limit: 10 })).toEqual([{ orgId: s.org, messageId: s.msg }]);
    expect(await store.completeAfterSend({ orgId: s.org, messageId: s.msg, now: now() })).toMatchObject({ result: "done", movedTo: "contacted", ticketId: expect.any(Number) });
    expect(await leadStatus(s)).toBe("contacted");
    expect(await timeline(s)).toEqual(["message_sent", "status_changed", "status_changed", "ticket_created"]);
    expect(await tickets(s)).toBe(1);
    expect(await marks(s)).toEqual(["sent", "follow_due", "follow_done"]);
    expect(await store.completeAfterSend({ orgId: s.org, messageId: s.msg, now: now() })).toEqual({ result: "already" });
    expect(await tickets(s)).toBe(1);
    expect(await store.pendingAfterSend({ orgId: s.org, limit: 10 })).toEqual([]);
  });

  it("a crash after the send is recorded and before its follow-up: found by the repair pass and finished, once", async () => {
    const s = await seed("qualified");
    await sentByHand(s); // ...and the process dies here
    expect(await tickets(s)).toBe(0);
    const pending = await store.pendingAfterSend({ limit: 1000 });
    expect(pending).toContainEqual({ orgId: s.org, messageId: s.msg });
    for (const p of pending.filter((x) => x.orgId === s.org)) await store.completeAfterSend({ orgId: p.orgId, messageId: p.messageId, now: now() });
    expect(await tickets(s)).toBe(1);
    expect(await leadStatus(s)).toBe("contacted");
  });

  it("a crash in the middle of the follow-up (work written, not committed): nothing half-done remains; the retry does it all, once", async () => {
    const s = await seed("new");
    await sentByHand(s);
    await expect(store.completeAfterSend({ orgId: s.org, messageId: s.msg, now: now(), hold: async () => { throw new Error("process killed"); } })).rejects.toThrow("process killed");
    expect(await tickets(s)).toBe(0);
    expect(await timeline(s)).toEqual([]);
    expect(await leadStatus(s)).toBe("new");
    expect(await marks(s)).toEqual(["sent", "follow_due"]);
    expect((await store.completeAfterSend({ orgId: s.org, messageId: s.msg, now: now() })).result).toBe("done");
    expect(await tickets(s)).toBe(1);
    expect(await leadStatus(s)).toBe("contacted");
  });

  it("many completions at once (the sender, a retry, the repair sweep): exactly one does the work, no errors", async () => {
    for (let i = 0; i < 8; i++) {
      const s = await seed("new");
      await sentByHand(s);
      const rs = await Promise.all(Array.from({ length: 6 }, () => store.completeAfterSend({ orgId: s.org, messageId: s.msg, now: now() })));
      expect(rs.filter((r) => r.result === "done")).toHaveLength(1);
      expect(rs.filter((r) => r.result === "already")).toHaveLength(5);
      expect(await tickets(s)).toBe(1);
      expect((await timeline(s)).filter((k: string) => k === "message_sent")).toHaveLength(1);
    }
  });

  it("Gmail: a confirmed send writes the outbox entry with it; a person's 'it was sent' and Gmail's late confirmation together still follow up once", async () => {
    const s = await seed("new");
    const conn = await mailbox.save({ orgId: s.org, userId: s.user, provider: "fake", account: { sub: `sub-${s.user}`, email: "ana@agency.test" }, scopes: ["email", "openid", "https://www.googleapis.com/auth/gmail.send"], refreshToken: "rt", keyring, now: now() });
    if (!conn.ok) throw new Error(conn.code);
    const r = await sends.reserve({ orgId: s.org, userId: s.user, messageId: s.msg, expectedHash: s.hash, connectionId: conn.connection.id, provider: "fake", checkList: true, dailyCap: 50, now: now(), leaseMs: 1, newRfcMessageId: `<dis-${randomBytes(6).toString("hex")}@dealinsec.com>` });
    if (!r.ok) throw new Error(r.code);
    await new Promise((res) => setTimeout(res, 10));
    expect(await sends.recoverExpired({ orgId: s.org, now: now() })).toBe(1); // the worker went quiet: uncertain
    // the sender checks their Sent folder: it went
    expect(await sends.resolve({ orgId: s.org, jobId: r.job.id, decision: "sent", userId: s.user, now: now(), recordEvent: true })).toMatchObject({ won: true });
    // ...while Gmail's confirmation arrives late, and both sides try to finish the follow-up at once
    const [late, a, b] = await Promise.all([
      sends.finishSent({ orgId: s.org, jobId: r.job.id, attempt: 1, providerMessageId: "g-late", providerThreadId: null, now: now(), recordEvent: true }),
      store.completeAfterSend({ orgId: s.org, messageId: s.msg, now: now() }),
      store.completeAfterSend({ orgId: s.org, messageId: s.msg, now: now() }),
    ]);
    expect(late.won).toBe(false); // already settled as sent: no second record
    expect([a.result, b.result].sort()).toEqual(["already", "done"]);
    expect(await marks(s)).toEqual(["sent", "follow_due", "follow_done"]);
    expect(await tickets(s)).toBe(1);
    expect((await timeline(s))[0]).toBe("message_sent");
    expect((await q.query(`SELECT data FROM lead_events WHERE lead_id = $1 AND kind = 'message_sent'`, [s.lead])).rows[0].data).toMatchObject({ channel: "gmail_confirmed" });
  });

  it("Gmail: the provider's confirmation records the outbox entry atomically; a crash right after it is repaired once", async () => {
    const s = await seed("researching");
    const conn = await mailbox.save({ orgId: s.org, userId: s.user, provider: "fake", account: { sub: `sub-${s.user}`, email: "ana@agency.test" }, scopes: ["email", "openid", "https://www.googleapis.com/auth/gmail.send"], refreshToken: "rt", keyring, now: now() });
    if (!conn.ok) throw new Error(conn.code);
    const r = await sends.reserve({ orgId: s.org, userId: s.user, messageId: s.msg, expectedHash: s.hash, connectionId: conn.connection.id, provider: "fake", checkList: true, dailyCap: 50, now: now(), leaseMs: 60_000, newRfcMessageId: `<dis-${randomBytes(6).toString("hex")}@dealinsec.com>` });
    if (!r.ok) throw new Error(r.code);
    // two confirmations racing (a retried write): one records it
    const [x, y] = await Promise.all([1, 2].map(() => sends.finishSent({ orgId: s.org, jobId: r.job.id, attempt: 1, providerMessageId: "g1", providerThreadId: "t1", now: now(), recordEvent: true })));
    expect([x.won, y.won].sort()).toEqual([false, true]);
    expect(await marks(s)).toEqual(["sent", "follow_due"]); // ...the process dies before the follow-up
    expect(await store.pendingAfterSend({ orgId: s.org, limit: 5 })).toEqual([{ orgId: s.org, messageId: s.msg }]);
    expect((await store.completeAfterSend({ orgId: s.org, messageId: s.msg, now: now() })).result).toBe("done");
    expect(await tickets(s)).toBe(1);
    expect((await q.query(`SELECT data FROM lead_events WHERE lead_id = $1 AND kind = 'message_sent'`, [s.lead])).rows[0].data).toMatchObject({ channel: "gmail" });
  });

  it("nothing to do: not sent yet, a send recorded before the outbox existed, another organization; a closed lead gets no ticket but is marked done", async () => {
    const s = await seed("new");
    expect(await store.completeAfterSend({ orgId: s.org, messageId: s.msg, now: now() })).toEqual({ result: "not_sent" });
    const legacy = await seed("new");
    await store.recordSentIfAllowed({ orgId: legacy.org, id: legacy.msg, now: now(), keys: [], outbox: null });
    expect(await store.completeAfterSend({ orgId: legacy.org, messageId: legacy.msg, now: now() })).toEqual({ result: "not_due" });
    expect(await tickets(legacy)).toBe(0);
    const mine = await seed("new"), other = await seed("new");
    await sentByHand(mine);
    expect(await store.completeAfterSend({ orgId: other.org, messageId: mine.msg, now: now() })).toEqual({ result: "not_sent" });
    expect(await store.pendingAfterSend({ orgId: other.org, limit: 10 })).toEqual([]);
    const lost = await seed("lost");
    await sentByHand(lost);
    expect(await store.completeAfterSend({ orgId: lost.org, messageId: lost.msg, now: now() })).toMatchObject({ result: "done", movedTo: null, ticketId: null });
    expect(await tickets(lost)).toBe(0);
    expect(await leadStatus(lost)).toBe("lost");
    const archived = await seed("new", { archived: true });
    await sentByHand(archived);
    expect(await store.completeAfterSend({ orgId: archived.org, messageId: archived.msg, now: now() })).toMatchObject({ result: "done", ticketId: null });
    expect(await marks(archived)).toEqual(["sent", "follow_due", "follow_done"]);
  });

  it("follow-up completion and other operations on the same message and lead never deadlock", async () => {
    for (let i = 0; i < 10; i++) {
      const s = await seed("new");
      await sentByHand(s);
      const ops = await Promise.allSettled([
        store.completeAfterSend({ orgId: s.org, messageId: s.msg, now: now() }),
        q.query(`UPDATE leads SET do_not_contact = true WHERE id = $1`, [s.lead]),
        store.recordSentIfAllowed({ orgId: s.org, id: s.msg, now: now(), keys: [], outbox: { userId: s.user } }),
        store.completeAfterSend({ orgId: s.org, messageId: s.msg, now: now() }),
        store.addSuppression(s.org, { kind: "domain", value: "acme.test", reason: "manual", sourceMessageId: null, note: null, userId: null, now: now() }),
      ]);
      expect(ops.filter((o) => o.status === "rejected").map((o: any) => o.reason?.code ?? o.reason?.message)).toEqual([]);
      // At most one follow-up task; none when "do not contact" committed first (no follow-up for a lead we may not write to).
      const n = await tickets(s);
      expect(n).toBeLessThanOrEqual(1);
      const scheduled = (await q.query(`SELECT count(*)::int n FROM outreach_followups WHERE organization_id = $1 AND status = 'scheduled'`, [s.org]).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n;
      expect(scheduled).toBe(n);
    }
  });
});
