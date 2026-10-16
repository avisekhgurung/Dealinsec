/**
 * The outreach inbox (AI Outbound → Inbox): conversations Gmail reply sync linked to outreach, one conversation's
 * messages, and the review queue. Reads the reply-sync tables; never a mailbox, never a model.
 *
 * Who sees what (the 14 Oct decision): a conversation is visible to members who may view leads (the Deals module), like
 * the lead itself. A message matched by its sender's address alone is visible only to the person whose mailbox it came
 * from, until they confirm it. Message text is plain text and is rendered as text, never as HTML.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { leadMessages, leads, mailboxConnections, mailMessages, mailSendJobs, mailThreads, outreachFollowups } from "@shared/schema";
import { fail, readGate, writeGate, type Result, type Who } from "../services/leads";
import { applyReply, releaseHolds, type ApplyDeps } from "./reply-apply";
import { INBOX_FILTERS, REPLY_LABELS, type ConversationMessage, type ConversationView, type InboxFilter, type InboxItem, type ReplyLabel, type ReviewItem, type ThreadStatus } from "@shared/inbox-view";
import { mailSyncSchemaReady } from "./status";

const PAGE = 30;
const LABELS: readonly string[] = REPLY_LABELS;

const NOT_READY = () => fail(503, "inbox_unavailable", "The inbox isn't set up on this server yet.");
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
/** A timestamp column read by raw SQL as UTC text: node-postgres would otherwise read it in the server's local time. */
const UTC = (col: ReturnType<typeof sql>) => sql`to_char(${col}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

async function ready(user: Who): Promise<Result<{ orgId: string }>> {
  const g = readGate(user);
  if (g) return g;
  if (!(await mailSyncSchemaReady().catch(() => false))) return NOT_READY();
  return { ok: true, orgId: user.organizationId! };
}

/** Conversations, newest activity first, `PAGE` at a time (cursor: the last item's activity time and id). */
export async function listInbox(user: Who, raw: { filter?: unknown; q?: unknown; before?: unknown } = {}): Promise<Result<{ items: InboxItem[]; next: string | null; counts: Record<InboxFilter, number> }>> {
  const r = await ready(user);
  if (!r.ok) return r;
  const filter: InboxFilter = (INBOX_FILTERS as readonly string[]).includes(String(raw.filter)) ? (raw.filter as InboxFilter) : "all";
  const q = typeof raw.q === "string" ? raw.q.trim().slice(0, 80) : "";
  const before = typeof raw.before === "string" && /^\d{4}-\d\d-\d\dT[\d:.]+Z\|\d{1,10}$/.test(raw.before) ? raw.before.split("|") : null;
  const now = new Date().toISOString();
  const due = sql`EXISTS (SELECT 1 FROM ${outreachFollowups} f WHERE f.organization_id = t.organization_id AND f.root_message_id = t.lead_message_id AND (f.status = 'drafted' OR (f.status = 'scheduled' AND f.due_at <= ${now}::timestamp)))`;
  const where = {
    all: sql`true`, awaiting: sql`t.status = 'awaiting'`, replied: sql`t.status <> 'awaiting'`, interested: sql`t.status = 'interested'`,
    needs_review: sql`t.status = 'needs_review'`, follow_up_due: due,
  } as const;
  const search = q ? sql`AND (l.company_name ILIKE ${`%${q}%`} OR m.subject ILIKE ${`%${q}%`} OR m.to_address ILIKE ${`%${q}%`})` : sql``;
  const page = before ? sql`AND (coalesce(t.last_message_at, t.created_at), t.id) < (${before[0]}::timestamp, ${Number(before[1])})` : sql``;
  const rows = (await db.execute(sql`
    SELECT t.id, t.lead_id, t.status, ${UTC(sql`t.last_message_at`)} AS last_message_at, ${UTC(sql`t.last_inbound_at`)} AS last_inbound_at,
           ${UTC(sql`coalesce(t.last_message_at, t.created_at)`)} AS activity_at, l.company_name, l.status AS lead_status, l.converted_deal_id,
           m.subject, m.to_address,
           (SELECT count(*)::int FROM ${mailMessages} x WHERE x.thread_id = t.id AND x.direction = 'in') AS replies,
           (SELECT count(*)::int FROM ${mailMessages} x WHERE x.thread_id = t.id AND x.review_state = 'pending') AS pending,
           (SELECT x.classification FROM ${mailMessages} x WHERE x.thread_id = t.id AND x.direction = 'in' AND x.review_state <> 'dismissed' ORDER BY x.sent_at DESC, x.id DESC LIMIT 1) AS last_label,
           (SELECT json_build_object('step', f.step, 'status', f.status, 'dueAt', f.due_at) FROM ${outreachFollowups} f
             WHERE f.organization_id = t.organization_id AND f.root_message_id = t.lead_message_id AND f.status IN ('scheduled', 'held', 'drafted') ORDER BY f.step LIMIT 1) AS followup
      FROM ${mailThreads} t
      JOIN ${leads} l ON l.id = t.lead_id AND l.organization_id = t.organization_id
      JOIN ${leadMessages} m ON m.id = t.lead_message_id AND m.organization_id = t.organization_id
     WHERE t.organization_id = ${r.orgId} AND ${where[filter]} ${search} ${page}
     ORDER BY coalesce(t.last_message_at, t.created_at) DESC, t.id DESC
     LIMIT ${PAGE + 1}`)).rows as any[];
  const items: InboxItem[] = rows.slice(0, PAGE).map((x) => ({
    threadId: Number(x.id), leadId: Number(x.lead_id), company: x.company_name, leadStatus: x.lead_status, dealId: x.converted_deal_id ? Number(x.converted_deal_id) : null,
    contact: String(x.to_address ?? "").toLowerCase(), subject: x.subject ?? "", status: x.status as ThreadStatus, lastLabel: (x.last_label as ReplyLabel | null) ?? null,
    lastMessageAt: iso(x.last_message_at), lastInboundAt: iso(x.last_inbound_at), replies: Number(x.replies), pendingReview: Number(x.pending),
    followup: x.followup ? { step: Number(x.followup.step), status: String(x.followup.status), dueAt: new Date(x.followup.dueAt + (String(x.followup.dueAt).endsWith("Z") ? "" : "Z")).toISOString() } : null,
  }));
  const last = rows.length > PAGE ? rows[PAGE - 1] : null;
  const counts = (await db.execute(sql`
    SELECT count(*)::int AS all,
           count(*) FILTER (WHERE t.status = 'awaiting')::int AS awaiting,
           count(*) FILTER (WHERE t.status <> 'awaiting')::int AS replied,
           count(*) FILTER (WHERE t.status = 'interested')::int AS interested,
           count(*) FILTER (WHERE t.status = 'needs_review')::int AS needs_review,
           count(*) FILTER (WHERE ${due})::int AS follow_up_due
      FROM ${mailThreads} t WHERE t.organization_id = ${r.orgId}`)).rows[0] as Record<InboxFilter, number>;
  return { ok: true, items, next: last ? `${last.activity_at}|${last.id}` : null, counts };
}

/** Messages from my mailbox matched by their sender's address alone, waiting for me to confirm or dismiss. */
export async function reviewQueue(user: Who): Promise<Result<{ items: ReviewItem[] }>> {
  const r = await ready(user);
  if (!r.ok) return r;
  const rows = await db.select({ m: mailMessages, company: leads.companyName }).from(mailMessages)
    .innerJoin(mailboxConnections, eq(mailboxConnections.id, mailMessages.connectionId))
    .innerJoin(leads, and(eq(leads.id, mailMessages.leadId), eq(leads.organizationId, mailMessages.organizationId)))
    .where(and(eq(mailMessages.organizationId, r.orgId), eq(mailboxConnections.userId, user.id), eq(mailMessages.reviewState, "pending"), eq(mailMessages.reviewReason, "address_only")))
    .orderBy(desc(mailMessages.sentAt)).limit(50);
  return { ok: true, items: rows.map(({ m, company }) => ({ mailMessageId: m.id, leadId: m.leadId, company, from: m.fromAddress, fromName: m.fromName, subject: m.subject, text: m.bodyText, sentAt: m.sentAt.toISOString(), reason: m.reviewReason ?? "" })) };
}

export async function conversation(user: Who, threadId: number): Promise<Result<ConversationView>> {
  const r = await ready(user);
  if (!r.ok) return r;
  const [row] = await db.select({ t: mailThreads, lead: leads, owner: mailboxConnections.userId, account: mailboxConnections.accountEmail }).from(mailThreads)
    .innerJoin(leads, and(eq(leads.id, mailThreads.leadId), eq(leads.organizationId, mailThreads.organizationId)))
    .innerJoin(mailboxConnections, eq(mailboxConnections.id, mailThreads.connectionId))
    .where(and(eq(mailThreads.organizationId, r.orgId), eq(mailThreads.id, threadId)));
  if (!row) return fail(404, "not_found", "That conversation isn't in your workspace.");
  const { t, lead } = row;
  const follow = await db.select().from(outreachFollowups).where(and(eq(outreachFollowups.organizationId, r.orgId), eq(outreachFollowups.rootMessageId, t.leadMessageId))).orderBy(asc(outreachFollowups.step));
  const ourIds = [t.leadMessageId, ...follow.map((f) => f.draftMessageId).filter((x): x is number => !!x)];
  const ours = await db.select().from(leadMessages).where(and(eq(leadMessages.organizationId, r.orgId), inArray(leadMessages.id, ourIds)));
  const jobs = await db.select({ messageId: mailSendJobs.messageId, status: mailSendJobs.status }).from(mailSendJobs).where(and(eq(mailSendJobs.organizationId, r.orgId), inArray(mailSendJobs.messageId, ourIds)));
  const synced = await db.select().from(mailMessages).where(and(eq(mailMessages.organizationId, r.orgId), eq(mailMessages.threadId, t.id))).orderBy(asc(mailMessages.sentAt), asc(mailMessages.id));
  const isOwner = row.owner === user.id;
  const messages: ConversationMessage[] = [
    ...ours.filter((m) => m.status !== "cancelled" || m.id === t.leadMessageId).map((m): ConversationMessage => ({
      id: `o:${m.id}`, direction: "out", kind: m.id === t.leadMessageId ? "outreach" : "followup", from: row.account, fromName: null, to: m.toAddress ? [m.toAddress.toLowerCase()] : [],
      subject: m.subject ?? "", text: m.body, textNote: null, at: iso(m.sentAt ?? m.approvedAt ?? m.createdAt), status: m.status,
      sendState: jobs.find((j) => j.messageId === m.id)?.status ?? null, label: null, labelBy: null, review: null,
    })),
    // The hand-sent copy of our outreach is the same text as the outreach above: not shown twice.
    ...synced.filter((m) => m.kind !== "outreach_copy").map((m): ConversationMessage => ({
      id: `m:${m.id}`, direction: m.direction as "in" | "out", kind: m.kind, from: m.fromAddress, fromName: m.fromName, to: (m.toAddresses as string[]) ?? [],
      subject: m.subject, text: m.bodyText, textNote: m.bodyRemovedAt ? "The text was deleted after the retention period." : m.bodyText === null ? "No text to show." : null,
      at: iso(m.sentAt), status: null, sendState: null, label: (m.classification as ReplyLabel | null) ?? null, labelBy: m.classifiedBy,
      review: m.reviewState === "pending" || m.reviewState === "dismissed" ? { reason: m.reviewReason ?? "", state: m.reviewState } : null,
    })),
  ].sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
  const live = !lead.archivedAt && !lead.converting && !lead.convertedDealId;
  return {
    ok: true,
    thread: {
      id: t.id, status: t.status as ThreadStatus, leadId: lead.id, company: lead.companyName, leadStatus: lead.status, dealId: lead.convertedDealId ?? null,
      canConvert: live && ["qualified", "contacted", "replied", "meeting", "proposal"].includes(lead.status),
      contact: String(ours.find((m) => m.id === t.leadMessageId)?.toAddress ?? "").toLowerCase(),
      // Only the mailbox's owner can open it in their own Gmail.
      gmailUrl: isOwner ? `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(row.account)}#all/${encodeURIComponent(t.providerThreadId)}` : null,
    },
    messages,
    followups: follow.map((f) => ({ step: f.step, status: f.status, dueAt: f.dueAt.toISOString(), reason: f.reason, draftMessageId: f.draftMessageId })),
    canWrite: !writeGate(user),
  };
}

/** Confirm or dismiss a match waiting for review. Address-only matches: the mailbox owner; another sender in a linked thread: anyone who may change leads. */
export async function reviewMessage(user: Who, mailMessageId: number, raw: unknown, deps: ApplyDeps): Promise<Result<{ state: string }>> {
  const r = await ready(user);
  if (!r.ok) return r;
  const g = writeGate(user);
  if (g) return g;
  const decision = (raw as { decision?: unknown })?.decision;
  if (decision !== "confirm" && decision !== "dismiss") return fail(400, "invalid", "Choose confirm or dismiss.");
  const now = deps.now();
  const out = await db.transaction(async (tx): Promise<Result<{ state: string }>> => {
    const [m] = await tx.select().from(mailMessages).where(and(eq(mailMessages.organizationId, r.orgId), eq(mailMessages.id, mailMessageId))).for("update");
    if (!m) return fail(404, "not_found", "That message isn't in your workspace.");
    if (m.reviewReason === "address_only") {
      const [c] = await tx.select({ userId: mailboxConnections.userId }).from(mailboxConnections).where(eq(mailboxConnections.id, m.connectionId));
      if (c?.userId !== user.id) return fail(404, "not_found", "That message isn't in your workspace."); // not even its existence
    }
    if (m.reviewState !== "pending") return { ok: true, state: m.reviewState };
    if (decision === "dismiss") {
      await tx.update(mailMessages).set({ reviewState: "dismissed" }).where(eq(mailMessages.id, m.id));
      await releaseHolds(tx, { orgId: r.orgId, leadMessageId: m.leadMessageId, now });
      if (m.threadId) {
        // The conversation's state goes back to what its other replies say (or awaiting).
        const [prev] = await tx.select({ c: mailMessages.classification }).from(mailMessages)
          .where(and(eq(mailMessages.threadId, m.threadId), eq(mailMessages.direction, "in"), sql`${mailMessages.reviewState} IN ('none', 'confirmed')`, sql`${mailMessages.id} <> ${m.id}`))
          .orderBy(desc(mailMessages.sentAt)).limit(1);
        const back = prev?.c === "interested" ? "interested" : prev?.c === "not_interested" ? "not_interested" : prev?.c === "opt_out" ? "opted_out" : prev?.c === "bounce" ? "bounced" : prev?.c ? "replied" : "awaiting";
        await tx.update(mailThreads).set({ status: back, statusAt: now, updatedAt: now }).where(eq(mailThreads.id, m.threadId));
      }
      return { ok: true, state: "dismissed" };
    }
    let threadId = m.threadId;
    if (!threadId) {
      // Confirmed: this Gmail thread now belongs to the conversation (later messages in it match by thread).
      await tx.insert(mailThreads).values({ organizationId: r.orgId, connectionId: m.connectionId, providerThreadId: m.providerThreadId, leadId: m.leadId, leadMessageId: m.leadMessageId, source: "adopted", lastMessageAt: m.sentAt, lastInboundAt: m.sentAt, createdAt: now, updatedAt: now })
        .onConflictDoNothing({ target: [mailThreads.connectionId, mailThreads.providerThreadId] });
      const [th] = await tx.select({ id: mailThreads.id }).from(mailThreads).where(and(eq(mailThreads.connectionId, m.connectionId), eq(mailThreads.providerThreadId, m.providerThreadId)));
      threadId = th.id;
    }
    // Applied again, now as a confirmed reply (its effects run once: events and list entries are unique).
    await tx.update(mailMessages).set({ reviewState: "confirmed", threadId, appliedAt: null }).where(eq(mailMessages.id, m.id));
    return { ok: true, state: "confirmed" };
  });
  if (out.ok && out.state === "confirmed") await applyReply(r.orgId, mailMessageId, deps);
  return out;
}

/** A person's correction of the rules' label. Applied again: an opt-out takes effect; an opt-out once applied is not undone. */
export async function relabelMessage(user: Who, mailMessageId: number, raw: unknown, deps: ApplyDeps): Promise<Result<{ label: ReplyLabel }>> {
  const r = await ready(user);
  if (!r.ok) return r;
  const g = writeGate(user);
  if (g) return g;
  const label = (raw as { label?: unknown })?.label;
  if (typeof label !== "string" || !LABELS.includes(label)) return fail(400, "invalid", "Choose one of the labels.");
  const [m] = await db.select().from(mailMessages).where(and(eq(mailMessages.organizationId, r.orgId), eq(mailMessages.id, mailMessageId), eq(mailMessages.direction, "in")));
  if (!m || (m.reviewReason === "address_only" && m.reviewState === "pending")) return fail(404, "not_found", "That message isn't in your workspace.");
  await db.update(mailMessages).set({ classification: label, classifiedBy: "user", classifierVersion: null, appliedAt: null }).where(and(eq(mailMessages.id, m.id), eq(mailMessages.organizationId, r.orgId)));
  await applyReply(r.orgId, m.id, deps);
  return { ok: true, label: label as ReplyLabel };
}
