/**
 * The next best action for a lead. Pure rules in a strict priority order, no model: every action
 * names the facts it came from, so "why" is never invented. The first rule that applies wins.
 *
 *   1  archived, won or lost            -> nothing to do
 *   2  marked do not contact            -> no outreach, whatever else is true
 *   3  matches something you exclude    -> reconsider
 *   4  a message is approved, unsent    -> send it (open it in your email app, then mark it sent)
 *   5  a draft is waiting               -> review it
 *   6  not researched yet               -> research it
 *   7  they replied                     -> answer them
 *   8  in a meeting or proposal         -> move it forward
 *   9  contacted                        -> wait a few days, then follow up
 *   10 not yet contacted: no email      -> find a contact
 *   11 not yet contacted: low fit       -> reconsider
 *   12 not yet contacted, reachable     -> draft outreach
 *
 * It recommends; the backend validates and performs any stage change (shared/leads.ts), and sending
 * always needs a person's approval.
 */
import type { FitVerdict } from "./fit";
import type { Confidence } from "./lead-score";

export type ActionKey = "none" | "reconsider" | "research" | "send_message" | "review_draft" | "respond" | "move_forward" | "wait" | "follow_up" | "find_contact" | "draft_outreach";

export interface NextActionInput {
  status: string;
  archived: boolean;
  doNotContact: boolean;
  hasContactEmail: boolean;
  /** A research run has finished for this lead. */
  researched: boolean;
  fit: FitVerdict | null;
  score: { total: number; knownMax: number; confidence: Confidence } | null;
  /** The lead's one unsent message: a draft waiting for review, or approved and waiting to be sent. */
  pendingMessage: "draft" | "approved" | null;
  /** Whole days since the lead was last contacted; null if never. */
  daysSinceContact: number | null;
  overdueTicket: boolean;
  /** The lead can be turned into a deal now (a status the conversion accepts). */
  canConvert: boolean;
}
export interface NextAction { action: ActionKey; label: string; reason: string; blockedBy?: "archived" | "closed" | "do_not_contact" }

/** A contacted lead gets this many quiet days before a follow-up is suggested. */
export const FOLLOW_UP_AFTER_DAYS = 3;
/** With enough measured, a score under this on the 100 scale suggests moving on. */
export const LOW_SCORE = 25;

const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

export function nextAction(i: NextActionInput): NextAction {
  if (i.archived) return { action: "none", label: "Archived", reason: "This lead is archived.", blockedBy: "archived" };
  if (i.status === "won") return { action: "none", label: "Won", reason: "It became a deal. Carry on there.", blockedBy: "closed" };
  if (i.status === "lost") return { action: "none", label: "Closed", reason: "This lead is marked lost.", blockedBy: "closed" };
  if (i.doNotContact) return { action: "none", label: "Do not contact", reason: "It is marked do not contact, so nothing is sent to it.", blockedBy: "do_not_contact" };

  if (i.fit === "excluded") return { action: "reconsider", label: "Reconsider this lead", reason: "It matches something you said you do not want." };

  if (i.pendingMessage === "approved") return { action: "send_message", label: "Send your approved message", reason: "It is approved and waiting: open it in your email app, then mark it sent." };
  if (i.pendingMessage === "draft") return { action: "review_draft", label: "Review your draft", reason: "A message is drafted and waiting for your approval." };
  if (!i.researched && (i.status === "new" || i.status === "researching")) {
    return { action: "research", label: "Research this company", reason: "Nothing has been researched yet, so most of the score is unknown." };
  }

  if (i.status === "replied") return { action: "respond", label: "Reply to the customer", reason: "They replied. Answer while the conversation is warm." };
  if (i.status === "meeting" || i.status === "proposal") {
    return i.canConvert
      ? { action: "move_forward", label: "Move it forward", reason: `It is at the ${i.status} stage. Create the deal once the amount is agreed.` }
      : { action: "follow_up", label: "Follow up", reason: `It is at the ${i.status} stage and cannot become a deal yet.` };
  }

  if (i.status === "contacted") {
    if (i.overdueTicket) return { action: "follow_up", label: "Follow up", reason: "A follow-up step you set is overdue." };
    if (i.daysSinceContact !== null && i.daysSinceContact >= FOLLOW_UP_AFTER_DAYS) {
      return { action: "follow_up", label: "Follow up", reason: `You contacted them ${days(i.daysSinceContact)} ago and no reply is recorded.` };
    }
    return { action: "wait", label: "Wait", reason: i.daysSinceContact === null ? "You contacted them recently. Give it a few days." : `You contacted them ${days(i.daysSinceContact)} ago. Give it a few days.` };
  }

  // new, researching or qualified, and researched: not yet contacted.
  if (!i.hasContactEmail) return { action: "find_contact", label: "Find a contact email", reason: "There is no way to reach them yet." };
  if (i.score && i.score.confidence === "high" && i.score.total < LOW_SCORE) {
    return { action: "reconsider", label: "Reconsider this lead", reason: `It scores ${i.score.total} of ${i.score.knownMax} on what is known, which is low.` };
  }
  return { action: "draft_outreach", label: "Draft outreach", reason: "It is researched, reachable and not yet contacted." };
}
