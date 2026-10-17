/**
 * The Postgres SendStore. See send-store.ts for the states and the contract.
 *
 * Lock order, the same everywhere so nothing can deadlock: the message row (FOR UPDATE) first, always; then its job;
 * then the lead (FOR SHARE), the do-not-contact address keys (advisory, sorted), the sender's user row (FOR SHARE) and
 * the mailbox row (FOR UPDATE). Recording a send by hand takes message, lead, address keys (message-store.ts);
 * adding to the list takes one address key; removing a member updates the user row and then locks their mailbox rows;
 * disconnecting locks the mailbox rows. Every finishing write locks the message row before touching the job.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { leadMessages, leads, mailSendJobs, mailboxConnections, orgRoles, outreachEvents, outreachFollowups, outreachSuppressions, users, type MailSendJobRow } from "@shared/schema";
import { mailSyncSchemaReady } from "./status";
import { hashDraft } from "@shared/outreach-hash";
import { normalEmail, suppressionKeys } from "@shared/outreach-safety";
import { addressLockKey, OUTREACH_ADDRESS_LOCK } from "../sales/message-store";
import { mayConnect } from "./connect-service";
import { capabilitiesOf, contentProblem } from "./provider";
import type { Reservation, ReserveInput, SendJobView, SendStore } from "./send-store";

export const DAY_MS = 86_400_000;
const view = (r: MailSendJobRow): SendJobView => ({ ...r, status: r.status as SendJobView["status"] });
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** A Date for raw SQL against a timestamp column: UTC wall-clock, as drizzle stores it (node-postgres would send local time). */
const at = (d: Date) => sql`${d.toISOString()}::timestamp`;

/** Locks the job's message row, then the job. Null when either is missing or belongs elsewhere. */
async function lockJob(tx: Tx, orgId: string, jobId: number) {
  const [ref] = await tx.select({ messageId: mailSendJobs.messageId }).from(mailSendJobs).where(and(eq(mailSendJobs.id, jobId), eq(mailSendJobs.organizationId, orgId)));
  if (!ref) return null;
  const [msg] = await tx.select().from(leadMessages).where(and(eq(leadMessages.id, ref.messageId), eq(leadMessages.organizationId, orgId))).for("update");
  const [job] = await tx.select().from(mailSendJobs).where(eq(mailSendJobs.id, jobId)).for("update");
  return msg && job ? { msg, job } : null;
}

/** Where an unsent message goes back to: approved, unless its lead has since been marked do-not-contact (then discarded). */
async function backFromSending(tx: Tx, orgId: string, msg: { id: number; leadId: number }, now: Date): Promise<string> {
  const [lead] = await tx.select({ dnc: leads.doNotContact }).from(leads).where(and(eq(leads.organizationId, orgId), eq(leads.id, msg.leadId))).for("share");
  const to = !lead || lead.dnc ? "cancelled" : "approved";
  await tx.update(leadMessages).set({ status: to, updatedAt: now }).where(and(eq(leadMessages.id, msg.id), eq(leadMessages.status, "sending")));
  return to;
}

export const pgSendStore: SendStore = {
  async reserve(i: ReserveInput): Promise<Reservation> {
    return db.transaction(async (tx): Promise<Reservation> => {
      // 1. the message: a second send, a manual "I sent it", an edit or a discard of it waits here, or this waits for it.
      const [msg] = await tx.select().from(leadMessages).where(and(eq(leadMessages.organizationId, i.orgId), eq(leadMessages.id, i.messageId))).for("update");
      if (!msg || msg.direction !== "out") return { ok: false, code: "not_found" };
      const [existing] = await tx.select().from(mailSendJobs).where(and(eq(mailSendJobs.messageId, i.messageId), eq(mailSendJobs.organizationId, i.orgId))).for("update");
      const job = existing ? view(existing) : null;
      if (msg.status === "sent" || job?.status === "sent") return { ok: false, code: "already_sent", job };
      if (msg.status === "sending" || job?.status === "sending" || job?.status === "uncertain") return { ok: false, code: "in_flight", job };
      if (msg.status !== "approved") return { ok: false, code: "not_approved", status: msg.status };
      // 1b. a follow-up: its sequence still open (no reply, opt-out or bounce applied; not held for review). Read under this
      //     message's lock, which reply-apply.ts takes before cancelling or holding it, so the two can't cross.
      let isFollowup = false;
      if (await mailSyncSchemaReady().catch(() => false)) {
        const [f] = await tx.select({ status: outreachFollowups.status, root: outreachFollowups.rootMessageId }).from(outreachFollowups)
          .where(and(eq(outreachFollowups.organizationId, i.orgId), eq(outreachFollowups.draftMessageId, msg.id)));
        if (f && f.status !== "drafted") return { ok: false, code: "followup_stopped" };
        isFollowup = !!f;
        if (f) {
          const answered = await tx.execute(sql`SELECT 1 FROM ${outreachEvents} e WHERE e.organization_id = ${i.orgId} AND e.message_id = ${f.root} AND e.kind IN ('replied', 'opted_out', 'bounced') LIMIT 1`);
          if (answered.rows.length) return { ok: false, code: "followup_stopped" };
        }
      }
      // 2. exactly the approved text: the page's hash, and the stored text still hashing to it, with a one-line subject.
      if (msg.bodyHash !== i.expectedHash) return { ok: false, code: "changed" };
      const subject = (msg.subject ?? "").trim(), body = msg.body.trim();
      if (contentProblem(subject, body) || hashDraft(subject, body) !== msg.bodyHash) return { ok: false, code: "invalid_content" };
      const to = normalEmail(msg.toAddress);
      if (!to) return { ok: false, code: "no_address" };
      // 3. the lead's do-not-contact flag, as it is now; and a follow-up only while the lead is still being pursued
      //    (a lead turned into a deal, being turned into one, or archived gets no more chasing).
      const [lead] = await tx.select({ dnc: leads.doNotContact, dealId: leads.convertedDealId, converting: leads.converting, archivedAt: leads.archivedAt }).from(leads).where(and(eq(leads.organizationId, i.orgId), eq(leads.id, msg.leadId))).for("share");
      if (!lead || lead.dnc) return { ok: false, code: "do_not_contact" };
      if (isFollowup && (lead.dealId || lead.converting || lead.archivedAt)) return { ok: false, code: "followup_stopped" };
      // 4. the address and its domain on the list, under their keys' locks (sorted).
      const keys = i.checkList ? suppressionKeys(to).sort((a, b) => addressLockKey(i.orgId, a).localeCompare(addressLockKey(i.orgId, b))) : [];
      for (const k of keys) await tx.execute(sql`SELECT pg_advisory_xact_lock(${OUTREACH_ADDRESS_LOCK}::int, hashtext(${addressLockKey(i.orgId, k)}))`);
      if (keys.length) {
        const [hit] = await tx.select().from(outreachSuppressions).where(and(eq(outreachSuppressions.organizationId, i.orgId), sql`(${sql.join(keys.map((k) => sql`(${outreachSuppressions.kind} = ${k.kind} AND ${outreachSuppressions.value} = ${k.value})`), sql` OR `)})`)).limit(1);
        if (hit) return { ok: false, code: "suppressed", entry: { kind: hit.kind, value: hit.value, reason: hit.reason } };
      }
      // 5. the sender, now: still a member of this organization, with a role that may work on leads.
      const [u] = await tx.select({ organizationId: users.organizationId, memberStatus: users.memberStatus, orgRole: users.orgRole, customRoleId: users.customRoleId })
        .from(users).where(eq(users.id, i.userId)).for("share");
      if (!u || u.organizationId !== i.orgId || u.memberStatus === "removed") return { ok: false, code: "not_member" };
      let customPermissions: string[] | null = null;
      if (u.customRoleId) {
        const [role] = await tx.select({ permissions: orgRoles.permissions, organizationId: orgRoles.organizationId }).from(orgRoles).where(eq(orgRoles.id, u.customRoleId));
        customPermissions = role && role.organizationId === i.orgId ? (role.permissions as string[]) : [];
      }
      if (!mayConnect({ id: i.userId, organizationId: u.organizationId, memberStatus: u.memberStatus, orgRole: u.orgRole, customPermissions })) return { ok: false, code: "not_allowed" };
      // 6. their own mailbox: active, holding a token, able to send. Locked: a disconnect waits, or this sees it.
      const [conn] = await tx.select().from(mailboxConnections)
        .where(and(eq(mailboxConnections.id, i.connectionId), eq(mailboxConnections.organizationId, i.orgId), eq(mailboxConnections.userId, i.userId), eq(mailboxConnections.provider, i.provider)))
        .for("update");
      if (!conn || conn.status !== "active" || !conn.refreshTokenEnc) return { ok: false, code: "mailbox_unavailable" };
      if (!capabilitiesOf(Array.isArray(conn.scopes) ? (conn.scopes as string[]) : []).send) return { ok: false, code: "missing_send_scope" };
      // 7. the account's sends in the last 24 hours (across its connections, so reconnecting doesn't reset it), counted
      //    under the mailbox lock: two messages racing for the last slot are serialized here.
      const used = await tx.execute(sql`
        SELECT count(*)::int AS n FROM ${mailSendJobs} j JOIN ${mailboxConnections} c ON c.id = j.connection_id
         WHERE c.provider = ${conn.provider} AND c.account_sub = ${conn.accountSub} AND j.message_id <> ${i.messageId}
           AND (j.status IN ('sending', 'uncertain') OR (j.status = 'sent' AND j.sent_at > ${at(new Date(i.now.getTime() - DAY_MS))}))`);
      if (Number((used.rows[0] as { n: unknown }).n) >= i.dailyCap) return { ok: false, code: "daily_cap" };
      // 7b. the plan's sends for the workspace, across its mailboxes, under the workspace's lock (taken last, so no deadlock).
      if (i.planCap) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${PLAN_SEND_LOCK}, hashtext(${i.orgId}))`);
        const ws = await tx.execute(sql`SELECT count(*)::int AS n FROM ${mailSendJobs} WHERE organization_id = ${i.orgId} AND message_id <> ${i.messageId}
          AND (status IN ('sending', 'uncertain') OR (status = 'sent' AND sent_at >= ${at(i.planCap.since)}))`);
        if (Number((ws.rows[0] as { n: unknown }).n) >= i.planCap.max) return { ok: false, code: "plan_send_limit" };
      }
      if (i.hold) await i.hold();
      // 8. reserve: a new job, or the next attempt of one that certainly didn't go out (same Message-ID).
      const lease = new Date(i.now.getTime() + i.leaseMs);
      const fields = { status: "sending", connectionId: conn.id, requestedBy: i.userId, bodyHash: msg.bodyHash, toAddress: to, leaseUntil: lease, errorCode: null, resolvedBy: null, resolvedAt: null, updatedAt: i.now };
      const [row] = job
        ? await tx.update(mailSendJobs).set({ ...fields, attempts: sql`${mailSendJobs.attempts} + 1` }).where(and(eq(mailSendJobs.id, job.id), inArray(mailSendJobs.status, ["failed", "blocked"]))).returning()
        : await tx.insert(mailSendJobs).values({ ...fields, organizationId: i.orgId, leadId: msg.leadId, messageId: msg.id, rfcMessageId: i.newRfcMessageId, attempts: 1, createdAt: i.now }).returning();
      if (!row) return { ok: false, code: "in_flight", job };
      const [marked] = await tx.update(leadMessages).set({ status: "sending", updatedAt: i.now })
        .where(and(eq(leadMessages.id, msg.id), eq(leadMessages.status, "approved"))).returning({ id: leadMessages.id });
      if (!marked) throw new Error("the locked message changed status"); // can't happen under the row lock; abort rather than guess
      return { ok: true, job: view(row), mail: { subject, body, to } };
    });
  },

  async finishSent({ orgId, jobId, attempt, providerMessageId, providerThreadId, now, recordEvent }) {
    return db.transaction(async (tx) => {
      const l = await lockJob(tx, orgId, jobId);
      if (!l) return { won: false, job: null };
      const [row] = await tx.update(mailSendJobs)
        .set({ status: "sent", providerMessageId, providerThreadId, sentAt: now, leaseUntil: null, errorCode: null, updatedAt: now })
        .where(and(eq(mailSendJobs.id, jobId), eq(mailSendJobs.attempts, attempt), inArray(mailSendJobs.status, ["sending", "uncertain"]))).returning();
      if (!row) return { won: false, job: view(l.job) };
      await tx.update(leadMessages).set({ status: "sent", sentAt: now, updatedAt: now }).where(and(eq(leadMessages.id, row.messageId), eq(leadMessages.status, "sending")));
      if (recordEvent) {
        // The send and its follow-up's outbox entry commit together (message-store.ts completeAfterSend runs it).
        const base = { organizationId: orgId, leadId: row.leadId, messageId: row.messageId, source: "provider", provider: "gmail", actorUserId: row.requestedBy, createdAt: now };
        await tx.insert(outreachEvents).values([{ ...base, kind: "sent", providerMessageId }, { ...base, kind: "follow_due", providerMessageId: null }]).onConflictDoNothing();
      }
      return { won: true, job: view(row) };
    });
  },

  async finishNotSent({ orgId, jobId, attempt, status, code, now }) {
    return db.transaction(async (tx) => {
      const l = await lockJob(tx, orgId, jobId);
      if (!l) return false;
      const [row] = await tx.update(mailSendJobs).set({ status, errorCode: code, leaseUntil: null, updatedAt: now })
        .where(and(eq(mailSendJobs.id, jobId), eq(mailSendJobs.attempts, attempt), eq(mailSendJobs.status, "sending"))).returning({ id: mailSendJobs.id });
      if (!row) return false;
      await backFromSending(tx, orgId, l.msg, now);
      return true;
    });
  },

  async finishUncertain({ orgId, jobId, attempt, code, now }) {
    return db.transaction(async (tx) => {
      const l = await lockJob(tx, orgId, jobId);
      if (!l) return false;
      const [row] = await tx.update(mailSendJobs).set({ status: "uncertain", errorCode: code, leaseUntil: null, updatedAt: now })
        .where(and(eq(mailSendJobs.id, jobId), eq(mailSendJobs.attempts, attempt), eq(mailSendJobs.status, "sending"))).returning({ id: mailSendJobs.id });
      return !!row;
    });
  },

  async recoverExpired({ orgId, now }) {
    const r = await db.update(mailSendJobs).set({ status: "uncertain", errorCode: "lease_expired", leaseUntil: null, updatedAt: now })
      .where(and(eq(mailSendJobs.status, "sending"), sql`${mailSendJobs.leaseUntil} < ${at(now)}`, orgId ? eq(mailSendJobs.organizationId, orgId) : undefined))
      .returning({ id: mailSendJobs.id });
    return r.length;
  },

  async jobFor(orgId, messageId) {
    const [r] = await db.select().from(mailSendJobs).where(and(eq(mailSendJobs.organizationId, orgId), eq(mailSendJobs.messageId, messageId))).limit(1);
    return r ? view(r) : null;
  },

  async resolve({ orgId, jobId, decision, userId, now, recordEvent }) {
    return db.transaction(async (tx) => {
      const l = await lockJob(tx, orgId, jobId);
      if (!l || l.job.status !== "uncertain") return { won: false, job: l ? view(l.job) : null };
      if (decision === "sent") {
        const [row] = await tx.update(mailSendJobs).set({ status: "sent", sentAt: now, resolvedBy: userId, resolvedAt: now, leaseUntil: null, updatedAt: now })
          .where(and(eq(mailSendJobs.id, jobId), eq(mailSendJobs.status, "uncertain"))).returning();
        await tx.update(leadMessages).set({ status: "sent", sentAt: now, updatedAt: now }).where(and(eq(leadMessages.id, row.messageId), eq(leadMessages.status, "sending")));
        if (recordEvent) {
          const base = { organizationId: orgId, leadId: row.leadId, messageId: row.messageId, source: "manual", provider: "gmail", providerMessageId: null, actorUserId: userId, createdAt: now };
          await tx.insert(outreachEvents).values([{ ...base, kind: "sent" }, { ...base, kind: "follow_due" }]).onConflictDoNothing();
        }
        return { won: true, job: view(row), messageStatus: "sent" };
      }
      const [row] = await tx.update(mailSendJobs).set({ status: "failed", errorCode: "resolved_not_sent", resolvedBy: userId, resolvedAt: now, leaseUntil: null, updatedAt: now })
        .where(and(eq(mailSendJobs.id, jobId), eq(mailSendJobs.status, "uncertain"))).returning();
      const messageStatus = await backFromSending(tx, orgId, l.msg, now);
      return { won: true, job: view(row), messageStatus };
    });
  },
};

/** Messages this workspace handed to Gmail since `since`: in flight, or sent in the window (a failed send frees its slot). The plan's send allowance. */
/** Serialises the plan's send allowance per workspace (reserve step 7b). */
export const PLAN_SEND_LOCK = 7_310_032;

export async function countWorkspaceSends(orgId: string, since: Date): Promise<number> {
  const r = await db.execute(sql`SELECT count(*)::int AS n FROM ${mailSendJobs} WHERE organization_id = ${orgId}
    AND (status IN ('sending', 'uncertain') OR (status = 'sent' AND sent_at >= ${since.toISOString()}::timestamp))`);
  return Number((r.rows[0] as { n: unknown } | undefined)?.n ?? 0);
}
