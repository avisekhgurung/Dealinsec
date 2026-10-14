/**
 * The real Gmail adapter, against a stubbed fetch: no request leaves the machine. Checks what it asks Google for,
 * how it validates the identity token, and that nothing Google returns can leak into an error message.
 */
import { describe, expect, it, vi } from "vitest";
import { GmailProvider, GOOGLE_AUTHORIZE_URL, GOOGLE_REVOKE_URL, GOOGLE_TOKEN_URL, verifyIdTokenClaims } from "./gmail-provider";
import { GMAIL_SEND_SCOPE, MailProviderError, capabilitiesOf, normalizeScopes } from "./provider";

const CLIENT = "123-abc.apps.googleusercontent.com";
const NOW = new Date("2026-10-14T12:00:00Z");
const t = Math.floor(NOW.getTime() / 1000);
const SECRET_TOKEN = "1//SECRET-REFRESH-TOKEN-DO-NOT-LEAK";

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const idToken = (claims: Record<string, unknown> = {}) => `${b64({ alg: "RS256" })}.${b64({ iss: "https://accounts.google.com", aud: CLIENT, azp: CLIENT, sub: "1098765", email: "Rep@Example.com", email_verified: true, iat: t - 10, exp: t + 3500, nonce: "n1", ...claims })}.c2ln`;
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const tokenBody = (over: Record<string, unknown> = {}) => ({ access_token: "ya29.access", expires_in: 3599, refresh_token: SECRET_TOKEN, scope: `openid ${GMAIL_SEND_SCOPE} https://www.googleapis.com/auth/userinfo.email`, token_type: "Bearer", id_token: idToken(), ...over });

function provider(respond: (url: string, body: URLSearchParams) => Response | Promise<Response>) {
  const calls: { url: string; body: URLSearchParams; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: any, init: any) => {
    const body = new URLSearchParams(String(init.body));
    calls.push({ url: String(url), body, init });
    return respond(String(url), body);
  }) as unknown as typeof fetch;
  return { p: new GmailProvider({ clientId: CLIENT, clientSecret: "client-secret-xyz", fetchImpl, now: () => NOW }), calls };
}
const failure = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as MailProviderError; } };

describe("GmailProvider: what it asks Google for", () => {
  it("the consent URL: send + identity only, offline, consent, PKCE S256, nonce, state; no incremental grant", () => {
    const { p } = provider(() => json(200, {}));
    const u = new URL(p.authorizationUrl({ state: "st", codeChallenge: "ch", nonce: "n1", redirectUri: "https://www.dealinsec.com/api/integrations/gmail/callback", loginHint: "rep@example.com" }));
    expect(u.origin + u.pathname).toBe(GOOGLE_AUTHORIZE_URL);
    expect(Object.fromEntries(u.searchParams)).toEqual({
      client_id: CLIENT, redirect_uri: "https://www.dealinsec.com/api/integrations/gmail/callback", response_type: "code",
      scope: `openid email ${GMAIL_SEND_SCOPE}`, access_type: "offline", prompt: "consent", state: "st",
      code_challenge: "ch", code_challenge_method: "S256", nonce: "n1", login_hint: "rep@example.com",
    });
    const scopes = u.searchParams.get("scope")!.split(" ");
    expect(capabilitiesOf(scopes)).toEqual({ identify: true, send: true, mailboxAccess: false });
    expect(scopes.some((s) => /readonly|modify|metadata|compose|insert|labels|mail\.google\.com/.test(s))).toBe(false);
  });

  it("exchanges the code with the verifier, redirect URI and client credentials, and returns the validated account", async () => {
    const { p, calls } = provider(() => json(200, tokenBody()));
    const g = await p.exchangeCode({ code: "4/code", codeVerifier: "v".repeat(64), redirectUri: "https://www.dealinsec.com/api/integrations/gmail/callback", nonce: "n1" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(GOOGLE_TOKEN_URL);
    expect(calls[0].init.redirect).toBe("error");
    expect(Object.fromEntries(calls[0].body)).toEqual({ grant_type: "authorization_code", code: "4/code", code_verifier: "v".repeat(64), redirect_uri: "https://www.dealinsec.com/api/integrations/gmail/callback", client_id: CLIENT, client_secret: "client-secret-xyz" });
    expect(g.account).toEqual({ sub: "1098765", email: "rep@example.com", emailVerified: true });
    expect(g.refreshToken).toBe(SECRET_TOKEN);
    expect(g.scopes).toEqual(normalizeScopes(["openid", "email", GMAIL_SEND_SCOPE]));
    expect(g.accessExpiresAt.getTime()).toBe(NOW.getTime() + 3599_000);
  });

  it("refuses a response without a refresh token, and reports the scopes Google actually granted", async () => {
    expect((await failure(provider(() => json(200, tokenBody({ refresh_token: undefined }))).p.exchangeCode({ code: "c", codeVerifier: "v", redirectUri: "r", nonce: "n1" })))?.kind).toBe("rejected");
    const g = await provider(() => json(200, tokenBody({ scope: "openid https://www.googleapis.com/auth/userinfo.email" }))).p.exchangeCode({ code: "c", codeVerifier: "v", redirectUri: "r", nonce: "n1" });
    expect(capabilitiesOf(g.scopes).send).toBe(false);
  });

  it("send is not enabled: refuses without calling Google", async () => {
    const { p, calls } = provider(() => json(200, {}));
    const e = await failure(p.send("ya29", { from: "a@b.test", to: "c@d.test", subject: "s", text: "t", rfcMessageId: "<a@b>" }));
    expect(e?.kind).toBe("rejected");
    expect(calls).toHaveLength(0);
  });
});

describe("GmailProvider: identity token validation", () => {
  const ok = { clientId: CLIENT, nonce: "n1", now: NOW };
  it("accepts a well-formed token; keeps an unverified email marked unverified (the caller refuses it)", () => {
    expect(verifyIdTokenClaims(idToken(), ok)).toEqual({ sub: "1098765", email: "rep@example.com", emailVerified: true });
    expect(verifyIdTokenClaims(idToken({ iss: "accounts.google.com", email_verified: "true" }), ok).emailVerified).toBe(true);
    expect(verifyIdTokenClaims(idToken({ email_verified: false }), ok).emailVerified).toBe(false);
    expect(verifyIdTokenClaims(idToken({ azp: undefined }), ok).sub).toBe("1098765");
  });
  it.each([
    ["issuer", { iss: "https://evil.example" }],
    ["audience", { aud: "other-client.apps.googleusercontent.com" }],
    ["authorized party", { azp: "other-client.apps.googleusercontent.com" }],
    ["authorized party", { aud: [CLIENT, "other"], azp: undefined }],
    ["expired", { exp: t - 600 }],
    ["issued in the future", { iat: t + 600 }],
    ["nonce", { nonce: "replayed" }],
    ["nonce", { nonce: undefined }],
    ["subject", { sub: "" }],
    ["subject", { sub: 12345 }],
    ["email", { email: "not-an-address" }],
    ["email", { email: undefined }],
  ])("refuses a token with a bad %s", (_why, claims) => {
    let e: unknown;
    try { verifyIdTokenClaims(idToken(claims as any), ok); } catch (x) { e = x; }
    expect(e).toBeInstanceOf(MailProviderError);
    expect((e as MailProviderError).kind).toBe("identity_invalid");
  });
  it("refuses malformed tokens", () => {
    for (const bad of [undefined, "", "a.b", "a.b.c.d", "a.!!.c", `${b64({})}.${Buffer.from("not json").toString("base64url")}.x`]) {
      expect(() => verifyIdTokenClaims(bad, ok)).toThrow(MailProviderError);
    }
  });
  it("an exchange whose token fails validation is identity_invalid", async () => {
    const e = await failure(provider(() => json(200, tokenBody({ id_token: idToken({ nonce: "other" }) }))).p.exchangeCode({ code: "c", codeVerifier: "v", redirectUri: "r", nonce: "n1" }));
    expect(e?.kind).toBe("identity_invalid");
  });
});

describe("GmailProvider: failures", () => {
  it("maps Google's answers to kinds, and never puts anything from the response in the message", async () => {
    const leak = { error_description: `token ${SECRET_TOKEN} code 4/code` };
    const cases: [Response | Error, string][] = [
      [json(400, { error: "invalid_grant", ...leak }), "invalid_grant"],
      [json(401, { error: "invalid_client", ...leak }), "rejected"],
      [json(400, { error: "invalid_request", ...leak }), "rejected"],
      [json(403, { error: "insufficient_scope", ...leak }), "insufficient_scope"],
      [json(429, { error: "rate_limit_exceeded", ...leak }, { "retry-after": "30" }), "rate_limited"],
      [json(503, { ...leak }), "unavailable"],
      [new Response("<html>gateway</html>", { status: 502 }), "unavailable"],
      [new TypeError("fetch failed: " + SECRET_TOKEN), "unavailable"],
    ];
    for (const [r, kind] of cases) {
      const { p } = provider(() => { if (r instanceof Error) throw r; return r.clone(); });
      const e = await failure(p.refreshAccessToken(SECRET_TOKEN));
      expect(e?.kind, kind).toBe(kind);
      expect(e!.message).not.toContain(SECRET_TOKEN);
      expect(e!.message).not.toContain("4/code");
      expect(e!.message).not.toContain("client-secret-xyz");
      if (kind === "rate_limited") expect(e!.retryAfterMs).toBe(30_000);
    }
  });

  it("revoke: posts the token to Google's revoke endpoint; already-revoked counts as done; an outage is reported", async () => {
    const ok = provider(() => new Response("", { status: 200 }));
    await ok.p.revoke(SECRET_TOKEN);
    expect(ok.calls[0].url).toBe(GOOGLE_REVOKE_URL);
    expect(ok.calls[0].body.get("token")).toBe(SECRET_TOKEN);
    await provider(() => json(400, { error: "invalid_token" })).p.revoke(SECRET_TOKEN);
    expect((await failure(provider(() => json(503, {})).p.revoke(SECRET_TOKEN)))?.kind).toBe("unavailable");
    expect((await failure(provider(() => json(401, { error: "invalid_client" })).p.revoke(SECRET_TOKEN)))?.kind).toBe("rejected");
  });
});
