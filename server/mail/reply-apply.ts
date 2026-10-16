/**
 * What a synced reply changes (Phase D), applied once per message from the outbox `mail_messages.applied_at`.
 *
 * planReply (pure) decides; applyReply carries the plan out in ONE transaction:
 *   reply (any human answer)  "replied" on the outreach, the lead moves to "replied", follow-ups cancelled;
 *   opt-out                   address on the do-not-contact list, lead marked do-not-contact, every unsent message
 *                             to it cancelled, follow-ups cancelled. Applied even from a match awaiting review when it
 *                             comes from the address we wrote to: stopping is never the wrong direction;
 *   bounce                    the outreach address on the list (it doesn't work), follow-ups cancelled;
 *   out of office             nothing: an auto-reply is not an answer;
 *   awaiting review           follow-ups HELD (not sent, not drafted) until a person confirms or dismisses the match.
 *
 * Locks, in the order every outreach path uses: the mail message, the outreach messages (root, then the follow-up
 * drafts it cancels), the lead, then the address keys (sorted). A follow-up send reserves its own message row first,
 * so it either finishes before this (and is recorded) or sees the cancellation. Nothing here reads message text into
 * a model, a log or the lead's timeline: timeline entries carry ids only (the AI agent can read the timeline).
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { leadEvents, leadMessages, leads, leadTickets, mailMessages, mailThreads, outreachEvents, outreachFollowups, outreachSuppressions } from "@shared/schema";
import { canMove, type LeadStatus } from "@shared/leads";
import { normalEmail, suppressionKeys } from "@shared/outreach-safety";
import { addressLockKey, OUTREACH_ADDRESS_LOCK } from "../sales/message-store";
import { classifyReply, CLASSIFIER_VERSION, conversationStatusFor, type ReplyLabel } from "./reply-rules";
import type { MessageKind } from "./reply-match";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface ReplyFacts {
  direction: "in" | "out";
  kind: MessageKind;
  label: ReplyLabel;
  reviewState: string; // none | pending | confirmed | dismissed
  linked: boolean; // in a conversation's thread (not an address-only match)
  fromAddress: string | null;
  outreachTo: string; // the address the outreach went to
}

export interface ReplyPlan {
  event: "replied" | "opted_out" | "bounced" | null; // outreach_events on the root outreach, once
  suppress: { address: string; reason: "opt_out" | "bounce" } | null;
  markDoNotContact: boolean;
  moveToReplied: boolean;
  followups: { action: "cancel" | "hold"; reason: string } | null;
  threadStatus: "replied" | "interested" | "not_interested" | "opted_out" | "bounced" | "needs_review" | null;
  notify: boolean;
}

const NOTHING: ReplyPlan = { event: null, suppress: null, markDoNotContact: false, moveToReplied: false, followups: null, threadStatus: null, notify: false };

export function planReply(f: ReplyFacts): ReplyPlan {
  if (f.direction !== "in" || f.reviewState === "dismissed") return NOTHING;
  const fromOutreach = !!f.fromAddress && f.fromAddress === f.outreachTo;
  const optOut = (address: string): ReplyPlan => ({
    event: "opted_out", suppress: { address, reason: "opt_out" }, markDoNotContact: true, moveToReplied: false,
    followups: { action: "cancel", reason: "opted_out" }, threadStatus: "opted_out", notify: true,
  });
  if (f.reviewState === "pending") {
    // Safety first: the person we wrote to asking us to stop is honoured before anyone reviews the match.
    if (f.label === "opt_out" && fromOutreach) return optOut(f.outreachTo);
    return { ...NOTHING, followups: { action: "hold", reason: "review" }, threadStatus: f.linked ? "needs_review" : null, notify: true };
  }
  switch (f.label) {
    case "bounce":
      return { event: "bounced", suppress: { address: f.outreachTo, reason: "bounce" }, markDoNotContact: false, moveToReplied: false, followups: { action: "cancel", reason: "bounced" }, threadStatus: "bounced", notify: true };
    case "opt_out":
      return optOut(f.fromAddress ?? f.outreachTo);
    case "out_of_office":
      return NOTHING;
    default:
      return { event: "replied", suppress: null, markDoNotContact: false, moveToReplied: true, followups: { action: "cancel", reason: "replied" }, threadStatus: conversationStatusFor(f.label), notify: true };
  }
}

export interface ApplyDeps {
  now(): Date;
  log(event: string, fields?: Record<string, string | number | boolean | null>): void;
  /** A notice for the organization (the activity log): company name and what happened, never message content. */
  notify?(n: { orgId: string; leadId: number; userId: string | null; companyName: string; what: "replied" | "opted_out" | "bounced" | "review" }): Promise<void>;
}

/** The outreach a message belongs to: a follow-up draft's root, else the message itself. */
async function rootOf(tx: Tx, orgId: string, leadMessageId: number): Promise<number> {
  const [f] = await tx.select({ root: outreachFollowups.rootMessageId }).from(outreachFollowups)
    .where(and(eq(outreachFollowups.organizationId, orgId), eq(outreachFollowups.draftMessageId, leadMessageId))).limit(1);
  return f?.root ?? leadMessageId;
}

/** Cancels (or holds) the root outreach's pending follow-ups and their unsent drafts. Returns how many steps changed. */
export async function settleFollowups(tx: Tx, o: { orgId: string; rootId: number; action: "cancel" | "hold"; reason: string; now: Date }): Promise<number> {
  const pending = await tx.select().from(outreachFollowups)
    .where(and(eq(outreachFollowups.organizationId, o.orgId), eq(outreachFollowups.rootMessageId, o.rootId), inArray(outreachFollowups.status, o.action === "cancel" ? ["scheduled", "held", "drafted"] : ["scheduled", "drafted"])))
    .orderBy(outreachFollowups.step);
  let n = 0;
  for (const f of pending) {
    if (f.draftMessageId) {
      // The draft's own row first: a send of it either finished (then it's sent, and stays so) or sees this.
      const [d] = await tx.select().from(leadMessages).where(and(eq(leadMessages.organizationId, o.orgId), eq(leadMessages.id, f.draftMessageId))).for("update");
      if (d && (d.status === "draft" || d.status === "approved")) {
        if (o.action === "cancel") await tx.update(leadMessages).set({ status: "cancelled", updatedAt: o.now }).where(eq(leadMessages.id, d.id));
      } else if (d && d.status !== "cancelled") continue; // sending or sent: it is out of our hands
    }
    await tx.update(outreachFollowups).set({ status: o.action === "cancel" ? "cancelled" : "held", reason: o.reason, leaseUntil: null, updatedAt: o.now }).where(eq(outreachFollowups.id, f.id));
    n++;
  }
  return n;
}

export type ApplyResult = "applied" | "already" | "missing";

/** Applies one synced message's effect, once. Safe to call any number of times, concurrently. */
export async function applyReply(orgId: string, mailMessageId: number, deps: ApplyDeps): Promise<ApplyResult> {
  const now = deps.now();
  let notice: Parameters<NonNullable<ApplyDeps["notify"]>>[0] | null = null;
  const result = await db.transaction(async (tx): Promise<ApplyResult> => {
    const [m] = await tx.select().from(mailMessages).where(and(eq(mailMessages.organizationId, orgId), eq(mailMessages.id, mailMessageId))).for("update");
    if (!m) return "missing";
    if (m.appliedAt) return "already";
    const done = () => tx.update(mailMessages).set({ appliedAt: now }).where(eq(mailMessages.id, m.id));
    if (m.direction !== "in") { await done(); return "applied"; }

    const label = (m.classification as ReplyLabel | null) ?? classifyReply({ kind: m.kind as MessageKind, subject: m.subject, text: m.bodyText });
    if (!m.classification) await tx.update(mailMessages).set({ classification: label, classifiedBy: "rules", classifierVersion: CLASSIFIER_VERSION }).where(eq(mailMessages.id, m.id));
    const rootId = await rootOf(tx, orgId, m.leadMessageId);
    const [root] = await tx.select().from(leadMessages).where(and(eq(leadMessages.organizationId, orgId), eq(leadMessages.id, rootId))).for("update");
    const outreachTo = normalEmail(root?.toAddress) ?? "";
    const plan = planReply({ direction: "in", kind: m.kind as MessageKind, label, reviewState: m.reviewState, linked: m.threadId !== null, fromAddress: m.fromAddress, outreachTo });

    if (plan.followups) await settleFollowups(tx, { orgId, rootId, action: plan.followups.action, reason: plan.followups.reason, now });
    const [lead] = await tx.select().from(leads).where(and(eq(leads.organizationId, orgId), eq(leads.id, m.leadId))).for("update");
    const event = (kind: string, data: Record<string, unknown>) => tx.insert(leadEvents).values({ leadId: m.leadId, organizationId: orgId, kind, data, actor: "user", actorUserId: null, createdAt: now });

    if (plan.event && root) {
      const ins = await tx.insert(outreachEvents).values({ organizationId: orgId, leadId: root.leadId, messageId: root.id, kind: plan.event, source: "provider", provider: "gmail", providerMessageId: m.providerMessageId, actorUserId: null, createdAt: now })
        .onConflictDoNothing().returning({ id: outreachEvents.id });
      if (ins.length) await event(`outreach_${plan.event}`, { messageId: root.id, via: "gmail_sync" }); // ids only: no text from the email
    }
    if (plan.suppress) {
      const address = normalEmail(plan.suppress.address);
      if (address) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${OUTREACH_ADDRESS_LOCK}::int, hashtext(${addressLockKey(orgId, { kind: "email", value: address })}))`);
        await tx.insert(outreachSuppressions).values({ organizationId: orgId, kind: "email", value: address, reason: plan.suppress.reason, sourceMessageId: root?.id ?? null, note: "from a Gmail reply", createdBy: null, createdAt: now }).onConflictDoNothing();
        // Nothing unsent may go to it now, from any lead.
        const unsent = await tx.select({ id: leadMessages.id, leadId: leadMessages.leadId, to: leadMessages.toAddress }).from(leadMessages)
          .where(and(eq(leadMessages.organizationId, orgId), eq(leadMessages.direction, "out"), inArray(leadMessages.status, ["draft", "approved"]), sql`lower(${leadMessages.toAddress}) = ${address}`));
        for (const u of unsent) {
          const [c] = await tx.update(leadMessages).set({ status: "cancelled", updatedAt: now }).where(and(eq(leadMessages.id, u.id), inArray(leadMessages.status, ["draft", "approved"]))).returning({ id: leadMessages.id });
          if (c) await tx.insert(leadEvents).values({ leadId: u.leadId, organizationId: orgId, kind: "draft_cancelled", data: { messageId: u.id, why: "suppressed" }, actor: "user", actorUserId: null, createdAt: now });
        }
      }
    }
    if (lead) {
      if (plan.markDoNotContact && !lead.doNotContact) {
        await tx.update(leads).set({ doNotContact: true, updatedAt: now }).where(eq(leads.id, lead.id));
        await event("updated", { fields: ["doNotContact"], via: "gmail_sync" });
      }
      if (plan.moveToReplied && !lead.archivedAt && !lead.converting && canMove(lead.status as LeadStatus, "replied")) {
        const [moved] = await tx.update(leads).set({ status: "replied", statusChangedAt: now, updatedAt: now, lostReason: null })
          .where(and(eq(leads.id, lead.id), eq(leads.status, lead.status), isNull(leads.archivedAt), eq(leads.converting, false))).returning({ id: leads.id });
        if (moved) await event("status_changed", { from: lead.status, to: "replied", via: "gmail_sync" });
      }
      if (plan.followups?.action === "cancel") {
        await tx.update(leadTickets).set({ status: "cancelled", doneAt: now }).where(and(eq(leadTickets.organizationId, orgId), eq(leadTickets.leadId, lead.id), eq(leadTickets.kind, "follow_up"), eq(leadTickets.status, "open")));
      }
    }
    if (plan.threadStatus && m.threadId) await tx.update(mailThreads).set({ status: plan.threadStatus, statusAt: now, updatedAt: now }).where(and(eq(mailThreads.id, m.threadId), eq(mailThreads.organizationId, orgId)));
    await done();
    if (plan.notify && lead) notice = { orgId, leadId: lead.id, userId: null, companyName: lead.companyName, what: plan.event ?? "review" };
    deps.log("gmail_reply_applied", { mailMessageId: m.id, label, event: plan.event, followups: plan.followups?.action ?? null, review: m.reviewState === "pending" });
    return "applied";
  });
  if (notice && deps.notify) await deps.notify(notice).catch(() => {});
  return result;
}

/** Applies every unapplied synced message (oldest first): the repair path after a crash. Never throws. */
export async function applyPendingReplies(deps: ApplyDeps, opts: { orgId?: string; limit?: number } = {}): Promise<number> {
  try {
    const rows = await db.select({ id: mailMessages.id, org: mailMessages.organizationId }).from(mailMessages)
      .where(and(isNull(mailMessages.appliedAt), opts.orgId ? eq(mailMessages.organizationId, opts.orgId) : undefined))
      .orderBy(mailMessages.createdAt, mailMessages.id).limit(opts.limit ?? 50);
    let n = 0;
    for (const r of rows) if ((await applyReply(r.org, r.id, deps)) === "applied") n++;
    return n;
  } catch (e) {
    deps.log("gmail_reply_apply_failed", { errorType: (e as Error)?.name ?? "Error" });
    return 0;
  }
}

/** A dismissed review: follow-ups held for it go back to scheduled, unless something else still holds or answered them. */
export async function releaseHolds(tx: Tx, o: { orgId: string; leadMessageId: number; now: Date }): Promise<number> {
  const rootId = await rootOf(tx, o.orgId, o.leadMessageId);
  await tx.select({ id: leadMessages.id }).from(leadMessages).where(and(eq(leadMessages.organizationId, o.orgId), eq(leadMessages.id, rootId))).for("update");
  const still = await tx.execute(sql`
    SELECT 1 FROM ${mailMessages} m WHERE m.organization_id = ${o.orgId} AND m.review_state = 'pending' AND m.direction = 'in'
       AND (m.lead_message_id = ${rootId} OR m.lead_message_id IN (SELECT f.draft_message_id FROM ${outreachFollowups} f WHERE f.organization_id = ${o.orgId} AND f.root_message_id = ${rootId} AND f.draft_message_id IS NOT NULL))
     LIMIT 1`);
  const answered = await tx.execute(sql`SELECT 1 FROM ${outreachEvents} e WHERE e.organization_id = ${o.orgId} AND e.message_id = ${rootId} AND e.kind IN ('replied', 'opted_out', 'bounced') LIMIT 1`);
  if (still.rows.length || answered.rows.length) return 0;
  const r = await tx.update(outreachFollowups).set({ status: sql`CASE WHEN ${outreachFollowups.draftMessageId} IS NULL THEN 'scheduled' ELSE 'drafted' END`, reason: null, updatedAt: o.now })
    .where(and(eq(outreachFollowups.organizationId, o.orgId), eq(outreachFollowups.rootMessageId, rootId), eq(outreachFollowups.status, "held"), eq(outreachFollowups.reason, "review"))).returning({ id: outreachFollowups.id });
  return r.length;
}
