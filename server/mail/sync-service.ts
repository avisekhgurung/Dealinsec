/**
 * Gmail reply sync (Release B): one pass over one connected mailbox, finding messages that belong to outreach
 * conversations and storing them once. Everything is injected; tests run it against FakeMailProvider and
 * MemorySyncStore. Design and the Google side: docs/gmail-reply-sync.md.
 *
 * A pass:
 *   1. takes the mailbox's lease (one pass per mailbox at a time, across processes), only when due or asked for;
 *   2. gets a fresh access token (a revoked grant marks the mailbox for reconnecting; no read scope stops here);
 *   3. ties the threads of messages DealInSec sent from this mailbox to their outreach;
 *   4. first pass only: reads the linked threads and searches the mailbox for the addresses this person's outreach
 *      went to (last 60 days), oldest first, then starts the cursor at the mailbox's current history id;
 *      later passes: reads Gmail's change history after the cursor, moving the cursor after each page;
 *   5. for each new message, a metadata read decides (reply-match.ts) whether it belongs to a conversation; only then
 *      is the body read and stored. Unrelated mail is never stored and its body is never fetched;
 *   6. ends with the cursor saved, or with a retry time (exponential backoff with jitter), a "reconnect" or a
 *      "needs permission" state. Work per pass is bounded; what is left is picked up by the next pass.
 *
 * The cursor only moves past a change record once every message in it has been decided, so a pass that stops early
 * (a limit, an error, a crash) resumes without losing anything; seeing a message again stores nothing new.
 * Logs carry ids, counts and codes only: never an address, a subject, a body or a token.
 */
import { randomBytes } from "node:crypto";
import { forOrg, type GmailConfig, type GmailStatus } from "./config";
import { bodyOf, MATCH_HEADERS, parseMail, type ParsedMail } from "./mail-parse";
import type { MailboxStore } from "./mailbox-store";
import { capabilitiesOf, GMAIL_READONLY_SCOPE, MailProviderError, type MailboxReader, type MailProvider, type MessageRef } from "./provider";
import { decideMatch, type ConversationLink } from "./reply-match";
import { classifyReply } from "./reply-rules";
import type { PassOutcome, SyncState, SyncStore } from "./sync-store";

export const SYNC_INTERVAL_MS = 3 * 60_000;
export const LEASE_MS = 2 * 60_000;
export const BACKOFF_BASE_MS = 2 * 60_000;
export const BACKOFF_MAX_MS = 60 * 60_000;
const PROBLEM_RECHECK_MS = 24 * 3_600_000; // reconnect / permission problems: the sweep wakes them when the mailbox changes
export const LOOKBACK_DAYS = 60; // the first pass reads this far back
export const OUTREACH_WINDOW_DAYS = 180; // outreach older than this doesn't attract address matches
export const MAX_READS_PER_PASS = 150; // message reads (metadata or full)
export const MAX_READS_FIRST_PASS = 300;
const MAX_HISTORY_PAGES = 10;
const HISTORY_PAGE_SIZE = 100;
const FIRST_PASS_ADDRESSES = 50;
const FIRST_PASS_THREADS = 50;
const SKIP = new Set(["DRAFT", "SPAM", "TRASH", "CHAT"]);
const NOISE = new Set(["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL"]); // skipped unless already in a linked thread
const EMAIL = /^[^\s@<>"',;(){}]{1,64}@([a-z0-9-]+\.)+[a-z]{2,}$/;

export interface SyncDeps {
  status(): Promise<GmailStatus>;
  /** Whether the reply-sync tables are migrated (mail-sync-schema.ts). */
  syncSchemaReady(): Promise<boolean>;
  provider(config: GmailConfig): MailProvider & MailboxReader;
  mailbox: MailboxStore;
  store: SyncStore;
  now(): Date;
  random(): number;
  log(event: string, fields?: Record<string, string | number | boolean | null>): void;
  /** What a stored inbound message changes in the outreach (reply-apply.ts), applied right after it is stored. */
  applyReply?(orgId: string, mailMessageId: number): Promise<unknown>;
  /** Re-applies messages stored but not applied (a crash between the two). */
  applyPending?(): Promise<number>;
}

export type ReplySync = { on: true; config: GmailConfig } | { on: false; reason: "gmail_off" | "sync_off" | "not_migrated" };

/** Whether reply sync runs for an organization: Gmail on for it, GMAIL_REPLY_SYNC_ENABLED set, the tables migrated. */
export async function replySyncFor(orgId: string | null | undefined, deps: Pick<SyncDeps, "status" | "syncSchemaReady">): Promise<ReplySync> {
  const s = forOrg(await deps.status(), orgId);
  if (!s.enabled) return { on: false, reason: "gmail_off" };
  if (!s.config.replySync) return { on: false, reason: "sync_off" };
  let ready = false;
  try { ready = await deps.syncSchemaReady(); } catch { ready = false; }
  return ready ? { on: true, config: s.config } : { on: false, reason: "not_migrated" };
}

export type PassResult = {
  outcome: "ok" | "partial" | SyncState | "busy" | "off" | "not_connected";
  stored: number;
  ignored: number;
  reads: number;
  bootstrap: boolean;
};

class Budget extends Error { constructor() { super("read budget used"); this.name = "Budget"; } }
class LostLease extends Error { constructor() { super("lease lost"); this.name = "LostLease"; } }

export function backoffMs(failures: number, random: () => number, retryAfterMs?: number): number {
  const exp = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1));
  const jittered = Math.min(BACKOFF_MAX_MS, Math.round(exp * (0.8 + 0.4 * random())));
  return Math.max(jittered, Math.min(retryAfterMs ?? 0, BACKOFF_MAX_MS));
}

/**
 * One pass over one mailbox. `userId` is the mailbox's owner (from the store's due list, or the signed-in person for
 * "sync now"); the connection must be theirs, in `orgId`, or nothing happens. Never throws.
 */
export async function syncMailbox(input: { orgId: string; userId: string; connectionId: number; force?: boolean }, deps: SyncDeps): Promise<PassResult> {
  const result: PassResult = { outcome: "off", stored: 0, ignored: 0, reads: 0, bootstrap: false };
  let gate: ReplySync;
  try { gate = await replySyncFor(input.orgId, deps); } catch { return result; }
  if (!gate.on) return result;
  const config = gate.config;
  const provider = deps.provider(config);
  const owner = `p${process.pid}-${randomBytes(6).toString("hex")}`;
  const now0 = deps.now();
  let state;
  try {
    state = await deps.store.claim({ orgId: input.orgId, connectionId: input.connectionId, owner, now: now0, leaseMs: LEASE_MS, force: !!input.force });
  } catch (e) {
    deps.log("gmail_sync_failed", { where: "claim", errorType: (e as Error)?.name ?? "Error" });
    return { ...result, outcome: "busy" };
  }
  if (!state) return { ...result, outcome: "busy" };

  let lastDone: string | null = null; // the last change record fully decided this pass
  const finish = async (outcome: PassOutcome) => {
    try { await deps.store.finish({ connectionId: input.connectionId, owner, now: deps.now(), outcome }); } catch (e) {
      deps.log("gmail_sync_failed", { where: "finish", errorType: (e as Error)?.name ?? "Error" });
    }
  };
  const problem = (s: SyncState, code: string) => finish({ ok: false, state: s, code, nextRunAt: new Date(deps.now().getTime() + PROBLEM_RECHECK_MS), countFailure: false, resetCursor: false, historyId: lastDone });

  try {
    // 2. the mailbox, still this person's, with a token and the read scope; then a fresh access token.
    const t = await deps.mailbox.token(input.orgId, input.userId, provider.id, config.keyring);
    if (!t || t.connection.id !== input.connectionId || t.connection.status !== "active" || t.refreshToken === null) {
      await problem("needs_reconnect", t?.refreshToken === null ? (t.reason === "unreadable" ? "token_unreadable" : "no_token") : "not_connected");
      return { ...result, outcome: "not_connected" };
    }
    if (!capabilitiesOf(t.connection.scopes).read) { await problem("needs_scope", "missing_read_scope"); return { ...result, outcome: "needs_scope" }; }
    let access: string;
    try {
      const a = await provider.refreshAccessToken(t.refreshToken);
      if (a.scopes.length && !a.scopes.includes(GMAIL_READONLY_SCOPE)) { await problem("needs_scope", "missing_read_scope"); return { ...result, outcome: "needs_scope" }; }
      access = a.accessToken;
    } catch (e) {
      if (e instanceof MailProviderError && e.kind === "invalid_grant") {
        await deps.mailbox.markProblem({ orgId: input.orgId, id: t.connection.id, code: "revoked", clearToken: true, now: deps.now() });
        await problem("needs_reconnect", "revoked");
        return { ...result, outcome: "needs_reconnect" };
      }
      throw e;
    }
    const accountEmail = t.connection.accountEmail.toLowerCase();
    const since = new Date(deps.now().getTime() - OUTREACH_WINDOW_DAYS * 86_400_000);

    // 3. threads of messages sent through DealInSec from this mailbox.
    await deps.store.adoptSendThreads({ orgId: input.orgId, connectionId: input.connectionId, now: deps.now() });

    let budget = state.historyId ? MAX_READS_PER_PASS : MAX_READS_FIRST_PASS;
    const read = async (id: string, format: "metadata" | "full") => {
      if (budget <= 0) throw new Budget();
      budget--; result.reads++;
      return provider.message(access, id, format, format === "metadata" ? MATCH_HEADERS : []);
    };
    const backfill: string[] = []; // threads adopted this pass: their earlier messages are read too

    /** A metadata read, unless the message can be skipped without one. Null: skipped, already known, or gone. */
    const inspect = async (ref: MessageRef, known: Set<string>): Promise<ParsedMail | null> => {
      if ((ref.labelIds ?? []).some((l) => SKIP.has(l)) || known.has(ref.id)) return null;
      if ((ref.labelIds ?? []).some((l) => NOISE.has(l)) && !(await deps.store.threadLink(input.orgId, input.connectionId, ref.threadId))) { result.ignored++; return null; }
      try { return parseMail(await read(ref.id, "metadata")); } catch (e) {
        if (e instanceof MailProviderError && e.kind === "not_found") return null;
        throw e;
      }
    };

    /** Decides one inspected message and stores it if it belongs to a conversation. */
    const apply = async (m: ParsedMail): Promise<void> => {
      const thread = await deps.store.threadLink(input.orgId, input.connectionId, m.threadId);
      const reference: ConversationLink | null = thread ? null : await deps.store.referenceLink(input.orgId, input.connectionId, [m.inReplyTo, ...m.references].filter((x): x is string => !!x));
      const addrs = Array.from(new Set([m.from, ...m.to].filter((a): a is string => !!a))).slice(0, 30);
      const candidates = addrs.length ? await deps.store.outreachTo(input.orgId, input.userId, addrs, since) : [];
      const d = decideMatch(m, { accountEmail, thread, reference, outreachTo: (a) => candidates.filter((c) => c.toAddress === a) });
      if (d.action === "ignore") { result.ignored++; return; }
      let body: { text: string | null; trimmed: boolean } = { text: null, trimmed: false };
      if (d.needBody) {
        try { body = bodyOf(await read(m.id, "full")); } catch (e) {
          if (e instanceof MailProviderError && e.kind === "not_found") return;
          throw e;
        }
      }
      const r = await deps.store.storeMessage({
        orgId: input.orgId, connectionId: input.connectionId, providerMessageId: m.id, providerThreadId: m.threadId,
        link: d.link, adoptThread: d.adoptThread ? { source: d.match === "adopted" ? "adopted" : "reference" } : null, linked: d.match !== "address",
        direction: d.direction, kind: d.kind, match: d.match, review: d.review, fromAddress: m.from, fromName: m.fromName, to: m.to,
        subject: m.subject, bodyText: body.text, bodyTrimmed: body.trimmed, rfcMessageId: m.rfcMessageId, inReplyTo: m.inReplyTo,
        sentAt: m.date ?? deps.now(), now: deps.now(),
        classification: d.direction === "in" ? classifyReply({ kind: d.kind, subject: m.subject, text: body.text }) : null,
      });
      if (r.created) result.stored++;
      if (r.created && r.id !== null && deps.applyReply) {
        // A failure here is repaired by the sweep (applyPending): the message is stored, its effect is in the outbox.
        try { await deps.applyReply(input.orgId, r.id); } catch (e) { deps.log("gmail_reply_apply_failed", { mailMessageId: r.id, errorType: (e as Error)?.name ?? "Error" }); }
      }
      if (r.created && d.adoptThread) backfill.push(m.threadId);
    };

    /** Reads, oldest first, then decides in that order (so an outgoing copy adopts its thread before the reply arrives). */
    const decideAll = async (refs: MessageRef[]) => {
      const unique = Array.from(new Map(refs.map((r) => [r.id, r])).values());
      const known = await deps.store.known(input.orgId, input.connectionId, unique.map((r) => r.id));
      const parsed: ParsedMail[] = [];
      for (const r of unique) { const p = await inspect(r, known); if (p) parsed.push(p); }
      // Gmail's receive time (ms), sent mail first on a tie: the hand-sent copy adopts its thread before the reply.
      const key = (m: ParsedMail) => (m.receivedAt ?? m.date)?.getTime() ?? 0;
      parsed.sort((a, b) => key(a) - key(b) || Number(b.labels.includes("SENT")) - Number(a.labels.includes("SENT")));
      for (const p of parsed) await apply(p);
    };

    const drainBackfill = async () => {
      while (backfill.length) {
        const threadId = backfill.shift()!;
        let refs: MessageRef[] = [];
        try { refs = await provider.threadMessages(access, threadId); } catch (e) {
          if (e instanceof MailProviderError && e.kind === "not_found") continue;
          throw e;
        }
        await decideAll(refs);
      }
    };

    // 4. the first pass, or the change history since the cursor.
    let newCursor: string;
    let complete = true;
    if (!state.historyId) {
      result.bootstrap = true;
      const profile = await provider.profile(access);
      const refs: MessageRef[] = [];
      for (const threadId of await deps.store.linkedThreadIds(input.orgId, input.connectionId, FIRST_PASS_THREADS)) {
        try { refs.push(...(await provider.threadMessages(access, threadId))); } catch (e) {
          if (!(e instanceof MailProviderError && e.kind === "not_found")) throw e;
        }
      }
      const addresses = (await deps.store.recentOutreachAddresses({ orgId: input.orgId, userId: input.userId, since: new Date(deps.now().getTime() - LOOKBACK_DAYS * 86_400_000), limit: FIRST_PASS_ADDRESSES }))
        .filter((a) => EMAIL.test(a));
      for (const a of addresses) refs.push(...(await provider.search(access, { q: `{from:${a} to:${a}} newer_than:${LOOKBACK_DAYS}d`, maxResults: 20 })).messages);
      try {
        await decideAll(refs);
        await drainBackfill();
      } catch (e) {
        if (!(e instanceof Budget)) throw e;
        // Older mail left unread stays unread (the first pass is a best-effort look back); new mail is what the cursor guarantees.
        deps.log("gmail_sync_first_pass_truncated", { connectionId: input.connectionId, reads: result.reads });
      }
      newCursor = profile.historyId; // read before the scan: nothing that arrives during it is missed
    } else {
      const start = state.historyId;
      let pageToken: string | null = null;
      let pages = 0;
      newCursor = start;
      for (;;) {
        const page = await provider.history(access, { startHistoryId: start, pageToken, maxResults: HISTORY_PAGE_SIZE });
        try {
          for (const rec of page.records) {
            await decideAll(rec.added);
            await drainBackfill();
            lastDone = rec.id;
          }
        } catch (e) {
          if (!(e instanceof Budget)) throw e;
          complete = false;
        }
        if (lastDone && !(await deps.store.checkpoint({ connectionId: input.connectionId, owner, historyId: lastDone, now: deps.now(), leaseMs: LEASE_MS }))) throw new LostLease();
        if (!complete) { newCursor = lastDone ?? start; break; }
        pages++;
        if (!page.nextPageToken) { newCursor = page.historyId; break; }
        if (pages >= MAX_HISTORY_PAGES) { newCursor = lastDone ?? start; complete = false; break; }
        pageToken = page.nextPageToken;
      }
    }

    const now = deps.now();
    await finish({ ok: true, historyId: newCursor, bootstrapped: result.bootstrap, nextRunAt: complete ? new Date(now.getTime() + SYNC_INTERVAL_MS) : now });
    result.outcome = complete ? "ok" : "partial";
  } catch (e) {
    if (e instanceof LostLease) { result.outcome = "busy"; return result; }
    const kind = e instanceof MailProviderError ? e.kind : "internal";
    const now = deps.now();
    if (kind === "insufficient_scope") { await problem("needs_scope", "missing_read_scope"); result.outcome = "needs_scope"; }
    else if (kind === "invalid_grant") { await problem("needs_reconnect", "revoked"); result.outcome = "needs_reconnect"; }
    else if (kind === "cursor_expired") {
      // Too old for Gmail's history: start over with a first pass (nothing stored is lost; it is skipped as known).
      await finish({ ok: false, state: "retrying", code: "cursor_expired", nextRunAt: now, countFailure: false, resetCursor: true });
      result.outcome = "retrying";
    } else {
      const retryAfter = e instanceof MailProviderError ? e.retryAfterMs : undefined;
      await finish({ ok: false, state: "retrying", code: kind === "internal" ? "internal" : kind, nextRunAt: new Date(now.getTime() + backoffMs(state.failures + 1, deps.random, retryAfter)), countFailure: true, resetCursor: false, historyId: lastDone });
      result.outcome = "retrying";
      if (kind === "internal") deps.log("gmail_sync_failed", { where: "pass", errorType: (e as Error)?.name ?? "Error" });
    }
  }
  deps.log("gmail_sync_pass", { connectionId: input.connectionId, outcome: result.outcome, stored: result.stored, ignored: result.ignored, reads: result.reads, bootstrap: result.bootstrap });
  return result;
}

/** One sweep: passes for the mailboxes that are due, one after another. Never throws. */
export async function syncDueMailboxes(deps: SyncDeps, opts: { limit?: number } = {}): Promise<number> {
  try {
    if (!(await deps.syncSchemaReady())) return 0;
    // Whatever is left of disconnected mailboxes goes first, whether or not sync is on.
    const purged = await deps.store.purgeDisconnected(20);
    if (purged) deps.log("gmail_sync_purged", { mailboxes: purged });
    if (deps.applyPending) await deps.applyPending();
    const s = await deps.status();
    if (!s.enabled || !s.config.replySync) return 0;
    const due = await deps.store.due({ now: deps.now(), readScope: GMAIL_READONLY_SCOPE, limit: opts.limit ?? 5, orgIds: s.config.allowedOrgIds });
    for (const d of due) await syncMailbox({ orgId: d.organizationId, userId: d.userId, connectionId: d.connectionId }, deps);
    return due.length;
  } catch (e) {
    deps.log("gmail_sync_failed", { where: "sweep", errorType: (e as Error)?.name ?? "Error" });
    return 0;
  }
}
