/**
 * The boundary between DealInSec and a mailbox provider. Release A: connect (authorization URL, code exchange), keep
 * access (refresh, revoke) and send one message. Release B (reply sync, behind GMAIL_REPLY_SYNC_ENABLED): read-only
 * calls that find replies to outreach (MailboxReader below); nothing here can change or delete mail.
 *
 * Adapters classify every failure into MailProviderError kinds, so callers never parse provider responses. For a send,
 * the distinction that matters is whether the provider may have acted: "uncertain" (a timeout, a dropped connection,
 * a 5xx after the request went out) must never be retried automatically, because the message may already be out.
 */

export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
/**
 * Release B: read messages, to find replies to outreach. A Google "restricted" scope: production use needs Google's
 * verification and a yearly security assessment (docs/gmail-reply-sync.md). Requested only while reply sync is on.
 */
export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
/** Release A: identify the account, and send. No read scope of any kind. */
export const RELEASE_A_SCOPES = ["openid", "email", GMAIL_SEND_SCOPE] as const;
/** Release B: Release A plus reading (never modify, compose, insert, labels or settings). */
export const REPLY_SYNC_SCOPES = [...RELEASE_A_SCOPES, GMAIL_READONLY_SCOPE] as const;
/** Google reports the "email" scope by its long name. */
const SCOPE_ALIASES: Record<string, string> = { "https://www.googleapis.com/auth/userinfo.email": "email" };
/** Anything that could change or delete mail, or read it beyond gmail.readonly. Never held; a grant that includes one is refused. */
const MAILBOX_ACCESS = /^https:\/\/(mail\.google\.com\/|www\.googleapis\.com\/auth\/gmail\.(?!send$|readonly$))/;

/** Granted scopes in one comparable form: deduplicated, aliases folded, sorted. */
export function normalizeScopes(raw: string | string[] | undefined | null): string[] {
  const list = Array.isArray(raw) ? raw : String(raw ?? "").split(/\s+/);
  return Array.from(new Set(list.map((x) => x.trim()).filter(Boolean).map((x) => SCOPE_ALIASES[x] ?? x))).sort();
}
/**
 * What a set of granted scopes lets DealInSec do. `read` is gmail.readonly (reply sync); `mailboxAccess` is anything
 * more (changing, deleting, composing, full access), which DealInSec never asks for and refuses to hold.
 */
export function capabilitiesOf(scopes: readonly string[]): { identify: boolean; send: boolean; read: boolean; mailboxAccess: boolean } {
  const s = normalizeScopes([...scopes]);
  return { identify: s.includes("email"), send: s.includes(GMAIL_SEND_SCOPE), read: s.includes(GMAIL_READONLY_SCOPE), mailboxAccess: s.some((x) => MAILBOX_ACCESS.test(x)) };
}

export interface MailAccount {
  sub: string; // the provider's stable account id
  email: string;
  emailVerified: boolean;
}

export interface AuthorizationRequest {
  /** What to ask for; the provider's Release A scopes when absent. */
  scopes?: readonly string[];
  state: string;
  codeChallenge: string; // PKCE, S256
  nonce: string; // echoed in the identity token: ties the identity to this request
  redirectUri: string;
  loginHint?: string;
}

export interface TokenGrant {
  refreshToken: string;
  accessToken: string;
  accessExpiresAt: Date;
  scopes: string[]; // as granted, which may be fewer than requested
  account: MailAccount;
}

export interface AccessGrant {
  accessToken: string;
  expiresAt: Date;
  scopes: string[];
}

/** One plain-text message. Header fields must not contain line breaks; adapters refuse ones that do. */
export interface OutgoingMail {
  from: string;
  fromName?: string; // display name; a single line, encoded when it isn't plain ASCII
  to: string;
  subject: string;
  text: string;
  rfcMessageId: string; // "<…@…>", ours, so a sent copy can be found later
  date?: Date;
  /** A reply in an existing conversation (a follow-up): the Message-ID answered, the chain before it, Gmail's thread. */
  inReplyTo?: string;
  references?: string[];
  threadId?: string;
}

export interface SentMail {
  providerMessageId: string;
  providerThreadId: string | null;
}

export type MailErrorKind =
  | "invalid_grant" // the refresh token is revoked or expired: the person must reconnect
  | "insufficient_scope" // the account did not grant what this needs
  | "rate_limited" // the provider refused for quota; nothing was done
  | "rejected" // the provider (or the adapter) refused this request as invalid; nothing was done
  | "unavailable" // a non-send call failed in transit; safe to try again later
  | "identity_invalid" // the provider's identity token failed validation (issuer, audience, expiry, nonce, claims)
  | "cursor_expired" // reading: the sync position is too old for the provider's change history; start over from now
  | "not_found" // reading: the message or thread is gone (deleted since it was listed)
  | "uncertain"; // a send whose outcome is unknown: it may have gone out

export class MailProviderError extends Error {
  constructor(readonly kind: MailErrorKind, message: string, readonly retryAfterMs?: number) {
    super(message);
    this.name = "MailProviderError";
  }
  /** Whether a send that failed this way might still have been delivered. */
  get mayHaveSent(): boolean {
    return this.kind === "uncertain";
  }
}

export interface MailProvider {
  readonly id: "gmail" | "fake";
  readonly scopes: readonly string[];
  authorizationUrl(req: AuthorizationRequest): string;
  exchangeCode(input: { code: string; codeVerifier: string; redirectUri: string; nonce: string }): Promise<TokenGrant>;
  refreshAccessToken(refreshToken: string): Promise<AccessGrant>;
  revoke(token: string): Promise<void>;
  send(accessToken: string, mail: OutgoingMail): Promise<SentMail>;
}

/* ── Release B: reading, for reply sync ─────────────────────────────────────────────── */

/** A header, as the provider decoded it. */
export interface MailHeader { name: string; value: string }
/** One MIME part, Gmail's shape (format "full" or "metadata"). `data` is base64url, already transfer-decoded. */
export interface MailPart {
  mimeType?: string;
  filename?: string;
  headers?: MailHeader[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: MailPart[];
}
/** A message as read from the mailbox. `payload` has headers only for "metadata", the whole tree for "full". */
export interface MailboxMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  internalDate: Date | null;
  payload: MailPart;
}
/** A message id seen in the change history or a listing (no content). */
export interface MessageRef { id: string; threadId: string; labelIds?: string[] }
export interface HistoryPage {
  /** Change records in ascending order; each has its own history id (a safe place to resume after). */
  records: { id: string; added: MessageRef[] }[];
  /** The mailbox's current history id. */
  historyId: string;
  nextPageToken: string | null;
}

/**
 * The read-only calls reply sync needs. Every call takes a short-lived access token; none can change the mailbox.
 * Failures are MailProviderError kinds: invalid_grant, insufficient_scope, rate_limited, unavailable (try later),
 * cursor_expired (history), not_found (a message deleted since it was listed), rejected.
 */
export interface MailboxReader {
  profile(accessToken: string): Promise<{ email: string; historyId: string }>;
  history(accessToken: string, input: { startHistoryId: string; pageToken?: string | null; maxResults?: number }): Promise<HistoryPage>;
  /** Message ids matching a provider search (Gmail's `q`), newest first. */
  search(accessToken: string, input: { q: string; maxResults?: number; pageToken?: string | null }): Promise<{ messages: MessageRef[]; nextPageToken: string | null }>;
  /** The ids (and labels) of a thread's messages, no content. */
  threadMessages(accessToken: string, threadId: string): Promise<MessageRef[]>;
  /** "metadata": the named headers only; "full": headers and body. */
  message(accessToken: string, id: string, format: "metadata" | "full", headers?: readonly string[]): Promise<MailboxMessage>;
}

const LINE_BREAK = /[\r\n\u0085\u2028\u2029]/;
const ADDRESS = /^[^\s@<>"',;]{1,64}@([a-z0-9-]+\.)+[a-z]{2,}$/i;
const RFC_ID = /^<[A-Za-z0-9._%+-]{1,200}@[A-Za-z0-9.-]{1,60}>$/;

/**
 * What may be sent as an approved message: a one-line subject (1–200 characters) and a body (up to 20,000) with no
 * carriage return and no control character but line feed and tab. Stored outreach text uses "\n" line breaks only, so
 * the bytes that leave (each "\n" becomes CRLF) are a fixed function of exactly the approved text. Null when fine.
 */
export function contentProblem(subject: string, body: string): string | null {
  if (!subject || subject.length > 200 || /[\u0000-\u001f\u007f\u0085\u2028\u2029]/.test(subject)) return "subject";
  if (!body.trim() || body.length > 20_000 || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(body)) return "body";
  return null;
}

/** The checks every adapter applies before a message leaves: one recipient, no header injection, our Message-ID. */
export function validateOutgoing(mail: OutgoingMail): void {
  for (const [field, v] of [["from", mail.from], ["fromName", mail.fromName ?? ""], ["to", mail.to], ["subject", mail.subject], ["rfcMessageId", mail.rfcMessageId]] as const) {
    if (typeof v !== "string" || LINE_BREAK.test(v)) throw new MailProviderError("rejected", `${field} must be a single line`);
  }
  if (!ADDRESS.test(mail.from) || mail.from.length > 254) throw new MailProviderError("rejected", "from is not one address");
  if (!ADDRESS.test(mail.to) || mail.to.length > 254) throw new MailProviderError("rejected", "to is not one address");
  if (!mail.subject.trim() || mail.subject.length > 200) throw new MailProviderError("rejected", "a subject is required (at most 200 characters)");
  if (typeof mail.text !== "string" || !mail.text.trim()) throw new MailProviderError("rejected", "there is no message text");
  if (!RFC_ID.test(mail.rfcMessageId)) throw new MailProviderError("rejected", "rfcMessageId is not <local@domain>");
  // Threading headers are ids we stored ourselves, but checked like any header: one id each, no line breaks.
  const THREAD_ID = /^<[^<>\s]{1,250}>$/;
  if (mail.inReplyTo !== undefined && !THREAD_ID.test(mail.inReplyTo)) throw new MailProviderError("rejected", "inReplyTo is not one <message-id>");
  if (mail.references !== undefined && (mail.references.length > 20 || mail.references.some((r) => !THREAD_ID.test(r)))) throw new MailProviderError("rejected", "references are not <message-id>s");
  if (mail.threadId !== undefined && !/^[A-Za-z0-9_-]{1,128}$/.test(mail.threadId)) throw new MailProviderError("rejected", "threadId is not a provider thread id");
  if ((mail.fromName ?? "").length > 100 || /[\u0000-\u001f\u007f]/.test(mail.fromName ?? "") || /[\u0000\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(mail.text) || /[\u0000-\u001f\u007f]/.test(mail.subject)) {
    throw new MailProviderError("rejected", "control characters are not allowed");
  }
  if (mail.text.length > 20_000) throw new MailProviderError("rejected", "the message is too long");
}
