/**
 * What a model-written outreach message must not contain. Pure: the same rules run on the server before a
 * draft is saved and are tested without a model.
 *
 * This is a safety net for the things a program CAN check, not a promise the message is good. It cannot tell
 * whether a sentence is true: that is why a person reads and approves every message, and why the draft is
 * written only from verified facts. What it does catch, because they are the costly mistakes:
 *   - an invented PRICE, discount or guarantee (the sender never agreed one),
 *   - links or email addresses the model made up (or copied off a page),
 *   - unfilled placeholders ("[Name]"), markup, and a wrong length,
 *   - pretending a conversation already happened ("as we discussed"),
 *   - text that reads like an instruction to an AI, echoed from a web page.
 * A PERSON editing a draft is held only to the structural rules (length, placeholders, markup): their own
 * message may quote their own price.
 */
import { injectionLike } from "./research";

export type IssueCode =
  | "subject_length" | "body_length" | "placeholder" | "html" | "price" | "discount_or_guarantee"
  | "link" | "email_address" | "false_history" | "instruction_like";
export interface Issue { code: IssueCode; message: string }
export interface Draft { subject: string; body: string }
export interface DraftContext {
  /** The one address the message is going to; it is the only address allowed in the text. */
  to: string;
  /** The lead's own site: its address may appear in the text. */
  siteHost: string;
}

export const LIMITS = { subjectMin: 3, subjectMax: 120, bodyMin: 40, bodyMax: 1500 } as const;
/**
 * Only this much text is scanned by the pattern rules. Anything longer is already refused for its length, and bounding the
 * scan keeps every pattern linear in practice: a pattern that backtracks on a pathological string (100,000 letters, no dots)
 * must not be able to hang the server.
 */
const SCAN = { subject: LIMITS.subjectMax + 100, body: LIMITS.bodyMax + 300 } as const;

const PLACEHOLDER = /\[[^\]\n]{1,40}\]|\{\{[^}\n]*\}\}|\{[A-Za-z_ ]{2,30}\}|<[A-Z][A-Za-z ]{1,30}>|\b(?:INSERT|TODO|LOREM|XXX|FIRSTNAME|YOUR NAME)\b/;
const HTML = /<\/?[a-z][^>\n]*>/i;
const CURRENCY_SYMBOL = /[$€£₹¥]\s?\d/;
const CURRENCY_WORD = /\b\d[\d,.]*\s?(?:k|m|thousand|million|lakh|crore)?\s?(?:usd|eur|gbp|inr|rs\.?|rupees?|dollars?|euros?|pounds?|bucks)\b/i;
const PERCENT = /\b\d+(?:\.\d+)?\s?%/;
const RATE = /\b\d[\d,.]*\s?(?:per|\/|a)\s?(?:hour|hr|day|week|month|year|project|page|word)\b/i;
const THOUSANDS = /\b\d{1,3}(?:,\d{3})+\b/;
const DISCOUNT = /\b(?:discount|% off|free of charge|guarantee[ds]?|money[- ]back|limited[- ]time|act now|risk[- ]free|special offer)\b/i;
const URL_RE = /\bhttps?:\/\/[^\s)>\]]+|\bwww\.[^\s)>\]]+/gi;
/** A word shaped like a web address by itself (example.com, blog.example.xyz): letters-and-digits labels, then a letters-only ending of 2 to 24 letters. Tested on one word at a time, anchored. */
const BARE_DOMAIN_WORD = /^(?:[a-z0-9][a-z0-9-]{0,62}\.)+[a-z]{2,24}$/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const FALSE_HISTORY = /\b(?:as (?:we )?discussed|following (?:up on )?our (?:call|conversation|chat|meeting|talk)|thanks for (?:your|getting back)|great (?:speaking|talking|chatting) with you|as promised|per our (?:call|conversation|chat)|nice (?:meeting|speaking to) you|good to (?:meet|speak with) you)\b/i;

const hostOf = (s: string): string => { try { return new URL(/^[a-z]+:\/\//i.test(s) ? s : `https://${s}`).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } };
const onSite = (host: string, site: string) => !!site && (host === site || host.endsWith(`.${site}`));

/** The rules that apply to everything, written by a model or a person. */
export function checkStructure(d: Draft): Issue[] {
  const out: Issue[] = [];
  const subject = d.subject.trim(), body = d.body.trim();
  const scanSubject = subject.slice(0, SCAN.subject), scanBody = body.slice(0, SCAN.body);
  if (subject.length < LIMITS.subjectMin || subject.length > LIMITS.subjectMax || /[\r\n]/.test(d.subject)) out.push({ code: "subject_length", message: `The subject must be ${LIMITS.subjectMin} to ${LIMITS.subjectMax} characters on one line.` });
  if (body.length < LIMITS.bodyMin || body.length > LIMITS.bodyMax) out.push({ code: "body_length", message: `The message must be ${LIMITS.bodyMin} to ${LIMITS.bodyMax} characters.` });
  if (PLACEHOLDER.test(scanSubject) || PLACEHOLDER.test(scanBody)) out.push({ code: "placeholder", message: "It still has a placeholder such as [Name] or {{name}}. Fill it in or remove it." });
  if (HTML.test(scanSubject) || HTML.test(scanBody)) out.push({ code: "html", message: "It contains markup. Use plain text." });
  return out;
}

/** The extra rules for a MODEL-written draft. */
export function checkDraft(d: Draft, ctx: DraftContext): Issue[] {
  const out = checkStructure(d);
  const text = `${d.subject.trim().slice(0, SCAN.subject)}\n${d.body.trim().slice(0, SCAN.body)}`;
  const site = ctx.siteHost.toLowerCase().replace(/^www\./, "");
  const to = ctx.to.trim().toLowerCase();

  if (CURRENCY_SYMBOL.test(text) || CURRENCY_WORD.test(text) || PERCENT.test(text) || RATE.test(text) || THOUSANDS.test(text)) {
    out.push({ code: "price", message: "It mentions a price, rate or percentage. The sender has not set one, so none may appear." });
  }
  if (DISCOUNT.test(text)) out.push({ code: "discount_or_guarantee", message: "It offers a discount or a guarantee. Nothing like that has been agreed." });

  const urls = Array.from(text.matchAll(URL_RE)).map((m) => hostOf(m[0]));
  const bare = text.replace(URL_RE, " ").replace(EMAIL, " ").split(/[\s,;:()<>"'\[\]{}!?]+/)
    .map((w) => w.replace(/\.+$/, "")).filter((w) => w.length > 3 && w.length <= 253 && BARE_DOMAIN_WORD.test(w)).map((w) => hostOf(w));
  if ([...urls, ...bare].some((h) => !onSite(h, site))) out.push({ code: "link", message: "It contains a link or web address that is not the company's own site." });

  if (Array.from(text.matchAll(EMAIL)).some((m) => m[0].toLowerCase() !== to)) out.push({ code: "email_address", message: "It contains an email address other than the one it is going to." });
  if (FALSE_HISTORY.test(text)) out.push({ code: "false_history", message: "It talks as if you had already spoken. You have not contacted them yet." });
  if (injectionLike(text)) out.push({ code: "instruction_like", message: "It contains text that reads like an instruction to an AI." });
  return out;
}

/** One line a retry can be told: what to fix. */
export const issuesForRetry = (issues: Issue[]): string => issues.map((i) => `- ${i.message}`).join("\n");
