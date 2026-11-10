/**
 * Campaigns: one named group of leads written to together. Pure rules, shared by the server and the page: no
 * network, no database, no model.
 *
 * A campaign adds NO new way to write or send a message. Each member's message is an ordinary outreach message
 * (lead_messages): drafted from the lead's verified facts, checked by code, and approved by a person who read exactly
 * that text. What a campaign adds is the grouping, a background job that prepares the drafts one at a time within the
 * plan's allowance, a paced queue for messages that are ALREADY approved, and the numbers.
 *
 * Three rules hold everywhere:
 *   - nothing is sent that a person did not approve, one message at a time; there is no "approve all";
 *   - the queue only sends a message that still carries the opt-out line the person saw when approving it;
 *   - the queue stops itself on anything that needs a person: a mailbox problem, a limit, an uncertain send, bounces.
 */
import { z } from "zod";
import { unsubscribeLine } from "./unsubscribe";

export const MAX_CAMPAIGNS = 50;
export const CAMPAIGN_MAX_MEMBERS = 200;
export const DAILY_LIMIT = { min: 1, max: 50, default: 20 } as const;
export const GAP_SECONDS = { min: 60, max: 3600, default: 180 } as const;
export const FOOTER_NOTE_MAX = 200;

/**
 * The line every campaign message ends with. Its wording is deliberate: it must NOT itself read as an opt-out to the
 * reply rules (server/mail/reply-rules.ts), because a mail app that quotes our message back inside a friendly reply
 * would otherwise put that person on the do-not-contact list. A test holds the two together.
 */
export const OPT_OUT_LINE = "If this isn't relevant, just tell me and I won't write again.";

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
/** True when a message still ends with the opt-out line (spacing aside). The queue sends nothing without it. */
export const hasOptOutLine = (body: string | null | undefined): boolean => squash(String(body ?? "")).includes(OPT_OUT_LINE);

/**
 * A draft with the campaign's footer: the person's own note (their business name and address, if they gave one), the
 * opt-out line, and (when the server can sign one) this message's own unsubscribe link. Added BEFORE anyone approves, so what is approved is what is sent. Idempotent.
 */
export function withFooter(body: string, note: string | null | undefined, unsubscribeUrl?: string | null): string {
  const text = String(body ?? "").replace(/\r\n/g, "\n").trim();
  if (hasOptOutLine(text)) return text;
  const n = squash(String(note ?? "")).slice(0, FOOTER_NOTE_MAX);
  // The link is a second way out, beside replying. It is this message's own link (server/sales/unsubscribe.ts).
  const link = unsubscribeUrl && /^https?:\/\/\S+$/.test(unsubscribeUrl) ? unsubscribeLine(unsubscribeUrl) : "";
  return [text, [n, OPT_OUT_LINE, link].filter(Boolean).join("\n")].join("\n\n");
}

const int = (min: number, max: number, def: number) => z.number().int().min(min).max(max).default(def);
const leadIds = z.array(z.number().int().positive()).max(CAMPAIGN_MAX_MEMBERS).transform((xs) => Array.from(new Set(xs)));
const name = z.string().transform(squash).pipe(z.string().min(1, "Give the campaign a name.").max(80));
const footerNote = z.string().transform(squash).pipe(z.string().max(FOOTER_NOTE_MAX, `Keep the footer note under ${FOOTER_NOTE_MAX} characters.`));
/** No links or addresses in the footer note: it is appended to every message, and a message may only carry the recipient's own site and address. */
const plainNote = footerNote.refine((s) => !/https?:\/\/|www\.|@/i.test(s), "The footer note can't contain a link or an email address.");

export const campaignCreateSchema = z.object({
  name,
  leadIds: leadIds.pipe(z.array(z.number()).min(1, "Pick at least one lead.")),
  profileId: z.number().int().positive().nullable().default(null),
  dailyLimit: int(DAILY_LIMIT.min, DAILY_LIMIT.max, DAILY_LIMIT.default),
  gapSeconds: int(GAP_SECONDS.min, GAP_SECONDS.max, GAP_SECONDS.default),
  footerNote: plainNote.default(""),
});
export type CampaignCreate = z.infer<typeof campaignCreateSchema>;

export const campaignUpdateSchema = z.object({
  name: name.optional(),
  dailyLimit: z.number().int().min(DAILY_LIMIT.min).max(DAILY_LIMIT.max).optional(),
  gapSeconds: z.number().int().min(GAP_SECONDS.min).max(GAP_SECONDS.max).optional(),
  footerNote: plainNote.optional(),
}).strict();
export const addMembersSchema = z.object({ leadIds: leadIds.pipe(z.array(z.number()).min(1, "Pick at least one lead.")) }).strict();

/* ── a member, as a person reads it ─────────────────────────────────────── */

/** Where one lead stands in a campaign. The message's own status is the truth once a draft exists. */
export type MemberStage = "queued" | "skipped" | "failed" | "draft" | "approved" | "sending" | "sent" | "discarded";
export const MEMBER_STAGE_LABEL: Record<MemberStage, string> = {
  queued: "Waiting for a draft", skipped: "Skipped", failed: "Couldn't draft", draft: "Draft to review", approved: "Approved, not sent",
  sending: "Sending / check needed", sent: "Sent", discarded: "Draft discarded",
};
export function memberStage(m: { state: string; messageStatus: string | null }): MemberStage {
  if (m.state === "queued" || m.state === "drafting") return "queued";
  if (m.state === "skipped") return "skipped";
  if (m.state === "failed") return "failed";
  switch (m.messageStatus) {
    case "draft": case "variant": return "draft";
    case "approved": return "approved";
    case "sending": return "sending";
    case "sent": return "sent";
    default: return "discarded";
  }
}

/** Why a lead got no draft, or why its approved message is held back from the queue, in the person's words. */
export const REASON_LABEL: Record<string, string> = {
  no_address: "No email address on the lead or its site",
  no_facts: "No verified facts to write from. Research it first",
  do_not_contact: "Marked do-not-contact",
  suppressed: "On your do-not-contact list",
  already_contacted: "Already contacted",
  closed: "The lead is closed",
  draft_rejected: "The draft didn't pass the safety checks",
  footer_too_long: "The message is too long to carry the opt-out line. Shorten it",
  lead_missing: "The lead is no longer in your workspace",
  model_unavailable: "The writing assistant didn't answer",
  versions_waiting: "It has message versions waiting. Choose one on the lead, then press Prepare drafts again",
  no_opt_out_line: "The opt-out line was removed. Put it back to send from the queue",
  changed: "The message changed after approval",
  not_approved: "Not approved",
  in_flight: "A send is in progress or needs checking",
  invalid_content: "The message can't be sent as it is",
  followup_stopped: "A reply arrived in this conversation",
  not_found: "The message is gone",
};
export const reasonLabel = (code: string | null | undefined): string | null => (code ? REASON_LABEL[code] ?? "Needs a look" : null);

/** Why drafting stopped, or sending paused, before its work was done. */
export const STOP_LABEL: Record<string, string> = {
  draft_allowance: "Your plan's AI drafts for this 30-day period are used up",
  NO_CREDITS: "Your plan's AI drafts for this 30-day period are used up",
  daily_limit: "Today's drafting limit is reached",
  global_limit: "Today's AI budget is used up for everyone",
  workspace_budget: "This workspace's AI usage for the last 30 days has reached its limit",
  user_unavailable: "The person who started this can no longer do it. Start it again",
  stopped: "Stopped by you",
  paused: "Paused by you",
  no_mailbox: "Connect your Gmail in Settings to send",
  mailbox_reconnect: "Reconnect your Gmail in Settings",
  mailbox_unavailable: "Connect your Gmail in Settings (or reconnect it)",
  missing_send_scope: "Your Gmail connection can't send email. Reconnect it",
  not_allowed: "Your role doesn't allow sending",
  not_member: "The sender is no longer a member",
  daily_cap: "Today's sending limit for this mailbox is reached. Start again tomorrow",
  plan_send_limit: "Your plan's sends for the last 30 days are used up",
  unavailable: "Sending from Gmail isn't available on this server",
  sending_disabled: "Sending from Gmail isn't switched on",
  cap_invalid: "Sending is switched off until its daily limit is configured correctly",
  outreach_not_setup: "The do-not-contact list isn't set up on this server",
  uncertain: "One send couldn't be confirmed. Check your Sent folder and settle it before sending more",
  send_failed: "Gmail refused a message. Check it before sending more",
  bounce_rate: "Too many messages bounced. Check the addresses before sending more",
  queue_off: "Queued sending isn't switched on for this server",
  done: "Everything approved has been sent",
};
export const stopLabel = (code: string | null | undefined): string | null => (code ? STOP_LABEL[code] ?? "Stopped. It needs a look" : null);

/** What a draft refusal means for the campaign: leave this lead and go on, stop drafting, or try this lead again later. */
export function draftRefusal(code: string): "skip" | "stop" | "retry" | "adopt" {
  if (code === "draft_exists") return "adopt";
  if (["global_limit", "daily_limit", "workspace_budget", "draft_allowance", "NO_CREDITS"].includes(code)) return "stop";
  if (["model_unavailable", "internal"].includes(code)) return "retry";
  return "skip";
}
export const DRAFT_TRIES = 3;

/** What a send refusal means: hold this one message and go on, pause the whole queue, or simply try again on the next pass. */
export function sendRefusal(code: string): "hold" | "pause" | "later" {
  if (["not_found", "not_approved", "in_flight", "changed", "invalid_content", "no_address", "do_not_contact", "suppressed", "followup_stopped"].includes(code)) return "hold";
  if (["provider_unavailable", "suppression_unavailable"].includes(code)) return "later";
  return "pause";
}

/* ── pacing ─────────────────────────────────────────────────────────────── */

/** The earliest moment for the next send: the gap, stretched by up to half again, so messages don't leave on a beat. */
export function nextSendAt(now: Date, gapSeconds: number, random: number): Date {
  const gap = Math.min(GAP_SECONDS.max, Math.max(GAP_SECONDS.min, Math.floor(gapSeconds) || GAP_SECONDS.default));
  return new Date(now.getTime() + Math.round(gap * 1000 * (1 + Math.min(1, Math.max(0, random)) / 2)));
}

/**
 * Whether bounces say "stop": at least two, and one in ten or more of what was sent. Two bounces out of three sends
 * stops a campaign; two out of thirty does not.
 */
export const tooManyBounces = (s: { sent: number; bounced: number }): boolean => s.bounced >= 2 && s.sent > 0 && s.bounced / s.sent >= 0.1;

/* ── numbers ────────────────────────────────────────────────────────────── */

export interface CampaignCounts {
  members: number; queued: number; skipped: number; failed: number; draft: number; approved: number; sending: number; sent: number; discarded: number;
  replied: number; interested: number; bounced: number; optedOut: number;
}
export const EMPTY_COUNTS: CampaignCounts = { members: 0, queued: 0, skipped: 0, failed: 0, draft: 0, approved: 0, sending: 0, sent: 0, discarded: 0, replied: 0, interested: 0, bounced: 0, optedOut: 0 };
export interface CampaignRates { /** Shares of what was SENT, 0–100, or null while nothing has been sent (never a made-up zero). */ reply: number | null; bounce: number | null; optOut: number | null }
const share = (n: number, of: number) => (of > 0 ? Math.round((1000 * n) / of) / 10 : null);
export const campaignRates = (c: Pick<CampaignCounts, "sent" | "replied" | "bounced" | "optedOut">): CampaignRates => ({ reply: share(c.replied, c.sent), bounce: share(c.bounced, c.sent), optOut: share(c.optedOut, c.sent) });

/** Counts from the members themselves: what the page shows is always what the rows say. */
export function countMembers(ms: { state: string; messageStatus: string | null; outcomes: string[]; interested?: boolean }[]): CampaignCounts {
  const c = { ...EMPTY_COUNTS, members: ms.length };
  for (const m of ms) {
    c[memberStage(m)]++;
    if (m.messageStatus === "sent") {
      if (m.outcomes.includes("replied")) c.replied++;
      if (m.outcomes.includes("bounced")) c.bounced++;
      if (m.outcomes.includes("opted_out")) c.optedOut++;
      if (m.interested) c.interested++;
    }
  }
  return c;
}
