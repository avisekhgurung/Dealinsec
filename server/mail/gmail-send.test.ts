/**
 * Sending an approved message from the person's own connected mailbox (Milestone 2), end to end against the in-memory
 * world and FakeMailProvider. The same reservation runs against real Postgres, with real concurrency, in
 * send-store.pg.test.ts.
 */
import { describe, expect, it } from "vitest";
import { SEND_MESSAGES } from "@shared/gmail-connect";
import { hashDraft } from "@shared/outreach-hash";
import { GMAIL_SEND_URL, GmailProvider, GOOGLE_TOKEN_URL } from "./gmail-provider";
import { GMAIL_SEND_SCOPE, MailProviderError, normalizeScopes } from "./provider";
import { resolveSend, sendApproved, sendStateFor, SEND_LEASE_MS, TRANSIENT_TRIES } from "./send-service";
import { BODY, KEYS, makeWorld, SUBJECT } from "./send-world";
import { loadKeyring } from "./token-crypto";

const ok = <T,>(r: T) => { if (!(r as any).ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`); return r as Extract<T, { ok: true }>; };
const failed = <T,>(r: T) => { if ((r as any).ok) throw new Error(`expected a refusal, got ${JSON.stringify(r)}`); return r as Extract<T, { ok: false }>; };
/** Decodes the fake's raw MIME: headers and the base64 body. */
function parse(raw: string) {
  const at = raw.indexOf("\r\n\r\n");
  const headers = Object.fromEntries(raw.slice(0, at).replace(/\r\n /g, " ").split("\r\n").map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 2)]));
  return { headers, body: Buffer.from(raw.slice(at + 4).replace(/\r\n/g, ""), "base64").toString("utf8") };
}

describe("sending: the happy path", () => {
  it("sends exactly the approved subject and body from the sender's own mailbox, records it once, and follows up once", async () => {
    const w = makeWorld();
    await w.connect("ana");
    const m = w.approved();
    const r = ok(await sendApproved(w.members.ana, m.id, m.bodyHash, w.deps));
    expect(r.outcome).toBe("sent");
    expect(r.send).toMatchObject({ status: "sent", code: null, canRetry: false, canResolve: false, message: SEND_MESSAGES.sent });
    expect(w.fake.outbox).toHaveLength(1);
    const sent = w.fake.outbox[0];
    const { headers, body } = parse(sent.raw);
    expect(headers.From).toBe('"Ana Silva" <ana@agency.test>');
    expect(headers.To).toBe(m.toAddress);
    expect(headers.Subject).toBe(SUBJECT);
    expect(body).toBe(BODY.replace(/\n/g, "\r\n"));
    expect(hashDraft(headers.Subject, body.replace(/\r\n/g, "\n"))).toBe(m.bodyHash);
    const job = w.world.jobs[0];
    expect(headers["Message-ID"]).toBe(job.rfcMessageId);
    expect(job).toMatchObject({ status: "sent", attempts: 1, providerMessageId: sent.providerMessageId, providerThreadId: sent.providerThreadId, requestedBy: "ana", bodyHash: m.bodyHash, leaseUntil: null });
    expect(w.world.messages.get(m.id)).toMatchObject({ status: "sent" });
    // the send and its follow-up's outbox entry, recorded together
    expect(w.world.events).toEqual([
      expect.objectContaining({ kind: "sent", source: "provider", provider: "gmail", providerMessageId: sent.providerMessageId, messageId: m.id }),
      expect.objectContaining({ kind: "follow_due", source: "provider", provider: "gmail", messageId: m.id, actorUserId: "ana" }),
    ]);
    expect(w.afterSent).toEqual([{ actor: "ana", leadId: m.leadId, messageId: m.id, via: "gmail" }]);
    // nothing from the message, the address or the token in the logs
    const logged = JSON.stringify(w.logs);
    for (const secret of [BODY.slice(0, 20), SUBJECT, m.toAddress!, w.tokenOf("ana")]) expect(logged).not.toContain(secret);
  });

  it("a repeat after success (double click, stale tab, retry) sends nothing and follows up nothing again", async () => {
    const w = makeWorld();
    await w.connect("ana");
    const m = w.approved();
    ok(await sendApproved(w.members.ana, m.id, m.bodyHash, w.deps));
    for (let i = 0; i < 3; i++) expect(ok(await sendApproved(w.members.ana, m.id, m.bodyHash, w.deps)).outcome).toBe("already_sent");
    expect(w.fake.outbox).toHaveLength(1);
    expect(w.afterSent).toHaveLength(1);
    expect(w.world.events.map((e) => e.kind)).toEqual(["sent", "follow_due"]);
  });

  it("two requests at the same moment: one send, the other told it's in flight", async () => {
    const w = makeWorld();
    await w.connect("ana");
    const m = w.approved();
    w.fake.delayNext("send", 30);
    const [a, b] = await Promise.all([sendApproved(w.members.ana, m.id, m.bodyHash, w.deps), sendApproved(w.members.ana, m.id, m.bodyHash, w.deps)]);
    const outcomes = [a, b].map((x) => (x.ok ? x.outcome : x.code)).sort();
    expect(outcomes).toEqual(["in_flight", "sent"]);
    expect(w.fake.outbox).toHaveLength(1);
    expect(w.afterSent).toHaveLength(1);
  });
});

describe("sending: re-checked at send time", () => {
  it("only the exact approved text: a stale page, an edit after approval, or stored text that no longer matches its hash", async () => {
    const w = makeWorld();
    await w.connect("ana");
    const m = w.approved();
    expect(failed(await sendApproved(w.members.ana, m.id, hashDraft(SUBJECT, BODY + " "+"x"), w.deps)).code).toBe("changed");
    // edited after approval: back to draft with a new hash (what editDraft does)
    const edited = w.approved();
    Object.assign(edited, { status: "draft", subject: "New subject", bodyHash: hashDraft("New subject", BODY) });
    expect(failed(await sendApproved(w.members.ana, edited.id, edited.bodyHash, w.deps)).code).toBe("not_approved");
    // the subject or body changed underneath an approval that kept its old hash
    const sub = w.approved();
    sub.subject = "Changed subject";
    expect(failed(await sendApproved(w.members.ana, sub.id, sub.bodyHash, w.deps)).code).toBe("invalid_content");
    const body = w.approved();
    body.body = BODY + "\nPS: 50% off";
    expect(failed(await sendApproved(w.members.ana, body.id, body.bodyHash, w.deps)).code).toBe("invalid_content");
    // a subject with a line break can never be sent (it would also make the hash ambiguous)
    const nl = w.approved({ subject: "Hello\nBcc: all@x.test" });
    expect(failed(await sendApproved(w.members.ana, nl.id, nl.bodyHash, w.deps)).code).toBe("invalid_content");
    expect(w.fake.outbox).toHaveLength(0);
    expect(w.world.jobs).toHaveLength(0);
  });

  it("the lead marked do-not-contact, or the address or its whole domain on the list: nothing sent, nothing reserved", async () => {
    const w = makeWorld();
    await w.connect("ana");
    const dnc = w.approved();
    w.world.leads.get(dnc.leadId)!.doNotContact = true;
    expect(failed(await sendApproved(w.members.ana, dnc.id, dnc.bodyHash, w.deps)).code).toBe("do_not_contact");
    const addr = w.approved({ to: "ceo@listed.test" });
    w.world.suppressions.push({ organizationId: "org-a", kind: "email", value: "ceo@listed.test", reason: "opt_out" });
    expect(failed(await sendApproved(w.members.ana, addr.id, addr.bodyHash, w.deps)).code).toBe("suppressed");
    const dom = w.approved({ to: "Sales@Blocked-Domain.test" });
    w.world.suppressions.push({ organizationId: "org-a", kind: "domain", value: "blocked-domain.test", reason: "manual" });
    expect(failed(await sendApproved(w.members.ana, dom.id, dom.bodyHash, w.deps)).code).toBe("suppressed");
    // another organization's list doesn't apply
    const other = w.approved({ to: "x@only-b-blocks.test" });
    w.world.suppressions.push({ organizationId: "org-b", kind: "domain", value: "only-b-blocks.test", reason: "manual" });
    expect(ok(await sendApproved(w.members.ana, other.id, other.bodyHash, w.deps)).outcome).toBe("sent");
    expect(w.fake.outbox.map((x) => x.to)).toEqual(["x@only-b-blocks.test"]);
    expect(w.world.jobs).toHaveLength(1);
  });

  it("without the do-not-contact list's tables (and the follow-up outbox) nothing is sent, and nothing can be settled", async () => {
    const w = makeWorld();
    await w.connect("ana");
    const m = w.approved();
    const off = { ...w.deps, listReady: async () => false };
    expect(failed(await sendApproved(w.members.ana, m.id, m.bodyHash, off))).toMatchObject({ status: 503, code: "outreach_not_setup" });
    expect(w.world.jobs).toHaveLength(0);
    w.fake.failNext("send", "uncertain");
    ok(await sendApproved(w.members.ana, m.id, m.bodyHash, w.deps));
    expect(failed(await resolveSend(w.members.ana, m.id, { decision: "sent" }, off)).code).toBe("outreach_not_setup");
    expect(w.world.jobs[0].status).toBe("uncertain");
  });

  it("the list can't be read: nothing is sent (fail closed)", async () => {
    const w = makeWorld();
    await w.connect("ana");
    const m = w.approved();
    const r = failed(await sendApproved(w.members.ana, m.id, m.bodyHash, { ...w.deps, listReady: async () => { throw new Error("db"); } }));
    expect(r).toMatchObject({ status: 503, code: "suppression_unavailable" });
    expect(w.fake.outbox).toHaveLength(0);
  });

  it("permissions and membership, re-read under lock: a role that can't work on leads, a member removed since sign-in, another organization", async () => {
    const w = makeWorld();
    await w.connect("ana");
    const m = w.approved();
    expect(failed(await sendApproved(w.members.acct, m.id, m.bodyHash, w.deps))).toMatchObject({ status: 403, code: "not_allowed" });
    // signed in as an active member a moment ago, removed before the send is reserved
    w.world.users.get("ana")!.memberStatus = "removed";
    expect(failed(await sendApproved(w.members.ana, m.id, m.bodyHash, w.deps)).code).toBe("not_member");
    w.world.users.get("ana")!.memberStatus = "active";
    w.world.users.get("ana")!.orgRole = "ACCOUNTS"; // demoted since sign-in
    expect(failed(await sendApproved(w.members.ana, m.id, m.bodyHash, w.deps)).code).toBe("not_allowed");
    w.world.users.get("ana")!.orgRole = "SALES";
    // another organization's member, with their own mailbox, can't reach this message
    await w.connect("zed");
    expect(failed(await sendApproved(w.members.zed, m.id, m.bodyHash, w.deps)).code).toBe("not_found");
    expect(w.fake.outbox).toHaveLength(0);
  });

  it("an admin can't send as a member: only their own mailbox is ever used, and without one nothing is sent", async () => {
    const w = makeWorld();
    await w.connect("ana");
    const m = w.approved();
    expect(failed(await sendApproved(w.members.admin, m.id, m.bodyHash, w.deps)).code).toBe("no_mailbox");
    await w.connect("admin");
    expect(ok(await sendApproved(w.members.admin, m.id, m.bodyHash, w.deps)).outcome).toBe("sent");
    expect(w.fake.outbox[0].from).toBe("admin@agency.test");
    expect(w.world.jobs[0].requestedBy).toBe("admin");
  });

  it("the mailbox: not connected, needing reconnect, no send scope, or disconnected between the check and the reservation", async () => {
    const w = makeWorld();
    const m = w.approved();
    expect(failed(await sendApproved(w.members.ana, m.id, m.bodyHash, w.deps)).code).toBe("no_mailbox");
    const c = await w.connect("ana");
    await w.mailbox.markProblem({ orgId: "org-a", id: c.id, code: "revoked", clearToken: true, now: w.clock });
    expect(failed(await sendApproved(w.members.ana, m.id, m.bodyHash, w.deps)).code).toBe("mailbox_reconnect");
    await w.mailbox.disconnect({ orgId: "org-a", userId: "ana", keyring: null, now: w.clock });
    await w.connect("ana", undefined, ["openid", "email"]);
    expect(failed(await sendApproved(w.members.ana, m.id, m.bodyHash, w.deps)).code).toBe("missing_send_scope");
    await w.mailbox.disconnect({ orgId: "org-a", userId: "ana", keyring: null, now: w.clock });
    await w.connect("ana");
    // disconnected after the token check, before the reservation: the reservation sees it
    const sends = w.deps.sends;
    const r = await sendApproved(w.members.ana, m.id, m.bodyHash, { ...w.deps, sends: { ...sends, reserve: async (i) => { await w.mailbox.disconnect({ orgId: "org-a", userId: "ana", keyring: null, now: w.clock }); return sends.reserve.call(w.world, i); }, recoverExpired: sends.recoverExpired.bind(w.world), jobFor: sends.jobFor.bind(w.world) } as any });
    expect(failed(r).code).toBe("mailbox_unavailable");
    expect(w.fake.outbox).toHaveLength(0);
  });

  it("revoked at Google: found when refreshing (nothing reserved) or at send (blocked); either way the mailbox needs reconnecting", async () => {
    const w = makeWorld();
    await w.connect("ana");
    const m = w.approved();
    w.fake.revokeAllExternally();
    expect(failed(await sendApproved(w.members.ana, m.id, m.bodyHash, w.deps)).code).toBe("mailbox_reconnect");
    expect(w.mailbox.rows[0]).toMatchObject({ status: "needs_reconnect", lastErrorCode: "revoked", refreshTokenEnc: null });
    expect(w.world.jobs).toHaveLength(0);
    // revoked between the refresh and the send
    await w.mailbox.disconnect({ orgId: "org-a", userId: "ana", keyring: null, now: w.clock });
    await w.connect("ana");
    w.fake.failNext("send", "invalid_grant");
    const r = ok(await sendApproved(w.members.ana, m.id, m.bodyHash, w.deps));
    expect(r).toMatchObject({ outcome: "failed", reconnect: true, send: { status: "blocked", code: "mailbox_reconnect", canRetry: true } });
    expect(w.world.messages.get(m.id)!.status).toBe("approved");
    expect(w.mailbox.rows.find((x) => x.status !== "disconnected")).toMatchObject({ status: "needs_reconnect", lastErrorCode: "revoked" });
  });
});

describe("sending: outcomes", () => {
  it("a clear refusal: failed, nothing accepted, the message approved again; a deliberate retry keeps the same Message-ID", async () => {
    const w = makeWorld();
    await w.connect("ana");
    const m = w.approved();
    w.fake.failNext("send", "rejected");
    const r = ok(await sendApproved(w.members.ana, m.id, m.bodyHash, w.deps));
    expect(r).toMatchObject({ outcome: "failed", send: { status: "failed", code: "rejected", canRetry: true } });
    expect(w.world.messages.get(m.id)!.status).toBe("approved");
    expect(w.fake.outbox).toHaveLength(0);
    const rfc = w.world.jobs[0].rfcMessageId;
    expect(ok(await sendApproved(w.members.ana, m.id, m.bodyHash, w.deps)).outcome).toBe("sent");
    expect(w.world.jobs).toHaveLength(1);
    expect(w.world.jobs[0]).toMatchObject({ attempts: 2, rfcMessageId: rfc, status: "sent" });
    expect(parse(w.fake.outbox[0].raw).headers["Message-ID"]).toBe(rfc);
    expect(w.afterSent).toHaveLength(1);
  });

  it("rate limited (proven not accepted): retried with bounded backoff and jitter, then sent; exhausted, it fails without sending", async () => {
    const w = makeWorld();
    await w.connect("ana");
    const m = w.approved();
    w.fake.failNext("send", "rate_limited");
    w.fake.failNext("send", "rate_limited", { retryAfterMs: 3_000 });
    expect(ok(await sendApproved(w.members.ana, m.id, m.bodyHash, w.deps)).outcome).toBe("sent");
    expect(w.sleeps).toEqual([300, 2250]); // 400·2^0 and max(800, 3000) scaled by jitter 0.75, capped at 4000
    expect(w.fake.outbox).toHaveLength(1);
    const n = w.approved();
    for (let i = 0; i < TRANSIENT_TRIES; i++) w.fake.failNext("send", "rate_limited");
    expect(ok(await sendApproved(w.members.ana, n.id, n.bodyHash, w.deps))).toMatchObject({ outcome: "failed", send: { code: "rate_limited" } });
    expect(w.fake.outbox).toHaveLength(1);
  });

  for (const [name, delivered] of [["timeout before Gmail accepted it", false], ["timeout after Gmail accepted it", true]] as const) {
    it(`${name}: uncertain, never resent, every other path blocked until a person settles it`, async () => {
      const w = makeWorld();
      await w.connect("ana");
      const m = w.approved();
      w.fake.failNext("send", "uncertain", { delivered });
      const r = ok(await sendApproved(w.members.ana, m.id, m.bodyHash, w.deps));
      expect(r).toMatchObject({ outcome: "uncertain", send: { status: "uncertain", code: "provider_uncertain", canResolve: true, canRetry: false } });
      expect(w.world.messages.get(m.id)!.status).toBe("sending"); // what keeps "I sent it", open-in-app, edit and discard out (outreach-mvp tests)
      expect(w.fake.outbox).toHaveLength(delivered ? 1 : 0);
      for (let i = 0; i < 3; i++) expect(failed(await sendApproved(w.members.ana, m.id, m.bodyHash, w.deps)).code).toBe("in_flight");
      expect(w.fake.calls.filter((c) => c.op === "send")).toHaveLength(1);
      expect(w.afterSent).toHaveLength(0);
    });
  }

  it("an ambiguous provider answer (a 5xx, an unknown error) is uncertain too, never failed", async () => {
    const w = makeWorld();
    await w.connect("ana");
    for (const kind of ["unavailable", "identity_invalid"] as const) {
      const m = w.approved();
      w.fake.failNext("send", kind);
      expect(ok(await sendApproved(w.members.ana, m.id, m.bodyHash, w.deps)).outcome).toBe("uncertain");
    }
    const m = w.approved();
    const p = w.deps.provider({} as any);
    const crashing = { ...w.deps, provider: () => Object.assign(Object.create(p), { send: async () => { throw new TypeError("socket hang up"); } }) };
    expect(ok(await sendApproved(w.members.ana, m.id, m.bodyHash, crashing)).outcome).toBe("uncertain");
  });

  it("the process dies mid-send (no answer, ever): the lease runs out and the job becomes uncertain, not resent", async () => {
    const w = makeWorld();
    await w.connect("ana");
    const m = w.approved();
    w.fake.hangNext("send");
    void sendApproved(w.members.ana, m.id, m.bodyHash, w.deps); // never settles: the "crashed" worker
    await new Promise((r) => setTimeout(r, 20));
    expect(w.world.jobs[0]).toMatchObject({ status: "sending" });
    expect(ok(await sendStateFor(w.members.ana, m.id, w.deps)).send).toMatchObject({ status: "sending" });
    w.tick(SEND_LEASE_MS + 1);
    expect(ok(await sendStateFor(w.members.ana, m.id, w.deps)).send).toMatchObject({ status: "uncertain", code: "lease_expired", canResolve: true });
    expect(failed(await sendApproved(w.members.ana, m.id, m.bodyHash, w.deps)).code).toBe("in_flight");
    expect(w.fake.calls.filter((c) => c.op === "send")).toHaveLength(1);
  });

  it("a late confirmation after the lease ran out still records the send (from uncertain), once", async () => {
    const w = makeWorld();
    await w.connect("ana");
    const m = w.approved();
    w.fake.delayNext("send", 40);
    const pending = sendApproved(w.members.ana, m.id, m.bodyHash, w.deps);
    await new Promise((r) => setTimeout(r, 10));
    w.tick(SEND_LEASE_MS + 1);
    await w.world.recoverExpired({ now: w.clock });
    expect(w.world.jobs[0].status).toBe("uncertain");
    expect(ok(await pending).outcome).toBe("sent");
    expect(w.world.jobs[0]).toMatchObject({ status: "sent", providerMessageId: w.fake.outbox[0].providerMessageId });
    expect(w.afterSent).toHaveLength(1);
  });

  it("a person settles an expired send as sent, then Gmail's late confirmation arrives: recorded once, one follow-up", async () => {
    const w = makeWorld();
    await w.connect("ana");
    const m = w.approved();
    w.fake.delayNext("send", 40);
    const pending = sendApproved(w.members.ana, m.id, m.bodyHash, w.deps);
    await new Promise((r) => setTimeout(r, 10));
    w.tick(SEND_LEASE_MS + 1);
    expect(ok(await resolveSend(w.members.ana, m.id, { decision: "sent" }, w.deps)).send.status).toBe("sent");
    expect(ok(await pending).outcome).toBe("sent");
    expect(w.afterSent).toEqual([{ actor: "ana", leadId: m.leadId, messageId: m.id, via: "gmail_confirmed" }]);
    expect(w.world.events.filter((e) => e.kind === "sent")).toHaveLength(1);
    expect(w.world.jobs[0]).toMatchObject({ status: "sent", resolvedBy: "ana" });
  });

  it("the database fails after Gmail accepted it: the write is retried, never the send; the job stays in flight, then uncertain", async () => {
    const w = makeWorld();
    await w.connect("ana");
    const m = w.approved();
    let writes = 0;
    const broken = { ...w.deps, sends: Object.assign(Object.create(w.world), { finishSent: async () => { writes++; throw new Error("connection terminated"); } }) };
    const r = ok(await sendApproved(w.members.ana, m.id, m.bodyHash, broken));
    expect(r).toMatchObject({ outcome: "uncertain", send: { code: "unrecorded" } });
    expect(writes).toBe(3);
    expect(w.fake.outbox).toHaveLength(1);
    expect(w.logs.some((l) => l.event === "gmail_send_unrecorded")).toBe(true);
    // every later attempt is refused; once the lease is out it is uncertain, for a person to settle
    expect(failed(await sendApproved(w.members.ana, m.id, m.bodyHash, w.deps)).code).toBe("in_flight");
    w.tick(SEND_LEASE_MS + 1);
    expect(ok(await sendStateFor(w.members.ana, m.id, w.deps)).send).toMatchObject({ status: "uncertain", code: "lease_expired" });
    expect(w.fake.calls.filter((c) => c.op === "send")).toHaveLength(1);
    expect(w.afterSent).toHaveLength(0);
  });
});

describe("sending: settling an uncertain send", () => {
  async function uncertain() {
    const w = makeWorld();
    await w.connect("ana");
    const m = w.approved();
    w.fake.failNext("send", "uncertain", { delivered: true });
    ok(await sendApproved(w.members.ana, m.id, m.bodyHash, w.deps));
    return { w, m };
  }

  it("'it's in my Sent folder': recorded as sent by that person, with when and what they decided; follow-up once", async () => {
    const { w, m } = await uncertain();
    w.tick(60_000);
    const r = ok(await resolveSend(w.members.ana, m.id, { decision: "sent" }, w.deps));
    expect(r).toMatchObject({ messageStatus: "sent", send: { status: "sent", canResolve: false } });
    expect(w.world.jobs[0]).toMatchObject({ status: "sent", resolvedBy: "ana", resolvedAt: w.clock, providerMessageId: null });
    expect(w.world.events).toEqual([
      expect.objectContaining({ kind: "sent", source: "manual", provider: "gmail", actorUserId: "ana" }),
      expect.objectContaining({ kind: "follow_due", source: "manual", provider: "gmail", actorUserId: "ana" }),
    ]);
    expect(w.leadEvents.at(-1)).toMatchObject({ kind: "message_send_resolved", data: { messageId: m.id, decision: "sent", requestedBy: "ana" }, actor: "ana" });
    expect(w.afterSent).toEqual([{ actor: "ana", leadId: m.leadId, messageId: m.id, via: "gmail_confirmed" }]);
    expect(failed(await resolveSend(w.members.ana, m.id, { decision: "sent" }, w.deps)).code).toBe("not_uncertain");
    expect(failed(await resolveSend(w.members.ana, m.id, { decision: "not_sent" }, w.deps)).code).toBe("not_uncertain");
    expect(w.afterSent).toHaveLength(1);
  });

  it("'it isn't there': approved again for a deliberate resend with the same Message-ID; discarded instead if the lead became do-not-contact", async () => {
    const { w, m } = await uncertain();
    const rfc = w.world.jobs[0].rfcMessageId;
    expect(ok(await resolveSend(w.members.ana, m.id, { decision: "not_sent" }, w.deps))).toMatchObject({ messageStatus: "approved", send: { status: "failed", code: "resolved_not_sent", canRetry: true } });
    expect(w.world.jobs[0]).toMatchObject({ resolvedBy: "ana" });
    expect(w.afterSent).toHaveLength(0);
    expect(ok(await sendApproved(w.members.ana, m.id, m.bodyHash, w.deps)).outcome).toBe("sent");
    expect(w.world.jobs[0]).toMatchObject({ attempts: 2, rfcMessageId: rfc });
    const second = await uncertain();
    second.w.world.leads.get(second.m.leadId)!.doNotContact = true;
    expect(ok(await resolveSend(second.w.members.ana, second.m.id, { decision: "not_sent" }, second.w.deps)).messageStatus).toBe("cancelled");
  });

  it("only the sender (who can see their Sent folder) may settle it; an admin only once the sender has left; never another org", async () => {
    const { w, m } = await uncertain();
    for (const who of ["ben", "acct", "zed"]) expect(failed(await resolveSend(w.members[who], m.id, { decision: "sent" }, w.deps)).code, who).toMatch(/not_allowed|not_found/);
    expect(failed(await resolveSend(w.members.admin, m.id, { decision: "sent" }, w.deps)).code).toBe("not_allowed");
    expect(ok(await sendStateFor(w.members.admin, m.id, w.deps)).send!.canResolve).toBe(false);
    w.world.users.get("ana")!.memberStatus = "removed";
    expect(ok(await sendStateFor(w.members.admin, m.id, w.deps)).send!.canResolve).toBe(true);
    expect(ok(await resolveSend(w.members.admin, m.id, { decision: "not_sent" }, w.deps)).send.status).toBe("failed");
    expect(w.world.jobs[0].resolvedBy).toBe("admin");
    expect(failed(await resolveSend(w.members.ana, m.id, { decision: "maybe" }, w.deps)).code).toBe("invalid");
  });

  it("can't settle a send that is still in flight (its lease not yet out)", async () => {
    const w = makeWorld();
    await w.connect("ana");
    const m = w.approved();
    w.fake.hangNext("send");
    void sendApproved(w.members.ana, m.id, m.bodyHash, w.deps);
    await new Promise((r) => setTimeout(r, 20));
    expect(failed(await resolveSend(w.members.ana, m.id, { decision: "not_sent" }, w.deps)).code).toBe("not_uncertain");
  });
});

describe("sending: limits and switches", () => {
  it("the plan's send allowance: counted across the WORKSPACE's mailboxes over 30 days; a failed send frees its slot", async () => {
    const w = makeWorld();
    w.deps.planSendCap = async () => ({ since: new Date(w.clock.getTime() - 30 * 86_400_000), max: 2 });
    await w.connect("ana"); await w.connect("ben");
    const [a, b, c, d] = [w.approved(), w.approved(), w.approved(), w.approved()];
    ok(await sendApproved(w.members.ana, a.id, a.bodyHash, w.deps));
    w.fake.failNext("send", "rejected");                                   // certainly not accepted: frees its slot
    expect(ok(await sendApproved(w.members.ben, b.id, b.bodyHash, w.deps)).outcome).toBe("failed");
    ok(await sendApproved(w.members.ben, c.id, c.bodyHash, w.deps));
    const r = failed(await sendApproved(w.members.ana, d.id, d.bodyHash, w.deps)); // a different mailbox, the same workspace
    expect(r).toMatchObject({ status: 429, code: "plan_send_limit" });
    expect(r.message).toMatch(/Nothing was sent/);
    expect(w.fake.outbox.map((x) => x.to)).toEqual([a.toAddress, c.toAddress]);
  });

  it("two messages racing for the plan's last send: exactly one goes", async () => {
    const w = makeWorld();
    w.deps.planSendCap = async () => ({ since: new Date(w.clock.getTime() - 30 * 86_400_000), max: 1 });
    await w.connect("ana");
    const [a, b] = [w.approved(), w.approved()];
    w.fake.delayNext("send", 20);
    const rs = await Promise.all([sendApproved(w.members.ana, a.id, a.bodyHash, w.deps), sendApproved(w.members.ana, b.id, b.bodyHash, w.deps)]);
    expect(rs.map((x) => (x.ok ? x.outcome : x.code)).sort()).toEqual(["plan_send_limit", "sent"]);
    expect(w.fake.outbox).toHaveLength(1);
  });

  it("the per-mailbox daily cap: counts sends and anything in flight or uncertain over a rolling 24 hours, across reconnects", async () => {
    const w = makeWorld({ env: { MAIL_SEND_DAILY_CAP: "2" } });
    await w.connect("ana");
    const [a, b, c] = [w.approved(), w.approved(), w.approved()];
    ok(await sendApproved(w.members.ana, a.id, a.bodyHash, w.deps));
    w.fake.failNext("send", "uncertain");
    ok(await sendApproved(w.members.ana, b.id, b.bodyHash, w.deps));
    expect(failed(await sendApproved(w.members.ana, c.id, c.bodyHash, w.deps))).toMatchObject({ status: 429, code: "daily_cap" });
    // disconnecting and reconnecting the same account doesn't reset it
    await w.mailbox.disconnect({ orgId: "org-a", userId: "ana", keyring: null, now: w.clock });
    await w.connect("ana", { sub: "g-ana", email: "ana@agency.test", emailVerified: true });
    expect(failed(await sendApproved(w.members.ana, c.id, c.bodyHash, w.deps)).code).toBe("daily_cap");
    w.tick(24 * 3_600_000 + 1); // the sent one ages out; the uncertain one still counts
    ok(await resolveSend(w.members.ana, b.id, { decision: "not_sent" }, w.deps));
    expect(ok(await sendApproved(w.members.ana, c.id, c.bodyHash, w.deps)).outcome).toBe("sent");
    expect(w.fake.outbox.map((x) => x.to)).toEqual([a.toAddress, c.toAddress]);
  });

  it("two messages racing for the last slot of the cap: exactly one goes", async () => {
    const w = makeWorld({ env: { MAIL_SEND_DAILY_CAP: "1" } });
    await w.connect("ana");
    const [a, b] = [w.approved(), w.approved()];
    w.fake.delayNext("send", 20);
    const rs = await Promise.all([sendApproved(w.members.ana, a.id, a.bodyHash, w.deps), sendApproved(w.members.ana, b.id, b.bodyHash, w.deps)]);
    expect(rs.map((r) => (r.ok ? r.outcome : r.code)).sort()).toEqual(["daily_cap", "sent"]);
    expect(w.fake.outbox).toHaveLength(1);
  });

  it("an invalid cap, sending switched off, or the integration off: nothing sent, a plain reason", async () => {
    for (const env of [{ MAIL_SEND_DAILY_CAP: "lots" }, { GMAIL_INTEGRATION_ENABLED: "false" }, { NODE_ENV: "production" }]) {
      const w = makeWorld({ env });
      const m = w.approved();
      const r = failed(await sendApproved(w.members.ana, m.id, m.bodyHash, w.deps));
      expect(r.status, JSON.stringify(env)).toBe(503);
      expect(r.message).not.toMatch(/MAIL_|env|undefined|Error/);
      expect(w.fake.calls).toHaveLength(0);
    }
  });

  it("the real Gmail adapter can't send unless GMAIL_SENDING_ENABLED is on (config off, and the adapter itself refuses)", async () => {
    const w = makeWorld({ env: { MAIL_PROVIDER: "gmail", GMAIL_OAUTH_CLIENT_ID: "1-a.apps.googleusercontent.com", GMAIL_OAUTH_CLIENT_SECRET: "s" } });
    const m = w.approved();
    expect(failed(await sendApproved(w.members.ana, m.id, m.bodyHash, w.deps))).toMatchObject({ status: 503, code: "sending_disabled" });
    const g = new GmailProvider({ clientId: "1-a.apps.googleusercontent.com", clientSecret: "s", fetchImpl: (() => { throw new Error("network"); }) as any });
    await expect(g.send("ya29", { from: "a@b.test", to: "c@d.test", subject: "s", text: "t", rfcMessageId: "<a@b>" })).rejects.toBeInstanceOf(MailProviderError);
  });

  it("refusals are plain sentences with no internals", async () => {
    const w = makeWorld();
    await w.connect("ana");
    const m = w.approved();
    const rs = [
      await sendApproved(w.members.ana, m.id, "nope", w.deps),
      await sendApproved(w.members.ana, 999, m.bodyHash, w.deps),
      await resolveSend(w.members.ana, m.id, { decision: "sent" }, w.deps),
    ];
    for (const r of rs) {
      const f = failed(r);
      expect(f.message).toMatch(/^[A-Z].*[.]$/);
      expect(f.message).not.toMatch(/undefined|null|Error|stack|\{|token|sql/i);
    }
  });
});

describe("sending over HTTP", () => {
  it("same-origin JSON only; an uncertain send answers 202; failures are plain and carry no internals", async () => {
    const express = (await import("express")).default;
    const { registerGmailRoutes } = await import("./routes");
    const w = makeWorld();
    await w.connect("ana");
    const app = express();
    app.use(express.json());
    const who = (req: any) => w.members[String(req.get("x-test-user") ?? "")] ?? null;
    registerGmailRoutes(app, {
      status: w.deps.status, provider: w.deps.provider, store: w.mailbox, now: w.deps.now, log: w.deps.log,
      cleanup: () => ({ keyring: null, provider: null }), audit: () => {},
      auth: (req: any, res, next) => { const u = who(req); if (!u) return res.status(401).json({ message: "Unauthorized" }); req.user = u; next(); },
      currentUser: async (req) => who(req), send: w.deps,
    });
    const server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
      fetch(base + path, { method: "POST", headers: { "content-type": "application/json", "x-test-user": "ana", ...headers }, body: JSON.stringify(body) });
    try {
      const m = w.approved(), n = w.approved();
      expect((await post(`/api/integrations/gmail/messages/${m.id}/send`, { bodyHash: m.bodyHash }, { "sec-fetch-site": "cross-site" })).status).toBe(403);
      expect((await post(`/api/integrations/gmail/messages/${m.id}/send`, { bodyHash: m.bodyHash }, { origin: "https://evil.example" })).status).toBe(403);
      expect((await fetch(`${base}/api/integrations/gmail/messages/${m.id}/send`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-test-user": "ana" }, body: `bodyHash=${m.bodyHash}` })).status).toBe(415);
      expect(w.fake.outbox).toHaveLength(0);
      const sent = await post(`/api/integrations/gmail/messages/${m.id}/send`, { bodyHash: m.bodyHash });
      expect(sent.status).toBe(200);
      expect(await sent.json()).toMatchObject({ outcome: "sent", send: { status: "sent" } });
      w.fake.failNext("send", "uncertain");
      const unsure = await post(`/api/integrations/gmail/messages/${n.id}/send`, { bodyHash: n.bodyHash });
      expect(unsure.status).toBe(202);
      expect((await (await fetch(`${base}/api/integrations/gmail/messages/${n.id}/send`, { headers: { "x-test-user": "ana" } })).json()).send).toMatchObject({ status: "uncertain", canResolve: true });
      const benTry = await post(`/api/integrations/gmail/messages/${n.id}/resolve`, { decision: "sent" }, { "x-test-user": "ben" });
      expect(benTry.status).toBe(403);
      expect(await benTry.json()).toEqual({ code: "not_allowed", error: expect.stringMatching(/^Only the person who sent it/) });
      expect((await post(`/api/integrations/gmail/messages/${n.id}/resolve`, { decision: "not_sent" })).status).toBe(200);
      w.deps.sends.reserve = async () => { throw new Error("relation \"mail_send_jobs\" does not exist at /srv/app"); };
      const boom = await post(`/api/integrations/gmail/messages/${n.id}/send`, { bodyHash: n.bodyHash });
      expect(boom.status).toBe(500);
      expect(await boom.json()).toEqual({ code: "internal", error: "Something went wrong on our side." });
      expect(JSON.stringify(w.logs)).not.toContain("/srv/app");
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});

describe("reliability audit (each case reproduced a defect before its fix)", () => {
  it("exact content: a body with a carriage return or a control character is refused before anything is reserved or sent", async () => {
    const w = makeWorld();
    await w.connect("ana");
    for (const body of ["Line one\rLine two", "Tab\tis fine\nbut this\u0007 isn't", "Null\u0000byte"]) {
      const m = w.approved({ body });
      expect(failed(await sendApproved(w.members.ana, m.id, m.bodyHash, w.deps)).code, JSON.stringify(body)).toBe("invalid_content");
    }
    expect(w.fake.outbox).toHaveLength(0);
    expect(w.world.jobs).toHaveLength(0);
    const tab = w.approved({ body: "Tab\there\nnext line" });
    expect(ok(await sendApproved(w.members.ana, tab.id, tab.bodyHash, w.deps)).outcome).toBe("sent");
  });

  it("exact content: what leaves hashes back to the approval, for unicode, tabs, inner blank lines and trimmed edges", async () => {
    const w = makeWorld();
    await w.connect("ana");
    for (const [subject, body] of [["Olá — café ☕", "Primeira linha\n\n\tsegunda — 💡\n\nfim"], ["  Spaced subject  ", "\n\nBody with edges\n\n"]]) {
      const m = w.approved({ subject, body });
      ok(await sendApproved(w.members.ana, m.id, m.bodyHash, w.deps));
      const raw = w.fake.outbox.at(-1)!.raw;
      const at = raw.indexOf("\r\n\r\n");
      const sentBody = Buffer.from(raw.slice(at + 4).replace(/\r\n/g, ""), "base64").toString("utf8").replace(/\r\n/g, "\n");
      const sentSubject = w.fake.outbox.at(-1)!.subject;
      expect(hashDraft(sentSubject, sentBody)).toBe(m.bodyHash);
      expect(sentSubject).toBe(subject.trim());
      expect(sentBody).toBe(body.trim());
    }
    // changing either one alone breaks the approval
    expect(hashDraft("Olá — café ☕", "x")).not.toBe(hashDraft("Olá — café", "x"));
    expect(hashDraft("s", "body")).not.toBe(hashDraft("s", "body "+"!"));
  });

  it("outcome follows the stored state: a refusal that arrives after the lease ran out is reported uncertain, as the job is", async () => {
    const w = makeWorld();
    await w.connect("ana");
    const m = w.approved();
    w.fake.delayNext("send", 30);
    w.fake.failNext("send", "rejected");
    const p = sendApproved(w.members.ana, m.id, m.bodyHash, w.deps);
    await new Promise((r) => setTimeout(r, 5));
    w.tick(SEND_LEASE_MS + 1);
    await w.world.recoverExpired({ now: w.clock });
    const r = ok(await p);
    expect([r.outcome, r.send.status]).toEqual(["uncertain", "uncertain"]);
    expect(w.world.messages.get(m.id)!.status).toBe("sending");
  });

  it("reading or settling a send needs permission to read leads (a custom role without it gets nothing)", async () => {
    const w = makeWorld();
    await w.connect("ana");
    const m = w.approved();
    w.fake.failNext("send", "uncertain");
    ok(await sendApproved(w.members.ana, m.id, m.bodyHash, w.deps));
    const nobody = { id: "nobody", organizationId: "org-a", memberStatus: "active", orgRole: "CUSTOM", customPermissions: [] as string[] };
    expect(failed(await sendStateFor(nobody, m.id, w.deps))).toMatchObject({ status: 403, code: "forbidden" });
    const teamOnly = { ...nobody, id: "team", customPermissions: ["team.manage"] };
    w.world.users.get("ana")!.memberStatus = "removed";
    expect(failed(await resolveSend(teamOnly, m.id, { decision: "not_sent" }, w.deps)).code).toBe("not_allowed");
    expect(ok(await resolveSend(w.members.admin, m.id, { decision: "not_sent" }, w.deps)).send.status).toBe("failed");
  });

  it("a late confirmation of an attempt that no longer owns the job (after 'not sent' and a retry) is recorded, not dropped", async () => {
    const w = makeWorld();
    await w.connect("ana");
    const m = w.approved();
    w.fake.delayNext("send", 40);
    const first = sendApproved(w.members.ana, m.id, m.bodyHash, w.deps);
    await new Promise((r) => setTimeout(r, 5));
    w.tick(SEND_LEASE_MS + 1);
    ok(await resolveSend(w.members.ana, m.id, { decision: "not_sent" }, w.deps));
    expect(ok(await sendApproved(w.members.ana, m.id, m.bodyHash, w.deps)).outcome).toBe("sent"); // attempt 2
    await first; // Gmail now confirms attempt 1: two copies went out
    expect(w.fake.outbox).toHaveLength(2);
    expect(w.leadEvents).toContainEqual(expect.objectContaining({ kind: "message_send_late_confirmation", data: { messageId: m.id, attempt: 1 } }));
    expect(w.logs.some((l) => l.event === "gmail_send_late_confirmation")).toBe(true);
    expect(w.world.jobs[0]).toMatchObject({ status: "sent", attempts: 2 }); // the record isn't rewritten
    expect(w.afterSent).toHaveLength(1);
  });
});

describe("sending: only for organizations the integration is switched on for", () => {
  it("an organization outside GMAIL_ALLOWED_ORG_IDS can't send, even with a connected mailbox", async () => {
    const w = makeWorld({ env: { GMAIL_ALLOWED_ORG_IDS: "org-b" } });
    await w.connect("ana");
    const m = w.approved();
    expect(failed(await sendApproved(w.members.ana, m.id, m.bodyHash, w.deps))).toMatchObject({ status: 503, code: "unavailable" });
    expect(w.fake.calls.filter((c) => c.op === "send")).toHaveLength(0);
    const listed = makeWorld({ env: { GMAIL_ALLOWED_ORG_IDS: "org-a" } });
    await listed.connect("ana");
    const n = listed.approved();
    expect(ok(await sendApproved(listed.members.ana, n.id, n.bodyHash, listed.deps)).outcome).toBe("sent");
  });
});

describe("sending through the real Gmail adapter, with Google stubbed (failure injection)", () => {
  const ACCESS = "ya29.PIPELINE-ACCESS-TOKEN";
  const REFRESH = "1//PIPELINE-REFRESH-TOKEN";
  const gjson = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  const gErr = (code: number, reason: string) => gjson(code, { error: { code, message: "x", errors: [{ reason }] } });

  /** Ana's Gmail connected (as the real adapter's mailbox), and Google answering each send with `answer(n)`. */
  async function gmailWorld(answer: (n: number) => Response | Promise<Response>, opts: { delayMs?: number } = {}) {
    const w = makeWorld();
    const sends: { auth: string; raw: string }[] = [];
    const fetchImpl = (async (url: any, init: any) => {
      if (String(url) === GOOGLE_TOKEN_URL) return gjson(200, { access_token: ACCESS, expires_in: 3599, token_type: "Bearer", scope: `openid https://www.googleapis.com/auth/userinfo.email ${GMAIL_SEND_SCOPE}` });
      if (String(url) !== GMAIL_SEND_URL) throw new Error(`unexpected request to ${url}`);
      sends.push({ auth: init.headers.Authorization, raw: JSON.parse(init.body).raw });
      const n = sends.length;
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      // like a real fetch: the request's timeout signal aborts it
      return new Promise<Response>((resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal.reason));
        Promise.resolve().then(() => answer(n)).then(resolve, reject);
      });
    }) as unknown as typeof fetch;
    const gmail = new GmailProvider({ clientId: "1-a.apps.googleusercontent.com", clientSecret: "s", fetchImpl, now: () => w.clock, sendingEnabled: true, sendTimeoutMs: 50 });
    w.deps.provider = () => gmail;
    const saved = await w.mailbox.save({ orgId: "org-a", userId: "ana", provider: "gmail", account: { sub: "g-ana", email: "ana@agency.test" }, scopes: normalizeScopes(["openid", "email", GMAIL_SEND_SCOPE]), refreshToken: REFRESH, keyring: loadKeyring(KEYS), now: w.clock });
    if (!saved.ok) throw new Error(saved.code);
    return { ...w, sends, connection: saved.connection };
  }
  const decode = (raw: string) => Buffer.from(raw, "base64url").toString("utf8");

  it("Gmail accepts: exactly the approved text leaves once, with the fresh access token; recorded with Gmail's ids; follow-up once", async () => {
    const w = await gmailWorld(() => gjson(200, { id: "18f2aa", threadId: "18f2aa" }));
    const m = w.approved();
    const r = ok(await sendApproved(w.members.ana, m.id, m.bodyHash, w.deps));
    expect(r.outcome).toBe("sent");
    expect(w.sends).toHaveLength(1);
    expect(w.sends[0].auth).toBe(`Bearer ${ACCESS}`);
    const { headers, body } = parse(decode(w.sends[0].raw));
    expect([headers.From, headers.To, headers.Subject]).toEqual(['"Ana Silva" <ana@agency.test>', m.toAddress, SUBJECT]);
    expect(hashDraft(headers.Subject, body.replace(/\r\n/g, "\n"))).toBe(m.bodyHash);
    expect(w.world.jobs[0]).toMatchObject({ status: "sent", providerMessageId: "18f2aa", providerThreadId: "18f2aa", attempts: 1 });
    expect(headers["Message-ID"]).toBe(w.world.jobs[0].rfcMessageId);
    expect(w.world.events.map((e) => e.kind)).toEqual(["sent", "follow_due"]);
    expect(w.afterSent).toHaveLength(1);
    expect(ok(await sendApproved(w.members.ana, m.id, m.bodyHash, w.deps)).outcome).toBe("already_sent");
    expect(w.sends).toHaveLength(1);
    const logged = JSON.stringify(w.logs);
    for (const secret of [ACCESS, REFRESH, SUBJECT, m.toAddress!]) expect(logged).not.toContain(secret);
  });

  it.each([
    ["a 500", () => gErr(500, "backendError")],
    ["a 503 with no body", () => new Response("", { status: 503 })],
    ["a dropped connection", () => { throw new TypeError("socket hang up"); }],
    ["no answer before the send timeout", () => new Promise<Response>(() => {})],
    ["a 200 that names no message", () => gjson(200, {})],
  ])("%s: uncertain, sent once and never again; the message stays held for the sender to settle", async (_label, answer) => {
    const w = await gmailWorld(answer as () => Response);
    const m = w.approved();
    const r = ok(await sendApproved(w.members.ana, m.id, m.bodyHash, w.deps));
    expect(r.outcome).toBe("uncertain");
    expect(r.send).toMatchObject({ status: "uncertain", canResolve: true, canRetry: false });
    expect(w.sends).toHaveLength(1);
    expect(w.world.messages.get(m.id)!.status).toBe("sending");
    expect(w.afterSent).toHaveLength(0);
    expect(w.leadEvents.map((e) => e.kind)).toEqual(["message_send_uncertain"]);
    // a second click, a stale tab, a later visit: nothing is sent again until a person settles it
    expect(failed(await sendApproved(w.members.ana, m.id, m.bodyHash, w.deps)).code).toBe("in_flight");
    w.tick(SEND_LEASE_MS * 3);
    expect(failed(await sendApproved(w.members.ana, m.id, m.bodyHash, w.deps)).code).toBe("in_flight");
    expect(w.sends).toHaveLength(1);
    expect(ok(await resolveSend(w.members.ana, m.id, { decision: "sent" }, w.deps)).messageStatus).toBe("sent");
    expect(w.afterSent).toHaveLength(1);
  });

  it("rate limited (proven not sent): retried with bounded backoff honouring Retry-After, then sent once", async () => {
    const w = await gmailWorld((n) => (n < TRANSIENT_TRIES ? gjson(429, { error: { code: 429, errors: [{ reason: "rateLimitExceeded" }] } }, { "retry-after": "2" }) : gjson(200, { id: "r1", threadId: "r1" })));
    const m = w.approved();
    expect(ok(await sendApproved(w.members.ana, m.id, m.bodyHash, w.deps)).outcome).toBe("sent");
    expect(w.sends).toHaveLength(TRANSIENT_TRIES);
    expect(new Set(w.sends.map((s) => parse(decode(s.raw)).headers["Message-ID"])).size).toBe(1); // the same message each time
    expect(w.sleeps.every((ms) => ms >= 1_000 && ms <= 4_000)).toBe(true);
  });

  it("Gmail refuses (bad request, expired token, API switched off): failed, nothing sent, approved again for a deliberate retry", async () => {
    for (const answer of [() => gErr(400, "invalidArgument"), () => gErr(401, "authError"), () => gErr(403, "accessNotConfigured")]) {
      const w = await gmailWorld(answer);
      const m = w.approved();
      const r = ok(await sendApproved(w.members.ana, m.id, m.bodyHash, w.deps));
      expect(r.outcome).toBe("failed");
      expect(r.send).toMatchObject({ status: "failed", canRetry: true });
      expect(w.sends).toHaveLength(1);
      expect(w.world.messages.get(m.id)!.status).toBe("approved");
      expect(w.mailbox.rows[0].status).toBe("active"); // a refusal of one send doesn't condemn the mailbox
    }
  });

  it("the connection lacks the send permission at Gmail: blocked, and the mailbox is marked for reconnecting", async () => {
    const w = await gmailWorld(() => gErr(403, "insufficientPermissions"));
    const m = w.approved();
    const r = ok(await sendApproved(w.members.ana, m.id, m.bodyHash, w.deps));
    expect(r).toMatchObject({ outcome: "failed", reconnect: true, send: { status: "blocked", code: "missing_send_scope" } });
    expect(w.mailbox.rows[0]).toMatchObject({ status: "needs_reconnect", lastErrorCode: "missing_send_scope" });
    expect(w.world.messages.get(m.id)!.status).toBe("approved");
  });

  it("a double click while Gmail is slow: one request reaches Gmail", async () => {
    const w = await gmailWorld(() => gjson(200, { id: "d1" }), { delayMs: 20 });
    const m = w.approved();
    const rs = await Promise.all([1, 2, 3].map(() => sendApproved(w.members.ana, m.id, m.bodyHash, w.deps)));
    expect(rs.map((x) => (x.ok ? x.outcome : x.code)).sort()).toEqual(["in_flight", "in_flight", "sent"]);
    expect(w.sends).toHaveLength(1);
  });
});
