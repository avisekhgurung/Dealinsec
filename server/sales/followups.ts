/**
 * The follow-up sequence (outreach_followups, scheduled by message-store.ts completeAfterSend when an outreach or a
 * follow-up is sent). When a step falls due, this prepares a DRAFT for the person to review, edit, approve and send:
 * nothing here sends anything.
 *
 * Before drafting it rechecks, at that moment: no reply, opt-out or bounce on the conversation; the lead still open,
 * not do-not-contact, not already past "contacted"; the address not on the do-not-contact list. Sending rechecks
 * again (send-store-pg.ts reserve), so a reply arriving after the draft still stops it.
 *
 * The draft is a fixed template, personalized from the lead (name, company) and the subject of the outreach we wrote
 * ourselves. It never uses synced Gmail content, and it makes no model call (no AI budget spent unattended).
 */
import { and, eq, inArray, lt, or, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { leadEvents, leadMessages, leads, outreachEvents, outreachFollowups, outreachSuppressions } from "@shared/schema";
import { addBusinessDays } from "@shared/followup-policy";
import { hashDraft } from "@shared/outreach-hash";
import { normalEmail, suppressionKeys } from "@shared/outreach-safety";
import { DraftExists, messageStore } from "./message-store";
import { followupText } from "./followup-text";

export { followupText };

export const FOLLOWUP_PROMPT_VERSION = "followup-t1"; // a template, not a model prompt
const LEASE_MS = 5 * 60_000;
const STILL_CONTACTING = new Set(["contacted", "qualified", "new", "researching"]);

export interface FollowupDeps {
  now(): Date;
  log(event: string, fields?: Record<string, string | number | boolean | null>): void;
  senderName(orgId: string, userId: string | null): Promise<string>;
  notify?(n: { orgId: string; leadId: number; companyName: string }): Promise<void>;
}

type Outcome = "drafted" | "skipped" | "later" | "busy" | "gone";

/** Prepares one due step, if it is still wanted. */
async function draftOne(id: number, deps: FollowupDeps): Promise<Outcome> {
  const now = deps.now();
  const [f] = await db.update(outreachFollowups).set({ leaseUntil: new Date(now.getTime() + LEASE_MS), attempts: sql`${outreachFollowups.attempts} + 1` as any, updatedAt: now })
    .where(and(eq(outreachFollowups.id, id), eq(outreachFollowups.status, "scheduled"), or(isNull(outreachFollowups.leaseUntil), lt(outreachFollowups.leaseUntil, now)))).returning();
  if (!f) return "busy";
  const stop = async (reason: string, status: "skipped" | "cancelled" = "skipped") => {
    await db.update(outreachFollowups).set({ status, reason, leaseUntil: null, updatedAt: now }).where(and(eq(outreachFollowups.id, f.id), eq(outreachFollowups.status, "scheduled")));
    deps.log("outreach_followup_skipped", { followupId: f.id, reason });
    return "skipped" as const;
  };

  const [root] = await db.select().from(leadMessages).where(and(eq(leadMessages.organizationId, f.organizationId), eq(leadMessages.id, f.rootMessageId)));
  if (!root || root.status !== "sent") return stop("root_missing");
  const answered = await db.select({ id: outreachEvents.id }).from(outreachEvents)
    .where(and(eq(outreachEvents.organizationId, f.organizationId), eq(outreachEvents.messageId, root.id), inArray(outreachEvents.kind, ["replied", "opted_out", "bounced"]))).limit(1);
  if (answered.length) return stop("replied", "cancelled");
  const [lead] = await db.select().from(leads).where(and(eq(leads.organizationId, f.organizationId), eq(leads.id, f.leadId)));
  if (!lead || lead.archivedAt || lead.converting || lead.convertedDealId) return stop("lead_closed");
  if (lead.doNotContact) return stop("do_not_contact", "cancelled");
  if (!STILL_CONTACTING.has(lead.status)) return stop("progressed"); // replied, meeting, proposal, won or lost: a person is on it
  const to = normalEmail(root.toAddress);
  if (!to) return stop("no_address");
  const keys = suppressionKeys(to);
  const listed = await db.select({ id: outreachSuppressions.id }).from(outreachSuppressions)
    .where(and(eq(outreachSuppressions.organizationId, f.organizationId), sql`(${sql.join(keys.map((k) => sql`(${outreachSuppressions.kind} = ${k.kind} AND ${outreachSuppressions.value} = ${k.value})`), sql` OR `)})`)).limit(1);
  if (listed.length) return stop("suppressed", "cancelled");

  const text = followupText({ step: f.step, greetName: lead.contactName, company: lead.companyName, subject: root.subject ?? "", sender: await deps.senderName(f.organizationId, root.approvedBy) });
  let draft;
  try {
    draft = await messageStore.create({
      orgId: f.organizationId, leadId: lead.id, subject: text.subject, body: text.body, bodyHash: hashDraft(text.subject, text.body), toAddress: to,
      toSource: (root.toSource as "lead" | "site") ?? "lead", researchId: null, claimIds: [], promptVersion: FOLLOWUP_PROMPT_VERSION, by: "agent", userId: root.approvedBy ?? "system", now,
    });
  } catch (e) {
    if (!(e instanceof DraftExists)) throw e;
    // The lead already has a message waiting (someone is writing): try again the next business day.
    await db.update(outreachFollowups).set({ dueAt: addBusinessDays(now, 1), leaseUntil: null, reason: "draft_waiting", updatedAt: now }).where(eq(outreachFollowups.id, f.id));
    return "later";
  }
  // Still scheduled? A reply applied meanwhile cancels the step; then the draft we just made goes too.
  const [done] = await db.update(outreachFollowups).set({ status: "drafted", draftMessageId: draft.id, reason: null, leaseUntil: null, updatedAt: now })
    .where(and(eq(outreachFollowups.id, f.id), eq(outreachFollowups.status, "scheduled"))).returning({ id: outreachFollowups.id });
  if (!done) {
    await db.update(leadMessages).set({ status: "cancelled", updatedAt: now }).where(and(eq(leadMessages.id, draft.id), eq(leadMessages.status, "draft")));
    return "gone";
  }
  await db.insert(leadEvents).values({ leadId: lead.id, organizationId: f.organizationId, kind: "draft_created", data: { messageId: draft.id, followupStep: f.step }, actor: "agent", actorUserId: null, createdAt: now });
  deps.log("outreach_followup_drafted", { followupId: f.id, step: f.step, messageId: draft.id });
  if (deps.notify) await deps.notify({ orgId: f.organizationId, leadId: lead.id, companyName: lead.companyName }).catch(() => {});
  return "drafted";
}

/** Drafts the follow-ups that are due (a few per call). Never throws. */
export async function draftDueFollowups(deps: FollowupDeps, opts: { limit?: number } = {}): Promise<Record<Outcome, number>> {
  const counts: Record<Outcome, number> = { drafted: 0, skipped: 0, later: 0, busy: 0, gone: 0 };
  try {
    const now = deps.now();
    const due = await db.select({ id: outreachFollowups.id }).from(outreachFollowups)
      .where(and(eq(outreachFollowups.status, "scheduled"), sql`${outreachFollowups.dueAt} <= ${now.toISOString()}::timestamp`, or(isNull(outreachFollowups.leaseUntil), sql`${outreachFollowups.leaseUntil} < ${now.toISOString()}::timestamp`)))
      .orderBy(outreachFollowups.dueAt).limit(opts.limit ?? 10);
    for (const d of due) {
      try { counts[await draftOne(d.id, deps)]++; } catch (e) { deps.log("outreach_followup_failed", { followupId: d.id, errorType: (e as Error)?.name ?? "Error" }); }
    }
  } catch (e) {
    deps.log("outreach_followup_failed", { where: "sweep", errorType: (e as Error)?.name ?? "Error" });
  }
  return counts;
}
