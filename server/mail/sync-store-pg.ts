/**
 * The Postgres SyncStore (tables: mail-sync-schema.ts; contract: sync-store.ts). Reads the outreach tables
 * (lead_messages, mail_send_jobs, mailbox_connections) and never writes them: what a reply changes in the outreach is
 * applied separately, from mail_messages.applied_at (the outbox).
 */
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import { leadMessages, mailboxConnections, mailMessages, mailSendJobs, mailSyncState, mailThreads, type MailSyncStateRow } from "@shared/schema";
import type { ConversationLink, OutreachCandidate } from "./reply-match";
import { CLASSIFIER_VERSION } from "./reply-rules";
import type { DueMailbox, StoreMessageInput, SyncStateView, SyncStore } from "./sync-store";

const OUTREACH_STATUSES = ["approved", "sending", "sent"];
const view = (r: MailSyncStateRow): SyncStateView => ({
  organizationId: r.organizationId, connectionId: r.connectionId, historyId: r.historyId, bootstrappedAt: r.bootstrappedAt,
  state: r.state as SyncStateView["state"], nextRunAt: r.nextRunAt, lastRunAt: r.lastRunAt, lastSuccessAt: r.lastSuccessAt,
  failures: r.failures, lastErrorCode: r.lastErrorCode, lastErrorAt: r.lastErrorAt, leaseUntil: r.leaseUntil,
});
/** A timestamp for raw SQL, as drizzle stores them (UTC wall-clock): a bare Date would be sent in the server's local time. */
const at = (d: Date) => sql`${d.toISOString()}::timestamp`;
const anyOf = (col: SQL, xs: string[]) => sql`${col} IN (${sql.join(xs.map((x) => sql`${x}`), sql`, `)})`;
const outreachAt = sql<Date>`coalesce(${leadMessages.sentAt}, ${leadMessages.approvedAt}, ${leadMessages.createdAt})`;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function linkOf(tx: Tx | typeof db, orgId: string, threadRow: { leadId: number; leadMessageId: number }): Promise<ConversationLink> {
  const [m] = await tx.select({ to: leadMessages.toAddress }).from(leadMessages).where(and(eq(leadMessages.organizationId, orgId), eq(leadMessages.id, threadRow.leadMessageId)));
  return { leadId: threadRow.leadId, leadMessageId: threadRow.leadMessageId, toAddress: (m?.to ?? "").toLowerCase() };
}

export const pgSyncStore: SyncStore = {
  async due({ now, readScope, limit, orgIds }) {
    if (orgIds && !orgIds.length) return [];
    const rows = await db.execute(sql`
      SELECT c.organization_id AS "organizationId", c.id AS "connectionId", c.user_id AS "userId"
        FROM ${mailboxConnections} c LEFT JOIN ${mailSyncState} s ON s.connection_id = c.id
       WHERE c.status = 'active' AND c.refresh_token_enc IS NOT NULL AND c.scopes @> ${JSON.stringify([readScope])}::jsonb
         ${orgIds ? sql`AND ${anyOf(sql`c.organization_id`, orgIds)}` : sql``}
         AND (s.id IS NULL
              OR (s.state IN ('needs_reconnect', 'needs_scope') AND c.updated_at > s.updated_at)
              OR (s.state NOT IN ('needs_reconnect', 'needs_scope') AND s.next_run_at <= ${at(now)}))
         AND (s.lease_until IS NULL OR s.lease_until < ${at(now)})
       ORDER BY s.next_run_at ASC NULLS FIRST
       LIMIT ${limit}`);
    return (rows.rows as any[]).map((r): DueMailbox => ({ organizationId: r.organizationId, connectionId: Number(r.connectionId), userId: r.userId }));
  },

  async claim({ orgId, connectionId, owner, now, leaseMs, force }) {
    await db.insert(mailSyncState).values({ organizationId: orgId, connectionId, state: "ok", nextRunAt: now, failures: 0, createdAt: now, updatedAt: now })
      .onConflictDoNothing({ target: mailSyncState.connectionId });
    const woken = sql`(${mailSyncState.state} IN ('needs_reconnect', 'needs_scope') AND EXISTS (SELECT 1 FROM ${mailboxConnections} c WHERE c.id = ${mailSyncState.connectionId} AND c.updated_at > ${mailSyncState.updatedAt}))`;
    const [r] = await db.update(mailSyncState)
      .set({ leaseOwner: owner, leaseUntil: new Date(now.getTime() + leaseMs), lastRunAt: now, updatedAt: now })
      .where(and(
        eq(mailSyncState.connectionId, connectionId), eq(mailSyncState.organizationId, orgId),
        sql`(${mailSyncState.leaseUntil} IS NULL OR ${mailSyncState.leaseUntil} < ${at(now)})`,
        force ? sql`true` : sql`(${mailSyncState.nextRunAt} <= ${at(now)} OR ${woken})`,
      )).returning();
    return r ? view(r) : null;
  },

  async checkpoint({ connectionId, owner, historyId, now, leaseMs }) {
    const r = await db.update(mailSyncState).set({ historyId, leaseUntil: new Date(now.getTime() + leaseMs), updatedAt: now })
      .where(and(eq(mailSyncState.connectionId, connectionId), eq(mailSyncState.leaseOwner, owner))).returning({ id: mailSyncState.id });
    return r.length > 0;
  },

  async finish({ connectionId, owner, now, outcome }) {
    const base = { leaseOwner: null, leaseUntil: null, updatedAt: now, nextRunAt: outcome.nextRunAt };
    const set = outcome.ok
      ? { ...base, historyId: outcome.historyId, state: "ok", failures: 0, lastSuccessAt: now, lastErrorCode: null, lastErrorAt: null, ...(outcome.bootstrapped ? { bootstrappedAt: now } : {}) }
      : {
          ...base, state: outcome.state, lastErrorCode: outcome.code, lastErrorAt: now,
          ...(outcome.countFailure ? { failures: sql`${mailSyncState.failures} + 1` } : {}),
          ...(outcome.resetCursor ? { historyId: null, bootstrappedAt: null } : outcome.historyId ? { historyId: outcome.historyId } : {}),
        };
    await db.update(mailSyncState).set(set as any).where(and(eq(mailSyncState.connectionId, connectionId), eq(mailSyncState.leaseOwner, owner)));
  },

  async state(orgId, connectionId) {
    const [r] = await db.select().from(mailSyncState).where(and(eq(mailSyncState.organizationId, orgId), eq(mailSyncState.connectionId, connectionId)));
    return r ? view(r) : null;
  },

  async adoptSendThreads({ orgId, connectionId, now }) {
    const r = await db.execute(sql`
      INSERT INTO ${mailThreads} (organization_id, connection_id, provider_thread_id, lead_id, lead_message_id, source, last_message_at, created_at, updated_at)
      SELECT DISTINCT ON (j.provider_thread_id) j.organization_id, j.connection_id, j.provider_thread_id, j.lead_id, j.message_id, 'send', coalesce(j.sent_at, j.updated_at), ${at(now)}, ${at(now)}
        FROM ${mailSendJobs} j
       WHERE j.organization_id = ${orgId} AND j.connection_id = ${connectionId} AND j.provider_thread_id IS NOT NULL AND j.status IN ('sent', 'uncertain')
       ORDER BY j.provider_thread_id, j.created_at
      ON CONFLICT (connection_id, provider_thread_id) DO NOTHING`);
    return r.rowCount ?? 0;
  },

  async threadLink(orgId, connectionId, providerThreadId) {
    const [t] = await db.select({ leadId: mailThreads.leadId, leadMessageId: mailThreads.leadMessageId }).from(mailThreads)
      .where(and(eq(mailThreads.organizationId, orgId), eq(mailThreads.connectionId, connectionId), eq(mailThreads.providerThreadId, providerThreadId)));
    return t ? linkOf(db, orgId, t) : null;
  },

  async referenceLink(orgId, connectionId, rfcIds) {
    const ids = Array.from(new Set(rfcIds.map((x) => x.toLowerCase()))).slice(0, 60);
    if (!ids.length) return null;
    const [j] = await db.select({ leadId: mailSendJobs.leadId, leadMessageId: mailSendJobs.messageId, to: mailSendJobs.toAddress }).from(mailSendJobs)
      .where(and(eq(mailSendJobs.organizationId, orgId), eq(mailSendJobs.connectionId, connectionId), anyOf(sql`lower(${mailSendJobs.rfcMessageId})`, ids))).limit(1);
    if (j) return { leadId: j.leadId, leadMessageId: j.leadMessageId, toAddress: j.to.toLowerCase() };
    const [t] = await db.select({ leadId: mailThreads.leadId, leadMessageId: mailThreads.leadMessageId }).from(mailMessages)
      .innerJoin(mailThreads, eq(mailThreads.id, mailMessages.threadId))
      .where(and(eq(mailMessages.organizationId, orgId), eq(mailMessages.connectionId, connectionId), anyOf(sql`${mailMessages.rfcMessageId}`, ids))).limit(1);
    return t ? linkOf(db, orgId, t) : null;
  },

  async outreachTo(orgId, userId, addresses, since): Promise<OutreachCandidate[]> {
    const want = Array.from(new Set(addresses.map((a) => a.toLowerCase()))).slice(0, 60);
    if (!want.length) return [];
    const rows = await db.select({ id: leadMessages.id, leadId: leadMessages.leadId, to: leadMessages.toAddress, subject: leadMessages.subject, at: outreachAt }).from(leadMessages)
      .where(and(eq(leadMessages.organizationId, orgId), eq(leadMessages.approvedBy, userId), eq(leadMessages.direction, "out"), inArray(leadMessages.status, OUTREACH_STATUSES),
        anyOf(sql`lower(${leadMessages.toAddress})`, want), sql`${outreachAt} >= ${at(since)}`))
      .limit(200);
    return rows.map((r) => ({ leadId: r.leadId, leadMessageId: r.id, toAddress: (r.to ?? "").toLowerCase(), subject: r.subject ?? "", at: new Date(r.at) }));
  },

  async recentOutreachAddresses({ orgId, userId, since, limit }) {
    const rows = await db.execute(sql`
      SELECT lower(to_address) AS a, max(coalesce(sent_at, approved_at, created_at)) AS at
        FROM ${leadMessages}
       WHERE organization_id = ${orgId} AND direction = 'out' AND approved_by = ${userId} AND to_address IS NOT NULL
         AND status IN ('approved', 'sending', 'sent') AND coalesce(sent_at, approved_at, created_at) >= ${at(since)}
       GROUP BY 1 ORDER BY 2 DESC LIMIT ${limit}`);
    return (rows.rows as any[]).map((r) => String(r.a));
  },

  async linkedThreadIds(orgId, connectionId, limit) {
    const rows = await db.select({ id: mailThreads.providerThreadId }).from(mailThreads)
      .where(and(eq(mailThreads.organizationId, orgId), eq(mailThreads.connectionId, connectionId)))
      .orderBy(sql`${mailThreads.lastMessageAt} DESC NULLS LAST`).limit(limit);
    return rows.map((r) => r.id);
  },

  async known(orgId, connectionId, ids) {
    const want = Array.from(new Set(ids)).slice(0, 1000);
    if (!want.length) return new Set();
    const a = await db.select({ id: mailMessages.providerMessageId }).from(mailMessages)
      .where(and(eq(mailMessages.organizationId, orgId), eq(mailMessages.connectionId, connectionId), inArray(mailMessages.providerMessageId, want)));
    const b = await db.select({ id: mailSendJobs.providerMessageId }).from(mailSendJobs)
      .where(and(eq(mailSendJobs.organizationId, orgId), eq(mailSendJobs.connectionId, connectionId), inArray(mailSendJobs.providerMessageId, want)));
    return new Set([...a, ...b].map((r) => r.id).filter((x): x is string => !!x));
  },

  async storeMessage(i: StoreMessageInput) {
    return db.transaction(async (tx) => {
      const findThread = async () => (await tx.select().from(mailThreads)
        .where(and(eq(mailThreads.organizationId, i.orgId), eq(mailThreads.connectionId, i.connectionId), eq(mailThreads.providerThreadId, i.providerThreadId))).for("update"))[0] ?? null;
      let thread = await findThread();
      if (!thread && i.adoptThread) {
        const made = await tx.insert(mailThreads).values({
          organizationId: i.orgId, connectionId: i.connectionId, providerThreadId: i.providerThreadId, leadId: i.link.leadId, leadMessageId: i.link.leadMessageId,
          source: i.adoptThread.source, createdAt: i.now, updatedAt: i.now,
        }).onConflictDoNothing({ target: [mailThreads.connectionId, mailThreads.providerThreadId] }).returning({ id: mailThreads.id });
        thread = await findThread();
        // Messages of this Gmail thread kept earlier for review on their address alone now belong to its conversation
        // (still flagged when they came from someone other than the person written to).
        if (made.length && thread) {
          const to = (await linkOf(tx, i.orgId, thread)).toAddress;
          await tx.update(mailMessages).set({
            threadId: thread.id, leadId: thread.leadId, leadMessageId: thread.leadMessageId, matchKind: "thread",
            reviewReason: sql`CASE WHEN ${mailMessages.fromAddress} = ${to} OR ${mailMessages.kind} = 'bounce' THEN NULL ELSE 'other_sender' END`,
            reviewState: sql`CASE WHEN ${mailMessages.fromAddress} = ${to} OR ${mailMessages.kind} = 'bounce' THEN 'none' ELSE 'pending' END`,
          }).where(and(eq(mailMessages.organizationId, i.orgId), eq(mailMessages.connectionId, i.connectionId), eq(mailMessages.providerThreadId, i.providerThreadId),
            sql`${mailMessages.threadId} IS NULL`, eq(mailMessages.reviewState, "pending"), eq(mailMessages.reviewReason, "address_only")));
        }
      }
      const linked = i.linked && !!thread;
      const link = linked && thread ? { leadId: thread.leadId, leadMessageId: thread.leadMessageId } : { leadId: i.link.leadId, leadMessageId: i.link.leadMessageId };
      const [row] = await tx.insert(mailMessages).values({
        organizationId: i.orgId, connectionId: i.connectionId, providerMessageId: i.providerMessageId, providerThreadId: i.providerThreadId,
        threadId: linked ? thread!.id : null, leadId: link.leadId, leadMessageId: link.leadMessageId,
        direction: i.direction, kind: i.kind, matchKind: i.match, reviewReason: i.review, reviewState: i.review ? "pending" : "none",
        fromAddress: i.fromAddress, fromName: i.fromName, toAddresses: i.to, subject: i.subject.slice(0, 300), bodyText: i.bodyText, bodyTrimmed: i.bodyTrimmed,
        rfcMessageId: i.rfcMessageId?.slice(0, 255) ?? null, inReplyTo: i.inReplyTo?.slice(0, 255) ?? null, sentAt: i.sentAt, createdAt: i.now,
        classification: i.classification, classifiedBy: i.classification ? "rules" : null, classifierVersion: i.classification ? CLASSIFIER_VERSION : null,
      }).onConflictDoNothing({ target: [mailMessages.connectionId, mailMessages.providerMessageId] }).returning({ id: mailMessages.id });
      if (!row) return { created: false, id: null };
      if (linked && thread) {
        await tx.update(mailThreads).set({
          lastMessageAt: sql`greatest(coalesce(${mailThreads.lastMessageAt}, ${at(i.sentAt)}), ${at(i.sentAt)})`,
          ...(i.direction === "in" ? { lastInboundAt: sql`greatest(coalesce(${mailThreads.lastInboundAt}, ${at(i.sentAt)}), ${at(i.sentAt)})` } : {}),
          updatedAt: i.now,
        }).where(eq(mailThreads.id, thread.id));
      }
      return { created: true, id: row.id };
    });
  },

  async purge(orgId, connectionId) {
    return db.transaction(async (tx) => {
      const gone = await tx.delete(mailMessages).where(and(eq(mailMessages.organizationId, orgId), eq(mailMessages.connectionId, connectionId))).returning({ id: mailMessages.id });
      await tx.delete(mailThreads).where(and(eq(mailThreads.organizationId, orgId), eq(mailThreads.connectionId, connectionId)));
      await tx.delete(mailSyncState).where(and(eq(mailSyncState.organizationId, orgId), eq(mailSyncState.connectionId, connectionId)));
      return gone.length;
    });
  },

  async purgeDisconnected(limit) {
    const rows = await db.execute(sql`
      SELECT c.organization_id AS "orgId", c.id AS "connectionId" FROM ${mailboxConnections} c
       WHERE c.status IN ('disconnected', 'revoked')
         AND (EXISTS (SELECT 1 FROM ${mailSyncState} s WHERE s.connection_id = c.id)
              OR EXISTS (SELECT 1 FROM ${mailThreads} t WHERE t.connection_id = c.id)
              OR EXISTS (SELECT 1 FROM ${mailMessages} m WHERE m.connection_id = c.id))
       LIMIT ${limit}`);
    for (const r of rows.rows as any[]) await pgSyncStore.purge(r.orgId, Number(r.connectionId));
    return rows.rows.length;
  },
};

/**
 * The retention period (MAIL_SYNC_RETENTION_DAYS, default 365; "off" keeps text until disconnect): the text of
 * synced messages older than that is deleted; who, when and the match stay, so the conversation still makes sense.
 */
export async function purgeExpiredBodies(days: number, now: Date, limit = 500): Promise<number> {
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const r = await db.execute(sql`
    UPDATE ${mailMessages} SET body_text = NULL, body_removed_at = ${at(now)}
     WHERE id IN (SELECT id FROM ${mailMessages} WHERE body_text IS NOT NULL AND sent_at < ${at(cutoff)} ORDER BY sent_at LIMIT ${limit})`);
  return r.rowCount ?? 0;
}

/** MAIL_SYNC_RETENTION_DAYS: whole days from 30 to 3650, "off", or unset (365). Anything else: 365, with a problem to log. */
export function retentionDays(raw: string | undefined): { days: number | null; problem: string | null } {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return { days: 365, problem: null };
  if (v === "off") return { days: null, problem: null };
  const n = Number(v);
  return /^\d{2,4}$/.test(v) && n >= 30 && n <= 3650 ? { days: n, problem: null } : { days: 365, problem: "MAIL_SYNC_RETENTION_DAYS must be whole days from 30 to 3650, or \"off\"; using 365" };
}
