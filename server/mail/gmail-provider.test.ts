/**
 * The real Gmail adapter, against a stubbed fetch: no request leaves the machine. Checks what it asks Google for,
 * how it validates the identity token, and that nothing Google returns can leak into an error message.
 */
import { describe, expect, it, vi } from "vitest";
import { createMailProvider, resolveGmailConfig } from "./config";
import { GMAIL_SEND_URL, GmailProvider, GOOGLE_AUTHORIZE_URL, GOOGLE_REVOKE_URL, GOOGLE_TOKEN_URL, verifyIdTokenClaims } from "./gmail-provider";
import { buildMime } from "./mime";
import { GMAIL_SEND_SCOPE, MailProviderError, capabilitiesOf, normalizeScopes, type OutgoingMail } from "./provider";

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
    expect(capabilitiesOf(scopes)).toEqual({ identify: true, send: true, read: false, mailboxAccess: false });
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

  it("send is off unless the adapter is built with sending on: refuses without calling Google (and so does the one the app builds)", async () => {
    const { p, calls } = provider(() => json(200, { id: "m1" }));
    const e = await failure(p.send("ya29", { from: "a@b.test", to: "c@d.test", subject: "s", text: "t", rfcMessageId: "<a@b>" }));
    expect(e?.kind).toBe("rejected");
    expect(calls).toHaveLength(0);
    const cfg = resolveGmailConfig({ GMAIL_INTEGRATION_ENABLED: "true", MAIL_PROVIDER: "gmail", NODE_ENV: "production", GMAIL_OAUTH_CLIENT_ID: "9-z.apps.googleusercontent.com", GMAIL_OAUTH_CLIENT_SECRET: "s", GMAIL_OAUTH_REDIRECT_URI: "https://www.dealinsec.com/api/integrations/gmail/callback", MAILBOX_TOKEN_KEYS: `1:${Buffer.alloc(32, 7).fill(9, 0, 1).toString("base64")}`, MAILBOX_TOKEN_KEY_CURRENT: "1" });
    if (!cfg.enabled) throw new Error(JSON.stringify(cfg));
    const built = createMailProvider(cfg.config, { NODE_ENV: "production" });
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("no request may leave the machine"); });
    expect((await failure(built.send("ya29", { from: "a@b.test", to: "c@d.test", subject: "s", text: "t", rfcMessageId: "<a@b>" })))?.kind).toBe("rejected");
    expect(spy).not.toHaveBeenCalled();
    // With GMAIL_SENDING_ENABLED the app builds an adapter that does send (a distinct instance: the setting is part of its key).
    const onCfg = resolveGmailConfig({ ...Object.fromEntries(Object.entries({ GMAIL_INTEGRATION_ENABLED: "true", MAIL_PROVIDER: "gmail", NODE_ENV: "production", GMAIL_OAUTH_CLIENT_ID: "9-z.apps.googleusercontent.com", GMAIL_OAUTH_CLIENT_SECRET: "s", GMAIL_OAUTH_REDIRECT_URI: "https://www.dealinsec.com/api/integrations/gmail/callback", MAILBOX_TOKEN_KEYS: `1:${Buffer.alloc(32, 7).fill(9, 0, 1).toString("base64")}`, MAILBOX_TOKEN_KEY_CURRENT: "1" })), GMAIL_SENDING_ENABLED: "true" });
    if (!onCfg.enabled) throw new Error(JSON.stringify(onCfg));
    const sending = createMailProvider(onCfg.config, { NODE_ENV: "production" });
    expect(sending).not.toBe(built);
    spy.mockImplementation(async () => new Response(JSON.stringify({ id: "m1", threadId: "t1" }), { status: 200, headers: { "content-type": "application/json" } }));
    expect(await sending.send("ya29", { from: "a@b.test", to: "c@d.test", subject: "s", text: "t", rfcMessageId: "<a@b>" })).toEqual({ providerMessageId: "m1", providerThreadId: "t1" });
    spy.mockRestore();
  });
});

describe("GmailProvider: sending (users.messages.send, stubbed)", () => {
  const ACCESS = "ya29.ACCESS-TOKEN-DO-NOT-LEAK";
  const MAIL: OutgoingMail = { from: "ana@agency.test", fromName: "Ana Silva", to: "jo@acme-foods.test", subject: "A quick idea for Acme — spring menu", text: "Hi Jo,\n\nOne idea:\tseasonal menus.\n\nAna", rfcMessageId: "<dis-0123abcd@dealinsec.com>", date: NOW };
  function sender(respond: () => Response | Promise<Response>, opts: { sendTimeoutMs?: number; fetchImpl?: typeof fetch } = {}) {
    const calls: { url: string; init: RequestInit; json: any }[] = [];
    const fetchImpl = opts.fetchImpl ?? (vi.fn(async (url: any, init: any) => { calls.push({ url: String(url), init, json: JSON.parse(String(init.body)) }); return respond(); }) as unknown as typeof fetch);
    return { p: new GmailProvider({ clientId: CLIENT, clientSecret: "client-secret-xyz", fetchImpl, now: () => NOW, sendingEnabled: true, sendTimeoutMs: opts.sendTimeoutMs }), calls };
  }

  it("posts exactly the approved message as base64url `raw`, with the access token as a bearer token, and returns Gmail's ids", async () => {
    const { p, calls } = sender(() => json(200, { id: "18f2a0b1c2d3e4f5", threadId: "18f2a0b1c2d3e4f5", labelIds: ["SENT"] }));
    expect(await p.send(ACCESS, MAIL)).toEqual({ providerMessageId: "18f2a0b1c2d3e4f5", providerThreadId: "18f2a0b1c2d3e4f5" });
    expect(calls).toHaveLength(1);
    const c = calls[0];
    expect(c.url).toBe(GMAIL_SEND_URL);
    expect(c.init.method).toBe("POST");
    expect(c.init.redirect).toBe("error");
    expect(c.init.signal).toBeInstanceOf(AbortSignal);
    expect(c.init.headers).toEqual({ Authorization: `Bearer ${ACCESS}`, "Content-Type": "application/json", Accept: "application/json" });
    expect(Object.keys(c.json)).toEqual(["raw"]); // no threadId, no labels: a new message, nothing else
    expect(c.json.raw).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(c.json.raw, "base64url").toString("utf8")).toBe(buildMime(MAIL));
  });

  it("refuses an unsafe message before any request: header injection, two recipients, no token", async () => {
    const { p, calls } = sender(() => json(200, { id: "m1" }));
    for (const bad of [{ subject: "Hi\r\nBcc: everyone@x.test" }, { to: "a@x.test, b@x.test" }, { fromName: "Ana\nBcc: x@y.test" }, { rfcMessageId: "<a@b>\r\nX: y" }, { text: "" }]) {
      expect((await failure(p.send(ACCESS, { ...MAIL, ...bad })))?.kind, JSON.stringify(bad)).toBe("rejected");
    }
    expect((await failure(p.send("", MAIL)))?.kind).toBe("rejected");
    expect(calls).toHaveLength(0);
  });

  it("classifies Gmail's answers by what they prove, and never puts the token, the message or the answer in the error", async () => {
    const leak = `${ACCESS} ${MAIL.to} ${MAIL.subject}`;
    const gErr = (code: number, reason: string, status = "") => ({ error: { code, message: leak, status, errors: [{ reason, message: leak, domain: "global" }] } });
    const cases: [() => Response | Promise<Response>, string, number?][] = [
      // proven not sent: refused before sending
      [() => json(400, gErr(400, "invalidArgument", "INVALID_ARGUMENT")), "rejected"],
      [() => json(401, gErr(401, "authError", "UNAUTHENTICATED")), "rejected"],
      [() => json(403, gErr(403, "accessNotConfigured", "PERMISSION_DENIED")), "rejected"], // the Gmail API switched off for the project
      [() => json(403, gErr(403, "domainPolicy", "PERMISSION_DENIED")), "rejected"],
      [() => json(404, gErr(404, "notFound")), "rejected"],
      [() => json(403, gErr(403, "insufficientPermissions", "PERMISSION_DENIED")), "insufficient_scope"],
      [() => json(403, { error: { code: 403, message: leak, status: "PERMISSION_DENIED", details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }] } }), "insufficient_scope"],
      [() => json(429, gErr(429, "rateLimitExceeded", "RESOURCE_EXHAUSTED"), { "retry-after": "20" }), "rate_limited", 20_000],
      [() => json(403, gErr(403, "userRateLimitExceeded")), "rate_limited"],
      [() => json(403, gErr(403, "dailyLimitExceeded")), "rate_limited"],
      // may have gone out
      [() => json(500, gErr(500, "backendError")), "uncertain"],
      [() => new Response("<html>bad gateway</html>", { status: 502 }), "uncertain"],
      [() => json(503, {}), "uncertain"],
      [() => { throw new TypeError("fetch failed " + leak); }, "uncertain"],
      [() => { throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); }, "uncertain"],
      [() => json(200, {}), "uncertain"], // "yes" without saying to what
      [() => json(200, { id: "../../etc" }), "uncertain"],
      [() => new Response("not json", { status: 200 }), "uncertain"],
    ];
    for (const [respond, kind, retry] of cases) {
      const { p, calls } = sender(respond);
      const e = await failure(p.send(ACCESS, MAIL));
      expect(e, kind).toBeInstanceOf(MailProviderError);
      expect(e!.kind, `${kind} ${respond.toString().slice(0, 80)}`).toBe(kind);
      expect(e!.mayHaveSent).toBe(kind === "uncertain");
      if (retry) expect(e!.retryAfterMs).toBe(retry);
      for (const secret of [ACCESS, MAIL.to, MAIL.subject, "client-secret-xyz"]) expect(e!.message).not.toContain(secret);
      expect(calls.length).toBeLessThanOrEqual(1); // the adapter never retries a send itself
    }
  });

  it("a Gmail that never answers: given up on after the send timeout, as uncertain (not as 'failed')", async () => {
    const hang = (async (_u: any, init: any) => new Promise<Response>((_r, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)))) as unknown as typeof fetch;
    const { p } = sender(() => json(200, { id: "x" }), { sendTimeoutMs: 25, fetchImpl: hang });
    const started = Date.now();
    expect((await failure(p.send(ACCESS, MAIL)))?.kind).toBe("uncertain");
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("a body that stops arriving after Gmail's 200 is uncertain too", async () => {
    const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"id":"m')); c.error(new Error("connection reset")); } });
    const { p } = sender(() => new Response(stream, { status: 200, headers: { "content-type": "application/json" } }));
    expect((await failure(p.send(ACCESS, MAIL)))?.kind).toBe("uncertain");
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
