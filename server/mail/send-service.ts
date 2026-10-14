/**
 * Sending an approved outreach message from the person's own connected mailbox (Gmail Release A, Milestone 2).
 * Everything is injected, so the whole pipeline runs in tests against FakeMailProvider with either store.
 *
 *   1. checks that need no lock (switches, role, the mailbox usable, a fresh access token from the provider);
 *   2. the reservation: one transaction re-checking everything under the outreach locks (send-store.ts), committed;
 *   3. the provider call, outside any transaction, of exactly the approved subject and body, with our stable Message-ID;
 *   4. the outcome, written with a conditional update fenced by the attempt:
 *        confirmed  → sent (Gmail's ids), the "sent" event, then the lead moves on and the follow-up is created, once;
 *        refused    → failed (or blocked, for a mailbox problem): nothing was accepted, the message is approved again;
 *        unknown    → uncertain: never retried automatically; a person checks their Sent folder and says what happened.
 *
 * Only a refusal that proves nothing was accepted (the provider asking us to slow down) is retried here, a few times,
 * with exponential backoff and jitter. A confirmed send whose recording fails is retried as a database write only; if
 * that still fails the job stays "sending", its lease runs out and it becomes uncertain. Nothing ever resends it.
 * Logs carry ids and codes only: never the message, an address, a token or a provider response.
 */
import { randomBytes } from "node:crypto";
import { canReadModule, memberCan } from "@shared/permissions";
import { RESOLVE_DECISIONS, sendMessage, type ResolveDecision, type SendOutcome, type SendView } from "@shared/gmail-connect";
import { sendingAvailability, type GmailStatus } from "./config";
import { mayConnect, type Member } from "./connect-service";
import type { MailboxStore } from "./mailbox-store";
import { capabilitiesOf, MailProviderError, type MailProvider } from "./provider";
import type { ReserveRefusal, SendJobView, SendStore } from "./send-store";
import type { GmailConfig } from "./config";

export const SEND_LEASE_MS = 5 * 60_000; // far longer than one provider call (its timeout is seconds)
export const TRANSIENT_TRIES = 3;
const BACKOFF_BASE_MS = 400, BACKOFF_CAP_MS = 4_000, RECORD_TRIES = 3;

export interface SendDeps {
  status(): Promise<GmailStatus>;
  provider(config: GmailConfig): MailProvider;
  mailbox: MailboxStore;
  sends: SendStore;
  now(): Date;
  sleep(ms: number): Promise<void>;
  random(): number;
  /** Whether the do-not-contact list's tables exist. Throws when that can't be told: then nothing is sent. */
  listReady(): Promise<boolean>;
  /** After a confirmed send (once): move the lead on, add the follow-up, note it on the lead's timeline. */
  afterSent(actor: Member, info: { leadId: number; messageId: number; via: "gmail" | "gmail_confirmed" }): Promise<void>;
  leadEvent(orgId: string, leadId: number, kind: string, data: Record<string, string | number | boolean | null>, actorUserId: string): Promise<void>;
  /** Whether a member is still active in the organization (an admin may settle an uncertain send only once its sender has left). */
  isActiveMember(orgId: string, userId: string): Promise<boolean>;
  log(event: string, fields?: Record<string, string | number | boolean | null>): void;
}

export type Fail = { ok: false; status: number; code: string; message: string };
const fail = (status: number, code: string, message: string): Fail => ({ ok: false, status, code, message });

export function sendView(job: SendJobView, viewer: Member, canResolve = false): SendView {
  return {
    messageId: job.messageId, status: job.status, code: job.errorCode, message: sendMessage(job.status, job.errorCode), attempts: job.attempts,
    sentAt: job.sentAt?.toISOString() ?? null, resolvedAt: job.resolvedAt?.toISOString() ?? null,
    canResolve: job.status === "uncertain" && (canResolve || job.requestedBy === viewer.id),
    canRetry: job.status === "failed" || job.status === "blocked",
  };
}

const REFUSALS: Record<ReserveRefusal, [number, string]> = {
  not_found: [404, "That message isn't in your workspace."],
  not_approved: [409, "Approve the message before you send it."],
  already_sent: [409, "That message has already been sent."],
  in_flight: [409, "That message is being sent, or waiting for you to confirm whether it went out. Nothing was sent again."],
  changed: [409, "The message changed since you read it. Reload it, read it again, and approve it before sending."],
  invalid_content: [409, "This message can't be sent as it is (its subject must be one line, and the text must match what was approved). Edit and approve it again."],
  no_address: [422, "This message has no valid email address."],
  do_not_contact: [409, "This lead is marked do-not-contact, so nothing can be sent to it."],
  suppressed: [409, "This address or its domain is on your do-not-contact list, so nothing can be sent to it."],
  not_member: [403, "You're no longer a member of this organization."],
  not_allowed: [403, "Your role doesn't allow sending messages. Ask your organization owner."],
  mailbox_unavailable: [409, "Connect your Gmail in Settings (or reconnect it) to send from it."],
  missing_send_scope: [409, "Your Gmail connection can't send email. Reconnect it in Settings and keep \"Send email on your behalf\" ticked."],
  daily_cap: [429, "You've reached today's sending limit for this mailbox. Nothing was sent; try again tomorrow."],
};

/** What a stored job says happened, when a conditional write didn't apply (someone else settled it first). */
const outcomeOf = (job: SendJobView | null | undefined, fallback: SendOutcome): SendOutcome =>
  !job ? fallback : job.status === "sent" ? "sent" : job.status === "failed" || job.status === "blocked" ? "failed" : "uncertain";

/** Gates every send-related call shares: integration on, sending possible in this build, and the cap valid. */
async function sendingGate(deps: SendDeps): Promise<Fail | { ok: true; config: GmailConfig; cap: number }> {
  const s = await deps.status();
  if (!s.enabled) return fail(503, "unavailable", "Sending from Gmail isn't available right now.");
  const a = sendingAvailability(s.config);
  if (!a.ok) return fail(503, a.reason, a.reason === "cap_invalid" ? "Sending is switched off until its daily limit is configured correctly." : "Sending from Gmail isn't switched on yet. Open the message in your email app instead.");
  return { ok: true, config: s.config, cap: a.cap };
}

const backoff = (n: number, random: number, hintMs?: number) =>
  Math.min(BACKOFF_CAP_MS, Math.max(hintMs ?? 0, BACKOFF_BASE_MS * 2 ** n) * (0.5 + random / 2));

/** Runs `op`, retrying only failures that prove the provider did nothing (rate limits; for a token refresh, outages too). */
async function withTransientRetry<T>(op: () => Promise<T>, retryable: (e: MailProviderError) => boolean, deps: SendDeps): Promise<T> {
  for (let n = 0; ; n++) {
    try { return await op(); } catch (e) {
      if (!(e instanceof MailProviderError) || !retryable(e) || n >= TRANSIENT_TRIES - 1) throw e;
      await deps.sleep(backoff(n, deps.random(), e.retryAfterMs));
    }
  }
}

/**
 * Sends message `messageId` (the text the person is looking at: `bodyHash`) from their own mailbox.
 * Outcomes: sent, uncertain (check your Sent folder), failed (nothing went out), already_sent.
 */
export async function sendApproved(user: Member, messageId: number, bodyHash: unknown, deps: SendDeps): Promise<Fail | { ok: true; outcome: SendOutcome; send: SendView; reconnect?: boolean }> {
  const gate = await sendingGate(deps);
  if (!gate.ok) return gate;
  if (!mayConnect(user)) return fail(403, "not_allowed", REFUSALS.not_allowed[1]);
  if (typeof bodyHash !== "string" || !/^[a-f0-9]{64}$/.test(bodyHash)) return fail(400, "invalid", "Send the message you are looking at.");
  if (!Number.isSafeInteger(messageId) || messageId <= 0) return fail(404, "not_found", REFUSALS.not_found[1]);
  const orgId = user.organizationId, { config } = gate;
  const provider = deps.provider(config);
  await deps.sends.recoverExpired({ orgId, now: deps.now() });

  // The mailbox, and a fresh access token, before anything is reserved: a dead connection reserves nothing.
  const conn = await deps.mailbox.live(orgId, user.id, provider.id);
  if (!conn || conn.status !== "active") return fail(409, conn ? "mailbox_reconnect" : "no_mailbox", REFUSALS.mailbox_unavailable[1]);
  if (!capabilitiesOf(conn.scopes).send) return fail(409, "missing_send_scope", REFUSALS.missing_send_scope[1]);
  const t = await deps.mailbox.token(orgId, user.id, provider.id, config.keyring);
  if (!t || t.refreshToken === null) {
    if (t) await deps.mailbox.markProblem({ orgId, id: t.connection.id, code: "token_unreadable", clearToken: true, now: deps.now() });
    return fail(409, "mailbox_reconnect", REFUSALS.mailbox_unavailable[1]);
  }
  let accessToken: string;
  try {
    const access = await withTransientRetry(() => provider.refreshAccessToken(t.refreshToken), (e) => e.kind === "unavailable" || e.kind === "rate_limited", deps);
    if (access.scopes.length && !capabilitiesOf(access.scopes).send) {
      await deps.mailbox.markProblem({ orgId, id: conn.id, code: "missing_send_scope", clearToken: false, now: deps.now() });
      return fail(409, "missing_send_scope", REFUSALS.missing_send_scope[1]);
    }
    accessToken = access.accessToken;
  } catch (e) {
    const kind = e instanceof MailProviderError ? e.kind : "error";
    deps.log("gmail_send_refresh_failed", { kind });
    if (kind === "invalid_grant") {
      await deps.mailbox.markProblem({ orgId, id: conn.id, code: "revoked", clearToken: true, now: deps.now() });
      return fail(409, "mailbox_reconnect", "Google no longer accepts your Gmail connection. Reconnect it in Settings. Nothing was sent.");
    }
    if (kind === "insufficient_scope") {
      await deps.mailbox.markProblem({ orgId, id: conn.id, code: "missing_send_scope", clearToken: false, now: deps.now() });
      return fail(409, "missing_send_scope", REFUSALS.missing_send_scope[1]);
    }
    return fail(503, "provider_unavailable", "Gmail couldn't be reached, so nothing was sent. Try again in a moment.");
  }

  // Sending needs the do-not-contact list and the outcome tables (the follow-up's outbox): without them, nothing is sent.
  let checkList: boolean;
  try { checkList = await deps.listReady(); } catch { return fail(503, "suppression_unavailable", "Your do-not-contact list couldn't be checked, so nothing was sent. Try again shortly."); }
  if (!checkList) return fail(503, "outreach_not_setup", "Sending from Gmail needs the do-not-contact list, which isn't set up on this server yet.");

  const r = await deps.sends.reserve({
    orgId, userId: user.id, messageId, expectedHash: bodyHash, connectionId: conn.id, provider: provider.id, checkList,
    dailyCap: gate.cap, now: deps.now(), leaseMs: SEND_LEASE_MS, newRfcMessageId: `<dis-${randomBytes(16).toString("hex")}@dealinsec.com>`,
  });
  if (!r.ok) {
    if (r.code === "already_sent" && r.job) return { ok: true, outcome: "already_sent", send: sendView(r.job, user) };
    const [status, message] = REFUSALS[r.code];
    return fail(status, r.code, message);
  }
  const { job } = r;
  deps.log("gmail_send_reserved", { jobId: job.id, attempt: job.attempts });

  // Outside any transaction: the provider call.
  let sent: { providerMessageId: string; providerThreadId: string | null };
  try {
    sent = await withTransientRetry(
      () => provider.send(accessToken, { from: conn.accountEmail, fromName: [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || undefined, to: r.mail.to, subject: r.mail.subject, text: r.mail.body, rfcMessageId: job.rfcMessageId, date: deps.now() }),
      (e) => e.kind === "rate_limited", deps);
  } catch (e) {
    const kind = e instanceof MailProviderError ? e.kind : "error";
    deps.log("gmail_send_failed", { jobId: job.id, kind });
    if (kind === "rate_limited" || kind === "rejected" || kind === "invalid_grant" || kind === "insufficient_scope") {
      const blocked = kind === "invalid_grant" || kind === "insufficient_scope";
      const code = kind === "invalid_grant" ? "mailbox_reconnect" : kind === "insufficient_scope" ? "missing_send_scope" : kind;
      const applied = await deps.sends.finishNotSent({ orgId, jobId: job.id, attempt: job.attempts, status: blocked ? "blocked" : "failed", code, now: deps.now() }).catch(() => false);
      if (blocked) await deps.mailbox.markProblem({ orgId, id: conn.id, code: kind === "invalid_grant" ? "revoked" : "missing_send_scope", clearToken: kind === "invalid_grant", now: deps.now() }).catch(() => {});
      await deps.leadEvent(orgId, job.leadId, "message_send_failed", { messageId, code }, user.id).catch(() => {});
      const now = await deps.sends.jobFor(orgId, messageId).catch(() => null);
      // If the lease ran out meanwhile, the job is uncertain (and stays so for a person to settle): say so, not "failed".
      return { ok: true, outcome: applied ? "failed" : outcomeOf(now, "uncertain"), send: sendView(now ?? { ...job, status: blocked ? "blocked" : "failed", errorCode: code }, user), reconnect: blocked };
    }
    // A timeout, a dropped connection, a 5xx, anything unknown: it may have gone out. Never retried.
    const code = "provider_uncertain";
    const applied = await deps.sends.finishUncertain({ orgId, jobId: job.id, attempt: job.attempts, code, now: deps.now() }).catch(() => false);
    await deps.leadEvent(orgId, job.leadId, "message_send_uncertain", { messageId }, user.id).catch(() => {});
    const now = await deps.sends.jobFor(orgId, messageId).catch(() => null);
    return { ok: true, outcome: applied ? "uncertain" : outcomeOf(now, "uncertain"), send: sendView(now ?? { ...job, status: "uncertain", errorCode: code }, user) };
  }

  // Confirmed. Record it (with the follow-up's outbox entry); a failed write is retried as a write only, never as a send.
  const recordEvent = true;
  let finished: { won: boolean; job: SendJobView | null } | null = null;
  for (let n = 0; n < RECORD_TRIES && !finished; n++) {
    try {
      finished = await deps.sends.finishSent({ orgId, jobId: job.id, attempt: job.attempts, providerMessageId: sent.providerMessageId, providerThreadId: sent.providerThreadId, now: deps.now(), recordEvent });
    } catch {
      if (n < RECORD_TRIES - 1) await deps.sleep(backoff(n, deps.random()));
    }
  }
  if (!finished) {
    deps.log("gmail_send_unrecorded", { jobId: job.id, attempt: job.attempts });
    return { ok: true, outcome: "uncertain", send: sendView({ ...job, status: "sending", errorCode: "unrecorded" }, user) };
  }
  if (finished.won) {
    try { await deps.afterSent(user, { leadId: job.leadId, messageId, via: "gmail" }); }
    catch (e) { deps.log("gmail_after_send_failed", { jobId: job.id, errorType: (e as Error)?.name ?? "Error" }); }
  } else if (!finished.job || finished.job.attempts !== job.attempts || finished.job.status !== "sent") {
    // Gmail confirmed an attempt that no longer owns the job (a person said "not sent", or it was retried): that copy DID
    // go out. Nothing is resent or rewritten, but it must not pass silently: a second copy may also have gone.
    deps.log("gmail_send_late_confirmation", { jobId: job.id, attempt: job.attempts });
    await deps.leadEvent(orgId, job.leadId, "message_send_late_confirmation", { messageId, attempt: job.attempts }, user.id).catch(() => {});
  }
  return { ok: true, outcome: "sent", send: sendView(finished.job ?? job, user) };
}

/** The send state of one message (null when it was never handed to a mailbox). Recovers expired leases first. */
export async function sendStateFor(user: Member, messageId: number, deps: SendDeps): Promise<Fail | { ok: true; send: SendView | null }> {
  if (!user.organizationId) return fail(403, "no_organization", "Finish setting up your workspace first.");
  if (!canReadModule(user as any, "deals")) return fail(403, "forbidden", "Your role doesn't include viewing leads.");
  if (!Number.isSafeInteger(messageId) || messageId <= 0) return fail(404, "not_found", REFUSALS.not_found[1]);
  await deps.sends.recoverExpired({ orgId: user.organizationId, now: deps.now() });
  const job = await deps.sends.jobFor(user.organizationId, messageId);
  if (!job) return { ok: true, send: null };
  return { ok: true, send: sendView(job, user, job.status === "uncertain" && (await mayResolve(user, job, deps))) };
}

/** The sender, or (once the sender has left the organization) someone who manages the team. */
async function mayResolve(user: Member, job: SendJobView, deps: SendDeps): Promise<boolean> {
  if (!canReadModule(user as any, "deals")) return false;
  if (job.requestedBy === user.id) return mayConnect(user);
  return memberCan(user as any, "team.manage") && !(await deps.isActiveMember(job.organizationId, job.requestedBy));
}

/**
 * A person settles an uncertain send after checking the sender's Gmail Sent folder: "sent" (it went: recorded as sent,
 * the follow-up created once) or "not_sent" (it didn't: approved again, so it can be sent deliberately). Recorded: who,
 * when, what they decided.
 */
export async function resolveSend(user: Member, messageId: number, raw: unknown, deps: SendDeps): Promise<Fail | { ok: true; send: SendView; messageStatus: string }> {
  if (!user.organizationId) return fail(403, "no_organization", "Finish setting up your workspace first.");
  const decision = (raw as { decision?: unknown })?.decision;
  if (typeof decision !== "string" || !(RESOLVE_DECISIONS as readonly string[]).includes(decision)) return fail(400, "invalid", "Say whether the message is in your Sent folder.");
  if (!Number.isSafeInteger(messageId) || messageId <= 0) return fail(404, "not_found", REFUSALS.not_found[1]);
  const orgId = user.organizationId, now = deps.now();
  await deps.sends.recoverExpired({ orgId, now });
  const job = await deps.sends.jobFor(orgId, messageId);
  if (!job) return fail(404, "not_found", "That message was never sent from Gmail.");
  if (job.status !== "uncertain") return fail(409, "not_uncertain", job.status === "sending" ? "That message is still being sent. Wait a moment, then check again." : "That send is already settled.");
  if (!(await mayResolve(user, job, deps))) return fail(403, "not_allowed", "Only the person who sent it can confirm this, because only they can see their Gmail Sent folder.");
  let listOn = false;
  try { listOn = await deps.listReady(); } catch { listOn = false; }
  if (!listOn) return fail(503, "outreach_not_setup", "This can't be recorded right now. Try again shortly.");
  const r = await deps.sends.resolve({ orgId, jobId: job.id, decision: decision as ResolveDecision, userId: user.id, now, recordEvent: true });
  if (!r.won || !r.job) return fail(409, "not_uncertain", "That send was settled by someone else just now. Reload to see it.");
  await deps.leadEvent(orgId, job.leadId, "message_send_resolved", { messageId, decision, requestedBy: job.requestedBy }, user.id).catch(() => {});
  deps.log("gmail_send_resolved", { jobId: job.id, decision });
  if (decision === "sent") {
    try { await deps.afterSent(user, { leadId: job.leadId, messageId, via: "gmail_confirmed" }); }
    catch (e) { deps.log("gmail_after_send_failed", { jobId: job.id, errorType: (e as Error)?.name ?? "Error" }); }
  }
  return { ok: true, send: sendView(r.job, user), messageStatus: r.messageStatus ?? "" };
}
