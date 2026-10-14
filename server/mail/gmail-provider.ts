/**
 * The Google adapter for Release A: OAuth (authorization code + PKCE + nonce), refresh and revoke. Sending is not
 * enabled in this build; `send` refuses without calling Google.
 *
 * No Google SDK: three form posts to Google's documented endpoints. The identity token arrives in the token
 * endpoint's own TLS response to this server, so its claims are validated (issuer, audience, authorized party,
 * expiry, issue time, nonce, subject, verified email) without fetching signing keys, as OpenID Connect Core
 * §3.1.3.7 allows for a token received directly from the token endpoint.
 *
 * Nothing from Google's responses (tokens, codes, error descriptions) is ever put in an error message or a log:
 * errors carry only a MailProviderError kind and a fixed sentence.
 */
import {
  MailProviderError, normalizeScopes, RELEASE_A_SCOPES,
  type AccessGrant, type AuthorizationRequest, type MailAccount, type MailProvider, type OutgoingMail, type SentMail, type TokenGrant,
} from "./provider";

export const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
const CLOCK_SKEW_S = 120;

export interface GmailProviderOptions {
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
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

export class GmailProvider implements MailProvider {
  readonly id = "gmail" as const;
  readonly scopes = RELEASE_A_SCOPES;
  private fetchImpl: typeof fetch;
  private now: () => Date;
  private timeoutMs: number;

  constructor(private opts: GmailProviderOptions) {
    if (!opts.clientId || !opts.clientSecret) throw new Error("the Gmail provider needs a client id and secret");
    this.fetchImpl = opts.fetchImpl ?? ((...a) => fetch(...a));
    this.now = opts.now ?? (() => new Date());
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  authorizationUrl(req: AuthorizationRequest): string {
    if (!req.state || !req.codeChallenge || !req.nonce || !req.redirectUri) throw new MailProviderError("rejected", "state, codeChallenge, nonce and redirectUri are required");
    const u = new URL(GOOGLE_AUTHORIZE_URL);
    const p: Record<string, string> = {
      client_id: this.opts.clientId,
      redirect_uri: req.redirectUri,
      response_type: "code",
      scope: this.scopes.join(" "),
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

  async send(_accessToken: string, _mail: OutgoingMail): Promise<SentMail> {
    throw new MailProviderError("rejected", "Sending through Gmail is not enabled yet.");
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

function retryAfter(res: Response): number | undefined {
  const v = Number(res.headers.get("retry-after"));
  return Number.isFinite(v) && v > 0 ? Math.min(v, 3600) * 1000 : undefined;
}
