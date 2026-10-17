/**
 * Reply sync against a REAL Postgres: the lease, the fenced cursor, idempotent message writes under concurrency,
 * thread adoption, organization isolation, the tables' checks, purging, and one full sync pass (fake mailbox,
 * Postgres stores). Also the migration on a scratch schema.
 *
 * Runs only with MAILBOX_PG_TEST_URL set to a disposable LOCAL database with the full schema (drizzle-kit push) and
 * the outreach, mailbox and reply-sync migrations applied. Every case uses fresh organization ids and deletes only its
 * own rows. A non-loopback host is refused.
 */
import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveGmailConfig, type GmailStatus } from "./config";
import { FakeMailProvider } from "./fake-provider";
import { GMAIL_READONLY_SCOPE, REPLY_SYNC_SCOPES } from "./provider";
import type { StoreMessageInput } from "./sync-store";
import { loadKeyring } from "./token-crypto";

const URL_ = process.env.MAILBOX_PG_TEST_URL;
const loopback = (u?: string) => { try { return !!u && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(u).hostname); } catch { return false; } };

describe.skipIf(!URL_ || !loopback(URL_))("reply sync (real Postgres)", () => {
  let store: typeof import("./sync-store-pg").pgSyncStore;
  let mailbox: typeof import("./mailbox-store-pg").pgMailboxStore;
  let sync: typeof import("./sync-service");
  let schema: typeof import("./mail-sync-schema");
  let pg: any, q: any;
  const orgs: string[] = [];
  const scratchSchemas: string[] = [];
  const KEYS = { MAILBOX_TOKEN_KEYS: `1:${randomBytes(32).toString("base64")}`, MAILBOX_TOKEN_KEY_CURRENT: "1" };
  const keyring = loadKeyring(KEYS);
  const now = () => new Date();

  beforeAll(async () => {
    process.env.DATABASE_URL = URL_!;
    store = (await import("./sync-store-pg")).pgSyncStore;
    mailbox = (await import("./mailbox-store-pg")).pgMailboxStore;
    sync = await import("./sync-service");
    schema = await import("./mail-sync-schema");
    ({ default: pg } = await import("pg"));
    q = new pg.Client({ connectionString: URL_ }); await q.connect();
  });
  afterAll(async () => {
    for (const o of orgs) for (const t of ["mail_messages", "mail_threads", "mail_sync_state", "mail_send_jobs", "mailbox_connections", "lead_messages", "leads", "users"]) await q.query(`DELETE FROM ${t} WHERE organization_id = $1`, [o]);
    for (const s of scratchSchemas) await q.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);
    await q?.end();
  });

  /** An organization with a member whose mailbox is connected (with read access), and one lead with sent outreach. */
  async function seed(opts: { scopes?: readonly string[]; to?: string } = {}) {
    const org = `t-${randomBytes(5).toString("hex")}`; orgs.push(org);
    const user = `u-${randomBytes(5).toString("hex")}`;
    await q.query(`INSERT INTO users (id, email, organization_id, org_role, member_status) VALUES ($1, $2, $3, 'SALES', 'active')`, [user, `${user}@example.test`, org]);
    const fake = new FakeMailProvider({ account: { sub: `g-${user}`, email: `${user}@agency.test`, emailVerified: true } });
    const verifier = "v".repeat(50);
    const url = fake.authorizationUrl({ scopes: opts.scopes ?? REPLY_SYNC_SCOPES, state: "s", codeChallenge: createHash("sha256").update(verifier).digest("base64url"), nonce: "n", redirectUri: "http://localhost/cb" });
    const grant = await fake.exchangeCode({ code: new URL(url).searchParams.get("code")!, codeVerifier: verifier, redirectUri: "http://localhost/cb", nonce: "n" });
    const conn = await mailbox.save({ orgId: org, userId: user, provider: "fake", account: { sub: `g-${user}`, email: `${user}@agency.test` }, scopes: grant.scopes, refreshToken: grant.refreshToken, keyring, now: now() });
    if (!conn.ok) throw new Error(conn.code);
    const to = opts.to ?? `jo-${randomBytes(3).toString("hex")}@acme.test`;
    const lead = (await q.query(`INSERT INTO leads (organization_id, owner_user_id, company_name, domain, source, status, do_not_contact, created_at, updated_at) VALUES ($1, $2, 'Acme', $3, 'outbound', 'contacted', false, now(), now()) RETURNING id`, [org, user, `${org}.test`])).rows[0].id;
    const msg = (await q.query(`INSERT INTO lead_messages (lead_id, organization_id, direction, channel, subject, body, body_hash, to_address, to_source, status, claim_ids, created_by, approved_by, approved_at, sent_at, created_at, updated_at) VALUES ($1, $2, 'out', 'manual', 'A quick idea', 'Hi', 'h', $3, 'site', 'sent', '[]', 'user', $4, now(), now(), now(), now()) RETURNING id`, [lead, org, to, user])).rows[0].id;
    return { org, user, connId: conn.connection.id, lead, msg, to, fake };
  }
  const message = (s: Awaited<ReturnType<typeof seed>>, o: Partial<StoreMessageInput> = {}): StoreMessageInput => ({
    orgId: s.org, connectionId: s.connId, providerMessageId: `m-${randomBytes(4).toString("hex")}`, providerThreadId: "t-1",
    link: { leadId: s.lead, leadMessageId: s.msg, toAddress: s.to }, adoptThread: { source: "adopted" }, linked: true,
    direction: "in", kind: "reply", match: "thread", review: null, fromAddress: s.to, fromName: "Jo", to: ["ana@agency.test"],
    subject: "Re: A quick idea", bodyText: "Yes", bodyTrimmed: false, rfcMessageId: "<r1@acme.test>", inReplyTo: null, sentAt: now(), now: now(), ...o,
  });

  it("the migration on an empty schema: creates, then changes nothing; the presence check agrees", async () => {
    const s = `mbx_sync_${randomBytes(4).toString("hex")}`; scratchSchemas.push(s);
    const c = new pg.Client({ connectionString: URL_ }); await c.connect();
    await c.query(`CREATE SCHEMA ${s}`); await c.query(`SET search_path TO ${s}`);
    const exec = (t: string, p?: unknown[]) => c.query(t, p as any[]);
    expect(await schema.mailSyncSchemaPresent(exec)).toMatchObject({ ok: false });
    expect((await schema.runMailSyncMigration(exec)).created).toEqual(["mail_sync_state", "mail_threads", "mail_messages", "outreach_followups"]);
    expect(await schema.runMailSyncMigration(exec)).toMatchObject({ created: [], addedColumns: [], createdIndexes: [] });
    expect(await schema.mailSyncSchemaPresent(exec)).toEqual({ ok: true });
    await c.end();
  });

  it("the migration upgrades an earlier version in place: new nullable/defaulted columns added, rows kept; a required one refused", async () => {
    const s = `mbx_up_${randomBytes(4).toString("hex")}`; scratchSchemas.push(s);
    const c = new pg.Client({ connectionString: URL_ }); await c.connect();
    await c.query(`CREATE SCHEMA ${s}`); await c.query(`SET search_path TO ${s}`);
    const exec = (t: string, p?: unknown[]) => c.query(t, p as any[]);
    await schema.runMailSyncMigration(exec);
    // Back to the first release's shape, with a row in it.
    await c.query(`ALTER TABLE mail_threads DROP COLUMN status, DROP COLUMN status_at`);
    await c.query(`ALTER TABLE mail_messages DROP COLUMN classification, DROP COLUMN classified_by, DROP COLUMN classifier_version, DROP COLUMN body_removed_at`);
    await c.query(`DROP TABLE outreach_followups`);
    await c.query(`INSERT INTO mail_threads (organization_id, connection_id, provider_thread_id, lead_id, lead_message_id, source, created_at, updated_at) VALUES ('o', 1, 't', 1, 1, 'adopted', now(), now())`);
    expect(await schema.mailSyncSchemaPresent(exec)).toMatchObject({ ok: false });
    const r = await schema.runMailSyncMigration(exec);
    expect(r.created).toEqual(["outreach_followups"]);
    expect(r.addedColumns.sort()).toEqual(["mail_messages.body_removed_at", "mail_messages.classification", "mail_messages.classified_by", "mail_messages.classifier_version", "mail_threads.status", "mail_threads.status_at"]);
    expect((await c.query(`SELECT status FROM mail_threads`)).rows).toEqual([{ status: "awaiting" }]);
    expect(await schema.mailSyncSchemaPresent(exec)).toEqual({ ok: true });
    // A NOT NULL column without a default can't be added to rows that exist: that is a conflict, and nothing changes.
    const { compareMailboxSchema } = await import("./mailbox-schema");
    const spec = [{ ...schema.MAIL_SYNC_TABLES[1], columns: [...schema.MAIL_SYNC_TABLES[1].columns, ["required_x", "integer NOT NULL"] as [string, string]] }];
    const snap = { relkind: "r", columns: [], primaryKey: "PRIMARY KEY (id)", checks: {}, indexes: [] };
    const exp = { mail_threads: { ...snap, columns: spec[0].columns.map(([n, d]) => ({ name: n, type: d.split(" ")[0], notNull: /NOT NULL|PRIMARY/.test(d), default: /DEFAULT/.test(d) ? "x" : null })) } };
    expect(compareMailboxSchema({ expected: exp as any, actual: { mail_threads: { ...snap, columns: [] } as any }, names: [], final: false, tables: spec as any }).filter((p) => p.includes("required_x"))).toEqual(["mail_threads.required_x: column missing"]);
    await c.end();
  });

  it("one lease at a time: concurrent claims give exactly one owner; a stale owner can't move the cursor or finish", async () => {
    const s = await seed();
    const claims = await Promise.all(Array.from({ length: 6 }, (_, i) => store.claim({ orgId: s.org, connectionId: s.connId, owner: `o${i}`, now: now(), leaseMs: 60_000, force: true })));
    expect(claims.filter(Boolean)).toHaveLength(1);
    const winner = `o${claims.findIndex(Boolean)}`;
    expect(await store.checkpoint({ connectionId: s.connId, owner: "someone-else", historyId: "999", now: now(), leaseMs: 60_000 })).toBe(false);
    expect(await store.checkpoint({ connectionId: s.connId, owner: winner, historyId: "100", now: now(), leaseMs: 60_000 })).toBe(true);
    await store.finish({ connectionId: s.connId, owner: "someone-else", now: now(), outcome: { ok: true, historyId: "5", bootstrapped: true, nextRunAt: now() } });
    expect((await store.state(s.org, s.connId))!.historyId).toBe("100");
    await store.finish({ connectionId: s.connId, owner: winner, now: now(), outcome: { ok: false, state: "retrying", code: "unavailable", nextRunAt: new Date(Date.now() + 60_000), countFailure: true, resetCursor: false, historyId: "120" } });
    expect(await store.state(s.org, s.connId)).toMatchObject({ historyId: "120", state: "retrying", failures: 1, lastErrorCode: "unavailable" });
    // not due for a minute: no claim without force; and another organization can't claim this mailbox
    expect(await store.claim({ orgId: s.org, connectionId: s.connId, owner: "x", now: now(), leaseMs: 60_000, force: false })).toBeNull();
    expect(await store.claim({ orgId: "other-org", connectionId: s.connId, owner: "x", now: now(), leaseMs: 60_000, force: true })).toBeNull();
  });

  it("due: only active mailboxes with read access; a mailbox with a problem wakes when it is reconnected", async () => {
    const a = await seed();
    const b = await seed({ scopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.send"] });
    const due = async () => (await store.due({ now: now(), readScope: GMAIL_READONLY_SCOPE, limit: 500, orgIds: [a.org, b.org] })).map((d) => d.connectionId);
    expect(await due()).toEqual([a.connId]);
    const o = "w1";
    await store.claim({ orgId: a.org, connectionId: a.connId, owner: o, now: now(), leaseMs: 60_000, force: true });
    await store.finish({ connectionId: a.connId, owner: o, now: now(), outcome: { ok: false, state: "needs_scope", code: "missing_read_scope", nextRunAt: new Date(Date.now() + 86_400_000), countFailure: false, resetCursor: false } });
    expect(await due()).toEqual([]);
    await new Promise((r) => setTimeout(r, 5));
    await mailbox.markHealthy({ orgId: a.org, id: a.connId, scopes: [...REPLY_SYNC_SCOPES], now: new Date(Date.now() + 1000) }); // reconnected
    expect(await due()).toEqual([a.connId]);
  });

  it("a message is stored once, even when the same one is written concurrently; its thread is adopted once (first link wins)", async () => {
    const s = await seed();
    const m = message(s, { providerThreadId: "t-race" });
    const results = await Promise.all(Array.from({ length: 6 }, () => store.storeMessage({ ...m })));
    expect(results.filter((r) => r.created)).toHaveLength(1);
    const other = await q.query(`INSERT INTO lead_messages (lead_id, organization_id, direction, channel, subject, body, body_hash, to_address, status, claim_ids, created_by, created_at, updated_at) VALUES ($1, $2, 'out', 'manual', 'x', 'x', 'h', 'z@z.test', 'sent', '[]', 'user', now(), now()) RETURNING id`, [s.lead, s.org]);
    await store.storeMessage(message(s, { providerThreadId: "t-race", link: { leadId: s.lead, leadMessageId: other.rows[0].id, toAddress: "z@z.test" } }));
    const rows = (await q.query(`SELECT lead_message_id FROM mail_messages WHERE organization_id = $1 ORDER BY id`, [s.org])).rows;
    expect(rows.map((r: any) => r.lead_message_id)).toEqual([s.msg, s.msg]); // the second follows the thread's conversation
    expect((await q.query(`SELECT count(*)::int n FROM mail_threads WHERE organization_id = $1`, [s.org])).rows[0].n).toBe(1);
    expect(await store.known(s.org, s.connId, [m.providerMessageId, "nope"])).toEqual(new Set([m.providerMessageId]));
  });

  it("lookups never cross organizations or mailboxes", async () => {
    const a = await seed({ to: "shared@acme.test" });
    const b = await seed({ to: "shared@acme.test" });
    await store.storeMessage(message(a, { providerThreadId: "t-a", rfcMessageId: "<only-a@acme.test>" }));
    expect(await store.threadLink(a.org, a.connId, "t-a")).toMatchObject({ leadMessageId: a.msg, toAddress: "shared@acme.test" });
    expect(await store.threadLink(b.org, b.connId, "t-a")).toBeNull();
    expect(await store.threadLink(a.org, b.connId, "t-a")).toBeNull();
    expect(await store.referenceLink(b.org, b.connId, ["<only-a@acme.test>"])).toBeNull();
    expect(await store.referenceLink(a.org, a.connId, ["<ONLY-A@acme.test>"])).toMatchObject({ leadMessageId: a.msg });
    expect((await store.outreachTo(b.org, b.user, ["shared@acme.test"], new Date(0))).map((c) => c.leadMessageId)).toEqual([b.msg]);
    // A mailbox matches only its own owner's outreach: a teammate in the same organization gets nothing.
    expect(await store.outreachTo(b.org, a.user, ["shared@acme.test"], new Date(0))).toEqual([]);
    expect(await store.recentOutreachAddresses({ orgId: a.org, userId: a.user, since: new Date(0), limit: 10 })).toEqual(["shared@acme.test"]);
    expect(await store.known(b.org, b.connId, (await q.query(`SELECT provider_message_id p FROM mail_messages WHERE organization_id = $1`, [a.org])).rows.map((r: any) => r.p))).toEqual(new Set());
  });

  it("threads of messages sent through DealInSec are adopted from the send jobs, once", async () => {
    const s = await seed();
    await q.query(`INSERT INTO mail_send_jobs (organization_id, connection_id, lead_id, message_id, requested_by, body_hash, to_address, rfc_message_id, status, attempts, provider_message_id, provider_thread_id, sent_at, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, 'h', $6, $7, 'sent', 1, 'gm-1', 'gt-1', now(), now(), now())`, [s.org, s.connId, s.lead, s.msg, s.user, s.to, `<dis-${randomBytes(4).toString("hex")}@dealinsec.test>`]);
    expect(await store.adoptSendThreads({ orgId: s.org, connectionId: s.connId, now: now() })).toBe(1);
    expect(await store.adoptSendThreads({ orgId: s.org, connectionId: s.connId, now: now() })).toBe(0);
    expect(await store.threadLink(s.org, s.connId, "gt-1")).toMatchObject({ leadId: s.lead, leadMessageId: s.msg });
    expect(await store.known(s.org, s.connId, ["gm-1"])).toEqual(new Set(["gm-1"]));
  });

  it("the tables refuse states the code never writes: a confirmed address match without a thread, an unknown kind", async () => {
    const s = await seed();
    const ins = (kind: string, match: string, review: string, thread: number | null) => q.query(
      `INSERT INTO mail_messages (organization_id, connection_id, provider_message_id, provider_thread_id, thread_id, lead_id, lead_message_id, direction, kind, match_kind, review_state, sent_at, created_at) VALUES ($1, $2, $3, 't', $4, $5, $6, 'in', $7, $8, $9, now(), now())`,
      [s.org, s.connId, randomBytes(4).toString("hex"), thread, s.lead, s.msg, kind, match, review]);
    await expect(ins("reply", "address", "confirmed", null)).rejects.toThrow(/mail_messages_thread_ck/);
    await expect(ins("reply", "thread", "none", null)).rejects.toThrow(/mail_messages_thread_ck/);
    await expect(ins("phishing", "address", "pending", null)).rejects.toThrow(/mail_messages_kind_ck/);
    await expect(ins("reply", "address", "pending", null)).resolves.toBeTruthy();
  });

  it("purging: a disconnected mailbox's messages, threads and state are deleted; others are untouched", async () => {
    const a = await seed(), b = await seed();
    await store.storeMessage(message(a)); await store.storeMessage(message(b));
    await store.claim({ orgId: a.org, connectionId: a.connId, owner: "p", now: now(), leaseMs: 1, force: true });
    await mailbox.disconnect({ orgId: a.org, userId: a.user, keyring: null, now: now() });
    expect(await store.purgeDisconnected(1000)).toBeGreaterThanOrEqual(1);
    const left = async (org: string) => (await q.query(`SELECT (SELECT count(*) FROM mail_messages WHERE organization_id = $1)::int + (SELECT count(*) FROM mail_threads WHERE organization_id = $1)::int + (SELECT count(*) FROM mail_sync_state WHERE organization_id = $1)::int AS n`, [org])).rows[0].n;
    expect(await left(a.org)).toBe(0);
    expect(await left(b.org)).toBe(2);
  });

  it("a full pass on Postgres: the hand-sent copy adopts the thread, the reply is stored, a second pass adds nothing", async () => {
    const s = await seed();
    const env = { GMAIL_INTEGRATION_ENABLED: "true", MAIL_PROVIDER: "fake", NODE_ENV: "test", GMAIL_OAUTH_REDIRECT_URI: "http://localhost:5072/api/integrations/gmail/callback", GMAIL_REPLY_SYNC_ENABLED: "true", ...KEYS };
    const deps = { status: async () => resolveGmailConfig(env) as GmailStatus, syncSchemaReady: async () => true, provider: () => s.fake, mailbox, store, now, random: () => 0.5, log: () => {} };
    const sent = s.fake.deliver({ from: `${s.user}@agency.test`, to: s.to, subject: "A quick idea", text: "Hi", labels: ["SENT"], messageId: "<hand@agency.test>" });
    s.fake.deliver({ from: `Jo <${s.to}>`, to: `${s.user}@agency.test`, subject: "Re: A quick idea", text: "Interested!", threadId: sent.threadId });
    s.fake.deliver({ from: "news@shop.test", to: `${s.user}@agency.test`, subject: "Sale", text: "x" });
    expect(await sync.syncMailbox({ orgId: s.org, userId: s.user, connectionId: s.connId, force: true }, deps)).toMatchObject({ outcome: "ok", stored: 2, bootstrap: true });
    s.fake.deliver({ from: s.to, to: `${s.user}@agency.test`, subject: "Re: A quick idea", text: "When can we talk?", threadId: sent.threadId });
    expect(await sync.syncMailbox({ orgId: s.org, userId: s.user, connectionId: s.connId, force: true }, deps)).toMatchObject({ outcome: "ok", stored: 1, bootstrap: false });
    expect(await sync.syncMailbox({ orgId: s.org, userId: s.user, connectionId: s.connId, force: true }, deps)).toMatchObject({ outcome: "ok", stored: 0 });
    const rows = (await q.query(`SELECT kind, match_kind, body_text, lead_message_id FROM mail_messages WHERE organization_id = $1 ORDER BY sent_at, id`, [s.org])).rows;
    expect(rows).toEqual([
      { kind: "outreach_copy", match_kind: "adopted", body_text: null, lead_message_id: s.msg },
      { kind: "reply", match_kind: "thread", body_text: "Interested!", lead_message_id: s.msg },
      { kind: "reply", match_kind: "thread", body_text: "When can we talk?", lead_message_id: s.msg },
    ]);
    expect((await store.state(s.org, s.connId))!).toMatchObject({ state: "ok", failures: 0, historyId: s.fake.historyId });
  });
});
