/**
 * Reading one synced message into the few fields reply sync keeps (docs/gmail-reply-sync.md). Pure: no I/O, no
 * logging, nothing from the message is ever interpreted as an instruction.
 *
 * The body becomes plain text only. HTML is reduced to text here and is never stored or rendered; quoted history
 * (our own email, quoted back) is cut off, so what is kept is what the other person actually wrote. Addresses are
 * taken from the address part of a header only: a display name never identifies anyone.
 */
import { normalEmail } from "@shared/outreach-safety";
import type { MailboxMessage, MailHeader, MailPart } from "./provider";

/** The headers a metadata read asks for: enough to decide whether a message belongs to an outreach conversation. */
export const MATCH_HEADERS = ["From", "To", "Cc", "Subject", "Message-ID", "In-Reply-To", "References", "Date", "Auto-Submitted", "Precedence", "X-Autoreply", "X-Autorespond", "Content-Type"] as const;

export const MAX_BODY_CHARS = 20_000;
const MAX_REFERENCES = 30;

export interface ParsedMail {
  id: string;
  threadId: string;
  labels: string[];
  rfcMessageId: string | null;
  inReplyTo: string | null;
  references: string[]; // oldest first, the last MAX_REFERENCES
  from: string | null; // normalized address, or null when the header has none we accept
  fromName: string | null; // shown, never matched on
  to: string[];
  cc: string[];
  subject: string;
  date: Date | null; // the Date header (else when Gmail received it)
  receivedAt: Date | null; // when Gmail received it (millisecond precision): the order to decide messages in
  automated: boolean; // an auto-reply (out of office, autoresponder) or bulk/list mail
  bounce: boolean; // a delivery failure report
}

export interface ParsedBody { text: string | null; trimmed: boolean }

export function headerOf(headers: MailHeader[] | undefined, name: string): string | null {
  const n = name.toLowerCase();
  for (const h of headers ?? []) if (h.name.toLowerCase() === n) return h.value;
  return null;
}

/** Splits an address header on commas outside quotes and angle brackets. */
function splitAddresses(v: string): string[] {
  const out: string[] = [];
  let cur = "", quoted = false, angle = 0;
  for (const ch of v.slice(0, 5_000)) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === "<") angle++;
    else if (!quoted && ch === ">") angle = Math.max(0, angle - 1);
    if (ch === "," && !quoted && angle === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

/** One mailbox from a header entry: the <address> when there is one, else the bare address. Display names are ignored. */
export function addressOf(entry: string): { address: string | null; name: string | null } {
  const m = /<([^<>]*)>\s*$/.exec(entry);
  const address = normalEmail(m ? m[1] : entry);
  let name: string | null = m ? entry.slice(0, m.index).trim().replace(/^"(.*)"$/, "$1").trim() : null;
  if (name) name = name.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 120) || null;
  return { address, name };
}

export function addressList(v: string | null): string[] {
  if (!v) return [];
  return Array.from(new Set(splitAddresses(v).map((e) => addressOf(e).address).filter((a): a is string => !!a))).slice(0, 50);
}

/** Message-IDs in a header ("<a@b> <c@d>"), in order. Anything not shaped like one is ignored. */
export function messageIds(v: string | null): string[] {
  if (!v) return [];
  return (v.slice(0, 20_000).match(/<[^<>\s]{1,250}>/g) ?? []).map((x) => x.toLowerCase());
}

const AUTO_SUBJECT = /^\s*(automatic reply|auto(matic)?[- ]?(reply|response)|out of (the )?office|ooo\b|autoreply|abwesenheit|r[ée]ponse automatique|respuesta autom[áa]tica)/i;

export function parseMail(m: MailboxMessage): ParsedMail {
  const h = m.payload.headers;
  const from = addressOf(headerOf(h, "From") ?? "");
  const autoSubmitted = (headerOf(h, "Auto-Submitted") ?? "").trim().toLowerCase();
  const precedence = (headerOf(h, "Precedence") ?? "").trim().toLowerCase();
  const subject = (headerOf(h, "Subject") ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 300);
  const contentType = (headerOf(h, "Content-Type") ?? m.payload.mimeType ?? "").toLowerCase();
  const local = from.address?.split("@")[0] ?? "";
  const date = (() => { const d = new Date(headerOf(h, "Date") ?? ""); return Number.isNaN(d.getTime()) ? m.internalDate : d; })();
  const ownId = messageIds(headerOf(h, "Message-ID"))[0] ?? null;
  return {
    id: m.id,
    threadId: m.threadId,
    labels: m.labelIds,
    rfcMessageId: ownId,
    inReplyTo: messageIds(headerOf(h, "In-Reply-To"))[0] ?? null,
    references: messageIds(headerOf(h, "References")).slice(-MAX_REFERENCES),
    from: from.address,
    fromName: from.name,
    to: addressList(headerOf(h, "To")),
    cc: addressList(headerOf(h, "Cc")),
    subject,
    date,
    receivedAt: m.internalDate,
    automated: (!!autoSubmitted && autoSubmitted !== "no") || headerOf(h, "X-Autoreply") !== null || headerOf(h, "X-Autorespond") !== null
      || ["auto_reply", "bulk", "junk", "list"].includes(precedence) || AUTO_SUBJECT.test(subject),
    bounce: /^(mailer-daemon|postmaster)$/.test(local) || (contentType.includes("multipart/report") && contentType.includes("delivery-status")),
  };
}

/* ── body ─────────────────────────────────────────────────────────────────────── */

function decode(data: string | undefined, charset: string): string {
  if (!data) return "";
  let bytes: Buffer;
  try { bytes = Buffer.from(data, "base64url"); } catch { return ""; }
  try { return new TextDecoder(charset || "utf-8", { fatal: false }).decode(bytes); } catch { return new TextDecoder("utf-8").decode(bytes); }
}

function isAttachment(p: MailPart): boolean {
  if (p.filename || p.body?.attachmentId) return true;
  return /^\s*attachment/i.test(headerOf(p.headers, "Content-Disposition") ?? "");
}

function charsetOf(p: MailPart): string {
  const ct = headerOf(p.headers, "Content-Type") ?? "";
  return (/charset="?([A-Za-z0-9_.:-]{1,40})"?/i.exec(ct)?.[1] ?? "utf-8").toLowerCase();
}

/** The first inline part of a type, depth first (the order mail clients show). */
function firstPart(p: MailPart, type: string, depth = 0): MailPart | null {
  if (depth > 8) return null;
  if ((p.mimeType ?? "").toLowerCase() === type && !isAttachment(p) && p.body?.data) return p;
  for (const c of p.parts ?? []) { const f = firstPart(c, type, depth + 1); if (f) return f; }
  return null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
/** HTML to plain text: structure becomes line breaks, every tag goes, quoted history (Gmail/Outlook/Apple/Yahoo markers) is cut. */
export function htmlToText(html: string): ParsedBody {
  let s = html.slice(0, 400_000);
  s = s.replace(/<(script|style|head|title)\b[\s\S]*?<\/\1\s*>/gi, "");
  const cut = s.search(/<div[^>]+class="?[^">]*\b(gmail_quote|yahoo_quoted)\b|<blockquote\b|<div[^>]+id="?(divRplyFwdMsg|appendonsend)\b/i);
  const trimmed = cut > 0;
  if (trimmed) s = s.slice(0, cut);
  s = s.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|tr|h[1-6]|table)\s*>/gi, "\n").replace(/<li\b[^>]*>/gi, "• ");
  s = s.replace(/<[^>]*>/g, "");
  s = s.replace(/&(#x?[0-9a-f]{1,6}|[a-z]{2,8});/gi, (m, e: string) => {
    if (e[0] === "#") { const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ""; }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
  return { text: s, trimmed };
}

/** Lines that start what is quoted back from earlier in the conversation. */
const QUOTE_START = [
  /^-{2,}\s*(original message|forwarded message)\s*-{2,}\s*$/i,
  /^_{8,}\s*$/, // Outlook's rule above "From: … Sent: …"
  /^>/,
];
/** "On Mon, 3 Oct 2026 at 10:00, Ana <ana@x.com> wrote:", sometimes wrapped over two lines. */
const WROTE = /^(on\b|le\b|am\b|el\b|il\b).{0,300}\b(wrote|a écrit|schrieb|escribió|ha scritto)\s*:\s*$/i;

/** Cuts quoted history from a plain-text reply. Keeps the whole text if cutting would leave nothing. */
export function stripQuoted(text: string): ParsedBody {
  const lines = text.split("\n");
  let cut = -1;
  for (let i = 0; i < lines.length && cut < 0; i++) {
    const l = lines[i].trim();
    if (WROTE.test(l) || (i + 1 < lines.length && WROTE.test(`${l} ${lines[i + 1].trim()}`))) cut = i;
    else if (QUOTE_START.some((r) => r.test(l))) cut = i;
    else if (/^from:\s/i.test(l) && lines.slice(i + 1, i + 5).some((x) => /^(sent|date):\s/i.test(x.trim()))) cut = i;
  }
  if (cut <= 0) return { text, trimmed: false };
  const kept = lines.slice(0, cut).join("\n");
  return kept.trim() ? { text: kept, trimmed: true } : { text, trimmed: false };
}

function tidy(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** The message's own words as plain text (null when it has no text part), quoted history removed, capped. */
export function bodyOf(m: MailboxMessage): ParsedBody {
  const plain = firstPart(m.payload, "text/plain");
  let r: ParsedBody;
  if (plain) r = stripQuoted(tidy(decode(plain.body?.data, charsetOf(plain))));
  else {
    const html = firstPart(m.payload, "text/html");
    if (!html) return { text: null, trimmed: false };
    const h = htmlToText(decode(html.body?.data, charsetOf(html)));
    const q = stripQuoted(tidy(h.text ?? ""));
    r = { text: q.text, trimmed: h.trimmed || q.trimmed };
  }
  const text = tidy(r.text ?? "");
  if (!text) return { text: null, trimmed: r.trimmed };
  return text.length > MAX_BODY_CHARS ? { text: `${text.slice(0, MAX_BODY_CHARS)}…`, trimmed: true } : { text, trimmed: r.trimmed };
}

/** A subject compared without reply/forward prefixes, case or spacing. */
export function subjectKey(s: string | null | undefined): string {
  let v = String(s ?? "").trim();
  for (let i = 0; i < 5; i++) v = v.replace(/^(re|fw|fwd|aw|wg|sv|vs|tr|rv)\s*(\[\d+\])?\s*:\s*/i, "");
  return v.replace(/\s+/g, " ").toLowerCase();
}
