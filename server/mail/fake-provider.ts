/**
 * An in-memory mailbox provider for tests and isolated local runs. It never touches the network and never delivers
 * anything: a "sent" message is a row in `outbox`. It behaves like a careful real provider where that matters to the
 * safety logic built on it: authorization codes are single-use and PKCE-checked, revoked tokens fail with
 * invalid_grant, a send needs the send scope, and a scripted failure can say the message went out anyway (uncertain).
 *
 * No imports beyond node:crypto (hashing and ids); a test asserts this file never reaches for fetch, http or sockets.
 */
import { createHash, randomBytes } from "node:crypto";
import { buildMime } from "./mime";
import {
  GMAIL_SEND_SCOPE, MailProviderError, normalizeScopes, RELEASE_A_SCOPES, validateOutgoing,
  type AccessGrant, type AuthorizationRequest, type MailAccount, type MailErrorKind, type MailProvider,
  type OutgoingMail, type SentMail, type TokenGrant,
} from "./provider";

type Op = "exchange" | "refresh" | "revoke" | "send";
interface Scripted { kind: MailErrorKind; delivered?: boolean; retryAfterMs?: number }

export interface FakeMailProviderOptions {
  account?: MailAccount;
  /** What the person "ticks" on the consent screen. Defaults to everything requested. */
  grantedScopes?: string[];
  now?: () => Date;
  accessTtlMs?: number;
}

const FAKE_AUTHORIZE = "https://fake-mail-provider.invalid/authorize"; // .invalid never resolves (RFC 2606)

export class FakeMailProvider implements MailProvider {
  readonly id = "fake" as const;
  readonly scopes = RELEASE_A_SCOPES;
  /** Every message the fake "delivered", in order (including an uncertain send that went out), with the raw MIME it built. */
  readonly outbox: (OutgoingMail & SentMail & { at: Date; raw: string })[] = [];
  /** Every call, for asserting what a flow did (and did not) ask the provider for. */
  readonly calls: { op: Op; at: Date }[] = [];

  private account: MailAccount;
  private granted: string[];
  private now: () => Date;
  private accessTtlMs: number;
  private codes = new Map<string, { challenge: string; redirectUri: string; nonce: string }>();
  private refreshTokens = new Map<string, { scopes: string[] }>();
  private accessTokens = new Map<string, { scopes: string[]; expiresAt: Date; refresh: string }>();
  private script = new Map<Op, Scripted[]>();
  private delays = new Map<Op, number[]>();
  private hangs = new Set<Op>();
  private seq = 0;

  constructor(opts: FakeMailProviderOptions = {}) {
    this.account = opts.account ?? { sub: "fake-sub-1", email: "rep@example.test", emailVerified: true };
    this.granted = opts.grantedScopes ?? [...RELEASE_A_SCOPES];
    this.now = opts.now ?? (() => new Date());
    this.accessTtlMs = opts.accessTtlMs ?? 3_600_000;
  }

  /** Delays the next call of `op` by `ms` (a slow provider). */
  delayNext(op: Op, ms: number): void {
    this.delays.set(op, [...(this.delays.get(op) ?? []), ms]);
  }
  /** The next call of `op` never answers (the process "dies" waiting). For a send, the message is NOT delivered. */
  hangNext(op: Op): void {
    this.hangs.add(op);
  }

  /** Makes the next call of `op` fail this way. For a send, `delivered: true` means it went out before failing. */
  failNext(op: Op, kind: MailErrorKind, extra: { delivered?: boolean; retryAfterMs?: number } = {}): void {
    this.script.set(op, [...(this.script.get(op) ?? []), { kind, ...extra }]);
  }

  /** The URL a person would be sent to. The fake never serves it; tests hand its code straight to the callback. */
  authorizationUrl(req: AuthorizationRequest): string {
    if (!req.state || !req.codeChallenge || !req.nonce || !req.redirectUri) throw new MailProviderError("rejected", "state, codeChallenge, nonce and redirectUri are required");
    const code = `fake-code-${++this.seq}-${randomBytes(6).toString("hex")}`;
    this.codes.set(code, { challenge: req.codeChallenge, redirectUri: req.redirectUri, nonce: req.nonce });
    const u = new URL(FAKE_AUTHORIZE);
    u.search = new URLSearchParams({ code, state: req.state, redirect_uri: req.redirectUri, scope: this.scopes.join(" ") }).toString();
    return u.toString();
  }

  /**
   * Local runs only: what Google would do after the person agreed, i.e. send the browser back to the callback with
   * the code and state. Lets the whole connect flow run in a browser with no network.
   */
  static consentRedirect(authorizationUrl: string): string {
    const u = new URL(authorizationUrl);
    if (u.origin + u.pathname !== FAKE_AUTHORIZE) throw new Error("not a fake authorization URL");
    const back = new URL(u.searchParams.get("redirect_uri")!);
    back.search = new URLSearchParams({ code: u.searchParams.get("code")!, state: u.searchParams.get("state")! }).toString();
    return back.toString();
  }

  /** Changes the account the next consent returns (another person, or an unverified address). */
  setAccount(account: MailAccount, grantedScopes?: string[]): void {
    this.account = account;
    if (grantedScopes) this.granted = grantedScopes;
  }

  async exchangeCode(input: { code: string; codeVerifier: string; redirectUri: string; nonce: string }): Promise<TokenGrant> {
    this.record("exchange");
    const c = this.codes.get(input.code);
    this.codes.delete(input.code); // single use, even when it fails
    if (!c || c.redirectUri !== input.redirectUri) throw new MailProviderError("invalid_grant", "unknown, used or mismatched authorization code");
    const challenge = createHash("sha256").update(input.codeVerifier ?? "").digest("base64url");
    if (challenge !== c.challenge) throw new MailProviderError("invalid_grant", "PKCE verifier does not match");
    if (input.nonce !== c.nonce) throw new MailProviderError("identity_invalid", "the identity token's nonce does not match");
    const refreshToken = `fake-refresh-${randomBytes(16).toString("hex")}`;
    this.refreshTokens.set(refreshToken, { scopes: [...this.granted] });
    const access = this.issueAccess(refreshToken, this.granted);
    return { refreshToken, accessToken: access.accessToken, accessExpiresAt: access.expiresAt, scopes: normalizeScopes(this.granted), account: { ...this.account } };
  }

  async refreshAccessToken(refreshToken: string): Promise<AccessGrant> {
    this.record("refresh");
    await this.pause("refresh");
    const r = this.refreshTokens.get(refreshToken);
    if (!r) throw new MailProviderError("invalid_grant", "refresh token revoked or unknown");
    return this.issueAccess(refreshToken, r.scopes);
  }

  /** Whether a refresh token is still live here (tests: was it revoked?). */
  isLive(refreshToken: string): boolean {
    return this.refreshTokens.has(refreshToken);
  }

  /** As if the person removed DealInSec in their Google account: every token stops working. */
  revokeAllExternally(): void {
    this.refreshTokens.clear();
    this.accessTokens.clear();
  }

  async revoke(token: string): Promise<void> {
    this.record("revoke");
    const refresh = this.refreshTokens.has(token) ? token : this.accessTokens.get(token)?.refresh;
    if (!refresh) return; // like Google: revoking an unknown token is not an error worth surfacing
    this.refreshTokens.delete(refresh);
    this.accessTokens.forEach((v, a) => { if (v.refresh === refresh) this.accessTokens.delete(a); });
  }

  async send(accessToken: string, mail: OutgoingMail): Promise<SentMail> {
    const scripted = this.record("send");
    await this.pause("send");
    const a = this.accessTokens.get(accessToken);
    if (!a || a.expiresAt <= this.now()) throw new MailProviderError("invalid_grant", "access token expired or revoked");
    if (!a.scopes.includes(GMAIL_SEND_SCOPE)) throw new MailProviderError("insufficient_scope", "the send scope was not granted");
    validateOutgoing(mail);
    const raw = buildMime(mail);
    if (scripted && !scripted.delivered) throw new MailProviderError(scripted.kind, `scripted ${scripted.kind}`, scripted.retryAfterMs);
    const sent: SentMail = { providerMessageId: `fake-msg-${++this.seq}`, providerThreadId: `fake-thread-${this.seq}` };
    this.outbox.push({ ...mail, ...sent, at: this.now(), raw });
    if (scripted) throw new MailProviderError(scripted.kind, `scripted ${scripted.kind} after delivery`, scripted.retryAfterMs);
    return sent;
  }

  private issueAccess(refresh: string, scopes: string[]): AccessGrant {
    const accessToken = `fake-access-${randomBytes(16).toString("hex")}`;
    const expiresAt = new Date(this.now().getTime() + this.accessTtlMs);
    this.accessTokens.set(accessToken, { scopes: [...scopes], expiresAt, refresh });
    return { accessToken, expiresAt, scopes: normalizeScopes(scopes) };
  }

  private async pause(op: Op): Promise<void> {
    if (this.hangs.delete(op)) await new Promise<never>(() => {});
    const ms = this.delays.get(op)?.shift();
    if (ms) await new Promise((r) => setTimeout(r, ms));
  }

  /** Logs the call and, for anything but a send (which decides for itself), throws a scripted failure. */
  private record(op: Op): Scripted | undefined {
    this.calls.push({ op, at: this.now() });
    const s = this.script.get(op)?.shift();
    if (s && op !== "send") throw new MailProviderError(s.kind, `scripted ${s.kind}`, s.retryAfterMs);
    return s;
  }
}
