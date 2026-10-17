/**
 * The outreach inbox, as both sides see it: the labels a reply can carry (set by fixed rules or by a person, never by
 * an AI model), what each conversation state means, and the shapes the API returns (server/mail/inbox.ts).
 */

export const REPLY_LABELS = ["interested", "more_info", "not_interested", "opt_out", "out_of_office", "bounce", "needs_review"] as const;
export type ReplyLabel = (typeof REPLY_LABELS)[number];
export const REPLY_LABEL_TEXT: Record<ReplyLabel, string> = {
  interested: "Interested",
  more_info: "Wants more information",
  not_interested: "Not interested",
  opt_out: "Asked not to be contacted",
  out_of_office: "Out of office",
  bounce: "Didn't arrive (bounced)",
  needs_review: "Needs review",
};

export const INBOX_FILTERS = ["all", "awaiting", "replied", "interested", "needs_review", "follow_up_due"] as const;
export type InboxFilter = (typeof INBOX_FILTERS)[number];
export const INBOX_FILTER_TEXT: Record<InboxFilter, string> = {
  all: "All", awaiting: "Awaiting reply", replied: "Replied", interested: "Interested", needs_review: "Needs review", follow_up_due: "Follow-up due",
};

export type ThreadStatus = "awaiting" | "replied" | "interested" | "not_interested" | "opted_out" | "bounced" | "needs_review";
export const THREAD_STATUS_TEXT: Record<ThreadStatus, { label: string; next: string }> = {
  awaiting: { label: "Awaiting reply", next: "Nothing to do yet. A follow-up draft appears when it's due." },
  replied: { label: "Replied", next: "Read the reply and answer it from your Gmail." },
  interested: { label: "Interested", next: "Answer them, and create the deal when you've agreed the work." },
  not_interested: { label: "Not interested", next: "No follow-ups will be drafted. You can mark the lead lost." },
  opted_out: { label: "Asked not to be contacted", next: "They're on your do-not-contact list. Nothing more will be sent to them." },
  bounced: { label: "Bounced", next: "The address didn't work and is on your do-not-contact list. Find another contact." },
  needs_review: { label: "Needs review", next: "Read the reply and set its label, so DealInSec knows what it means." },
};

export const FOLLOWUP_STATUS_TEXT: Record<string, string> = {
  scheduled: "Scheduled", held: "Paused for your review", drafted: "Draft ready for review", sent: "Sent", cancelled: "Stopped", skipped: "Skipped",
};

export interface InboxItem {
  threadId: number;
  leadId: number;
  company: string;
  leadStatus: string;
  dealId: number | null;
  contact: string;
  subject: string;
  status: ThreadStatus;
  lastLabel: ReplyLabel | null;
  lastMessageAt: string | null;
  lastInboundAt: string | null;
  replies: number;
  pendingReview: number;
  followup: { step: number; status: string; dueAt: string } | null;
}
export interface InboxList { items: InboxItem[]; next: string | null; counts: Record<InboxFilter, number> }

export interface ReviewItem { mailMessageId: number; leadId: number; company: string; from: string | null; fromName: string | null; subject: string; text: string | null; sentAt: string; reason: string }

export interface ConversationMessage {
  id: string;
  direction: "out" | "in";
  kind: string;
  from: string | null;
  fromName: string | null;
  to: string[];
  subject: string;
  text: string | null;
  textNote: string | null;
  at: string | null;
  status: string | null;
  sendState: string | null;
  label: ReplyLabel | null;
  labelBy: string | null;
  review: { reason: string; state: string } | null;
}
/** "Review and create deal": what the person confirmed. The deal is created only from this request, never automatically. */
export interface DealFromReplyInput { dealTitle?: string; dealAmount?: number }
export interface DealFromReplyResult { dealId: number; route: string; existing: boolean }

/** Lead-timeline entries about email (and the lead's stage), as the lead and deal pages show them. Ids and labels only. */
export const EMAIL_EVENT_KINDS = [
  "draft_created", "draft_approved", "draft_cancelled", "message_sent", "message_send_resolved", "message_send_late_confirmation",
  "outreach_replied", "outreach_opted_out", "outreach_bounced", "reply_labelled", "reply_match_confirmed", "reply_match_dismissed",
] as const;
export interface ActivityEvent { id: number; kind: string; data: Record<string, unknown>; at: string; actor: string }
/** A deal's email story: the lead it was won from, the prospect behind it, its conversations and their timeline. */
export interface DealEmailActivity {
  lead: { id: number; company: string; status: string } | null;
  prospect: { id: number; name: string; domain: string } | null;
  conversations: { threadId: number; status: ThreadStatus; subject: string; contact: string; lastMessageAt: string | null; replies: number }[];
  events: ActivityEvent[];
  /** False when this server has no reply-sync tables yet: conversations can't be shown, the timeline still can. */
  inboxAvailable: boolean;
}

export interface ConversationView {
  thread: {
    id: number; status: ThreadStatus; leadId: number; company: string; leadStatus: string; dealId: number | null; canConvert: boolean; contact: string; gmailUrl: string | null;
    /** The lead's estimated value in major units, offered as the deal amount: only when it is in the workspace's currency (never converted). */
    estimatedValue: number | null;
  };
  messages: ConversationMessage[];
  followups: { step: number; status: string; dueAt: string; reason: string | null; draftMessageId: number | null }[];
  canWrite: boolean;
}
