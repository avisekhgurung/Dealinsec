/**
 * Where reply sync keeps its state and what it found (tables: mail-sync-schema.ts). Two implementations:
 * sync-store-pg.ts (the app) and sync-memory.ts (tests); the contract suite (sync-store.contract.ts) runs on both.
 *
 * Every read and write is scoped by organization AND connection: a mailbox's threads and messages are never looked up
 * across mailboxes or organizations. Writes that change the cursor are fenced by the lease owner, so a pass that lost
 * its lease (it ran too long and another took over) can't move the cursor back. Message writes are idempotent on
 * (connection, provider message id): the same message seen twice is stored once.
 */
import type { ConversationLink, MatchKind, MessageKind, OutreachCandidate, ReviewReason } from "./reply-match";
import type { ReplyLabel } from "./reply-rules";

export type SyncState = "ok" | "retrying" | "needs_reconnect" | "needs_scope";

export interface SyncStateView {
  organizationId: string;
  connectionId: number;
  historyId: string | null;
  bootstrappedAt: Date | null;
  state: SyncState;
  nextRunAt: Date;
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  failures: number;
  lastErrorCode: string | null;
  lastErrorAt: Date | null;
  /** A pass holds the lease until then (sync in progress). */
  leaseUntil: Date | null;
}

export interface DueMailbox { organizationId: string; connectionId: number; userId: string }

export interface StoreMessageInput {
  orgId: string;
  connectionId: number;
  providerMessageId: string;
  providerThreadId: string;
  link: ConversationLink;
  /** Tie the Gmail thread to `link` first (first link wins: an existing thread keeps its conversation). */
  adoptThread: { source: "adopted" | "reference" } | null;
  /** Whether the message belongs to the thread's conversation (false for an address-only match awaiting review). */
  linked: boolean;
  direction: "in" | "out";
  kind: MessageKind;
  match: MatchKind;
  review: ReviewReason | null;
  fromAddress: string | null;
  fromName: string | null;
  to: string[];
  subject: string;
  bodyText: string | null;
  bodyTrimmed: boolean;
  rfcMessageId: string | null;
  inReplyTo: string | null;
  sentAt: Date;
  now: Date;
  /** reply-rules.ts label for an inbound message (null for outgoing). Rules only, never a model. */
  classification: ReplyLabel | null;
}

export type PassOutcome =
  | { ok: true; historyId: string; bootstrapped: boolean; nextRunAt: Date }
  | { ok: false; state: SyncState; code: string; nextRunAt: Date; countFailure: boolean; resetCursor: boolean; historyId?: string | null };

export interface SyncStore {
  /** Mailboxes due a pass: live, active, holding the read scope, and due (or never synced, or reconnected since a problem). */
  due(input: { now: Date; readScope: string; limit: number; orgIds: string[] | null }): Promise<DueMailbox[]>;
  /**
   * Takes the mailbox's lease for one pass (creating its state row the first time). Null when another pass holds it,
   * or (without `force`) when it isn't due yet.
   */
  claim(input: { orgId: string; connectionId: number; owner: string; now: Date; leaseMs: number; force: boolean }): Promise<SyncStateView | null>;
  /** Moves the cursor forward during a pass. False when the lease was lost (stop the pass). */
  checkpoint(input: { connectionId: number; owner: string; historyId: string; now: Date; leaseMs: number }): Promise<boolean>;
  /** Ends the pass: records its outcome and releases the lease (only if still held by `owner`). */
  finish(input: { connectionId: number; owner: string; now: Date; outcome: PassOutcome }): Promise<void>;
  state(orgId: string, connectionId: number): Promise<SyncStateView | null>;

  /** Ties the Gmail threads of messages sent from this mailbox through DealInSec to their outreach. Returns how many were new. */
  adoptSendThreads(input: { orgId: string; connectionId: number; now: Date }): Promise<number>;
  /** The conversation a Gmail thread of this mailbox is tied to. */
  threadLink(orgId: string, connectionId: number, providerThreadId: string): Promise<ConversationLink | null>;
  /** The conversation one of these Message-IDs (lower case, "<…>") belongs to: one we sent, or one already synced into a linked thread. */
  referenceLink(orgId: string, connectionId: number, rfcIds: string[]): Promise<ConversationLink | null>;
  /** Outreach to these addresses in the organization, approved or sent since `since`. */
  outreachTo(orgId: string, addresses: string[], since: Date): Promise<OutreachCandidate[]>;
  /** Addresses this person's outreach went to since `since` (the first pass searches the mailbox for these only). */
  recentOutreachAddresses(input: { orgId: string; userId: string; since: Date; limit: number }): Promise<string[]>;
  /** Gmail threads of this mailbox tied to conversations (for the first pass to read in full). */
  linkedThreadIds(orgId: string, connectionId: number, limit: number): Promise<string[]>;
  /** Which of these provider message ids are already known to this mailbox (stored, or sent through DealInSec). */
  known(orgId: string, connectionId: number, providerMessageIds: string[]): Promise<Set<string>>;
  /** Stores one message (and adopts its thread if asked), once. */
  storeMessage(input: StoreMessageInput): Promise<{ created: boolean; id: number | null }>;
  /** Deletes everything synced from a mailbox (on disconnect). Returns the number of messages deleted. */
  purge(orgId: string, connectionId: number): Promise<number>;
  /** Deletes what is left of mailboxes no longer connected (a purge that failed at disconnect). Returns how many mailboxes. */
  purgeDisconnected(limit: number): Promise<number>;
}
