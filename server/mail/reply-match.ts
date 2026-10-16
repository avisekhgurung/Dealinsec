/**
 * Which outreach conversation a synced message belongs to, if any (docs/gmail-reply-sync.md). Pure: the sync service
 * looks the context up and stores what this decides.
 *
 * Strongest first:
 *   thread     the message is in a Gmail thread already tied to an outreach message (sent from DealInSec, or adopted)
 *   reference  its In-Reply-To / References name a Message-ID we know (a reply whose subject or thread changed)
 *   adopted    an outgoing copy in the person's own Sent mail: to the outreach address, with the approved subject
 *              (outreach sent by hand from their email app); its thread is then followed
 *   address    only the sender's address matches someone this mailbox wrote to: kept for review, never linked silently
 *
 * A display name never matches anything. A message from a different address in a linked thread (a colleague, a
 * forward) is linked but flagged for review. Drafts, spam, trash and chats are ignored; so is everything else: a
 * message with no link is not stored at all.
 */
import { subjectKey, type ParsedMail } from "./mail-parse";

export interface ConversationLink { leadId: number; leadMessageId: number; toAddress: string }
/** An outreach message this mailbox's owner approved or sent, to an address. */
export interface OutreachCandidate extends ConversationLink { subject: string; at: Date }

export interface MatchContext {
  accountEmail: string;
  /** The conversation this Gmail thread is already tied to. */
  thread: ConversationLink | null;
  /** The conversation whose Message-ID this message's In-Reply-To or References name. */
  reference: ConversationLink | null;
  /** Outreach this mailbox's owner wrote to an address (most recent first is not assumed). */
  outreachTo(address: string): OutreachCandidate[];
}

export type MessageKind = "reply" | "auto_reply" | "bounce" | "own_reply" | "outreach_copy";
export type MatchKind = "thread" | "reference" | "adopted" | "address";
export type ReviewReason = "address_only" | "other_sender";

export type MatchDecision =
  | { action: "ignore"; reason: "label" | "no_link" | "no_sender" }
  | {
      action: "store";
      direction: "in" | "out";
      kind: MessageKind;
      match: MatchKind;
      link: ConversationLink;
      review: ReviewReason | null;
      /** Tie this Gmail thread to the conversation, so later messages in it match by thread. */
      adoptThread: boolean;
      /** Whether the body is worth reading and keeping (an outgoing copy of approved text is not). */
      needBody: boolean;
    };

const SKIP_LABELS = new Set(["DRAFT", "SPAM", "TRASH", "CHAT"]);

const latest = (xs: OutreachCandidate[]) => xs.slice().sort((a, b) => b.at.getTime() - a.at.getTime() || b.leadMessageId - a.leadMessageId)[0] ?? null;

export function decideMatch(m: ParsedMail, ctx: MatchContext): MatchDecision {
  if (m.labels.some((l) => SKIP_LABELS.has(l))) return { action: "ignore", reason: "label" };
  const account = ctx.accountEmail.toLowerCase();
  const outgoing = m.labels.includes("SENT") || (!!m.from && m.from === account);

  if (outgoing) {
    if (ctx.thread) return { action: "store", direction: "out", kind: "own_reply", match: "thread", link: ctx.thread, review: null, adoptThread: false, needBody: true };
    if (ctx.reference) return { action: "store", direction: "out", kind: "own_reply", match: "reference", link: ctx.reference, review: null, adoptThread: true, needBody: true };
    // Outreach sent by hand: exactly the approved subject, to the outreach address.
    const key = subjectKey(m.subject);
    const hits = key ? m.to.flatMap((a) => ctx.outreachTo(a)).filter((c) => subjectKey(c.subject) === key && m.to.includes(c.toAddress)) : [];
    const c = latest(hits);
    if (c) return { action: "store", direction: "out", kind: "outreach_copy", match: "adopted", link: c, review: null, adoptThread: true, needBody: false };
    return { action: "ignore", reason: "no_link" };
  }

  const kind: MessageKind = m.bounce ? "bounce" : m.automated ? "auto_reply" : "reply";
  const linked = ctx.thread ? { link: ctx.thread, match: "thread" as const, adopt: false } : ctx.reference ? { link: ctx.reference, match: "reference" as const, adopt: true } : null;
  if (linked) {
    // A bounce comes from the mail system, not the person; anything else from another address is someone else.
    const otherSender = kind !== "bounce" && m.from !== linked.link.toAddress;
    return { action: "store", direction: "in", kind, match: linked.match, link: linked.link, review: otherSender ? "other_sender" : null, adoptThread: linked.adopt, needBody: true };
  }
  if (!m.from) return { action: "ignore", reason: "no_sender" };
  const c = latest(ctx.outreachTo(m.from));
  if (c) return { action: "store", direction: "in", kind, match: "address", link: c, review: "address_only", adoptThread: false, needBody: true };
  return { action: "ignore", reason: "no_link" };
}
