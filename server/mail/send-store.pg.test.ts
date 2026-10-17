/**
 * Reserving and settling Gmail sends against a REAL Postgres, with deterministic interleavings: one side holds its
 * locks (the store's `hold` hook, or an open transaction), the test waits until Postgres reports the other side blocked
 * on them (pg_locks), then lets go. Each case fails if the lock or conditional update it relies on is removed.
 *
 * Runs only with MAILBOX_PG_TEST_URL set to a disposable LOCAL database with the full schema (drizzle-kit push) and
 * script/migrate-lead-messages.ts, migrate-outreach-safety.ts and migrate-mailbox.ts applied. Every case uses a fresh
 * organization id and deletes only its own rows. A non-loopback host is refused.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashDraft } from "@shared/outreach-hash";
import { loadKeyring } from "./token-crypto";

const URL_ = process.env.MAILBOX_PG_TEST_URL;
const loopback = (u?: string) => { try { return !!u && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(u).hostname); } catch { return false; } };

describe.skipIf(!URL_ || !loopback(URL_))("Gmail send reservation (real Postgres)", () => {
  let sends: typeof import("./send-store-pg").pgSendStore;
  let mailbox: typeof import("./mailbox-store-pg").pgMailboxStore;
  let messages: typeof import("../sales/message-store").messageStore;
  let pg: any, q: any, watcher: any;
  const orgs: string[] = [];
  const keyring = loadKeyring({ MAILBOX_TOKEN_KEYS: `1:${randomBytes(32).toString("base64")}`, MAILBOX_TOKEN_KEY_CURRENT: "1" });
  const SUBJECT = "A quick idea", BODY = "Hi,\n\nShort note.\n\nAna";

  beforeAll(async () => {
    process.env.DATABASE_URL = URL_!;
    sends = (await import("./send-store-pg")).pgSendStore;
    mailbox = (await import("./mailbox-store-pg")).pgMailboxStore;
    messages = (await import("../sales/message-store")).messageStore;
    ({ default: pg } = await import("pg"));
    q = new pg.Client({ connectionString: URL_ }); await q.connect();
    watcher = new pg.Client({ connectionString: URL_ }); await watcher.connect();
  });
  afterAll(async () => {
    for (const o of orgs) for (const t of ["mail_send_jobs", "mailbox_connections", "outreach_events", "outreach_suppressions", "lead_messages", "leads", "users"]) await q.query(`DELETE FROM ${t} WHERE organization_id = $1`, [o]);
    await q?.end(); await watcher?.end();
  });

  const client = async () => { const c = new pg.Client({ connectionString: URL_ }); await c.connect(); return c; };
  /** Resolves once some backend waits for a lock. */
  async function blocked() {
    for (let i = 0; i < 300; i++) {
      if ((await watcher.query(`SELECT count(*)::int n FROM pg_locks WHERE NOT granted`)).rows[0].n > 0) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("nothing ever waited: the operations didn't contend");
  }
  const now = () => new Date();
  let seq = 0;
  /** An organization with a sales member, a connected mailbox, and `n` leads each with an approved message. */
  async function seed(n = 1, opts: { domain?: string } = {}) {
    const org = `t-${randomBytes(5).toString("hex")}`; orgs.push(org);
    const user = `u-${randomBytes(5).toString("hex")}`;
    await q.query(`INSERT INTO users (id, email, organization_id, org_role, member_status) VALUES ($1, $2, $3, 'SALES', 'active')`, [user, `${user}@example.test`, org]);
    const conn = await mailbox.save({ orgId: org, userId: user, provider: "fake", account: { sub: `sub-${user}`, email: `${user}@agency.test` }, scopes: ["email", "openid", "https://www.googleapis.com/auth/gmail.send"], refreshToken: "rt", keyring, now: now() });
    if (!conn.ok) throw new Error(conn.code);
    const msgs: { id: number; leadId: number; hash: string; to: string }[] = [];
    for (let i = 0; i < n; i++) {
      const to = `jo${++seq}@${opts.domain ?? "acme-foods.test"}`;
      const lead = (await q.query(`INSERT INTO leads (organization_id, owner_user_id, company_name, domain, source, status, do_not_contact, created_at, updated_at) VALUES ($1, $2, 'Acme', $3, 'outbound', 'qualified', false, now(), now()) RETURNING id`, [org, user, `d${seq}.test`])).rows[0].id;
      const hash = hashDraft(SUBJECT, BODY);
      const id = (await q.query(`INSERT INTO lead_messages (lead_id, organization_id, direction, channel, subject, body, body_hash, to_address, to_source, status, claim_ids, created_by, created_at, updated_at) VALUES ($1, $2, 'out', 'manual', $3, $4, $5, $6, 'site', 'approved', '[]', 'user', now(), now()) RETURNING id`, [lead, org, SUBJECT, BODY, hash, to])).rows[0].id;
      msgs.push({ id, leadId: lead, hash, to });
    }
    return { org, user, connId: conn.connection.id, msgs, m: msgs[0] };
  }
  type Seed = Awaited<ReturnType<typeof seed>>;
  const reserve = (s: Seed, m = s.m, extra: Partial<Parameters<typeof sends.reserve>[0]> = {}) =>
    sends.reserve({ orgId: s.org, userId: s.user, messageId: m.id, expectedHash: m.hash, connectionId: s.connId, provider: "fake", checkList: true, dailyCap: 50, now: now(), leaseMs: 60_000, newRfcMessageId: `<dis-${randomBytes(8).toString("hex")}@dealinsec.com>`, ...extra });
  /** A reservation that pauses holding every lock until released. */
  function held(s: Seed, m = s.m, extra: Partial<Parameters<typeof sends.reserve>[0]> = {}) {
    let release!: () => void, reached!: () => void;
    const at = new Promise<void>((r) => (reached = r));
    const done = reserve(s, m, { ...extra, hold: () => { reached(); return new Promise<void>((r) => (release = r)); } });
    return { at, done, release: () => release() };
  }
  const msgStatus = async (id: number) => (await q.query(`SELECT status FROM lead_messages WHERE id = $1`, [id])).rows[0].status;
  const jobs = async (org: string) => (await q.query(`SELECT * FROM mail_send_jobs WHERE organization_id = $1 ORDER BY id`, [org])).rows;

  it("reserve → sent: the job, the message and the event move together; a stale attempt or a second confirmation doesn't win", async () => {
    const s = await seed();
    const r = await reserve(s);
    if (!r.ok) throw new Error(r.code);
    expect(r.mail).toEqual({ subject: SUBJECT, body: BODY, to: s.m.to });
    expect(await msgStatus(s.m.id)).toBe("sending");
    expect(await sends.finishSent({ orgId: s.org, jobId: r.job.id, attempt: r.job.attempts + 1, providerMessageId: "g1", providerThreadId: "t1", now: now(), recordEvent: true })).toMatchObject({ won: false });
    expect(await sends.finishSent({ orgId: `other-${s.org}`, jobId: r.job.id, attempt: r.job.attempts, providerMessageId: "g1", providerThreadId: "t1", now: now(), recordEvent: true })).toMatchObject({ won: false, job: null });
    expect(await sends.finishSent({ orgId: s.org, jobId: r.job.id, attempt: r.job.attempts, providerMessageId: "g1", providerThreadId: "t1", now: now(), recordEvent: true })).toMatchObject({ won: true, job: { status: "sent", providerMessageId: "g1" } });
    expect(await sends.finishSent({ orgId: s.org, jobId: r.job.id, attempt: r.job.attempts, providerMessageId: "g1", providerThreadId: "t1", now: now(), recordEvent: true })).toMatchObject({ won: false });
    expect(await msgStatus(s.m.id)).toBe("sent");
    // the send and its follow-up's outbox entry, in the same transaction
    expect((await q.query(`SELECT kind, source, provider_message_id FROM outreach_events WHERE message_id = $1 ORDER BY id`, [s.m.id])).rows).toEqual([
      { kind: "sent", source: "provider", provider_message_id: "g1" }, { kind: "follow_due", source: "provider", provider_message_id: null },
    ]);
    expect(await reserve(s)).toMatchObject({ ok: false, code: "already_sent" });
    // the database itself refuses a "sent" with no proof
    await expect(q.query(`UPDATE mail_send_jobs SET status = 'sent', provider_message_id = NULL, resolved_by = NULL WHERE id = $1`, [r.job.id])).rejects.toMatchObject({ constraint: "mail_send_jobs_sent_ck" });
  });

  it("refused → approved again; retry is the next attempt with the same Message-ID; the stale attempt can't settle it", async () => {
    const s = await seed();
    const a = await reserve(s);
    if (!a.ok) throw new Error(a.code);
    expect(await sends.finishNotSent({ orgId: s.org, jobId: a.job.id, attempt: 1, status: "failed", code: "rejected", now: now() })).toBe(true);
    expect(await msgStatus(s.m.id)).toBe("approved");
    const b = await reserve(s);
    if (!b.ok) throw new Error(b.code);
    expect(b.job).toMatchObject({ id: a.job.id, attempts: 2, rfcMessageId: a.job.rfcMessageId, errorCode: null });
    expect(await sends.finishUncertain({ orgId: s.org, jobId: a.job.id, attempt: 1, code: "x", now: now() })).toBe(false);
    expect(await sends.finishNotSent({ orgId: s.org, jobId: a.job.id, attempt: 1, status: "failed", code: "x", now: now() })).toBe(false);
    expect((await jobs(s.org))[0].status).toBe("sending");
  });

  it("a lease that runs out becomes uncertain (never resent); a late confirmation still records it; a person can settle the rest", async () => {
    const s = await seed(2);
    const a = await reserve(s, s.msgs[0], { leaseMs: 1 });
    const b = await reserve(s, s.msgs[1], { leaseMs: 1 });
    if (!a.ok || !b.ok) throw new Error("reserve failed");
    await new Promise((r) => setTimeout(r, 15));
    expect(await sends.recoverExpired({ orgId: s.org, now: now() })).toBe(2);
    expect(await reserve(s, s.msgs[0])).toMatchObject({ ok: false, code: "in_flight" });
    expect(await sends.finishSent({ orgId: s.org, jobId: a.job.id, attempt: 1, providerMessageId: "late", providerThreadId: null, now: now(), recordEvent: true })).toMatchObject({ won: true });
    expect(await sends.resolve({ orgId: s.org, jobId: b.job.id, decision: "not_sent", userId: s.user, now: now(), recordEvent: true })).toMatchObject({ won: true, messageStatus: "approved", job: { status: "failed", errorCode: "resolved_not_sent", resolvedBy: s.user } });
    expect(await sends.resolve({ orgId: s.org, jobId: b.job.id, decision: "sent", userId: s.user, now: now(), recordEvent: true })).toMatchObject({ won: false });
  });

  it("on a server ahead of UTC (IST): a fresh lease isn't recovered early, and a send 20 hours ago still counts toward the daily cap", async () => {
    // node-postgres sends a Date in the process's local time; drizzle stores timestamps as UTC wall-clock.
    const tz = process.env.TZ;
    process.env.TZ = "Asia/Kolkata";
    try {
      expect(new Date().getTimezoneOffset()).toBe(-330);
      const s = await seed(2);
      const a = await reserve(s, s.msgs[0]); // a 60s lease
      if (!a.ok) throw new Error("reserve failed");
      expect(await sends.recoverExpired({ orgId: s.org, now: now() })).toBe(0);
      expect((await jobs(s.org))[0].status).toBe("sending");
      expect(await sends.recoverExpired({ orgId: s.org, now: new Date(Date.now() + 120_000) })).toBe(1);
      await sends.resolve({ orgId: s.org, jobId: a.job.id, decision: "sent", userId: s.user, now: new Date(Date.now() - 20 * 3_600_000), recordEvent: false });
      expect(await reserve(s, s.msgs[1], { dailyCap: 1 })).toMatchObject({ ok: false, code: "daily_cap" });
    } finally {
      if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz;
    }
  });

  it("two reservations of the same message at once: exactly one, never an error, one job row", async () => {
    for (let i = 0; i < 10; i++) {
      const s = await seed();
      const rs = await Promise.all([reserve(s), reserve(s), reserve(s)]);
      expect(rs.filter((r) => r.ok)).toHaveLength(1);
      expect(rs.filter((r) => !r.ok).map((r: any) => r.code)).toEqual(["in_flight", "in_flight"]);
      expect(await jobs(s.org)).toHaveLength(1);
    }
  });

  it("the send holds its locks: a do-not-contact entry for the address or the domain waits, and is added after the send", async () => {
    for (const k of [0, 1]) {
      const s = await seed(1, { domain: `later${k}.test` });
      const h = held(s); await h.at;
      const add = messages.addSuppression(s.org, { kind: k ? "domain" : "email", value: k ? `later${k}.test` : s.m.to, reason: "opt_out", sourceMessageId: null, note: null, userId: null, now: now() });
      await blocked();
      h.release();
      expect((await h.done).ok).toBe(true);
      expect((await add).created).toBe(true);
    }
  });

  it("the entry first (its key locked, committed while the send waits): the send is refused", async () => {
    for (const k of [0, 1]) {
      const s = await seed(1, { domain: `first${k}.test` });
      const c = await client();
      const key = k ? { kind: "domain", value: `first${k}.test` } : { kind: "email", value: s.m.to };
      await c.query("BEGIN");
      await c.query(`SELECT pg_advisory_xact_lock($1::int, hashtext($2))`, [7_310_030, `${s.org}|${key.kind}:${key.value}`]);
      await c.query(`INSERT INTO outreach_suppressions (organization_id, kind, value, reason, created_at) VALUES ($1, $2, $3, 'opt_out', now())`, [s.org, key.kind, key.value]);
      const send = reserve(s);
      await blocked(); await c.query("COMMIT"); await c.end();
      expect(await send).toMatchObject({ ok: false, code: "suppressed", entry: { kind: key.kind } });
      expect(await msgStatus(s.m.id)).toBe("approved");
    }
  });

  it("the lead flagged do-not-contact while the send waits: refused", async () => {
    const s = await seed();
    const c = await client();
    await c.query("BEGIN"); await c.query(`UPDATE leads SET do_not_contact = true WHERE id = $1`, [s.m.leadId]);
    const send = reserve(s);
    await blocked(); await c.query("COMMIT"); await c.end();
    expect(await send).toMatchObject({ ok: false, code: "do_not_contact" });
  });

  it("the member removed (or the mailbox disconnected) while the send waits: refused", async () => {
    const a = await seed();
    const c = await client();
    await c.query("BEGIN"); await c.query(`UPDATE users SET member_status = 'removed' WHERE id = $1`, [a.user]);
    const send = reserve(a);
    await blocked(); await c.query("COMMIT");
    expect(await send).toMatchObject({ ok: false, code: "not_member" });
    const b = await seed();
    await c.query("BEGIN"); await c.query(`UPDATE mailbox_connections SET status = 'disconnected', refresh_token_enc = NULL, token_key_version = NULL WHERE id = $1`, [b.connId]);
    const send2 = reserve(b);
    await blocked(); await c.query("COMMIT"); await c.end();
    expect(await send2).toMatchObject({ ok: false, code: "mailbox_unavailable" });
    // and the demoted sender, re-read inside the transaction
    const d = await seed();
    await q.query(`UPDATE users SET org_role = 'ACCOUNTS' WHERE id = $1`, [d.user]);
    expect(await reserve(d)).toMatchObject({ ok: false, code: "not_allowed" });
  });

  it("two messages racing for the mailbox's last daily slot: the second waits on the mailbox and is refused", async () => {
    const s = await seed(2);
    const h = held(s, s.msgs[0], { dailyCap: 1 }); await h.at;
    const second = reserve(s, s.msgs[1], { dailyCap: 1 });
    await blocked();
    h.release();
    expect((await h.done).ok).toBe(true);
    expect(await second).toMatchObject({ ok: false, code: "daily_cap" });
  });

  it("the plan's send allowance: two teammates' mailboxes racing for the workspace's last send; the second waits and is refused", async () => {
    const s = await seed(1);
    // A second member of the same workspace, with their own mailbox and their own approved message.
    const ben = `u-${randomBytes(5).toString("hex")}`;
    await q.query(`INSERT INTO users (id, email, organization_id, org_role, member_status) VALUES ($1, $2, $3, 'SALES', 'active')`, [ben, `${ben}@example.test`, s.org]);
    const conn = await mailbox.save({ orgId: s.org, userId: ben, provider: "fake", account: { sub: `sub-${ben}`, email: `${ben}@agency.test` }, scopes: ["email", "openid", "https://www.googleapis.com/auth/gmail.send"], refreshToken: "rt", keyring, now: now() });
    if (!conn.ok) throw new Error(conn.code);
    const lead = (await q.query(`INSERT INTO leads (organization_id, owner_user_id, company_name, domain, source, status, do_not_contact, created_at, updated_at) VALUES ($1, $2, 'Acme', $3, 'outbound', 'qualified', false, now(), now()) RETURNING id`, [s.org, ben, `ben${seq}.test`])).rows[0].id;
    const hash = hashDraft(SUBJECT, BODY);
    const id = (await q.query(`INSERT INTO lead_messages (lead_id, organization_id, direction, channel, subject, body, body_hash, to_address, to_source, status, claim_ids, created_by, created_at, updated_at) VALUES ($1, $2, 'out', 'manual', $3, $4, $5, $6, 'site', 'approved', '[]', 'user', now(), now()) RETURNING id`, [lead, s.org, SUBJECT, BODY, hash, `ben-target${seq}@acme-foods.test`])).rows[0].id;
    const planCap = { since: new Date(now().getTime() - 30 * 86_400_000), max: 1 };
    const h = held(s, s.m, { planCap }); await h.at;
    const second = sends.reserve({ orgId: s.org, userId: ben, messageId: id, expectedHash: hash, connectionId: conn.connection.id, provider: "fake", checkList: true, dailyCap: 50, planCap, now: now(), leaseMs: 60_000, newRfcMessageId: `<dis-${randomBytes(8).toString("hex")}@dealinsec.com>` });
    await blocked();
    h.release();
    expect((await h.done).ok).toBe(true);
    expect(await second).toMatchObject({ ok: false, code: "plan_send_limit" });
    expect(await msgStatus(id)).toBe("approved"); // nothing reserved for the refused one
  });

  it("'I sent it' (by hand) against a Gmail send of the same message: exactly one wins, in either order", async () => {
    const s = await seed();
    const h = held(s); await h.at;
    const manual = messages.recordSentIfAllowed({ orgId: s.org, id: s.m.id, now: now(), keys: [] });
    await blocked();
    h.release();
    expect((await h.done).ok).toBe(true);
    expect(await manual).toMatchObject({ result: "not_approved", row: { status: "sending" } });
    const t = await seed();
    let release!: () => void, reached!: () => void;
    const at = new Promise<void>((r) => (reached = r));
    const manual2 = messages.recordSentIfAllowed({ orgId: t.org, id: t.m.id, now: now(), keys: [], hold: () => { reached(); return new Promise<void>((r) => (release = r)); } });
    await at;
    const gmail = reserve(t);
    await blocked();
    release();
    expect(await manual2).toMatchObject({ result: "sent" });
    expect(await gmail).toMatchObject({ ok: false, code: "already_sent" });
    expect(await jobs(t.org)).toHaveLength(0);
  });

  it("only exactly-sendable approved text: a carriage return, a control character or a two-line subject is refused, even with a matching hash", async () => {
    for (const [subject, body] of [["Hello", "One\rTwo"], ["Hello", "Bell\u0007"], ["Two\nlines", "Body"]]) {
      const s = await seed();
      const hash = hashDraft(subject, body);
      await q.query(`UPDATE lead_messages SET subject = $1, body = $2, body_hash = $3 WHERE id = $4`, [subject, body, hash, s.m.id]);
      expect(await reserve(s, { ...s.m, hash })).toMatchObject({ ok: false, code: "invalid_content" });
      expect(await jobs(s.org)).toHaveLength(0);
    }
  });

  it("another organization can't reserve, settle or see it", async () => {
    const s = await seed(), other = await seed();
    expect(await reserve({ ...other, connId: other.connId }, s.m)).toMatchObject({ ok: false, code: "not_found" });
    const r = await reserve(s);
    if (!r.ok) throw new Error(r.code);
    expect(await sends.jobFor(other.org, s.m.id)).toBeNull();
    expect(await sends.resolve({ orgId: other.org, jobId: r.job.id, decision: "sent", userId: other.user, now: now(), recordEvent: true })).toMatchObject({ won: false, job: null });
    expect(await sends.recoverExpired({ orgId: other.org, now: new Date(Date.now() + 3_600_000) })).toBe(0);
    expect((await jobs(s.org))[0].status).toBe("sending");
  });

  it("the whole pipeline on Postgres with the fake provider: sent once, follow-up once; an uncertain send settled by its sender", async () => {
    const { sendApproved, resolveSend } = await import("./send-service");
    const { FakeMailProvider } = await import("./fake-provider");
    const { resolveGmailConfig } = await import("./config");
    const { createHash } = await import("node:crypto");
    const s = await seed(2);
    const fake = new FakeMailProvider({ account: { sub: `sub-${s.user}`, email: `${s.user}@agency.test`, emailVerified: true } });
    const env = { GMAIL_INTEGRATION_ENABLED: "true", MAIL_PROVIDER: "fake", NODE_ENV: "test", GMAIL_OAUTH_REDIRECT_URI: "http://localhost:5072/api/integrations/gmail/callback", MAILBOX_TOKEN_KEYS: "", MAILBOX_TOKEN_KEY_CURRENT: "1" };
    // a live fake grant, stored through the real mailbox store (reconnect of the seeded account)
    const verifier = "v".repeat(50);
    const url = fake.authorizationUrl({ state: "s", codeChallenge: createHash("sha256").update(verifier).digest("base64url"), nonce: "n", redirectUri: env.GMAIL_OAUTH_REDIRECT_URI });
    const grant = await fake.exchangeCode({ code: new URL(url).searchParams.get("code")!, codeVerifier: verifier, redirectUri: env.GMAIL_OAUTH_REDIRECT_URI, nonce: "n" });
    await mailbox.save({ orgId: s.org, userId: s.user, provider: "fake", account: { sub: `sub-${s.user}`, email: `${s.user}@agency.test` }, scopes: grant.scopes, refreshToken: grant.refreshToken, keyring, now: now() });
    const after: number[] = [];
    const config = resolveGmailConfig({ ...env, MAILBOX_TOKEN_KEYS: `1:${randomBytes(32).toString("base64")}` }); // its keys are replaced by the test keyring below
    if (!config.enabled) throw new Error("config");
    const deps = {
      status: async () => ({ enabled: true as const, config: { ...config.config, keyring } }), provider: () => fake, mailbox, sends, now, sleep: async () => {}, random: () => 0.5,
      listReady: async () => true, afterSent: async (_a: any, i: any) => { after.push(i.messageId); }, leadEvent: async () => {}, isActiveMember: async () => true, log: () => {},
    };
    const ana = { id: s.user, organizationId: s.org, memberStatus: "active", orgRole: "SALES" };
    const [first, second] = await Promise.all([sendApproved(ana, s.msgs[0].id, s.msgs[0].hash, deps), sendApproved(ana, s.msgs[0].id, s.msgs[0].hash, deps)]);
    expect([first, second].map((r: any) => (r.ok ? r.outcome : r.code)).sort()).toEqual(["in_flight", "sent"]);
    expect(fake.outbox).toHaveLength(1);
    expect(await msgStatus(s.msgs[0].id)).toBe("sent");
    fake.failNext("send", "uncertain", { delivered: true });
    expect(await sendApproved(ana, s.msgs[1].id, s.msgs[1].hash, deps)).toMatchObject({ ok: true, outcome: "uncertain" });
    expect(await msgStatus(s.msgs[1].id)).toBe("sending");
    expect(await resolveSend(ana, s.msgs[1].id, { decision: "sent" }, deps)).toMatchObject({ ok: true, messageStatus: "sent" });
    expect(after).toEqual([s.msgs[0].id, s.msgs[1].id]);
    expect((await q.query(`SELECT kind, source FROM outreach_events WHERE organization_id = $1 ORDER BY id`, [s.org])).rows).toEqual([
      { kind: "sent", source: "provider" }, { kind: "follow_due", source: "provider" }, { kind: "sent", source: "manual" }, { kind: "follow_due", source: "manual" },
    ]);
  });

  /**
   * The real Gmail adapter on Postgres, with Google stubbed (no request leaves the machine): `answer(n)` is Google's
   * reply to the n-th send, after `delayMs`. Returns the deps for sendApproved and the sends Google received.
   */
  async function gmailPipeline(s: Seed, answer: (n: number) => Response | Promise<Response>, opts: { delayMs?: number; cap?: string } = {}) {
    const { GmailProvider, GOOGLE_TOKEN_URL, GMAIL_SEND_URL } = await import("./gmail-provider");
    const { resolveGmailConfig } = await import("./config");
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    const received: string[] = [];
    const fetchImpl = (async (url: any, init: any) => {
      if (String(url) === GOOGLE_TOKEN_URL) return json(200, { access_token: "ya29.pg", expires_in: 3599, token_type: "Bearer", scope: "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.send" });
      if (String(url) !== GMAIL_SEND_URL) throw new Error(`unexpected request to ${url}`);
      received.push(JSON.parse(init.body).raw);
      const n = received.length;
      return new Promise<Response>((resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal.reason));
        setTimeout(() => Promise.resolve().then(() => answer(n)).then(resolve, reject), opts.delayMs ?? 0);
      });
    }) as unknown as typeof fetch;
    const gmail = new GmailProvider({ clientId: "1-a.apps.googleusercontent.com", clientSecret: "s", fetchImpl, sendingEnabled: true, sendTimeoutMs: 100 });
    const saved = await mailbox.save({ orgId: s.org, userId: s.user, provider: "gmail", account: { sub: `gsub-${s.user}`, email: `${s.user}@agency.test` }, scopes: ["email", "openid", "https://www.googleapis.com/auth/gmail.send"], refreshToken: "1//rt", keyring, now: now() });
    if (!saved.ok) throw new Error(saved.code);
    const config = resolveGmailConfig({ GMAIL_INTEGRATION_ENABLED: "true", MAIL_PROVIDER: "fake", NODE_ENV: "test", GMAIL_OAUTH_REDIRECT_URI: "http://localhost:5072/api/integrations/gmail/callback", MAILBOX_TOKEN_KEYS: `1:${randomBytes(32).toString("base64")}`, MAILBOX_TOKEN_KEY_CURRENT: "1", MAIL_SEND_DAILY_CAP: opts.cap });
    if (!config.enabled) throw new Error("config");
    const after: number[] = [];
    const deps = {
      status: async () => ({ enabled: true as const, config: { ...config.config, keyring } }), provider: () => gmail, mailbox, sends, now, sleep: async () => {}, random: () => 0.5,
      listReady: async () => true, afterSent: async (_a: any, i: any) => { after.push(i.messageId); }, leadEvent: async () => {}, isActiveMember: async () => true, log: () => {},
    };
    const member = { id: s.user, organizationId: s.org, memberStatus: "active", orgRole: "SALES" };
    return { deps, member, received, after, connId: saved.connection.id };
  }
  const outcomes = (rs: any[]) => rs.map((r) => (r.ok ? r.outcome : r.code)).sort();

  it("real adapter: six simultaneous sends of one message while Gmail is slow reach Gmail once; recorded once, follow-up once", async () => {
    const { sendApproved } = await import("./send-service");
    const s = await seed(1);
    const g = await gmailPipeline(s, () => new Response(JSON.stringify({ id: "pg1", threadId: "pg1" }), { status: 200 }), { delayMs: 40 });
    const rs = await Promise.all(Array.from({ length: 6 }, () => sendApproved(g.member, s.m.id, s.m.hash, g.deps)));
    expect(outcomes(rs)).toEqual(["in_flight", "in_flight", "in_flight", "in_flight", "in_flight", "sent"]);
    expect(g.received).toHaveLength(1);
    const [job] = await jobs(s.org);
    expect(job).toMatchObject({ status: "sent", provider_message_id: "pg1", attempts: 1, connection_id: g.connId });
    expect(await msgStatus(s.m.id)).toBe("sent");
    expect(g.after).toEqual([s.m.id]);
    expect((await q.query(`SELECT kind FROM outreach_events WHERE organization_id = $1 ORDER BY id`, [s.org])).rows.map((r: any) => r.kind)).toEqual(["sent", "follow_due"]);
    expect(Buffer.from(g.received[0], "base64url").toString("utf8")).toContain(`Message-ID: ${job.rfc_message_id}`);
  });

  it("real adapter: a 5xx or a timeout is stored as uncertain; later sends (even all at once, even after the lease) never reach Gmail", async () => {
    const { sendApproved, resolveSend, SEND_LEASE_MS } = await import("./send-service");
    for (const answer of [() => new Response("{}", { status: 500 }), () => new Promise<Response>(() => {})]) {
      const s = await seed(1);
      const g = await gmailPipeline(s, answer);
      expect(await sendApproved(g.member, s.m.id, s.m.hash, g.deps)).toMatchObject({ ok: true, outcome: "uncertain" });
      expect((await jobs(s.org))[0]).toMatchObject({ status: "uncertain", error_code: "provider_uncertain" });
      expect(await msgStatus(s.m.id)).toBe("sending");
      const later = { ...g.deps, now: () => new Date(Date.now() + SEND_LEASE_MS * 2) };
      expect(outcomes(await Promise.all([1, 2, 3].map(() => sendApproved(g.member, s.m.id, s.m.hash, later))))).toEqual(["in_flight", "in_flight", "in_flight"]);
      expect(g.received).toHaveLength(1);
      expect(g.after).toEqual([]);
      expect(await resolveSend(g.member, s.m.id, { decision: "not_sent" }, g.deps)).toMatchObject({ ok: true, messageStatus: "approved" });
    }
  });

  it("real adapter: Gmail refuses (400): approved again; the deliberate retry is attempt 2 with the same Message-ID", async () => {
    const { sendApproved } = await import("./send-service");
    const s = await seed(1);
    const g = await gmailPipeline(s, (n) => (n === 1 ? new Response(JSON.stringify({ error: { code: 400, errors: [{ reason: "invalidArgument" }] } }), { status: 400 }) : new Response(JSON.stringify({ id: "pg2" }), { status: 200 })));
    expect(await sendApproved(g.member, s.m.id, s.m.hash, g.deps)).toMatchObject({ ok: true, outcome: "failed" });
    expect(await msgStatus(s.m.id)).toBe("approved");
    expect(await sendApproved(g.member, s.m.id, s.m.hash, g.deps)).toMatchObject({ ok: true, outcome: "sent" });
    const [job] = await jobs(s.org);
    expect(job).toMatchObject({ status: "sent", attempts: 2, provider_message_id: "pg2" });
    const ids = g.received.map((raw) => /Message-ID: (\S+)/.exec(Buffer.from(raw, "base64url").toString("utf8"))![1]);
    expect(ids).toEqual([job.rfc_message_id, job.rfc_message_id]);
  });

  it("real adapter: three messages racing for the mailbox's last daily slot: Gmail is asked once", async () => {
    const { sendApproved } = await import("./send-service");
    const s = await seed(3);
    const g = await gmailPipeline(s, (n) => new Response(JSON.stringify({ id: `cap${n}` }), { status: 200 }), { delayMs: 30, cap: "1" });
    const rs = await Promise.all(s.msgs.map((m) => sendApproved(g.member, m.id, m.hash, g.deps)));
    expect(outcomes(rs)).toEqual(["daily_cap", "daily_cap", "sent"]);
    expect(g.received).toHaveLength(1);
  });

  it("a storm of competing operations on the same messages never deadlocks", async () => {
    for (let i = 0; i < 12; i++) {
      const s = await seed(2);
      const first = await reserve(s, s.msgs[0], { leaseMs: 1 });
      if (!first.ok) throw new Error(first.code);
      await new Promise((r) => setTimeout(r, 3));
      const ops = await Promise.allSettled([
        sends.finishSent({ orgId: s.org, jobId: first.job.id, attempt: 1, providerMessageId: `p${i}`, providerThreadId: null, now: now(), recordEvent: true }),
        reserve(s, s.msgs[0]),
        sends.recoverExpired({ orgId: s.org, now: now() }),
        sends.resolve({ orgId: s.org, jobId: first.job.id, decision: "not_sent", userId: s.user, now: now(), recordEvent: true }),
        messages.recordSentIfAllowed({ orgId: s.org, id: s.msgs[0].id, now: now(), keys: [] }),
        reserve(s, s.msgs[1], { dailyCap: 1 }),
        messages.recordSentIfAllowed({ orgId: s.org, id: s.msgs[1].id, now: now(), keys: [] }),
        messages.addSuppression(s.org, { kind: "domain", value: "acme-foods.test", reason: "manual", sourceMessageId: null, note: null, userId: null, now: now() }),
        q.query(`UPDATE leads SET do_not_contact = true WHERE id = $1`, [s.msgs[1].leadId]),
      ]);
      const errors = ops.filter((o) => o.status === "rejected").map((o: any) => o.reason?.code ?? o.reason?.message);
      expect(errors).toEqual([]); // no deadlock (40P01), no constraint error
      const m0 = await msgStatus(s.msgs[0].id);
      const job = (await jobs(s.org)).find((j: any) => j.message_id === s.msgs[0].id);
      if (job.status === "sent") expect(m0).toBe("sent"); // (a message may be sent by hand after its Gmail attempt was settled as not sent)
      if (job.status === "sending" || job.status === "uncertain") expect(m0).toBe("sending");
    }
  }, 60_000);
});
