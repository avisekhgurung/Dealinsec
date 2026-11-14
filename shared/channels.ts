/**
 * Outreach channels: what each one can really do from DealInSec, in one place the server, the UI and the tests read.
 *
 * Checked 18 Oct 2026 against the providers' own documentation:
 *   - Email: the existing outreach (lead_messages): draft, approve, open in your email app or send from a connected Gmail,
 *     replies synced by fixed rules where Gmail reply sync is switched on.
 *   - WhatsApp: the official WhatsApp Business Platform Cloud API, with the workspace's own business number. A message
 *     goes only to someone who OPTED IN to hear from the business (Meta's opt-in policy: a listed phone number is not
 *     permission). Outside the 24-hour customer service window only an APPROVED template may be sent ("Template messages
 *     are the only type of message that can be sent to WhatsApp users outside of a customer service window"). Delivery,
 *     read and failure states and replies arrive on a signed webhook. Meta bills the business's own WhatsApp account.
 *   - LinkedIn: no API for member messages or connection requests is open to apps like DealInSec ("Open Permissions are
 *     the only permissions that are available to all developers without special approval": sign-in and posting to
 *     your own feed). So DealInSec drafts and the person sends on LinkedIn themselves; nothing is automated or scraped.
 *   - X: Direct Messages need an X developer app with paid API access and the person's OAuth 2.0 authorization;
 *     DealInSec has neither, so X is draft-and-copy only.
 *   - Instagram and Facebook Messenger (added 12 Nov 2026): Meta's messaging APIs only let a business reply to people
 *     who wrote to it first, from its own professional account; a first message to a business can't be sent by an app.
 *     So both are draft-and-copy only: DealInSec writes it, the person opens Instagram or Messenger and sends it.
 * A manual send is recorded as the person saying so ("You marked it sent"), never as a delivery.
 */
import { contentIssues, type Issue } from "./outreach-check";

export const CHANNELS = ["email", "whatsapp", "linkedin", "instagram", "x", "messenger"] as const;
export type Channel = (typeof CHANNELS)[number];
/** The channels whose messages live in channel_messages (email keeps lead_messages and its own panel). */
export const SHORT_CHANNELS = ["whatsapp", "linkedin", "instagram", "x", "messenger"] as const;
export type ShortChannel = (typeof SHORT_CHANNELS)[number];
export const isShortChannel = (c: unknown): c is ShortChannel => typeof c === "string" && (SHORT_CHANNELS as readonly string[]).includes(c);

export const CHANNEL_LABEL: Record<Channel, string> = { email: "Email", whatsapp: "WhatsApp", linkedin: "LinkedIn", instagram: "Instagram", x: "X", messenger: "Messenger" };
/** The channels added after the table's first CHECK (script/migrate-channels-social.ts): usable once that has run. */
export const SOCIAL_CHANNELS = ["instagram", "messenger"] as const;

/** How a message on the channel leaves DealInSec: through the provider's API, or by the person, outside DealInSec. */
export type SendMode = "api" | "manual";

/**
 * A channel's state for one workspace, as the UI shows it. Only states the server has checked: "ready_to_send" means a
 * connection exists, is active and was readable; nothing is ever shown as connected on the strength of a setting alone.
 */
export type ChannelState =
  | "not_configured"       // DealInSec isn't set up for this channel on this server
  | "awaiting_connection"  // set up, but this workspace hasn't connected an account
  | "connected"            // an account is connected; sending may still be off (see ready_to_send)
  | "permission_missing"   // connected, but the account's permission or token no longer works
  | "sending_unavailable"  // drafts only: the channel offers no sending to DealInSec
  | "ready_to_send"        // connected and allowed to send
  | "disconnected";        // was connected, then disconnected

export interface ChannelCapabilities {
  draft: boolean;
  /** Messages can be sent through the provider's API from DealInSec. */
  send: boolean;
  /** The provider reports delivery (and possibly read) to DealInSec. */
  deliveryStatus: boolean;
  /** Replies reach DealInSec on their own, so follow-ups can stop by themselves. */
  replySync: boolean;
  /** A place to open, outside DealInSec, to send by hand. */
  openExternal: boolean;
}

export interface ChannelStatus {
  channel: Channel;
  state: ChannelState;
  mode: SendMode;
  capabilities: ChannelCapabilities;
  /** One plain sentence: why it is in this state, and what (if anything) the person can do. */
  note: string;
  /** For a connected account, how it is shown (an email address, a business phone number). Never a token. */
  account?: string | null;
}

/* ── message kinds and their limits ──────────────────────────────────────── */

export const MESSAGE_KINDS = {
  whatsapp: ["text", "template"],
  linkedin: ["connection_note", "message"],
  instagram: ["ig_dm"],
  x: ["dm"],
  messenger: ["fb_message"],
} as const satisfies Record<ShortChannel, readonly string[]>;
export type MessageKind = (typeof MESSAGE_KINDS)[ShortChannel][number];
export const isKindOf = (channel: ShortChannel, kind: unknown): kind is MessageKind =>
  typeof kind === "string" && (MESSAGE_KINDS[channel] as readonly string[]).includes(kind);

export const KIND_LABEL: Record<MessageKind, string> = {
  // Not "inside the 24-hour window": most people send WhatsApp from their own phone, where that rule doesn't apply.
  // When DealInSec sends through the API, the window is explained on the message itself (channel-panel).
  text: "WhatsApp message", template: "Approved template",
  connection_note: "Connection request note", message: "Message to a connection", dm: "Direct message",
  ig_dm: "Instagram message", fb_message: "Messenger message",
};

/**
 * The most characters each kind may have. LinkedIn's connection-request note is 200 characters on a free account and
 * 300 with Premium (LinkedIn shows its own counter: check it there); a LinkedIn message is about 8,000; an X Direct
 * Message is 10,000; a WhatsApp text body 4,096 (Cloud API); an Instagram direct message 1,000 and a Messenger message
 * 2,000 (Meta's messaging limits). Drafts are written much shorter than these.
 */
export const KIND_MAX: Record<MessageKind, number> = { text: 4096, template: 1024, connection_note: 200, message: 8000, dm: 10000, ig_dm: 1000, fb_message: 2000 };
export const LINKEDIN_NOTE_PREMIUM_MAX = 300;
/** What a model-written draft aims for (well under the limits; a short first message reads better on these channels). */
export const KIND_DRAFT_TARGET: Record<MessageKind, { min: number; max: number }> = {
  text: { min: 60, max: 600 }, template: { min: 1, max: 1024 }, connection_note: { min: 60, max: 200 }, message: { min: 120, max: 900 }, dm: { min: 60, max: 500 },
  ig_dm: { min: 60, max: 400 }, fb_message: { min: 60, max: 500 },
};
export const maxFor = (kind: MessageKind, premium = false) => (kind === "connection_note" && premium ? LINKEDIN_NOTE_PREMIUM_MAX : KIND_MAX[kind]);

/**
 * The longest a MODEL-written draft may be, and the shortest: the kind's own draft target, except that a LinkedIn
 * connection note follows the channel's real ceiling, which is higher on a Premium account.
 */
export function draftRange(kind: MessageKind, premium = false): { min: number; max: number } {
  const t = KIND_DRAFT_TARGET[kind];
  return { min: t.min, max: kind === "connection_note" ? maxFor(kind, premium) : t.max };
}

/**
 * The length to ASK a model for, which is deliberately shorter than what will be accepted.
 *
 * A model cannot count characters, so it lands near whatever number it is given, a little over as often as under.
 * The LinkedIn connection note is the one kind whose accepted length IS the channel's hard ceiling (200 characters,
 * 300 on Premium), so asking for "up to 200" produced 210-odd, twice, and the person got a refusal instead of a note
 * (seen on production, 14 Nov 2026: POST /api/channels/leads/:id/draft 422 body_length, twice in 12 seconds). Asking
 * for a fifth less leaves room for the overshoot, and anything up to the real ceiling is still accepted.
 */
export function draftAim(kind: MessageKind, premium = false): { min: number; max: number } {
  const { min, max } = draftRange(kind, premium);
  return { min, max: Math.max(min + 20, Math.round(max * 0.8)) };
}

/* ── message states ──────────────────────────────────────────────────────── */

/** draft → approved → (sending →) sent, or cancelled; an API send can end failed or uncertain. */
export const MESSAGE_STATUSES = ["draft", "approved", "sending", "sent", "failed", "uncertain", "cancelled"] as const;
export type ChannelMessageStatus = (typeof MESSAGE_STATUSES)[number];
/** What the provider reported after the send, in order: a later state never goes back to an earlier one. */
export const DELIVERY_STATES = ["delivered", "read"] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];

/** How a message's state reads, honestly: a manual send is the person's word; delivery only when the provider said so. */
export function statusLabel(m: { status: ChannelMessageStatus; sentVia: SendMode | null; delivery: DeliveryState | null; repliedAt: string | null; channel: ShortChannel }): string {
  if (m.repliedAt) return m.sentVia === "manual" ? "Reply recorded by you" : "Reply received";
  if (m.status === "sent" && m.sentVia === "manual") return `You marked it sent on ${CHANNEL_LABEL[m.channel]}`;
  if (m.status === "sent") return m.delivery === "read" ? "Read" : m.delivery === "delivered" ? "Delivered" : "Sent";
  return ({ draft: "Draft", approved: "Approved, not sent", sending: "Sending…", failed: "Failed", uncertain: "Not confirmed", cancelled: "Discarded" } as const)[m.status as Exclude<ChannelMessageStatus, "sent">];
}

/* ── addresses ───────────────────────────────────────────────────────────── */

/** A phone number in E.164 form (+ and 8 to 15 digits), from what a person typed; null if it can't be one. */
export function normalPhone(v: unknown, defaultCountryCode?: string): string | null {
  if (typeof v !== "string") return null;
  let s = v.trim().replace(/[\s().-]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  if (!s.startsWith("+") && defaultCountryCode && /^\d{6,12}$/.test(s)) s = `+${defaultCountryCode}${s.replace(/^0+/, "")}`;
  return /^\+[1-9]\d{7,14}$/.test(s) ? s : null;
}

/** A LinkedIn member or company page (https://www.linkedin.com/in/… or /company/…), normalized; null otherwise. */
export function linkedinUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  try {
    const u = new URL(/^https?:\/\//i.test(v.trim()) ? v.trim() : `https://${v.trim()}`);
    const host = u.hostname.toLowerCase();
    if (u.protocol !== "https:" || !(host === "linkedin.com" || host.endsWith(".linkedin.com"))) return null;
    const m = u.pathname.match(/^\/(in|company)\/([A-Za-z0-9\-_%.]{2,100})\/?$/);
    return m ? `https://www.linkedin.com/${m[1]}/${m[2]}/` : null;
  } catch { return null; }
}

/** An X handle ("@name", "name" or an x.com / twitter.com profile link) as "name"; null otherwise. */
export function xHandle(v: unknown): string | null {
  if (typeof v !== "string") return null;
  let s = v.trim();
  const link = s.match(/^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/?(?:[?#].*)?$/i);
  if (link) s = link[1];
  s = s.replace(/^@/, "");
  return /^[A-Za-z0-9_]{1,15}$/.test(s) ? s : null;
}

/** An Instagram username ("@name", "name" or an instagram.com profile link) as "name"; null otherwise. */
export function instagramHandle(v: unknown): string | null {
  if (typeof v !== "string") return null;
  let s = v.trim();
  const link = s.match(/^(?:https?:\/\/)?(?:www\.|m\.)?instagram\.com\/([A-Za-z0-9._]{1,30})\/?(?:[?#].*)?$/i);
  if (link) s = link[1];
  s = s.replace(/^@/, "");
  // Instagram usernames: letters, numbers, dots and underscores, up to 30; never starting or ending with a dot.
  if (!/^[A-Za-z0-9._]{1,30}$/.test(s) || s.startsWith(".") || s.endsWith(".") || s.includes("..")) return null;
  if (["p", "reel", "reels", "explore", "stories", "direct", "accounts"].includes(s.toLowerCase())) return null;
  return s;
}

/** A Facebook Page for Messenger (a facebook.com or m.me link, or the Page's username) as its username; null otherwise. */
export function messengerPage(v: unknown): string | null {
  if (typeof v !== "string") return null;
  let s = v.trim();
  const link = s.match(/^(?:https?:\/\/)?(?:www\.|m\.|web\.)?(?:facebook\.com|fb\.com|m\.me)\/([A-Za-z0-9.]{5,50})\/?(?:[?#].*)?$/i);
  if (link) s = link[1];
  s = s.replace(/^@/, "");
  if (!/^[A-Za-z0-9.]{5,50}$/.test(s) || s.startsWith(".") || s.endsWith(".")) return null;
  if (["profile.php", "pages", "groups", "watch", "events", "marketplace", "messages"].includes(s.toLowerCase())) return null;
  return s;
}

/** Where the person goes to send by hand. Only a page they open themselves; DealInSec never acts there. */
export function externalUrl(channel: ShortChannel, to: string | null, search?: string): string | null {
  if (channel === "linkedin") return to ?? (search ? `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(search)}` : null);
  if (channel === "x") return to ? `https://x.com/${to}` : search ? `https://x.com/search?q=${encodeURIComponent(search)}&f=user` : null;
  // ig.me/m/<username> and m.me/<page> are Meta's own links that open a message thread with that account.
  if (channel === "instagram") return to ? `https://ig.me/m/${encodeURIComponent(to)}` : null;
  if (channel === "messenger") return to ? `https://m.me/${encodeURIComponent(to)}` : null;
  return null;
}

/**
 * The account's own PUBLIC page, for the channels whose message link only works for someone already signed in.
 *
 * `ig.me/m/<handle>` and `m.me/<page>` are real Meta links and they do resolve, but signed out they land on an
 * Instagram or Messenger login page with no explanation, which reads exactly like a broken link (reported 14 Nov
 * 2026). The profile page opens for anyone, so it is offered beside the message link: from there the person presses
 * Message themselves, which is what they do on these channels anyway.
 *
 * Only Instagram and Messenger need this. A LinkedIn destination is already the person's profile URL, and X's is
 * their profile too.
 */
export function profileUrl(channel: ShortChannel, to: string | null): string | null {
  if (!to) return null;
  if (channel === "instagram") return `https://www.instagram.com/${encodeURIComponent(to)}/`;
  if (channel === "messenger") return `https://www.facebook.com/${encodeURIComponent(to)}`;
  return null;
}

/** Whether this channel's message link needs the person to be signed in to that app in the same browser. */
export const SIGN_IN_NEEDED: Partial<Record<ShortChannel, string>> = {
  instagram: "This opens their Instagram messages, which needs you signed in to Instagram in this browser. If it shows a login page, open their profile instead and press Message there.",
  messenger: "This opens Messenger, which needs you signed in to Facebook in this browser. If it shows a login page, open their Page instead and press Message there.",
};

/* ── draft checks ────────────────────────────────────────────────────────── */

const PLACEHOLDER = /\[[^\]\n]{1,40}\]|\{\{[^}\n]*\}\}|\{[A-Za-z_ ]{2,30}\}|\b(?:INSERT|TODO|LOREM|XXX|FIRSTNAME|YOUR NAME)\b/;
const HTML = /<\/?[a-z][^>\n]*>/i;

/** Rules for any message on a short channel, written by a model or a person: length, placeholders, markup. */
export function checkChannelText(text: string, kind: MessageKind, opts: { premium?: boolean } = {}): Issue[] {
  const t = text.trim(), max = maxFor(kind, opts.premium);
  const out: Issue[] = [];
  if (t.length < 2 || t.length > max) out.push({ code: "body_length", message: `It must be 2 to ${max.toLocaleString("en")} characters (it is ${t.length.toLocaleString("en")}).` });
  if (PLACEHOLDER.test(t.slice(0, max + 200))) out.push({ code: "placeholder", message: "It still has a placeholder such as [Name] or {{name}}. Fill it in or remove it." });
  if (HTML.test(t.slice(0, max + 200))) out.push({ code: "html", message: "It contains markup. Use plain text." });
  return out;
}

/** The extra rules for a MODEL-written draft: the same content rules as email (no price, invented link, false history…) plus the draft length. */
export function checkChannelDraft(text: string, kind: MessageKind, ctx: { siteHost: string; premium?: boolean }): Issue[] {
  const t = text.trim(), range = draftRange(kind, ctx.premium);
  const out = checkChannelText(t, kind, { premium: ctx.premium });
  if (!out.length && (t.length < range.min || t.length > range.max)) out.push({ code: "body_length", message: `Write ${range.min} to ${range.max} characters (it is ${t.length}).` });
  return [...out, ...contentIssues(t.slice(0, 2000), { to: "", siteHost: ctx.siteHost })];
}

/** Words a WhatsApp reply may use to stop messages (Meta's own opt-out buttons arrive as text too). Whole-message match. */
const STOP_WORDS = ["stop", "stop all", "unsubscribe", "opt out", "optout", "cancel", "end", "quit", "remove me", "don't message me", "do not message me", "no more messages"];
export const isStopReply = (text: string | null | undefined) => !!text && STOP_WORDS.includes(text.trim().toLowerCase().replace(/[.!\s]+$/g, "").replace(/\s+/g, " "));
