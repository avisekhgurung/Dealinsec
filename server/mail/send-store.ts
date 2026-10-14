/**
 * Sending an approved message from the person's own mailbox: the durable state. One interface, two implementations:
 * send-store-pg.ts (the app) and send-memory.ts (tests); the same contract suite runs against both.
 *
 * A job (mail_send_jobs, one row per message, ever) moves through:
 *
 *   sending ──provider confirmed──▶ sent          (Gmail's ids recorded; the message becomes "sent")
 *      │    ──clearly refused────▶ failed         (nothing was accepted: the message is approved again, a retry may follow)
 *      │    ──mailbox unusable───▶ blocked        (stopped before the provider: same as failed, needs a reconnect)
 *      │    ──timeout / 5xx /
 *      │      unknown / lease out▶ uncertain      (it may have gone out: never retried automatically)
 *   uncertain ──a person checked their Sent folder──▶ sent (it went) | failed "resolved_not_sent" (it didn't)
 *   uncertain ──the provider's confirmation arrives late──▶ sent
 *   failed | blocked ──a deliberate retry (the same reservation checks again)──▶ sending (attempt + 1, same Message-ID)
 *
 * The message row moves with it, in the same transactions: approved → "sending" at reservation, "sending" → sent, or
 * back to approved when the job failed. Every other path (record as sent by hand, open in the email app, edit, discard)
 * only acts on an approved or draft message, so while a job is sending or uncertain they are all refused atomically.
 *
 * Duplicate submissions are prevented by the database, not by memory: the message row lock and its status, the unique
 * job per message, and conditional updates fenced by the attempt number.
 */
import type { MailboxProvider } from "./token-crypto";

export const JOB_STATUSES = ["sending", "sent", "uncertain", "failed", "blocked"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export interface SendJobView {
  id: number;
  organizationId: string;
  connectionId: number;
  leadId: number;
  messageId: number;
  requestedBy: string;
  bodyHash: string;
  toAddress: string;
  rfcMessageId: string;
  status: JobStatus;
  attempts: number;
  leaseUntil: Date | null;
  providerMessageId: string | null;
  providerThreadId: string | null;
  errorCode: string | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReserveInput {
  orgId: string;
  userId: string;
  messageId: number;
  /** The hash of the text the person is looking at: a stale page is refused. */
  expectedHash: string;
  /** The person's own live connection (read just before); re-checked under lock. */
  connectionId: number;
  provider: MailboxProvider;
  /** Whether the do-not-contact list's tables exist (without them nothing can be on it). */
  checkList: boolean;
  dailyCap: number;
  now: Date;
  leaseMs: number;
  /** Used only when the message has never had a job; a retry keeps the job's own Message-ID. */
  newRfcMessageId: string;
  /** Tests only: called with every lock held, before anything is written. */
  hold?: () => Promise<void>;
}

export type ReserveRefusal =
  | "not_found" | "not_approved" | "already_sent" | "in_flight" | "changed" | "invalid_content" | "no_address"
  | "do_not_contact" | "suppressed" | "not_member" | "not_allowed" | "mailbox_unavailable" | "missing_send_scope" | "daily_cap";

export type Reservation =
  | { ok: true; job: SendJobView; mail: { subject: string; body: string; to: string } }
  | { ok: false; code: ReserveRefusal; job?: SendJobView | null; entry?: { kind: string; value: string; reason: string }; status?: string };

export interface SendStore {
  /**
   * One transaction, locks in the outreach order (message row, lead row, address keys sorted) then the sender's user row
   * and their mailbox row: the message is the organization's, approved, the exact approved text, with an address; the
   * lead not do-not-contact; neither address nor domain listed; the sender still an active member allowed to work on
   * leads; the mailbox theirs, active, able to send and under its daily cap; no job in flight or done. Then the job is
   * reserved (sending, leased) and the message marked "sending". Committed before anything is sent.
   */
  reserve(i: ReserveInput): Promise<Reservation>;
  /** Confirmed by the provider: from sending or uncertain, fenced by attempt. Records the "sent" event in the same transaction. Only one caller wins. */
  finishSent(i: { orgId: string; jobId: number; attempt: number; providerMessageId: string; providerThreadId: string | null; now: Date; recordEvent: boolean }): Promise<{ won: boolean; job: SendJobView | null }>;
  /** Certainly not accepted: from sending only, fenced by attempt; the message is approved again. */
  finishNotSent(i: { orgId: string; jobId: number; attempt: number; status: "failed" | "blocked"; code: string; now: Date }): Promise<boolean>;
  /** Outcome unknown: from sending only, fenced by attempt; the message stays "sending". */
  finishUncertain(i: { orgId: string; jobId: number; attempt: number; code: string; now: Date }): Promise<boolean>;
  /** Jobs still "sending" after their lease (the process died or stalled): uncertain, never resent. Returns how many. */
  recoverExpired(i: { orgId?: string; now: Date }): Promise<number>;
  jobFor(orgId: string, messageId: number): Promise<SendJobView | null>;
  /**
   * A person settles an uncertain send after checking their Sent folder. "sent": the job and message become sent (event
   * recorded once). "not_sent": the job fails as resolved_not_sent and the message is approved again, or discarded if
   * the lead has since been marked do-not-contact. Only from uncertain; only one caller wins.
   */
  resolve(i: { orgId: string; jobId: number; decision: "sent" | "not_sent"; userId: string; now: Date; recordEvent: boolean }): Promise<{ won: boolean; job: SendJobView | null; messageStatus?: string }>;
}
