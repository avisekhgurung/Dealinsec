/**
 * The activity-log entries the mail jobs write when something happens with nobody at the keyboard: a reply was
 * synced, a follow-up fell due. Pure: it only builds the row; the caller stores it.
 *
 * The entry's user is the person it is about when there is one, and NULL otherwise. Never a made-up id: the column
 * is a foreign key to users, so a placeholder such as "system" makes the insert fail, and because the activity log
 * is best-effort the failure was swallowed and the notice simply never appeared (seen on production: every
 * "follow-up ready for review" notice, and every reply notice with no known sender, was lost that way).
 * Who wrote it is in `userName` ("Gmail", "Follow-ups"), which is what the activity list shows.
 */
import type { InsertActivityLog } from "@shared/schema";

export type ReplyNoticeKind = "replied" | "opted_out" | "bounced" | "review";
const REPLY_ACTION: Record<ReplyNoticeKind, string> = { replied: "replied to your outreach", opted_out: "asked not to be contacted", bounced: "outreach bounced", review: "a reply needs your review" };

/** A real user id or nothing: whatever isn't a plausible id is dropped rather than stored. */
const userOrNull = (id: string | null | undefined): string | null => (typeof id === "string" && id.trim() && id !== "system" ? id : null);

export function replyNotice(n: { orgId: string; leadId: number; userId: string | null; companyName: string; what: ReplyNoticeKind }): InsertActivityLog {
  return { organizationId: n.orgId, userId: userOrNull(n.userId), userName: "Gmail", action: REPLY_ACTION[n.what], entityType: "lead", entityId: String(n.leadId), detail: n.companyName };
}
export function followupNotice(n: { orgId: string; leadId: number; companyName: string }): InsertActivityLog {
  return { organizationId: n.orgId, userId: null, userName: "Follow-ups", action: "follow-up ready for review", entityType: "lead", entityId: String(n.leadId), detail: n.companyName };
}
