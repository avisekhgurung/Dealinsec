/**
 * One plain-text email as RFC 5322 / MIME, ready for a provider that takes a raw message (Gmail's `raw`).
 *
 *  - Every header value is validated first (validateOutgoing: single line, no control characters, one address each),
 *    so nothing in the subject, name or addresses can start a new header (no CR/LF injection).
 *  - Non-ASCII in the subject or display name is RFC 2047 encoded (UTF-8, base64), split so every line stays short;
 *    a plain ASCII display name is quoted with its specials escaped.
 *  - The body is UTF-8, line endings normalized to CRLF, sent base64 encoded in 76-character lines, so its bytes
 *    reach the recipient exactly as approved and no body line can be mistaken for a header or the end of the message.
 * Pure: no network, no clock unless `mail.date` is omitted.
 */
import { validateOutgoing, type OutgoingMail } from "./provider";

const CRLF = "\r\n";
const ASCII_PRINTABLE = /^[\x20-\x7e]*$/;

/** RFC 2047 encoded-words for `text`, each 64 characters at most (so "Subject: " plus one fits in 78), never splitting a UTF-8 character. */
export function encodeWords(text: string): string[] {
  const words: string[] = [];
  let chunk = "";
  for (const ch of Array.from(text)) {
    // "=?UTF-8?B?" + base64 + "?=": 39 bytes of text is 52 base64 characters, 64 in all.
    if (Buffer.byteLength(chunk + ch, "utf8") > 39) { words.push(chunk); chunk = ""; }
    chunk += ch;
  }
  if (chunk || !words.length) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, "utf8").toString("base64")}?=`);
}

/** A header whose value may need encoding; long values are folded onto continuation lines. */
function textHeader(name: string, value: string): string {
  if (ASCII_PRINTABLE.test(value) && !/=\?/.test(value) && name.length + 2 + value.length <= 78) return `${name}: ${value}`;
  return `${name}: ${encodeWords(value).join(`${CRLF} `)}`;
}

function mailbox(address: string, name?: string): string {
  if (!name) return address;
  if (ASCII_PRINTABLE.test(name) && !/=\?/.test(name)) return `"${name.replace(/(["\\])/g, "\\$1")}" <${address}>`;
  return `${encodeWords(name).join(`${CRLF} `)}${CRLF} <${address}>`;
}

/** RFC 5322 date, e.g. "Wed, 14 Oct 2026 12:00:00 +0000". */
export function rfc5322Date(d: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const p = (n: number) => String(n).padStart(2, "0");
  return `${days[d.getUTCDay()]}, ${p(d.getUTCDate())} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0000`;
}

/** The complete message (CRLF line endings). Throws MailProviderError("rejected") for anything unsafe. */
export function buildMime(mail: OutgoingMail): string {
  validateOutgoing(mail);
  const body = Buffer.from(mail.text.replace(/\r\n?/g, "\n").replace(/\n/g, CRLF), "utf8").toString("base64").replace(/.{1,76}/g, (l) => l + CRLF);
  const headers = [
    `From: ${mailbox(mail.from, mail.fromName?.trim() || undefined)}`,
    `To: ${mail.to}`,
    textHeader("Subject", mail.subject),
    `Date: ${rfc5322Date(mail.date ?? new Date())}`,
    `Message-ID: ${mail.rfcMessageId}`,
    ...(mail.inReplyTo ? [`In-Reply-To: ${mail.inReplyTo}`] : []),
    ...(mail.references?.length ? [`References: ${mail.references.join(`${CRLF} `)}`] : []),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ];
  return headers.join(CRLF) + CRLF + CRLF + body;
}

/** Gmail's `raw`: the whole message, base64url. */
export const toBase64Url = (raw: string): string => Buffer.from(raw, "utf8").toString("base64url");
