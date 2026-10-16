/**
 * The Google adapter for Release A: OAuth (authorization code + PKCE + nonce), refresh, revoke, and sending one
 * approved message through Gmail's users.messages.send. Sending is off unless the adapter is constructed with
 * `sendingEnabled: true`; config.ts passes the GMAIL_SENDING_ENABLED setting (off by default), so a production adapter
 * refuses without calling Google, independently of the config gate in front of it.
 *
 * No Google SDK: three form posts to Google's documented endpoints. The identity token arrives in the token
 * endpoint's own TLS response to this server, so its claims are validated (issuer, audience, authorized party,
 * expiry, issue time, nonce, subject, verified email) without fetching signing keys, as OpenID Connect Core
 * §3.1.3.7 allows for a token received directly from the token endpoint.
 *
 * Nothing from Google's responses (tokens, codes, error descriptions) is ever put in an error message or a log:
 * errors carry only a MailProviderError kind and a fixed sentence.
 */
import { buildMime, toBase64Url } from "./mime";
import {
  MailProviderError, normalizeScopes, RELEASE_A_SCOPES,
  type AccessGrant, type AuthorizationRequest, type HistoryPage, type MailAccount, type MailboxMessage, type MailboxReader, type MailPart,
  type MailProvider, type MessageRef, type OutgoingMail, type SentMail, type TokenGrant,
} from "./provider";

export const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
export const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const GMAIL_ID = /^[A-Za-z0-9_-]{1,128}$/;
/** Gmail's reasons for refusing for quota or rate: nothing was sent, so asking again later is safe. */
const RATE_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded", "dailyLimitExceeded", "quotaExceeded", "RATE_LIMIT_EXCEEDED", "RESOURCE_EXHAUSTED"]);
/** Gmail's reasons for a token that lacks the send permission. */
const SCOPE_REASONS = new Set(["insufficientPermissions", "ACCESS_TOKEN_SCOPE_INSUFFICIENT"]);
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
const CLOCK_SKEW_S = 120;

export interface GmailProviderOptions {
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
  /** How long to wait for Gmail to answer a send before calling it uncertain. Longer than other calls: an unanswered send can't be retried. */
  sendTimeoutMs?: number;
  /** Off unless set: the adapter refuses to send without calling Google. */
  sendingEnabled?: boolean;
}

/** Validates the identity token's claims and returns the account. Throws identity_invalid; never echoes the token. */
export function verifyIdTokenClaims(idToken: unknown, expect: { clientId: string; nonce: string; now: Date }): MailAccount {
  const bad = (why: string) => new MailProviderError("identity_invalid", `the identity token was not acceptable (${why})`);
  const parts = typeof idToken === "string" ? idToken.split(".") : [];
  if (parts.length !== 3 || !parts.every((p) => /^[A-Za-z0-9_-]+$/.test(p))) throw bad("format");
  let claims: Record<string, unknown>;
  try { claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")); } catch { throw bad("format"); }
  if (!claims || typeof claims !== "object") throw bad("format");
  const now = Math.floor(expect.now.getTime() / 1000);
  if (!ISSUERS.has(String(claims.iss))) throw bad("issuer");
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(expect.clientId)) throw bad("audience");
  if (aud.length > 1 && claims.azp !== expect.clientId) throw bad("authorized party");
  if (claims.azp !== undefined && claims.azp !== expect.clientId) throw bad("authorized party");
  if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_S < now) throw bad("expired");
  if (typeof claims.iat !== "number" || claims.iat - CLOCK_SKEW_S > now) throw bad("issued in the future");
  if (typeof claims.nonce !== "string" || claims.nonce !== expect.nonce) throw bad("nonce");
  if (typeof claims.sub !== "string" || !/^[A-Za-z0-9_-]{1,255}$/.test(claims.sub)) throw bad("subject");
  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  if (!/^[^\s@<>"',;]{1,64}@([a-z0-9-]+\.)+[a-z]{2,}$/.test(email) || email.length > 254) throw bad("email");
  const verified = claims.email_verified === true || claims.email_verified === "true";
  return { sub: claims.sub, email, emailVerified: verified };
}

export class GmailProvider implements MailProvider, MailboxReader {
  readonly id = "gmail" as const;
  readonly scopes = RELEASE_A_SCOPES;
  private fetchImpl: typeof fetch;
  private now: () => Date;
  private timeoutMs: number;
  private sendTimeoutMs: number;

  constructor(private opts: GmailProviderOptions) {
    if (!opts.clientId || !opts.clientSecret) throw new Error("the Gmail provider needs a client id and secret");
    this.fetchImpl = opts.fetchImpl ?? ((...a) => fetch(...a));
    this.now = opts.now ?? (() => new Date());
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.sendTimeoutMs = opts.sendTimeoutMs ?? 30_000;
  }

  authorizationUrl(req: AuthorizationRequest): string {
    if (!req.state || !req.codeChallenge || !req.nonce || !req.redirectUri) throw new MailProviderError("rejected", "state, codeChallenge, nonce and redirectUri are required");
    const u = new URL(GOOGLE_AUTHORIZE_URL);
    const p: Record<string, string> = {
      client_id: this.opts.clientId,
      redirect_uri: req.redirectUri,
      response_type: "code",
      scope: (req.scopes ?? this.scopes).join(" "),
      access_type: "offline", // a refresh token
      prompt: "consent", // always issue one, and show the person what they grant
      state: req.state,
      code_challenge: req.codeChallenge,
      code_challenge_method: "S256",
      nonce: req.nonce,
    };
    // Deliberately no include_granted_scopes: a connection holds exactly what this request asks for.
    if (req.loginHint) p.login_hint = req.loginHint;
    u.search = new URLSearchParams(p).toString();
    return u.toString();
  }

  async exchangeCode(input: { code: string; codeVerifier: string; redirectUri: string; nonce: string }): Promise<TokenGrant> {
    const j = await this.post(GOOGLE_TOKEN_URL, {
      grant_type: "authorization_code", code: input.code, code_verifier: input.codeVerifier, redirect_uri: input.redirectUri,
      client_id: this.opts.clientId, client_secret: this.opts.clientSecret,
    });
    if (typeof j.refresh_token !== "string" || !j.refresh_token) throw new MailProviderError("rejected", "Google did not issue a refresh token");
    if (typeof j.access_token !== "string" || !j.access_token) throw new MailProviderError("rejected", "Google did not issue an access token");
    const account = verifyIdTokenClaims(j.id_token, { clientId: this.opts.clientId, nonce: input.nonce, now: this.now() });
    return {
      refreshToken: j.refresh_token,
      accessToken: j.access_token,
      accessExpiresAt: this.expiry(j.expires_in),
      scopes: normalizeScopes(typeof j.scope === "string" ? j.scope : ""),
      account,
    };
  }

  async refreshAccessToken(refreshToken: string): Promise<AccessGrant> {
    const j = await this.post(GOOGLE_TOKEN_URL, { grant_type: "refresh_token", refresh_token: refreshToken, client_id: this.opts.clientId, client_secret: this.opts.clientSecret });
    if (typeof j.access_token !== "string" || !j.access_token) throw new MailProviderError("rejected", "Google did not issue an access token");
    return { accessToken: j.access_token, expiresAt: this.expiry(j.expires_in), scopes: normalizeScopes(typeof j.scope === "string" ? j.scope : "") };
  }

  /** Revokes the grant. A token Google no longer knows (already revoked or expired) counts as revoked. */
  async revoke(token: string): Promise<void> {
    try {
      await this.post(GOOGLE_REVOKE_URL, { token });
    } catch (e) {
      if (e instanceof MailProviderError && e.kind === "invalid_grant") return; // Google answers invalid_token: already gone
      throw e;
    }
  }

  /**
   * Sends one message, exactly as built from `mail` (buildMime validates every header first), as Gmail's `raw`.
   * Classification, from what the answer proves:
   *  - 2xx with Gmail's message id: sent. A 2xx without a usable id is uncertain (Gmail said yes; we can't tell to what).
   *  - 4xx: Gmail refused before sending. 429 and quota reasons are rate_limited; a missing send permission is
   *    insufficient_scope; anything else (a bad token, a malformed message, the API switched off) is rejected.
   *  - 5xx, a timeout, a dropped connection, a redirect, an unreadable answer: uncertain. It may have gone out.
   * The access token, the message and Gmail's answer never appear in an error.
   */
  async send(accessToken: string, mail: OutgoingMail): Promise<SentMail> {
    if (this.opts.sendingEnabled !== true) throw new MailProviderError("rejected", "Sending through Gmail is not enabled yet.");
    if (typeof accessToken !== "string" || !accessToken) throw new MailProviderError("rejected", "there is no access token");
    const raw = toBase64Url(buildMime(mail)); // throws "rejected" for anything unsafe, before any request
    let res: Response;
    try {
      res = await this.fetchImpl(GMAIL_SEND_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(mail.threadId ? { raw, threadId: mail.threadId } : { raw }), // a follow-up stays in its Gmail thread
        redirect: "error",
        signal: AbortSignal.timeout(this.sendTimeoutMs),
      });
    } catch {
      throw new MailProviderError("uncertain", "Gmail's answer didn't arrive, so the message may or may not have gone out");
    }
    let body: Record<string, any> = {};
    let readable = true;
    try { body = (await res.json()) ?? {}; } catch { readable = false; }
    if (res.ok) {
      const id = readable && typeof body.id === "string" && GMAIL_ID.test(body.id) ? body.id : null;
      if (!id) throw new MailProviderError("uncertain", "Gmail accepted the request but didn't identify the message it sent");
      return { providerMessageId: id, providerThreadId: typeof body.threadId === "string" && GMAIL_ID.test(body.threadId) ? body.threadId : null };
    }
    if (res.status >= 500 || res.status < 400) throw new MailProviderError("uncertain", "Gmail had a problem while sending, so the message may or may not have gone out");
    const reasons = gmailReasons(body);
    if (res.status === 429 || reasons.some((r) => RATE_REASONS.has(r))) throw new MailProviderError("rate_limited", "Gmail asked us to slow down; nothing was sent", retryAfter(res));
    if (res.status === 403 && reasons.some((r) => SCOPE_REASONS.has(r))) throw new MailProviderError("insufficient_scope", "the Gmail connection can't send email");
    throw new MailProviderError("rejected", "Gmail refused the message; nothing was sent");
  }

  /* ── reading (reply sync): GETs only; nothing here can change the mailbox ── */

  async profile(accessToken: string): Promise<{ email: string; historyId: string }> {
    const j = await this.read(accessToken, `${GMAIL_API}/profile`);
    if (typeof j.emailAddress !== "string" || !HISTORY_ID.test(String(j.historyId ?? ""))) throw new MailProviderError("unavailable", "Gmail's profile answer was unreadable");
    return { email: j.emailAddress.toLowerCase(), historyId: String(j.historyId) };
  }

  async history(accessToken: string, input: { startHistoryId: string; pageToken?: string | null; maxResults?: number }): Promise<HistoryPage> {
    if (!HISTORY_ID.test(input.startHistoryId)) throw new MailProviderError("rejected", "not a history id");
    const q = new URLSearchParams({ startHistoryId: input.startHistoryId, historyTypes: "messageAdded", maxResults: String(clamp(input.maxResults, 1, 500, 200)) });
    if (input.pageToken) q.set("pageToken", input.pageToken);
    const j = await this.read(accessToken, `${GMAIL_API}/history?${q}`, { notFound: "cursor_expired" });
    if (!HISTORY_ID.test(String(j.historyId ?? ""))) throw new MailProviderError("unavailable", "Gmail's history answer was unreadable");
    const records = (Array.isArray(j.history) ? j.history : []).flatMap((h: any) => {
      if (!HISTORY_ID.test(String(h?.id ?? ""))) return [];
      const added = (Array.isArray(h.messagesAdded) ? h.messagesAdded : []).map((a: any) => ref(a?.message)).filter(Boolean) as MessageRef[];
      return [{ id: String(h.id), added }];
    });
    return { records, historyId: String(j.historyId), nextPageToken: typeof j.nextPageToken === "string" ? j.nextPageToken : null };
  }

  async search(accessToken: string, input: { q: string; maxResults?: number; pageToken?: string | null }): Promise<{ messages: MessageRef[]; nextPageToken: string | null }> {
    const q = new URLSearchParams({ q: input.q, maxResults: String(clamp(input.maxResults, 1, 100, 25)), includeSpamTrash: "false" });
    if (input.pageToken) q.set("pageToken", input.pageToken);
    const j = await this.read(accessToken, `${GMAIL_API}/messages?${q}`);
    return { messages: (Array.isArray(j.messages) ? j.messages : []).map(ref).filter(Boolean) as MessageRef[], nextPageToken: typeof j.nextPageToken === "string" ? j.nextPageToken : null };
  }

  async threadMessages(accessToken: string, threadId: string): Promise<MessageRef[]> {
    if (!GMAIL_ID.test(threadId)) throw new MailProviderError("rejected", "not a thread id");
    const j = await this.read(accessToken, `${GMAIL_API}/threads/${threadId}?format=minimal`, { notFound: "not_found" });
    return (Array.isArray(j.messages) ? j.messages : []).map(ref).filter(Boolean) as MessageRef[];
  }

  async message(accessToken: string, id: string, format: "metadata" | "full", headers: readonly string[] = []): Promise<MailboxMessage> {
    if (!GMAIL_ID.test(id)) throw new MailProviderError("rejected", "not a message id");
    const q = new URLSearchParams({ format });
    if (format === "metadata") for (const h of headers) q.append("metadataHeaders", h);
    const j = await this.read(accessToken, `${GMAIL_API}/messages/${id}?${q}`, { notFound: "not_found" });
    const r = ref(j);
    if (!r) throw new MailProviderError("unavailable", "Gmail's message answer was unreadable");
    const ms = Number(j.internalDate);
    return { id: r.id, threadId: r.threadId, labelIds: r.labelIds ?? [], internalDate: Number.isFinite(ms) && ms > 0 ? new Date(ms) : null, payload: part(j.payload) };
  }

  /**
   * One authorized GET. 401 is "unavailable" (the next pass refreshes, and a revoked grant then says invalid_grant);
   * 403 for permission is insufficient_scope, for quota rate_limited; 404 is the caller's kind; 5xx and transport
   * failures are unavailable. Nothing from the answer leaves except parsed fields.
   */
  private async read(accessToken: string, url: string, o: { notFound?: "cursor_expired" | "not_found" } = {}): Promise<Record<string, any>> {
    if (typeof accessToken !== "string" || !accessToken) throw new MailProviderError("rejected", "there is no access token");
    let res: Response;
    try {
      res = await this.fetchImpl(url, { method: "GET", headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(this.timeoutMs) });
    } catch {
      throw new MailProviderError("unavailable", "Gmail could not be reached");
    }
    let body: Record<string, any> = {};
    try { body = (await res.json()) ?? {}; } catch { if (res.ok) throw new MailProviderError("unavailable", "Gmail's answer was unreadable"); }
    if (res.ok) return body;
    const reasons = gmailReasons(body);
    if (res.status === 429 || reasons.some((r) => RATE_REASONS.has(r))) throw new MailProviderError("rate_limited", "Gmail asked us to slow down", retryAfter(res));
    if (res.status === 403 && reasons.some((r) => SCOPE_REASONS.has(r))) throw new MailProviderError("insufficient_scope", "the Gmail connection can't read messages");
    if (res.status === 404 && o.notFound) throw new MailProviderError(o.notFound, o.notFound === "cursor_expired" ? "the sync position is too old" : "that message is gone");
    if (res.status === 401 || res.status >= 500) throw new MailProviderError("unavailable", "Gmail had a temporary problem");
    throw new MailProviderError("rejected", "Gmail refused the request");
  }

  private expiry(expiresIn: unknown): Date {
    const s = typeof expiresIn === "number" && expiresIn > 0 ? Math.min(expiresIn, 86_400) : 3_600;
    return new Date(this.now().getTime() + s * 1000);
  }

  /** One form POST. Maps every failure to a kind; the response body never leaves this function except parsed fields. */
  private async post(url: string, form: Record<string, string>): Promise<Record<string, any>> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams(form).toString(),
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new MailProviderError("unavailable", "Google could not be reached");
    }
    let body: Record<string, any> = {};
    try { body = (await res.json()) ?? {}; } catch { body = {}; }
    if (res.ok) return body;
    const err = typeof body.error === "string" ? body.error : "";
    if (res.status === 429) throw new MailProviderError("rate_limited", "Google asked us to slow down", retryAfter(res));
    if (res.status >= 500) throw new MailProviderError("unavailable", "Google had a temporary problem");
    if (err === "invalid_grant" || err === "invalid_token") throw new MailProviderError("invalid_grant", "the Google authorization is no longer valid");
    if (err === "insufficient_scope") throw new MailProviderError("insufficient_scope", "the Google authorization lacks a needed permission");
    throw new MailProviderError("rejected", "Google refused the request");
  }
}

const HISTORY_ID = /^\d{1,20}$/;
const clamp = (v: number | undefined, lo: number, hi: number, dflt: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : dflt);

/** A message reference from any Gmail answer, or null when its ids aren't Gmail ids. */
function ref(x: any): MessageRef | null {
  if (!x || typeof x.id !== "string" || !GMAIL_ID.test(x.id) || typeof x.threadId !== "string" || !GMAIL_ID.test(x.threadId)) return null;
  return { id: x.id, threadId: x.threadId, labelIds: Array.isArray(x.labelIds) ? x.labelIds.filter((l: unknown) => typeof l === "string").slice(0, 50) : [] };
}

/** A MIME tree, keeping only the fields reply sync reads (bounded depth and width). */
function part(x: any, depth = 0): MailPart {
  if (!x || typeof x !== "object" || depth > 8) return {};
  return {
    mimeType: typeof x.mimeType === "string" ? x.mimeType.slice(0, 100) : undefined,
    filename: typeof x.filename === "string" ? x.filename.slice(0, 200) : undefined,
    headers: Array.isArray(x.headers) ? x.headers.filter((h: any) => typeof h?.name === "string" && typeof h?.value === "string").slice(0, 200).map((h: any) => ({ name: h.name, value: h.value })) : undefined,
    body: x.body && typeof x.body === "object" ? { size: Number(x.body.size) || 0, data: typeof x.body.data === "string" ? x.body.data : undefined, attachmentId: typeof x.body.attachmentId === "string" ? x.body.attachmentId : undefined } : undefined,
    parts: Array.isArray(x.parts) ? x.parts.slice(0, 50).map((p: any) => part(p, depth + 1)) : undefined,
  };
}

/** The machine-readable reasons in a Google API error (both its older and newer shapes). Never their text. */
function gmailReasons(body: Record<string, any>): string[] {
  const e = body && typeof body.error === "object" && body.error ? body.error : {};
  const out: string[] = [];
  if (typeof e.status === "string") out.push(e.status);
  for (const x of Array.isArray(e.errors) ? e.errors : []) if (typeof x?.reason === "string") out.push(x.reason);
  for (const x of Array.isArray(e.details) ? e.details : []) if (typeof x?.reason === "string") out.push(x.reason);
  return out;
}

function retryAfter(res: Response): number | undefined {
  const v = Number(res.headers.get("retry-after"));
  return Number.isFinite(v) && v > 0 ? Math.min(v, 3600) * 1000 : undefined;
}
