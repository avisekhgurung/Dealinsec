/**
 * Reply sync end to end, against the fake mailbox (no network) and the in-memory stores: association, idempotency,
 * recovery, and the failure states. Mailbox owner Ana (org-a) writes to Jo at Acme; other organizations and other
 * mailboxes must never see each other's mail.
 */
import { createHash, randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveGmailConfig, type GmailStatus } from "./config";
import { FakeMailProvider } from "./fake-provider";
import { MemoryMailboxStore } from "./memory-store";
import { GMAIL_READONLY_SCOPE, RELEASE_A_SCOPES, REPLY_SYNC_SCOPES } from "./provider";
import { MemorySyncStore } from "./sync-memory";
import { backoffMs, BACKOFF_MAX_MS, MAX_READS_PER_PASS, replySyncFor, syncDueMailboxes, syncMailbox, SYNC_INTERVAL_MS, type SyncDeps } from "./sync-service";
import { loadKeyring } from "./token-crypto";

const KEYS = { MAILBOX_TOKEN_KEYS: `1:${randomBytes(32).toString("base64")}`, MAILBOX_TOKEN_KEY_CURRENT: "1" };
const SUBJECT = "A quick idea for Acme's spring menu";

function world(o: { sync?: boolean; migrated?: boolean; allowed?: string } = {}) {
  let clock = new Date("2026-10-15T09:00:00Z");
  const env: Record<string, string | undefined> = {
    GMAIL_INTEGRATION_ENABLED: "true", MAIL_PROVIDER: "fake", NODE_ENV: "test", GMAIL_OAUTH_REDIRECT_URI: "http://localhost:5072/api/integrations/gmail/callback",
    GMAIL_REPLY_SYNC_ENABLED: o.sync === false ? "false" : "true", GMAIL_ALLOWED_ORG_IDS: o.allowed, ...KEYS,
  };
  const keyring = loadKeyring(KEYS);
  const mailbox = new MemoryMailboxStore();
  const store = new MemorySyncStore();
  const fakes = new Map<string, FakeMailProvider>(); // one Google account (mailbox) per person
  const logs: { event: string; fields: Record<string, unknown> }[] = [];
  let current: FakeMailProvider | null = null;
  const deps: SyncDeps = {
    status: async () => resolveGmailConfig(env) as GmailStatus,
    syncSchemaReady: async () => o.migrated !== false,
    provider: () => current!,
    mailbox,
    store,
    now: () => clock,
    random: () => 0.5,
    log: (event, fields = {}) => logs.push({ event, fields }),
  };
  const fakeOf = (who: string) => fakes.get(who)!;
  const mirror = () => {
    store.connections = mailbox.rows.map((r) => ({ id: r.id, organizationId: r.organizationId, userId: r.userId, status: r.status, scopes: [...r.scopes], updatedAt: r.updatedAt }));
  };

  async function connect(who: string, org: string, scopes: readonly string[] = REPLY_SYNC_SCOPES) {
    const fake = new FakeMailProvider({ account: { sub: `g-${who}`, email: `${who}@agency.test`, emailVerified: true }, grantedScopes: [...scopes], now: () => clock });
    fakes.set(who, fake);
    const verifier = "v".repeat(50);
    const url = fake.authorizationUrl({ scopes, state: "s", codeChallenge: createHash("sha256").update(verifier).digest("base64url"), nonce: "n", redirectUri: env.GMAIL_OAUTH_REDIRECT_URI! });
    const grant = await fake.exchangeCode({ code: new URL(url).searchParams.get("code")!, codeVerifier: verifier, redirectUri: env.GMAIL_OAUTH_REDIRECT_URI!, nonce: "n" });
    const r = await mailbox.save({ orgId: org, userId: who, provider: "fake", account: { sub: `g-${who}`, email: `${who}@agency.test` }, scopes: grant.scopes, refreshToken: grant.refreshToken, keyring, now: clock });
    if (!r.ok) throw new Error(r.code);
    mirror();
    return r.connection;
  }

  let leadSeq = 0, msgSeq = 100;
  /** Outreach Ana (or `by`) approved to an address, in an organization. */
  function outreach(x: { org?: string; to?: string; subject?: string; status?: string; by?: string } = {}) {
    const row = { id: ++msgSeq, organizationId: x.org ?? "org-a", leadId: ++leadSeq, toAddress: x.to ?? "jo@acme.test", subject: x.subject ?? SUBJECT, status: x.status ?? "sent", approvedBy: x.by ?? "ana", at: clock };
    store.outreach.push(row);
    return row;
  }

  /** One pass for `who`'s mailbox. */
  async function pass(who: string, opts: { force?: boolean } = {}) {
    mirror();
    current = fakeOf(who);
    const row = mailbox.rows.find((r) => r.userId === who && r.status !== "disconnected")!;
    return syncMailbox({ orgId: row.organizationId, userId: who, connectionId: row.id, force: opts.force ?? true }, deps);
  }

  return {
    env, deps, mailbox, store, logs, fakeOf, connect, outreach, pass, mirror,
    get clock() { return clock; },
    tick(ms: number) { clock = new Date(clock.getTime() + ms); },
    use(who: string) { current = fakeOf(who); },
  };
}

type W = ReturnType<typeof world>;
/** Ana sent the outreach by hand from Gmail (a copy in her Sent mail); Jo replies in the same thread. */
function handSentAndReply(w: W, o: { replyText?: string; subject?: string } = {}) {
  const fake = w.fakeOf("ana");
  const sent = fake.deliver({ from: "Ana <ana@agency.test>", to: "jo@acme.test", subject: SUBJECT, text: "Hi Jo, …", labels: ["SENT"], messageId: "<hand-1@agency.test>" });
  w.tick(60_000);
  const reply = fake.deliver({ from: "Jo Bloggs <jo@acme.test>", to: "ana@agency.test", subject: o.subject ?? `Re: ${SUBJECT}`, text: o.replyText ?? "Yes, Tuesday works.\n\nOn Thu, Ana <ana@agency.test> wrote:\n> Hi Jo", threadId: sent.threadId, inReplyTo: "<hand-1@agency.test>", references: ["<hand-1@agency.test>"] });
  return { sent, reply };
}

describe("reply sync: switches", () => {
  it("does nothing unless Gmail is on for the organization, GMAIL_REPLY_SYNC_ENABLED is set, and the tables are migrated", async () => {
    for (const [o, reason] of [[{ sync: false }, "sync_off"], [{ migrated: false }, "not_migrated"], [{ allowed: "org-b" }, "gmail_off"]] as const) {
      const w = world(o);
      await w.connect("ana", "org-a");
      expect(await replySyncFor("org-a", w.deps)).toEqual({ on: false, reason });
      expect((await w.pass("ana")).outcome).toBe("off");
      expect(w.fakeOf("ana").calls.filter((c) => c.op !== "exchange")).toEqual([]);
    }
  });
});

describe("reply sync: association", () => {
  let w: W;
  beforeEach(async () => { w = world(); await w.connect("ana", "org-a"); });

  it("first pass: finds outreach sent by hand, adopts its thread, stores the reply (quote cut), and sets the cursor", async () => {
    const o = w.outreach();
    const { reply } = handSentAndReply(w);
    const r = await w.pass("ana");
    expect(r).toMatchObject({ outcome: "ok", bootstrap: true, stored: 2 });
    const stored = w.store.messages.find((m) => m.providerMessageId === reply.id)!;
    expect(stored).toMatchObject({ direction: "in", kind: "reply", match: "thread", leadId: o.leadId, leadMessageId: o.id, reviewState: "none", fromAddress: "jo@acme.test", fromName: "Jo Bloggs", bodyText: "Yes, Tuesday works.", bodyTrimmed: true });
    expect(stored.threadId).not.toBeNull();
    expect(w.store.messages.find((m) => m.kind === "outreach_copy")).toMatchObject({ direction: "out", match: "adopted", bodyText: null });
    expect(w.store.threads).toHaveLength(1);
    expect(w.store.threads[0]).toMatchObject({ source: "adopted", leadMessageId: o.id, lastInboundAt: stored.sentAt });
    expect((await w.store.state("org-a", w.mailbox.rows[0].id))!.historyId).toBe(w.fakeOf("ana").historyId);
  });

  it("later passes read only new history: a reply with a changed subject (new Gmail thread) is found by its References", async () => {
    const o = w.outreach();
    handSentAndReply(w);
    await w.pass("ana");
    w.tick(SYNC_INTERVAL_MS);
    const late = w.fakeOf("ana").deliver({ from: "jo@acme.test", to: "ana@agency.test", subject: "Pricing question", text: "What would this cost?", references: ["<hand-1@agency.test>"] });
    const r = await w.pass("ana");
    expect(r).toMatchObject({ outcome: "ok", bootstrap: false, stored: 1 });
    expect(w.store.messages.find((m) => m.providerMessageId === late.id)).toMatchObject({ match: "reference", leadMessageId: o.id, reviewState: "none" });
    expect(w.store.threads.map((t) => t.source).sort()).toEqual(["adopted", "reference"]);
  });

  it("a message seen again (duplicate notification, replayed history, a second pass) is stored once", async () => {
    w.outreach();
    handSentAndReply(w);
    await w.pass("ana");
    const count = w.store.messages.length;
    await w.pass("ana");
    w.fakeOf("ana").expireHistory();
    w.fakeOf("ana").deliver({ from: "news@shop.test", to: "ana@agency.test", subject: "Sale", text: "50% off" });
    await w.pass("ana"); // cursor_expired → reset
    const again = await w.pass("ana"); // first pass again: everything already known
    expect(again).toMatchObject({ outcome: "ok", bootstrap: true, stored: 0 });
    expect(w.store.messages).toHaveLength(count);
  });

  it("unrelated mail is never stored and its body is never read", async () => {
    w.outreach();
    await w.pass("ana");
    const spy = vi.spyOn(w.fakeOf("ana"), "message");
    const junk = w.fakeOf("ana").deliver({ from: "news@shop.test", to: "ana@agency.test", subject: "Sale", text: "private newsletter" });
    const friend = w.fakeOf("ana").deliver({ from: "Jo <friend@elsewhere.test>", to: "ana@agency.test", subject: "Lunch", text: "private" });
    await w.pass("ana");
    expect(w.store.messages).toEqual([]);
    expect(spy.mock.calls.filter((c) => c[2] === "full")).toEqual([]);
    expect(spy.mock.calls.map((c) => c[1]).sort()).toEqual([junk.id, friend.id].sort());
  });

  it("a message from an address Ana wrote to, outside any linked thread, waits for review and is not linked", async () => {
    const o = w.outreach();
    await w.pass("ana");
    w.fakeOf("ana").deliver({ from: "jo@acme.test", to: "ana@agency.test", subject: "Unrelated-looking note", text: "Saw your site" });
    await w.pass("ana");
    expect(w.store.messages).toHaveLength(1);
    expect(w.store.messages[0]).toMatchObject({ match: "address", review: "address_only", reviewState: "pending", threadId: null, leadMessageId: o.id });
    expect(w.store.threads).toEqual([]);
  });

  it("when a thread becomes linked later, its earlier review-only messages join the conversation (other senders stay flagged)", async () => {
    const o = w.outreach();
    await w.pass("ana");
    const fake = w.fakeOf("ana");
    const first = fake.deliver({ from: "jo@acme.test", to: "ana@agency.test", subject: "Quick question", text: "Who are you?" });
    fake.deliver({ from: "boss@acme.test", to: "ana@agency.test", subject: "Re: Quick question", text: "cc me", threadId: first.threadId });
    await w.pass("ana");
    expect(w.store.messages.map((m) => [m.match, m.reviewState])).toEqual([["address", "pending"]]); // boss: no link at all
    w.store.sendJobs.push({ organizationId: "org-a", connectionId: w.mailbox.rows[0].id, messageId: o.id, leadId: o.leadId, toAddress: "jo@acme.test", rfcMessageId: "<dis-5@dealinsec.test>", status: "sent", providerMessageId: null, providerThreadId: null });
    fake.deliver({ from: "jo@acme.test", to: "ana@agency.test", subject: "Re: Quick question", text: "Ah, it's about your email", threadId: first.threadId, references: ["<dis-5@dealinsec.test>"] });
    await w.pass("ana");
    const byFrom = (a: string) => w.store.messages.filter((m) => m.fromAddress === a).map((m) => [m.match, m.review, m.reviewState, m.threadId !== null]);
    expect(byFrom("jo@acme.test")).toEqual([["thread", null, "none", true], ["reference", null, "none", true]]);
    expect(byFrom("boss@acme.test")).toEqual([["thread", "other_sender", "pending", true]]); // read in the thread backfill
  });

  it("a colleague replying in the thread is linked but flagged; an out-of-office is kept as automated", async () => {
    w.outreach();
    const { sent } = handSentAndReply(w);
    w.fakeOf("ana").deliver({ from: "boss@acme.test", to: "ana@agency.test", subject: `Re: ${SUBJECT}`, text: "Jo forwarded this to me", threadId: sent.threadId });
    w.fakeOf("ana").deliver({ from: "jo@acme.test", to: "ana@agency.test", subject: `Automatic reply: ${SUBJECT}`, text: "Away until Monday", threadId: sent.threadId, headers: [{ name: "Auto-Submitted", value: "auto-replied" }] });
    await w.pass("ana");
    expect(w.store.messages.find((m) => m.fromAddress === "boss@acme.test")).toMatchObject({ match: "thread", review: "other_sender", reviewState: "pending" });
    expect(w.store.messages.find((m) => m.kind === "auto_reply")).toMatchObject({ match: "thread", review: null });
  });

  it("messages sent through DealInSec link their Gmail thread; Jo's reply matches by thread", async () => {
    const o = w.outreach();
    const sent = w.fakeOf("ana").deliver({ from: "ana@agency.test", to: "jo@acme.test", subject: "Different words", text: "x", labels: ["SENT"], messageId: "<dis-9@dealinsec.test>" });
    w.store.sendJobs.push({ organizationId: "org-a", connectionId: w.mailbox.rows[0].id, messageId: o.id, leadId: o.leadId, toAddress: "jo@acme.test", rfcMessageId: "<dis-9@dealinsec.test>", status: "sent", providerMessageId: sent.id, providerThreadId: sent.threadId });
    w.fakeOf("ana").deliver({ from: "jo@acme.test", to: "ana@agency.test", subject: "Re: Different words", text: "Interested", threadId: sent.threadId });
    await w.pass("ana");
    expect(w.store.threads).toMatchObject([{ source: "send", leadMessageId: o.id }]);
    expect(w.store.messages.map((m) => [m.kind, m.match])).toEqual([["reply", "thread"]]); // DealInSec's own send isn't copied
  });

  it("drafts and spam are skipped without being read", async () => {
    w.outreach();
    const { sent } = handSentAndReply(w);
    await w.pass("ana");
    const spy = vi.spyOn(w.fakeOf("ana"), "message");
    w.fakeOf("ana").deliver({ from: "ana@agency.test", to: "jo@acme.test", subject: `Re: ${SUBJECT}`, text: "draft", threadId: sent.threadId, labels: ["DRAFT"] });
    w.fakeOf("ana").deliver({ from: "jo@acme.test", to: "ana@agency.test", subject: `Re: ${SUBJECT}`, text: "spam?", threadId: sent.threadId, labels: ["SPAM"] });
    await w.pass("ana");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("reply sync: what a stored reply hands on", () => {
  it("each inbound message is labelled by the rules and applied once right after it is stored; outgoing ones get no label", async () => {
    const w = world();
    await w.connect("ana", "org-a");
    w.outreach();
    const applied: number[] = [];
    w.deps.applyReply = async (_org, id) => { applied.push(id); };
    handSentAndReply(w, { replyText: "Sounds good, let's talk Tuesday." });
    await w.pass("ana");
    const reply = w.store.messages.find((m) => m.kind === "reply")!;
    expect(reply.classification).toBe("interested");
    expect(w.store.messages.find((m) => m.kind === "outreach_copy")!.classification).toBeNull();
    expect(applied.sort()).toEqual(w.store.messages.map((m) => m.id).sort());
    await w.pass("ana"); // nothing new: nothing applied again
    expect(applied).toHaveLength(2);
  });
});

describe("reply sync: organizations and mailboxes stay apart", () => {
  it("Zed (org-b) writing to the same address never links to org-a's outreach, and each mailbox keeps its own", async () => {
    const w = world();
    await w.connect("ana", "org-a");
    await w.connect("zed", "org-b");
    w.outreach({ org: "org-a" });
    await w.pass("ana");
    await w.pass("zed");
    w.fakeOf("zed").deliver({ from: "jo@acme.test", to: "zed@agency.test", subject: `Re: ${SUBJECT}`, text: "hello zed", references: ["<hand-1@agency.test>"] });
    w.fakeOf("ana").deliver({ from: "jo@acme.test", to: "ana@agency.test", subject: "hi", text: "hello ana" });
    await w.pass("zed");
    await w.pass("ana");
    expect(w.store.messages.filter((m) => m.organizationId === "org-b")).toEqual([]);
    expect(w.store.messages.map((m) => [m.organizationId, m.connectionId])).toEqual([["org-a", w.mailbox.rows.find((r) => r.userId === "ana")!.id]]);
  });

  it("a teammate in the SAME organization: Ben's mailbox never files mail under Ana's outreach (by address or by a hand-sent copy)", async () => {
    const w = world();
    await w.connect("ana", "org-a");
    await w.connect("ben", "org-a");
    w.outreach({ org: "org-a", by: "ana" });
    await w.pass("ben");
    const ben = w.fakeOf("ben");
    // Jo writes to Ben; Ben's own copy of a mail to Jo with Ana's approved subject: neither is Ben's conversation.
    ben.deliver({ from: "jo@acme.test", to: "ben@agency.test", subject: "hi", text: "hello ben" });
    ben.deliver({ from: "Ben <ben@agency.test>", to: "jo@acme.test", subject: SUBJECT, text: "Hi Jo", labels: ["SENT"], messageId: "<ben-1@agency.test>" });
    await w.pass("ben");
    expect(w.store.messages).toEqual([]);
    expect(w.store.threads).toEqual([]);
  });

  it("a pass for someone else's connection does nothing", async () => {
    const w = world();
    const ana = await w.connect("ana", "org-a");
    await w.connect("ben", "org-a");
    w.mirror(); w.use("ben");
    expect((await syncMailbox({ orgId: "org-a", userId: "ben", connectionId: ana.id, force: true }, w.deps)).outcome).toBe("not_connected");
    expect((await syncMailbox({ orgId: "org-b", userId: "ana", connectionId: ana.id, force: true }, w.deps)).outcome).toBe("busy"); // the state row belongs to org-a
  });
});

describe("reply sync: failures and recovery", () => {
  let w: W;
  beforeEach(async () => { w = world(); await w.connect("ana", "org-a"); w.outreach(); });

  it("a revoked grant marks the mailbox for reconnecting (token deleted) and stops", async () => {
    w.fakeOf("ana").revokeAllExternally();
    expect((await w.pass("ana")).outcome).toBe("needs_reconnect");
    expect(w.mailbox.rows[0]).toMatchObject({ status: "needs_reconnect", lastErrorCode: "revoked", refreshTokenEnc: null });
    expect((await w.store.state("org-a", w.mailbox.rows[0].id))!.state).toBe("needs_reconnect");
  });

  it("a connection without read access stops before reading anything", async () => {
    const x = world();
    await x.connect("ana", "org-a", RELEASE_A_SCOPES);
    expect((await x.pass("ana")).outcome).toBe("needs_scope");
    expect(x.fakeOf("ana").calls.map((c) => c.op)).toEqual(["exchange"]);
    expect(await x.store.due({ now: x.clock, readScope: GMAIL_READONLY_SCOPE, limit: 5, orgIds: null })).toEqual([]);
  });

  it("rate limits and outages back off (with jitter, capped) and keep the cursor; the next pass catches up", async () => {
    await w.pass("ana");
    const cursor = (await w.store.state("org-a", w.mailbox.rows[0].id))!.historyId;
    handSentAndReply(w);
    w.fakeOf("ana").failNext("history", "rate_limited", { retryAfterMs: 10 * 60_000 });
    expect((await w.pass("ana", { force: false })).outcome).toBe("busy"); // the first pass scheduled the next one 3 minutes on
    w.tick(SYNC_INTERVAL_MS);
    const failed = await w.pass("ana", { force: false });
    expect(failed.outcome).toBe("retrying");
    const st = (await w.store.state("org-a", w.mailbox.rows[0].id))!;
    expect(st).toMatchObject({ state: "retrying", failures: 1, lastErrorCode: "rate_limited", historyId: cursor });
    expect(st.nextRunAt.getTime() - w.clock.getTime()).toBe(10 * 60_000); // Gmail's Retry-After wins over a shorter backoff
    expect((await w.pass("ana", { force: false })).outcome).toBe("busy"); // not due yet
    w.tick(10 * 60_000);
    expect(await w.pass("ana", { force: false })).toMatchObject({ outcome: "ok", stored: 2 });
    expect((await w.store.state("org-a", w.mailbox.rows[0].id))!).toMatchObject({ state: "ok", failures: 0, lastErrorCode: null });
  });

  it("backoff doubles from 2 minutes, is jittered ±20%, and never exceeds an hour", () => {
    expect(backoffMs(1, () => 0.5)).toBe(120_000);
    expect(backoffMs(3, () => 0.5)).toBe(480_000);
    expect(backoffMs(3, () => 0)).toBe(384_000);
    expect(backoffMs(30, () => 1)).toBe(BACKOFF_MAX_MS);
  });

  it("a cursor too old for Gmail's history starts over with a first pass, without duplicating anything", async () => {
    handSentAndReply(w);
    await w.pass("ana");
    const n = w.store.messages.length;
    w.fakeOf("ana").expireHistory();
    expect((await w.pass("ana")).outcome).toBe("retrying");
    expect((await w.store.state("org-a", w.mailbox.rows[0].id))!).toMatchObject({ historyId: null, lastErrorCode: "cursor_expired", failures: 0 });
    expect(await w.pass("ana")).toMatchObject({ outcome: "ok", bootstrap: true, stored: 0 });
    expect(w.store.messages).toHaveLength(n);
  });

  it("a big backlog is read in bounded passes, resuming from the last fully decided change", async () => {
    await w.pass("ana");
    const fake = w.fakeOf("ana");
    const sent = fake.deliver({ from: "ana@agency.test", to: "jo@acme.test", subject: SUBJECT, text: "x", labels: ["SENT"], messageId: "<hand-2@agency.test>" });
    for (let i = 0; i < MAX_READS_PER_PASS + 40; i++) fake.deliver({ from: `n${i}@news.test`, to: "ana@agency.test", subject: "news", text: "x" });
    for (let i = 0; i < 5; i++) fake.deliver({ from: "jo@acme.test", to: "ana@agency.test", subject: `Re: ${SUBJECT}`, text: `reply ${i}`, threadId: sent.threadId });
    const first = await w.pass("ana");
    expect(first.outcome).toBe("partial");
    expect(first.reads).toBeLessThanOrEqual(MAX_READS_PER_PASS);
    const st = (await w.store.state("org-a", w.mailbox.rows[0].id))!;
    expect(st.nextRunAt).toEqual(w.clock); // due again at once
    let guard = 0;
    while ((await w.pass("ana", { force: false })).outcome === "partial" && guard++ < 5);
    expect(w.store.messages.filter((m) => m.kind === "reply")).toHaveLength(5);
    expect(w.store.messages.filter((m) => m.kind === "outreach_copy")).toHaveLength(1);
  });

  it("two passes at once: the second finds the lease taken and does nothing", async () => {
    w.mirror(); w.use("ana");
    const id = w.mailbox.rows[0].id;
    w.fakeOf("ana").delayNext("refresh", 20);
    const [a, b] = await Promise.all([
      syncMailbox({ orgId: "org-a", userId: "ana", connectionId: id, force: true }, w.deps),
      syncMailbox({ orgId: "org-a", userId: "ana", connectionId: id, force: true }, w.deps),
    ]);
    expect([a.outcome, b.outcome].sort()).toEqual(["busy", "ok"]);
  });

  it("logs carry ids, counts and codes only: no address, subject, body or token", async () => {
    handSentAndReply(w, { replyText: "SECRET-BODY please call" });
    w.fakeOf("ana").failNext("message", "unavailable");
    await w.pass("ana");
    await w.pass("ana");
    const text = JSON.stringify(w.logs);
    for (const leak of ["SECRET-BODY", "jo@acme.test", "ana@agency.test", SUBJECT, "fake-refresh", "fake-access"]) expect(text).not.toContain(leak);
    expect(w.logs.some((l) => l.event === "gmail_sync_pass")).toBe(true);
  });
});

describe("reply sync: the sweep and disconnecting", () => {
  it("sweeps due mailboxes only, and deletes what is left of disconnected ones", async () => {
    const w = world();
    await w.connect("ana", "org-a");
    w.outreach();
    handSentAndReply(w);
    w.use("ana");
    w.mirror();
    expect(await syncDueMailboxes(w.deps)).toBe(1);
    expect(w.store.messages.length).toBeGreaterThan(0);
    expect(await syncDueMailboxes(w.deps)).toBe(0); // not due again for a few minutes
    await w.mailbox.disconnect({ orgId: "org-a", userId: "ana", keyring: null, now: w.clock });
    w.mirror();
    await syncDueMailboxes(w.deps);
    expect([w.store.messages, w.store.threads, w.store.states.size]).toEqual([[], [], 0]);
  });
});
