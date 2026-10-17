/**
 * How a lead-timeline entry reads, on the lead page and on its deal's page (one wording for both). Timeline entries
 * about email carry ids and labels only, never message text, so everything here is built from those.
 */
import { REPLY_LABEL_TEXT, type ReplyLabel } from "./inbox-view";

export const ACTIVITY_LABEL: Record<string, string> = {
  created: "Lead added", updated: "Details updated", status_changed: "Stage changed", note: "Note", ticket_created: "Next step added",
  ticket_done: "Next step closed", claim_added: "Fact recorded", converted: "Turned into a deal", archived: "Archived", researched: "Researched",
  draft_created: "Email draft written", draft_approved: "Email approved", draft_cancelled: "Email draft stopped",
  message_sent: "Email sent", message_send_resolved: "Send outcome confirmed", message_send_late_confirmation: "Send confirmed late",
  outreach_replied: "They replied", outreach_opted_out: "They asked not to be contacted", outreach_bounced: "Email bounced",
  reply_labelled: "Reply label changed", reply_match_confirmed: "Reply confirmed as theirs", reply_match_dismissed: "Reply marked not related",
  channel_draft_created: "Message draft written", channel_message_sent: "Message sent", channel_reply: "They replied",
  channel_opt_in: "WhatsApp permission recorded", channel_opted_out: "They asked to stop WhatsApp messages",
};

const CHANNEL_NAME: Record<string, string> = { whatsapp: "WhatsApp", linkedin: "LinkedIn", x: "X" };

const WHY_STOPPED: Record<string, string> = {
  replied: "they replied", opted_out: "they asked not to be contacted", bounced: "the address bounced", won: "the lead became a deal",
  suppressed: "the address is on the do-not-contact list", do_not_contact: "the lead is marked do-not-contact",
};

const label = (v: unknown) => (typeof v === "string" && v in REPLY_LABEL_TEXT ? REPLY_LABEL_TEXT[v as ReplyLabel] : null);

/** A short second line for an entry, or null. `stage` turns a stage id into its name. */
export function activityDetail(kind: string, d: Record<string, unknown>, stage: (s: string) => string): string | null {
  switch (kind) {
    case "status_changed":
      return typeof d.from === "string" && typeof d.to === "string" ? `${stage(d.from)} → ${stage(d.to)}${d.via === "gmail_sync" ? " (from their reply)" : ""}` : null;
    case "outreach_replied": {
      const l = label(d.label);
      return l ? `Reads as: ${l}` : null;
    }
    case "reply_labelled": {
      const to = label(d.to), from = label(d.from);
      return to ? (from ? `${from} → ${to}` : `Now: ${to}`) : null;
    }
    case "draft_cancelled":
      return typeof d.why === "string" && WHY_STOPPED[d.why] ? `Stopped because ${WHY_STOPPED[d.why]}` : null;
    case "converted":
      return d.via === "inbox" ? "From an interested email reply" : null;
    case "channel_draft_created":
    case "channel_message_sent":
    case "channel_reply": {
      const on = typeof d.channel === "string" && CHANNEL_NAME[d.channel] ? `On ${CHANNEL_NAME[d.channel]}` : null;
      if (!on) return null;
      if (kind === "channel_message_sent") return d.via === "manual" ? `${on}, sent by you outside DealInSec` : `${on}, from your business number`;
      if (kind === "channel_reply") return d.via === "manual" ? `${on}, recorded by you` : on;
      return d.ai ? `${on}, written by AI for you to review` : on;
    }
    case "updated":
      return Array.isArray(d.fields) && d.fields.includes("doNotContact") && d.via === "gmail_sync" ? "Marked do-not-contact after their reply" : null;
    default:
      return null;
  }
}

/** Who did it: Gmail reply sync, the agent, or a person. */
export function activityActor(e: { actor: string; data?: unknown }): "Gmail" | "Agent" | "You" {
  if ((e.data as { via?: unknown } | null)?.via === "gmail_sync") return "Gmail";
  return e.actor === "agent" ? "Agent" : "You";
}

/** The conversation an entry belongs to, when it names one (for a "View conversation" link). */
export function activityThreadId(d: Record<string, unknown>): number | null {
  return typeof d.threadId === "number" && d.threadId > 0 ? d.threadId : null;
}

/** The inbox address of one conversation. */
export const conversationHref = (threadId: number) => `/outbound?view=inbox&thread=${threadId}`;
