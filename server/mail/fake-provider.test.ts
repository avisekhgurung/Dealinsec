import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeMailProvider } from "./fake-provider";
import { GMAIL_SEND_SCOPE, MailProviderError, normalizeScopes, RELEASE_A_SCOPES, type OutgoingMail } from "./provider";

const REDIRECT = "http://localhost:5072/api/integrations/gmail/callback";
const verifier = "v".repeat(43);
const challenge = createHash("sha256").update(verifier).digest("base64url");
const mail = (over: Partial<OutgoingMail> = {}): OutgoingMail => ({ from: "rep@example.test", to: "ceo@acme.test", subject: "Hello", text: "Body", rfcMessageId: "<dis-1-abc@dealinsec.com>", ...over });
const kind = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return e instanceof MailProviderError ? e.kind : `other: ${(e as Error).message}`; } };

async function connected(p = new FakeMailProvider()) {
  const u = new URL(p.authorizationUrl({ state: "s1", codeChallenge: challenge, nonce: "n1", redirectUri: REDIRECT }));
  const grant = await p.exchangeCode({ code: u.searchParams.get("code")!, codeVerifier: verifier, redirectUri: REDIRECT, nonce: "n1" });
  return { p, grant };
}

describe("FakeMailProvider", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => { fetchSpy = vi.fn(() => { throw new Error("network used"); }); vi.stubGlobal("fetch", fetchSpy); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("never uses the network: no fetch during a full connect → send → revoke, and no network module in its source", async () => {
    const { p, grant } = await connected();
    await p.send(grant.accessToken, mail());
    await p.revoke(grant.refreshToken);
    expect(fetchSpy).not.toHaveBeenCalled();
    for (const f of ["fake-provider.ts", "provider.ts"]) {
      const src = readFileSync(path.join(import.meta.dirname, f), "utf8");
      expect(src).not.toMatch(/\bfetch\s*\(|from\s+["'](node:)?(https?|net|tls|dns|http2|undici|child_process)["']|require\(/);
    }
    // its authorization URL can't resolve anywhere
    expect(new URL(p.authorizationUrl({ state: "s", codeChallenge: challenge, nonce: "n1", redirectUri: REDIRECT })).hostname.endsWith(".invalid")).toBe(true);
  });

  it("connects with single-use, PKCE-checked codes and reports the account and granted scopes", async () => {
    const p = new FakeMailProvider();
    const code = new URL(p.authorizationUrl({ state: "s1", codeChallenge: challenge, nonce: "n1", redirectUri: REDIRECT })).searchParams.get("code")!;
    expect(await kind(p.exchangeCode({ code, codeVerifier: "w".repeat(43), redirectUri: REDIRECT, nonce: "n1" }))).toBe("invalid_grant");
    expect(await kind(p.exchangeCode({ code, codeVerifier: verifier, redirectUri: REDIRECT, nonce: "n1" }))).toBe("invalid_grant"); // already spent
    const { grant } = await connected(p);
    expect(grant.account).toEqual({ sub: "fake-sub-1", email: "rep@example.test", emailVerified: true });
    expect(grant.scopes).toEqual(normalizeScopes([...RELEASE_A_SCOPES]));
    expect(RELEASE_A_SCOPES.some((s) => /readonly|modify|metadata|compose|mail\.google\.com/.test(s))).toBe(false);
    const code2 = new URL(p.authorizationUrl({ state: "s2", codeChallenge: challenge, nonce: "n1", redirectUri: REDIRECT })).searchParams.get("code")!;
    expect(await kind(p.exchangeCode({ code: code2, codeVerifier: verifier, redirectUri: "https://elsewhere.test/cb", nonce: "n1" }))).toBe("invalid_grant");
  });

  it("checks the nonce, and its consent redirect goes straight back to the callback with code and state", async () => {
    const p = new FakeMailProvider();
    const url = p.authorizationUrl({ state: "st", codeChallenge: challenge, nonce: "n-good", redirectUri: REDIRECT });
    const back = new URL(FakeMailProvider.consentRedirect(url));
    expect(back.origin + back.pathname).toBe(REDIRECT);
    expect(back.searchParams.get("state")).toBe("st");
    expect(await kind(p.exchangeCode({ code: back.searchParams.get("code")!, codeVerifier: verifier, redirectUri: REDIRECT, nonce: "n-bad" }))).toBe("identity_invalid");
    expect(() => FakeMailProvider.consentRedirect("https://accounts.google.com/o/oauth2/v2/auth?code=x")).toThrow();
  });

  it("delivers only to its in-memory outbox, and refuses header injection or a missing send scope", async () => {
    const { p, grant } = await connected();
    const sent = await p.send(grant.accessToken, mail());
    expect(p.outbox).toHaveLength(1);
    expect(p.outbox[0]).toMatchObject({ to: "ceo@acme.test", providerMessageId: sent.providerMessageId });
    for (const bad of [{ to: "ceo@acme.test\r\nBcc: all@x.test" }, { subject: "Hi\nBcc: x@y.test" }, { to: "a@x.test, b@y.test" }, { rfcMessageId: "no-brackets" }, { text: "  " }, { subject: "Hi\u2028there" }]) {
      expect(await kind(p.send(grant.accessToken, mail(bad)))).toBe("rejected");
    }
    expect(p.outbox).toHaveLength(1);
    const noSend = await connected(new FakeMailProvider({ grantedScopes: ["openid", "email"] }));
    expect(noSend.grant.scopes).not.toContain(GMAIL_SEND_SCOPE);
    expect(await kind(noSend.p.send(noSend.grant.accessToken, mail()))).toBe("insufficient_scope");
    expect(noSend.p.outbox).toHaveLength(0);
  });

  it("revoked or expired access fails with invalid_grant; refresh works until revoked", async () => {
    let now = new Date("2026-10-14T10:00:00Z");
    const { p, grant } = await connected(new FakeMailProvider({ now: () => now, accessTtlMs: 60_000 }));
    now = new Date(now.getTime() + 61_000);
    expect(await kind(p.send(grant.accessToken, mail()))).toBe("invalid_grant");
    const fresh = await p.refreshAccessToken(grant.refreshToken);
    expect(await kind(p.send(fresh.accessToken, mail()))).toBe("ok");
    await p.revoke(grant.refreshToken);
    expect(await kind(p.refreshAccessToken(grant.refreshToken))).toBe("invalid_grant");
    expect(await kind(p.send(fresh.accessToken, mail()))).toBe("invalid_grant");
  });

  it("scripts failures: an uncertain send that went out is in the outbox and says it may have sent; a refused one is not", async () => {
    const { p, grant } = await connected();
    p.failNext("send", "uncertain", { delivered: true });
    let err: unknown;
    try { await p.send(grant.accessToken, mail({ rfcMessageId: "<dis-2@dealinsec.com>" })); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(MailProviderError);
    expect((err as MailProviderError).mayHaveSent).toBe(true);
    expect(p.outbox.map((m) => m.rfcMessageId)).toEqual(["<dis-2@dealinsec.com>"]);
    p.failNext("send", "rate_limited", { retryAfterMs: 5_000 });
    try { await p.send(grant.accessToken, mail({ rfcMessageId: "<dis-3@dealinsec.com>" })); } catch (e) { err = e; }
    expect(err).toMatchObject({ kind: "rate_limited", retryAfterMs: 5_000, mayHaveSent: false });
    expect(p.outbox).toHaveLength(1);
    p.failNext("refresh", "unavailable");
    expect(await kind(p.refreshAccessToken(grant.refreshToken))).toBe("unavailable");
    expect(await kind(p.refreshAccessToken(grant.refreshToken))).toBe("ok"); // a script is used once
    expect(p.calls.map((c) => c.op)).toEqual(["exchange", "send", "send", "refresh", "refresh"]);
  });
});
