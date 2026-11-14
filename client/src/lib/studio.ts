/**
 * Outreach Studio, client side: one shape for email and the five short channels, the Studio's own endpoints
 * (server/outreach-studio/routes.ts) and what a message's state means in plain words. Email messages still come from
 * /api/sales/leads/:id/messages and the others from /api/channels/leads/:id/messages; nothing here invents a state:
 * "sent" is either "sent from your Gmail" (DealInSec did it) or "you marked it sent" (the person told us).
 */
import type { FitGate } from "@shared/draft-fit-gate";
import { CHANNELS, CHANNEL_LABEL, externalUrl, normalPhone, type Channel, type ShortChannel } from "@shared/channels";
import type { SocialLinks } from "@shared/social-links";
import type { DraftBasis, DraftEvidence } from "@shared/draft-evidence";
import type { LeadEventView } from "@/lib/leads";
import type { ChannelMessage } from "@/lib/channels";
import { waMeUrl } from "@/lib/channels";

/** The order on screen: email first, then the channels most Indian freelancers use. */
export const STUDIO_CHANNELS: readonly Channel[] = ["email", "whatsapp", "linkedin", "instagram", "x", "messenger"];
export const isStudioChannel = (c: unknown): c is Channel => typeof c === "string" && (CHANNELS as readonly string[]).includes(c);

export const intelligenceUrl = (leadId: number) => `/api/outreach/leads/${leadId}/intelligence`;
export const handoffUrl = (leadId: number) => `/api/outreach/leads/${leadId}/handoff`;
export const followUpsUrl = (leadId: number) => `/api/outreach/leads/${leadId}/follow-ups`;
export const followUpDoneUrl = (leadId: number, ticketId: number) => `/api/outreach/leads/${leadId}/follow-ups/${ticketId}/done`;
export const replyNoteUrl = (leadId: number) => `/api/outreach/leads/${leadId}/reply-note`;
export const overviewUrl = (days: number) => `/api/outreach/overview?days=${days}`;
export const contactLinksUrl = (leadId: number) => `/api/outreach/leads/${leadId}/contact-links`;
export const OVERVIEW_PREFIX = "/api/outreach/overview";

export interface LeadIntelligence {
  evidence: DraftEvidence;
  counts: { facts: number; guesses: number; datedSignals: number };
  contact: {
    name: string | null; role: string | null; email: string | null; emailSource: "you" | "website" | null; phone: string | null; contactForm: string | null;
    /** Older servers omit these. */
    socials?: SocialLinks; socialSources?: Record<keyof SocialLinks, string | null>; socialsCheckedAt?: string | null; country?: string | null;
  };
  sources: { url: string; host: string; items: number }[];
  prospectId: number | null;
}

export interface OverviewNumbers {
  days: number;
  readyToContact: number | null; draftsWaiting: number | null; markedSentByYou: number | null; sentFromGmail: number | null;
  repliesRecordedByYou: number | null; repliesFoundInGmail: number | null; followUpsDue: number | null; interested: number | null; meetings: number | null;
  byChannel: { channel: Channel; drafts: number; markedSent: number; replies: number }[];
}

/** An email first message as /api/sales/leads/:id/messages returns it. */
export interface EmailMessage {
  id: number; status: "variant" | "draft" | "approved" | "sending" | "sent" | "cancelled"; subject: string; body: string; bodyHash: string;
  to: string | null; toSource: "lead" | "site" | null; edited: boolean; createdBy: string; createdAt: string; approvedAt: string | null; sentAt: string | null;
  strategy?: string | null; variantGroup?: string | null; byAi?: boolean;
}
export interface EmailMessages { messages: EmailMessage[]; gap?: "address" | "facts" | null; hasWebsite?: boolean; /** The saved ideal client's verdict on this lead, and what writing to it will do. Older servers omit both. */ fit?: FitGate | null; fitStale?: boolean }

/** One message in the Studio, whichever channel it is on. */
export interface StudioMessage {
  source: "email" | "channel";
  id: number;
  channel: Channel;
  kind: string;
  kindLabel: string;
  status: "variant" | "draft" | "approved" | "sending" | "sent" | "failed" | "uncertain" | "cancelled";
  /** What the state means, honestly, for the person. */
  stateLabel: string;
  subject: string | null;
  body: string;
  bodyHash: string;
  to: string | null;
  byAi: boolean;
  edited: boolean;
  createdAt: string;
  sentAt: string | null;
  /** How it went out: DealInSec sent it from a connected account, or the person told us they sent it. */
  sentBy: "dealinsec" | "you" | null;
  repliedAt: string | null;
  strategy: string | null;
}

const UNSENT = new Set(["variant", "draft", "approved", "sending", "uncertain", "failed"]);
export const isUnsent = (m: StudioMessage) => UNSENT.has(m.status);

/** How the email went out, from the lead's own timeline (the email view doesn't carry it). */
function emailSentBy(events: LeadEventView[], id: number): "dealinsec" | "you" | null {
  const e = events.find((x) => x.kind === "message_sent" && (x.data as { messageId?: unknown } | null)?.messageId === id);
  const via = (e?.data as { channel?: unknown } | null)?.channel;
  return via === "manual" ? "you" : via === "gmail" || via === "gmail_confirmed" ? "dealinsec" : null;
}
function emailRepliedAt(events: LeadEventView[], id: number): string | null {
  const e = events.find((x) => x.kind === "outreach_replied" && (x.data as { messageId?: unknown } | null)?.messageId === id);
  return e ? String(e.createdAt) : null;
}

export function fromEmail(m: EmailMessage, events: LeadEventView[]): StudioMessage {
  const sentBy = m.status === "sent" ? emailSentBy(events, m.id) ?? "you" : null;
  const repliedAt = m.status === "sent" ? emailRepliedAt(events, m.id) : null;
  const stateLabel = repliedAt ? "Reply recorded" : m.status === "sent" ? (sentBy === "dealinsec" ? "Sent from your Gmail" : "You marked it sent")
    : ({ variant: "Version to choose from", draft: "Draft", approved: "Approved, not sent", sending: "Sending from your Gmail…", cancelled: "Discarded" } as const)[m.status];
  return {
    source: "email", id: m.id, channel: "email", kind: "email", kindLabel: "First email", status: m.status, stateLabel, subject: m.subject, body: m.body,
    bodyHash: m.bodyHash, to: m.to, byAi: m.byAi !== false, edited: m.edited, createdAt: m.createdAt, sentAt: m.sentAt,
    sentBy, repliedAt, strategy: m.strategy ?? null,
  };
}

export function fromChannel(m: ChannelMessage): StudioMessage {
  const status = m.status === "received" ? "sent" : m.status;
  return {
    source: "channel", id: m.id, channel: m.channel, kind: m.kind, kindLabel: m.kindLabel, status, stateLabel: m.statusLabel, subject: null, body: m.body ?? "",
    bodyHash: m.bodyHash ?? "", to: m.to, byAi: !!m.byAi, edited: m.edited, createdAt: m.createdAt, sentAt: m.sentAt,
    sentBy: m.status === "sent" ? (m.sentVia === "api" ? "dealinsec" : "you") : null, repliedAt: m.repliedAt, strategy: null,
  };
}

/** The message the Studio works on for a channel: the unsent one, else the latest sent one, else none. */
export function currentFor(channel: Channel, all: StudioMessage[]): StudioMessage | null {
  const mine = all.filter((m) => m.channel === channel && m.status !== "cancelled").sort((a, b) => b.id - a.id);
  return mine.find((m) => m.status !== "variant" && isUnsent(m)) ?? mine.find((m) => m.status === "sent") ?? null;
}

/** What a message was built on ("Why Mika wrote this"), from the timeline entry written when it was drafted. */
export function basisFor(events: LeadEventView[], m: StudioMessage): DraftBasis | null {
  for (const e of events) {
    const d = (e.data ?? {}) as { messageId?: unknown; basis?: unknown; bases?: Record<string, unknown> };
    if ((e.kind === "draft_created" || e.kind === "channel_draft_created") && d.messageId === m.id && d.basis) return d.basis as DraftBasis;
    if (e.kind === "variants_created" && d.bases && d.bases[String(m.id)]) return d.bases[String(m.id)] as DraftBasis;
  }
  return null;
}

/** The text a person pastes: email gets its subject on top. */
export const copyText = (m: Pick<StudioMessage, "channel" | "subject" | "body">) => (m.channel === "email" && m.subject ? `Subject: ${m.subject}\n\n${m.body}` : m.body);

/** A mail program wants line breaks as CRLF. */
export const mailtoUrl = (to: string | null, subject: string, body: string) =>
  `mailto:${encodeURIComponent(to ?? "").replace(/%40/g, "@")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.replace(/\r?\n/g, "\r\n"))}`;

/** Where "Open" goes for a message: never anywhere that sends by itself. Null when the destination isn't known yet. */
export function openUrlFor(m: Pick<StudioMessage, "channel" | "to" | "subject" | "body">, company: string): string | null {
  if (m.channel === "email") return m.to ? mailtoUrl(m.to, m.subject ?? "", m.body) : null;
  if (m.channel === "whatsapp") return m.to ? waMeUrl(m.to, m.body) : null;
  return externalUrl(m.channel as ShortChannel, m.to, company);
}

/** "Open WhatsApp", "Open LinkedIn", "Open your email app". */
export const openLabel = (c: Channel) => (c === "email" ? "Open your email app" : `Open ${CHANNEL_LABEL[c]}`);

/** What the person does to send, in one line. Visible text (not only a tooltip), so it reads on a phone too. */
export const HOW_YOU_SEND: Record<Channel, string> = {
  email: "Send it from your connected Gmail, or open it in your email app and send it there.",
  whatsapp: "Open WhatsApp: the message is filled in. You press send.",
  linkedin: "Copy the message, open their LinkedIn, paste it and send it.",
  instagram: "Copy the message, open their Instagram messages, paste it and send it.",
  x: "Copy the message, open X, paste it in a message to them and send it.",
  messenger: "Copy the message, open Messenger, paste it and send it.",
};

/** The address each channel needs, as the person types it. */
export const DESTINATION: Record<Channel, { label: string; placeholder: string; missing: string }> = {
  email: { label: "Email address", placeholder: "name@company.com", missing: "No email address yet. Add it on the lead page (Edit)." },
  whatsapp: { label: "WhatsApp number", placeholder: "+91 98765 43210", missing: "Add their WhatsApp number with the country code." },
  linkedin: { label: "LinkedIn profile or company page", placeholder: "linkedin.com/in/their-name", missing: "No LinkedIn profile yet: Open searches LinkedIn for the company." },
  instagram: { label: "Instagram username", placeholder: "@theirbusiness", missing: "Add their Instagram username so Open goes straight to their messages." },
  x: { label: "X handle", placeholder: "@theirhandle", missing: "No X handle yet: Open searches X for the company." },
  messenger: { label: "Facebook Page", placeholder: "facebook.com/theirpage", missing: "Add their Facebook Page so Open goes straight to Messenger." },
};

/** The kinds a channel offers in the Studio (a WhatsApp template only where DealInSec sends WhatsApp itself). */
export const STUDIO_KINDS: Record<Exclude<Channel, "email">, { kind: string; label: string }[]> = {
  whatsapp: [{ kind: "text", label: "WhatsApp message" }],
  linkedin: [{ kind: "connection_note", label: "Connection request note" }, { kind: "message", label: "Message to a connection" }],
  instagram: [{ kind: "ig_dm", label: "Instagram message" }],
  x: [{ kind: "dm", label: "Direct message" }],
  messenger: [{ kind: "fb_message", label: "Messenger message" }],
};

/** The timeline kinds the Studio's activity list shows. */
export const OUTREACH_EVENT_KINDS = new Set([
  "draft_created", "variants_created", "draft_approved", "draft_cancelled", "draft_rewritten", "message_sent", "outreach_replied", "outreach_opted_out", "outreach_bounced",
  "channel_draft_created", "channel_message_sent", "channel_reply", "outreach_copied", "outreach_opened", "reply_recorded", "followup_scheduled", "followup_done", "status_changed",
]);

/** The channel a timeline entry is about, when it says. Email entries carry no medium (their "channel" is how it was sent). */
export function eventChannel(e: LeadEventView): Channel | null {
  const d = (e.data ?? {}) as { channel?: unknown };
  if (["draft_created", "variants_created", "draft_approved", "draft_cancelled", "message_sent", "outreach_replied", "outreach_opted_out", "outreach_bounced"].includes(e.kind)) return "email";
  return isStudioChannel(d.channel) ? d.channel : null;
}

export const REPLY_OUTCOMES = [
  { value: "interested", label: "Interested" }, { value: "question", label: "Asked a question" }, { value: "meeting", label: "Wants to meet" },
  { value: "not_now", label: "Not right now" }, { value: "not_interested", label: "Not interested" }, { value: "other", label: "Something else" },
] as const;

export const REWRITE_ACTIONS = [
  { action: "shorten", label: "Shorten", hint: "Same message, fewer words." },
  { action: "professional", label: "More professional", hint: "Formal and polite, for a company inbox." },
  { action: "conversational", label: "More conversational", hint: "Warmer, like a note from a person." },
  { action: "opening", label: "Better first line", hint: "Opens with something about them, not you." },
  { action: "ask", label: "Clearer ask", hint: "Makes the next step an easy yes." },
] as const;

/**
 * Where each channel's message goes, filled in from what is already known about the lead: the WhatsApp link on their
 * website (or their phone number, with India's code when the lead is in India), and their own Instagram, X, LinkedIn
 * and Facebook pages. Only a suggestion: the person can change it, and the Studio says where it came from.
 */
export function suggestedDestinations(c: LeadIntelligence["contact"] | undefined): Partial<Record<Channel, { to: string; from: string }>> {
  if (!c) return {};
  const out: Partial<Record<Channel, { to: string; from: string }>> = {};
  const s = c.socials;
  const india = /india|bharat|mumbai|delhi|bengaluru|bangalore|pune|chennai|kolkata|hyderabad|\bgoa\b|siliguri|jaipur|ahmedabad/i.test(c.country ?? "") || /(^|,\s*)IN$/.test((c.country ?? "").trim());
  const phone = c.phone ? normalPhone(c.phone) ?? (india || /^[6-9]\d{9}$/.test(c.phone.replace(/\D/g, "")) ? normalPhone(c.phone, "91") : null) : null;
  if (s?.whatsapp) out.whatsapp = { to: s.whatsapp, from: "the WhatsApp link on their website" };
  else if (phone) out.whatsapp = { to: phone, from: "the phone number on their website. Check it's on WhatsApp" };
  if (s?.linkedin) out.linkedin = { to: s.linkedin, from: "the LinkedIn link on their website" };
  if (s?.instagram) out.instagram = { to: s.instagram, from: "the Instagram link on their website" };
  if (s?.x) out.x = { to: s.x, from: "the X link on their website" };
  if (s?.facebook) out.messenger = { to: s.facebook, from: "the Facebook link on their website" };
  return out;
}
