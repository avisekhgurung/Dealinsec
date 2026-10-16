/**
 * What a reply says, by fixed rules only. Gmail content is never sent to an AI model (founder's rule, 14 Oct 2026),
 * so this is the whole classifier: conservative patterns over the person's own new words (quoted history is already
 * cut by mail-parse.ts). Anything mixed, long-winded or unclear is "needs_review": a person decides.
 *
 * Opt-outs are safety-critical and lean the other way: an unsubscribe phrase anywhere in the reply counts, even next
 * to friendlier words, because writing to someone who asked us to stop is the costly mistake.
 *
 * No import here may reach a network, a model or a database (a test asserts it).
 */
import type { ReplyLabel } from "@shared/inbox-view";
import type { MessageKind } from "./reply-match";

export { REPLY_LABEL_TEXT, type ReplyLabel } from "@shared/inbox-view";
export const CLASSIFIER_VERSION = "rules-1";

/** Phrases that mean "stop writing to me". Matched anywhere in the reply or its subject. */
const OPT_OUT = [
  /\bunsubscribe\b/, /\bopt(ed)?[- ]?out\b/, /\bremove (me|us|my (email|address))\b/, /\btake (me|us) off\b/,
  /\b(stop|quit) (emailing|e-mailing|contacting|messaging|sending)\b/, /\bdo not (contact|email|e-mail|write to) (me|us)\b/,
  /\bdon'?t (contact|email|e-mail|write to) (me|us)\b/, /\bno (more|further) (emails|e-mails|contact|messages)\b/,
  /\b(off|from) your (mailing |email )?list\b/, /\bplease stop\b/,
];
const NEGATIVE = [
  /\bnot interested\b/, /\bno,? thank(s| you)\b/, /\bno thanks\b/, /\bwe('re| are) (all set|good|covered|not looking)\b/,
  /\bnot (a (good )?fit|the right fit|for us|right now|at this time)\b/, /\b(don'?t|do not) (need|have (a )?need)\b/,
  /\bno (need|budget)\b/, /\bpass(ing)? on this\b/, /\bwe('ll| will) pass\b/, /\balready (have|work with|use)\b/,
];
const MORE_INFO = [
  /\b(send|share)( me| us)? (more|some) (info|information|details)\b/, /\bmore (info|information|details)\b/,
  /\bhow much\b/, /\b(pricing|price list|rates|quote)\b/, /\bwhat (does|would) (it|this|that) cost\b/,
  /\b(case stud(y|ies)|portfolio|examples of (your )?work)\b/, /\bcan you (explain|tell me more)\b/, /\btell me more\b/,
];
const POSITIVE = [
  /\b(i'?m|we'?re|i am|we are) (very )?interested\b/, /\b(sounds|looks) (good|great|interesting)\b/,
  /\b(let'?s|happy to|glad to|would love to|keen to) (talk|chat|connect|meet|hop on|discuss)\b/,
  /\b(book|schedule|set up|arrange) (a |the )?(call|meeting|time|chat)\b/, /\bwhen (are|would) you (free|available)\b/,
  /\b(free|available) (on|next|this|tomorrow|for a call)\b/, /\bcalendly\b/, /\byes,? (please|let'?s|i'?d|we'?d)\b/,
];
const AUTO_TEXT = [/\b(out of (the )?office|on (annual |parental )?leave|on vacation|on holiday|away from (my |the )?(desk|office)|limited access to email)\b/, /\bautomatic reply\b/];

const any = (rs: RegExp[], s: string) => rs.some((r) => r.test(s));

/** Normalized words for matching: lower case, curly quotes straightened, whitespace collapsed. */
function norm(s: string | null | undefined): string {
  return String(s ?? "").toLowerCase().replace(/[‘’ʼ]/g, "'").replace(/\s+/g, " ").trim();
}

export interface ClassifyInput { kind: MessageKind; subject: string | null; text: string | null }

/**
 * The label for one inbound message. Order: delivery failure, opt-out (wins over everything a person wrote),
 * out-of-office, then a single clear intent; two different intents, or none, need review.
 */
export function classifyReply(m: ClassifyInput): ReplyLabel {
  if (m.kind === "bounce") return "bounce";
  const subject = norm(m.subject), text = norm(m.text);
  const all = `${subject} ${text}`;
  if (any(OPT_OUT, all)) return "opt_out";
  if (m.kind === "auto_reply" || any(AUTO_TEXT, all)) return "out_of_office";
  if (!text) return "needs_review";
  // Only the opening of a long reply is judged; past that, a person reads it.
  const head = text.slice(0, 600);
  const negative = any(NEGATIVE, head);
  const positive = any(POSITIVE, head.replace(/\bnot interested\b/g, " "));
  const info = any(MORE_INFO, head);
  if (negative) return positive || info ? "needs_review" : "not_interested";
  if (positive) return "interested";
  if (info) return "more_info";
  return "needs_review";
}

/** What each label means for the conversation, the lead and the follow-ups (reply-apply.ts). */
export function conversationStatusFor(label: ReplyLabel): "replied" | "interested" | "not_interested" | "opted_out" | "bounced" | "needs_review" | null {
  switch (label) {
    case "interested": return "interested";
    case "more_info": return "replied";
    case "not_interested": return "not_interested";
    case "opt_out": return "opted_out";
    case "bounce": return "bounced";
    case "needs_review": return "needs_review";
    case "out_of_office": return null; // an auto-reply is not an answer: nothing changes
  }
}
