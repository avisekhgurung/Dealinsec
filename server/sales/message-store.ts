/** Database store for outreach messages. Tests replace this module (eval/world-mocks.ts). Every query is scoped by organization. */
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { leadEvents, leadMessages, leads, leadTickets, outreachEvents, outreachFollowups, outreachSuppressions, type LeadMessageRow, type OutreachEventRow, type OutreachSuppressionRow } from "@shared/schema";
import { followupDueAt, followupPolicy } from "@shared/followup-policy";
import { mailSyncSchemaReady } from "../mail/status";
import { canMove, isOpen, type LeadStatus } from "@shared/leads";
import { FOLLOW_UP_DAYS, pathToContacted } from "@shared/outreach-safety";
import { tablesReadyCheck } from "../leads/ready";

/** Drafting needs its own table and the model trace (daily allowances are counted from it). */
export const messagesTablesReady = tablesReadyCheck(["lead_messages", "llm_calls"]);
/**
 * Advisory-lock namespace for one do-not-contact key (an organization's address, or its domain):
 * pg_advisory_xact_lock(OUTREACH_ADDRESS_LOCK, hashtext("<org>|<kind>:<value>")). Taken by recordSentIfAllowed (for the
 * message's address and its domain) and by addSuppression (for the one key it adds), so a send and a new list entry for
 * the same address never interleave. (Other namespaces: 7_310_001 model budget, 7_310_002 search budget, 7_310_010
 * agreement creation.) A hash collision only makes two unrelated keys wait for each other briefly; it can't let one through.
 */
export const OUTREACH_ADDRESS_LOCK = 7_310_030;
export const addressLockKey = (orgId: string, k: { kind: string; value: string }) => `${orgId}|${k.kind}:${k.value}`;

/**
 * The outcome of recording a send. `sent` only when, inside one transaction holding the locks (message row, then lead row,
 * then the address keys in sorted order), the message was still approved, the lead not do-not-contact, and neither the
 * address nor its domain on the list. Every operation that competes takes a subset of those locks in the same order.
 */
export type SendRecord =
  | { result: "sent"; row: LeadMessageRow }
  | { result: "not_approved"; row: LeadMessageRow | null }
  | { result: "do_not_contact" }
  | { result: "suppressed"; entry: OutreachSuppressionRow };

/** The do-not-contact list and outcome events (script/migrate-outreach-safety.ts). Without them there can be no suppressed address. */
export const outreachSafetyReady = tablesReadyCheck(["outreach_suppressions", "outreach_events"]);

/** "sending": handed to the person's connected mailbox and not yet settled (server/mail/send-store.ts). Only that pipeline sets or leaves it. */
/** What finishing a send's follow-up did: the work itself, already done before, or nothing to do (no outbox entry, not sent). */
export type AfterSendResult = { result: "done"; movedTo: string | null; ticketId: number | null } | { result: "already" | "not_due" | "not_sent" };

export type MessageStatus = "draft" | "approved" | "sending" | "sent" | "cancelled";
export interface NewMessage {
  orgId: string; leadId: number; subject: string; body: string; bodyHash: string; toAddress: string; toSource: "lead" | "site";
  researchId: number | null; claimIds: number[]; promptVersion: string; by: "user" | "agent"; userId: string; now: Date;
}
export class DraftExists extends Error { constructor() { super("this lead already has an unsent message"); } }

export interface MessageStore {
  /** Creates a draft, or throws DraftExists if the lead already has an unsent (draft or approved) message. */
  create(m: NewMessage): Promise<LeadMessageRow>;
  get(orgId: string, id: number): Promise<LeadMessageRow | null>;
  listForLead(orgId: string, leadId: number, limit?: number): Promise<LeadMessageRow[]>;
  /** The lead's unsent message, if any. */
  unsent(orgId: string, leadId: number): Promise<LeadMessageRow | null>;
  /**
   * One atomic change: applies `set` only if the row is currently in `from` (and, when given, still has `hash`), and returns the
   * new row, or null when it was not (someone else got there first, or the text changed). This is what makes a double click safe.
   */
  transition(o: { orgId: string; id: number; from: MessageStatus; to: MessageStatus; hash?: string; now: Date; set?: Partial<Pick<LeadMessageRow, "subject" | "body" | "bodyHash" | "edited" | "approvedBy" | "approvedAt" | "sentAt">> }): Promise<LeadMessageRow | null>;
  /**
   * Records a manual send atomically against the CURRENT state (see SendRecord). `keys` are the message's address and its
   * domain (empty when the do-not-contact list's tables don't exist yet). `hold` is for tests only: called once all locks
   * are held, before anything is written, so a test can line up a competing operation deterministically.
   */
  recordSentIfAllowed(o: { orgId: string; id: number; now: Date; keys: { kind: "email" | "domain"; value: string }[]; hold?: () => Promise<void>; outbox?: { userId: string } | null }): Promise<SendRecord>;
  /**
   * The follow-up of a recorded send, from its outbox entry ("follow_due", written with the send): the "message_sent"
   * timeline entry, the lead's moves to "contacted", the follow-up ticket, and "follow_done", all in ONE transaction
   * under the message row's lock. Run it any number of times, concurrently or after a crash: the work happens once.
   * `hold` is for tests only: called with the work written but not committed.
   */
  completeAfterSend(o: { orgId: string; messageId: number; now: Date; hold?: () => Promise<void> }): Promise<AfterSendResult>;
  /** Sends whose follow-up was recorded as due but not done (oldest first): what a crash left behind. */
  pendingAfterSend(o: { orgId?: string; limit: number }): Promise<{ orgId: string; messageId: number }[]>;
  /** The organization's outgoing messages in these statuses, newest first. */
  listForOrg(orgId: string, statuses: MessageStatus[], limit: number): Promise<LeadMessageRow[]>;

  /** The first do-not-contact entry matching any of `keys` (an address, its domain), or null. */
  suppressedMatch(orgId: string, keys: { kind: "email" | "domain"; value: string }[]): Promise<OutreachSuppressionRow | null>;
  listSuppressions(orgId: string, limit: number): Promise<OutreachSuppressionRow[]>;
  /** Adds an entry, or returns the existing one (the unique index decides: one entry per organization, kind and value). */
  addSuppression(orgId: string, e: { kind: "email" | "domain"; value: string; reason: string; sourceMessageId: number | null; note: string | null; userId: string | null; now: Date }): Promise<{ row: OutreachSuppressionRow; created: boolean }>;
  /** Removes an entry the team added by hand (never an opt-out, bounce or complaint). Null when there is no such entry. */
  removeManualSuppression(orgId: string, id: number): Promise<OutreachSuppressionRow | null>;
  /** Records what happened to a message, once per message and kind (a repeat answers created: false). */
  recordEvent(orgId: string, e: { leadId: number; messageId: number; kind: string; source: "manual" | "provider"; provider: string | null; providerMessageId: string | null; userId: string | null; now: Date }): Promise<{ created: boolean }>;
  eventsFor(orgId: string, messageIds: number[]): Promise<OutreachEventRow[]>;
}

export const messageStore: MessageStore = {
  async create(m) {
    try {
      const [row] = await db.insert(leadMessages).values({
        leadId: m.leadId, organizationId: m.orgId, subject: m.subject, body: m.body, bodyHash: m.bodyHash, toAddress: m.toAddress, toSource: m.toSource,
        status: "draft", researchId: m.researchId, claimIds: m.claimIds, promptVersion: m.promptVersion, createdBy: m.by, createdByUser: m.userId,
        createdAt: m.now, updatedAt: m.now,
      }).returning();
      return row;
    } catch (e) {
      // The partial unique index (one unsent message per lead) decides, not a check-then-insert.
      if ((e as { code?: string })?.code === "23505") throw new DraftExists();
      throw e;
    }
  },
  async get(orgId, id) {
    const [r] = await db.select().from(leadMessages).where(and(eq(leadMessages.organizationId, orgId), eq(leadMessages.id, id))).limit(1);
    return r ?? null;
  },
  async listForLead(orgId, leadId, limit = 50) {
    return db.select().from(leadMessages).where(and(eq(leadMessages.organizationId, orgId), eq(leadMessages.leadId, leadId))).orderBy(desc(leadMessages.createdAt), desc(leadMessages.id)).limit(limit);
  },
  async unsent(orgId, leadId) {
    const [r] = await db.select().from(leadMessages)
      .where(and(eq(leadMessages.organizationId, orgId), eq(leadMessages.leadId, leadId), eq(leadMessages.direction, "out"), sql`${leadMessages.status} IN ('draft', 'approved')`)).limit(1);
    return r ?? null;
  },
  async transition({ orgId, id, from, to, hash, now, set }) {
    const [r] = await db.update(leadMessages).set({ ...set, status: to, updatedAt: now })
      .where(and(eq(leadMessages.organizationId, orgId), eq(leadMessages.id, id), eq(leadMessages.status, from), hash ? eq(leadMessages.bodyHash, hash) : undefined)).returning();
    return r ?? null;
  },
  async recordSentIfAllowed({ orgId, id, now, keys, hold, outbox }) {
    return db.transaction(async (tx): Promise<SendRecord> => {
      // 1. the message row: a concurrent discard or second "I sent it" waits here, or this waits for it.
      const [msg] = await tx.select().from(leadMessages).where(and(eq(leadMessages.organizationId, orgId), eq(leadMessages.id, id))).for("update");
      if (!msg || msg.status !== "approved") return { result: "not_approved", row: msg ?? null };
      // 2. the lead row (shared): marking the lead do-not-contact (an UPDATE of this row) waits until this commits, or this
      //    sees its committed result. Read here, so the flag is the one in force at this moment.
      const [lead] = await tx.select({ dnc: leads.doNotContact }).from(leads).where(and(eq(leads.organizationId, orgId), eq(leads.id, msg.leadId))).for("share");
      if (!lead || lead.dnc) return { result: "do_not_contact" };
      // 3. the address keys, in one sorted order: a new list entry for this address or domain waits, or this sees it.
      const ordered = [...keys].sort((a, b) => addressLockKey(orgId, a).localeCompare(addressLockKey(orgId, b)));
      for (const k of ordered) await tx.execute(sql`SELECT pg_advisory_xact_lock(${OUTREACH_ADDRESS_LOCK}::int, hashtext(${addressLockKey(orgId, k)}))`);
      if (ordered.length) {
        const [hit] = await tx.select().from(outreachSuppressions).where(and(eq(outreachSuppressions.organizationId, orgId), sql`(${sql.join(ordered.map((k) => sql`(${outreachSuppressions.kind} = ${k.kind} AND ${outreachSuppressions.value} = ${k.value})`), sql` OR `)})`)).limit(1);
        if (hit) return { result: "suppressed", entry: hit };
      }
      if (hold) await hold();
      const [row] = await tx.update(leadMessages).set({ status: "sent", sentAt: now, updatedAt: now })
        .where(and(eq(leadMessages.organizationId, orgId), eq(leadMessages.id, id), eq(leadMessages.status, "approved"))).returning();
      if (!row) return { result: "not_approved", row: msg };
      // The send and its outbox entry commit together: a crash after this can't lose the follow-up.
      if (outbox) {
        const base = { organizationId: orgId, leadId: row.leadId, messageId: id, source: "manual", provider: null, providerMessageId: null, actorUserId: outbox.userId, createdAt: now };
        await tx.insert(outreachEvents).values([{ ...base, kind: "sent" }, { ...base, kind: "follow_due" }]).onConflictDoNothing();
      }
      return { result: "sent", row };
    });
  },
  async completeAfterSend({ orgId, messageId, now, hold }) {
    return db.transaction(async (tx): Promise<AfterSendResult> => {
      // The message row first (every outreach and Gmail path locks it first): two completions run one after the other.
      const [msg] = await tx.select().from(leadMessages).where(and(eq(leadMessages.organizationId, orgId), eq(leadMessages.id, messageId))).for("update");
      if (!msg || msg.status !== "sent") return { result: "not_sent" };
      const marks = await tx.select().from(outreachEvents)
        .where(and(eq(outreachEvents.organizationId, orgId), eq(outreachEvents.messageId, messageId), inArray(outreachEvents.kind, ["follow_due", "follow_done"])));
      const due = marks.find((m) => m.kind === "follow_due");
      if (!due) return { result: "not_due" };
      if (marks.some((m) => m.kind === "follow_done")) return { result: "already" };
      const channel = due.provider === "gmail" ? (due.source === "provider" ? "gmail" : "gmail_confirmed") : "manual";
      const actorUserId = due.actorUserId;
      // The same writes the lead services make (leads/store.ts setStatus, addEvent, addTicket), in this transaction.
      const event = (kind: string, data: Record<string, unknown>) => tx.insert(leadEvents).values({ leadId: msg.leadId, organizationId: orgId, kind, data, actor: "user", actorUserId });
      await event("message_sent", { messageId, channel });
      const [lead] = await tx.select().from(leads).where(and(eq(leads.organizationId, orgId), eq(leads.id, msg.leadId))).for("update");
      let movedTo: string | null = null, ticketId: number | null = null;
      if (lead && !lead.archivedAt && !lead.converting) {
        let status = lead.status as LeadStatus;
        for (const step of pathToContacted(status)) {
          if (!canMove(status, step)) break;
          const [moved] = await tx.update(leads).set({ status: step, statusChangedAt: now, updatedAt: now, lostReason: null })
            .where(and(eq(leads.organizationId, orgId), eq(leads.id, lead.id), eq(leads.status, status), isNull(leads.archivedAt), eq(leads.converting, false))).returning({ id: leads.id });
          if (!moved) break;
          await event("status_changed", { from: status, to: step });
          status = step; movedTo = step;
        }
        // The follow-up sequence (outreach_followups, once migrated): this send is the outreach or one of its follow-ups;
        // the next step is scheduled unless the sequence is over or the person already answered.
        let dueAt: Date | null = new Date(now.getTime() + FOLLOW_UP_DAYS * 86_400_000);
        if (await mailSyncSchemaReady().catch(() => false)) {
          const [mine] = await tx.select().from(outreachFollowups).where(and(eq(outreachFollowups.organizationId, orgId), eq(outreachFollowups.draftMessageId, messageId))).for("update");
          const rootId = mine?.rootMessageId ?? messageId, step = mine?.step ?? 0;
          if (mine) await tx.update(outreachFollowups).set({ status: "sent", updatedAt: now }).where(eq(outreachFollowups.id, mine.id));
          // Earlier follow-up tasks for this lead are done: this send was the follow-up.
          if (mine) await tx.update(leadTickets).set({ status: "done", doneAt: now }).where(and(eq(leadTickets.organizationId, orgId), eq(leadTickets.leadId, lead.id), eq(leadTickets.kind, "follow_up"), eq(leadTickets.status, "open")));
          const answered = lead.doNotContact || (await tx.execute(sql`
            SELECT 1 FROM ${outreachEvents} e WHERE e.organization_id = ${orgId} AND e.kind IN ('replied', 'opted_out', 'bounced')
               AND (e.message_id = ${rootId} OR e.message_id IN (SELECT f.draft_message_id FROM ${outreachFollowups} f WHERE f.organization_id = ${orgId} AND f.root_message_id = ${rootId} AND f.draft_message_id IS NOT NULL))
             LIMIT 1`)).rows.length > 0;
          const policy = followupPolicy(process.env.OUTREACH_FOLLOWUP_BUSINESS_DAYS);
          dueAt = answered ? null : followupDueAt(policy, step + 1, now);
          if (dueAt) {
            await tx.insert(outreachFollowups).values({ organizationId: orgId, leadId: lead.id, rootMessageId: rootId, afterMessageId: messageId, step: step + 1, dueAt, status: "scheduled", createdAt: now, updatedAt: now })
              .onConflictDoNothing({ target: [outreachFollowups.rootMessageId, outreachFollowups.step] });
          }
        }
        if (isOpen(status) && dueAt) {
          const [t] = await tx.insert(leadTickets).values({ leadId: lead.id, organizationId: orgId, title: `Follow up with ${lead.companyName}`, kind: "follow_up", dueAt, createdBy: "user" }).returning({ id: leadTickets.id });
          ticketId = t.id;
          await event("ticket_created", { ticketId, kind: "follow_up" });
        }
        await tx.update(leads).set({ updatedAt: now }).where(and(eq(leads.organizationId, orgId), eq(leads.id, lead.id)));
      }
      if (hold) await hold();
      await tx.insert(outreachEvents).values({ organizationId: orgId, leadId: msg.leadId, messageId, kind: "follow_done", source: due.source, provider: due.provider, providerMessageId: null, actorUserId, createdAt: now });
      return { result: "done", movedTo, ticketId };
    });
  },
  async pendingAfterSend({ orgId, limit }) {
    const r = await db.execute(sql`
      SELECT d.organization_id AS "orgId", d.message_id AS "messageId" FROM ${outreachEvents} d
       WHERE d.kind = 'follow_due' ${orgId ? sql`AND d.organization_id = ${orgId}` : sql``}
         AND NOT EXISTS (SELECT 1 FROM ${outreachEvents} x WHERE x.organization_id = d.organization_id AND x.message_id = d.message_id AND x.kind = 'follow_done')
       ORDER BY d.created_at, d.id LIMIT ${limit}`);
    return (r.rows as { orgId: string; messageId: number }[]).map((x) => ({ orgId: x.orgId, messageId: Number(x.messageId) }));
  },
  async listForOrg(orgId, statuses, limit) {
    if (!statuses.length) return [];
    return db.select().from(leadMessages).where(and(eq(leadMessages.organizationId, orgId), eq(leadMessages.direction, "out"), inArray(leadMessages.status, statuses))).orderBy(desc(leadMessages.updatedAt), desc(leadMessages.id)).limit(limit);
  },

  async suppressedMatch(orgId, keys) {
    if (!keys.length) return null;
    const [r] = await db.select().from(outreachSuppressions).where(and(eq(outreachSuppressions.organizationId, orgId), sql`(${sql.join(keys.map((k) => sql`(${outreachSuppressions.kind} = ${k.kind} AND ${outreachSuppressions.value} = ${k.value})`), sql` OR `)})`)).limit(1);
    return r ?? null;
  },
  async listSuppressions(orgId, limit) {
    return db.select().from(outreachSuppressions).where(eq(outreachSuppressions.organizationId, orgId)).orderBy(desc(outreachSuppressions.createdAt), desc(outreachSuppressions.id)).limit(limit);
  },
  async addSuppression(orgId, e) {
    // Under this key's lock (and only it): a send being recorded to this address or domain finishes first, or sees this entry.
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${OUTREACH_ADDRESS_LOCK}::int, hashtext(${addressLockKey(orgId, e)}))`);
      const [ins] = await tx.insert(outreachSuppressions).values({ organizationId: orgId, kind: e.kind, value: e.value, reason: e.reason, sourceMessageId: e.sourceMessageId, note: e.note, createdBy: e.userId, createdAt: e.now }).onConflictDoNothing().returning();
      if (ins) return { row: ins, created: true };
      const [cur] = await tx.select().from(outreachSuppressions).where(and(eq(outreachSuppressions.organizationId, orgId), eq(outreachSuppressions.kind, e.kind), eq(outreachSuppressions.value, e.value))).limit(1);
      return { row: cur, created: false };
    });
  },
  async removeManualSuppression(orgId, id) {
    const [r] = await db.delete(outreachSuppressions).where(and(eq(outreachSuppressions.organizationId, orgId), eq(outreachSuppressions.id, id), eq(outreachSuppressions.reason, "manual"))).returning();
    return r ?? null;
  },
  async recordEvent(orgId, e) {
    const r = await db.insert(outreachEvents).values({ organizationId: orgId, leadId: e.leadId, messageId: e.messageId, kind: e.kind, source: e.source, provider: e.provider, providerMessageId: e.providerMessageId, actorUserId: e.userId, createdAt: e.now }).onConflictDoNothing().returning({ id: outreachEvents.id });
    return { created: r.length > 0 };
  },
  async eventsFor(orgId, messageIds) {
    if (!messageIds.length) return [];
    return db.select().from(outreachEvents).where(and(eq(outreachEvents.organizationId, orgId), inArray(outreachEvents.messageId, messageIds))).orderBy(outreachEvents.createdAt, outreachEvents.id);
  },
};
