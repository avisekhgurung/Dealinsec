/**
 * The boundary between DealInSec and a mailbox provider. Release A needs only: connect (authorization URL, code
 * exchange), keep access (refresh, revoke) and send one message. Reading a mailbox is Release B and is not here.
 *
 * Adapters classify every failure into MailProviderError kinds, so callers never parse provider responses. For a send,
 * the distinction that matters is whether the provider may have acted: "uncertain" (a timeout, a dropped connection,
 * a 5xx after the request went out) must never be retried automatically, because the message may already be out.
 */

export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
/** Release A: identify the account, and send. No read scope of any kind. */
export const RELEASE_A_SCOPES = ["openid", "email", GMAIL_SEND_SCOPE] as const;
/** Google reports the "email" scope by its long name. */
const SCOPE_ALIASES: Record<string, string> = { "https://www.googleapis.com/auth/userinfo.email": "email" };
/** Anything that could read, change or delete mail. Release A never holds one; a grant that includes one is refused. */
const MAILBOX_ACCESS = /^https:\/\/(mail\.google\.com\/|www\.googleapis\.com\/auth\/gmail\.(?!send$))/;

/** Granted scopes in one comparable form: deduplicated, aliases folded, sorted. */
export function normalizeScopes(raw: string | string[] | undefined | null): string[] {
  const list = Array.isArray(raw) ? raw : String(raw ?? "").split(/\s+/);
  return Array.from(new Set(list.map((x) => x.trim()).filter(Boolean).map((x) => SCOPE_ALIASES[x] ?? x))).sort();
}
/** What a set of granted scopes lets DealInSec do, in Release A terms. */
export function capabilitiesOf(scopes: readonly string[]): { identify: boolean; send: boolean; mailboxAccess: boolean } {
  const s = normalizeScopes([...scopes]);
  return { identify: s.includes("email"), send: s.includes(GMAIL_SEND_SCOPE), mailboxAccess: s.some((x) => MAILBOX_ACCESS.test(x)) };
}

export interface MailAccount {
  sub: string; // the provider's stable account id
  email: string;
  emailVerified: boolean;
}

export interface AuthorizationRequest {
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
  if ((mail.fromName ?? "").length > 100 || /[\u0000-\u001f\u007f]/.test(mail.fromName ?? "") || /[\u0000\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(mail.text) || /[\u0000-\u001f\u007f]/.test(mail.subject)) {
    throw new MailProviderError("rejected", "control characters are not allowed");
  }
  if (mail.text.length > 20_000) throw new MailProviderError("rejected", "the message is too long");
}
