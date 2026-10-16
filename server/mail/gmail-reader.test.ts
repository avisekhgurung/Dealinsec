/**
 * The Gmail adapter's read-only calls (reply sync), against a stubbed fetch: no request leaves the machine. Checks
 * the scopes it may ask for, that every read is a GET, how failures are classified, and that nothing Google returns
 * (or the token) leaks into an error message.
 */
import { describe, expect, it, vi } from "vitest";
import { GMAIL_API, GmailProvider } from "./gmail-provider";
import { capabilitiesOf, GMAIL_READONLY_SCOPE, GMAIL_SEND_SCOPE, MailProviderError, RELEASE_A_SCOPES, REPLY_SYNC_SCOPES } from "./provider";

const CLIENT = "123-abc.apps.googleusercontent.com";
const TOKEN = "ya29.SECRET-ACCESS-TOKEN";
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function provider(respond: (url: URL) => Response | Promise<Response>) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: any, init: any) => { const u = new URL(String(url)); calls.push({ url: u, init }); return respond(u); }) as unknown as typeof fetch;
  return { p: new GmailProvider({ clientId: CLIENT, clientSecret: "s", fetchImpl }), calls };
}
const failure = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as MailProviderError; } };

describe("scopes", () => {
  it("asks for gmail.readonly only when told to, and never for anything that can change mail", () => {
    const { p } = provider(() => json(200, {}));
    const req = { state: "s", codeChallenge: "c", nonce: "n", redirectUri: "https://www.dealinsec.com/api/integrations/gmail/callback" };
    expect(new URL(p.authorizationUrl(req)).searchParams.get("scope")).toBe(RELEASE_A_SCOPES.join(" "));
    const scope = new URL(p.authorizationUrl({ ...req, scopes: REPLY_SYNC_SCOPES })).searchParams.get("scope")!;
    expect(scope.split(" ")).toEqual(["openid", "email", GMAIL_SEND_SCOPE, GMAIL_READONLY_SCOPE]);
    expect(scope).not.toMatch(/modify|compose|insert|labels|settings|mail\.google\.com|metadata/);
  });
  it("read access is a capability of its own; modify or full access is never acceptable", () => {
    expect(capabilitiesOf([GMAIL_SEND_SCOPE, GMAIL_READONLY_SCOPE])).toMatchObject({ send: true, read: true, mailboxAccess: false });
    expect(capabilitiesOf(["https://www.googleapis.com/auth/gmail.modify"]).mailboxAccess).toBe(true);
    expect(capabilitiesOf(["https://mail.google.com/"]).mailboxAccess).toBe(true);
    expect(capabilitiesOf(["https://www.googleapis.com/auth/gmail.metadata"]).mailboxAccess).toBe(true);
  });
});

describe("reads", () => {
  it("every read is an authorized GET to the Gmail API, with no body and no redirects followed", async () => {
    const { p, calls } = provider((u) => {
      if (u.pathname.endsWith("/profile")) return json(200, { emailAddress: "Ana@Agency.test", historyId: "12345" });
      if (u.pathname.endsWith("/history")) return json(200, { historyId: "12400", history: [{ id: "12350", messagesAdded: [{ message: { id: "m1", threadId: "t1", labelIds: ["INBOX"] } }, { message: { id: "bad id!", threadId: "t1" } }] }], nextPageToken: "pg2" });
      if (u.pathname.endsWith("/messages")) return json(200, { messages: [{ id: "m2", threadId: "t2" }] });
      if (u.pathname.includes("/threads/")) return json(200, { messages: [{ id: "m1", threadId: "t1", labelIds: ["SENT"] }] });
      return json(200, { id: "m1", threadId: "t1", labelIds: ["INBOX"], internalDate: "1760000000000", payload: { headers: [{ name: "From", value: "jo@acme.com" }], parts: [{ mimeType: "text/plain", body: { data: "aGk" } }] } });
    });
    expect(await p.profile(TOKEN)).toEqual({ email: "ana@agency.test", historyId: "12345" });
    expect(await p.history(TOKEN, { startHistoryId: "12345", maxResults: 100 })).toEqual({ records: [{ id: "12350", added: [{ id: "m1", threadId: "t1", labelIds: ["INBOX"] }] }], historyId: "12400", nextPageToken: "pg2" });
    expect((await p.search(TOKEN, { q: "{from:jo@acme.com to:jo@acme.com} newer_than:60d" })).messages).toEqual([{ id: "m2", threadId: "t2", labelIds: [] }]);
    expect(await p.threadMessages(TOKEN, "t1")).toEqual([{ id: "m1", threadId: "t1", labelIds: ["SENT"] }]);
    const m = await p.message(TOKEN, "m1", "metadata", ["From", "References"]);
    expect(m).toMatchObject({ id: "m1", threadId: "t1", labelIds: ["INBOX"], payload: { headers: [{ name: "From", value: "jo@acme.com" }] } });
    for (const c of calls) {
      expect(c.init.method).toBe("GET");
      expect(c.init.body).toBeUndefined();
      expect(c.init.redirect).toBe("error");
      expect((c.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
      expect(c.url.origin + c.url.pathname).toMatch(new RegExp(`^${GMAIL_API.replace(/\./g, "\\.")}/`));
    }
    expect(calls[1].url.searchParams.get("historyTypes")).toBe("messageAdded");
    expect(calls[4].url.searchParams.getAll("metadataHeaders")).toEqual(["From", "References"]);
  });

  it("refuses ids that aren't Gmail ids before calling anything", async () => {
    const { p, calls } = provider(() => json(200, {}));
    expect((await failure(p.message(TOKEN, "../../send", "full")))?.kind).toBe("rejected");
    expect((await failure(p.threadMessages(TOKEN, "a/b")))?.kind).toBe("rejected");
    expect((await failure(p.history(TOKEN, { startHistoryId: "12; DROP" })))?.kind).toBe("rejected");
    expect(calls).toHaveLength(0);
  });

  it("classifies failures: 404 history = cursor_expired, 404 message = not_found, scope, quota, 401/5xx/network = unavailable", async () => {
    const at = (status: number, body: unknown = {}, headers: Record<string, string> = {}) => provider(() => json(status, body, headers)).p;
    expect((await failure(at(404).history(TOKEN, { startHistoryId: "1" })))?.kind).toBe("cursor_expired");
    expect((await failure(at(404).message(TOKEN, "m1", "full")))?.kind).toBe("not_found");
    expect((await failure(at(403, { error: { errors: [{ reason: "insufficientPermissions" }] } }).profile(TOKEN)))?.kind).toBe("insufficient_scope");
    const rl = await failure(at(429, {}, { "retry-after": "30" }).profile(TOKEN));
    expect([rl?.kind, rl?.retryAfterMs]).toEqual(["rate_limited", 30_000]);
    expect((await failure(at(403, { error: { errors: [{ reason: "userRateLimitExceeded" }] } }).profile(TOKEN)))?.kind).toBe("rate_limited");
    expect((await failure(at(401).profile(TOKEN)))?.kind).toBe("unavailable");
    expect((await failure(at(503).profile(TOKEN)))?.kind).toBe("unavailable");
    expect((await failure(provider(() => { throw new Error("ECONNRESET"); }).p.profile(TOKEN)))?.kind).toBe("unavailable");
    expect((await failure(at(400).search(TOKEN, { q: "x" })))?.kind).toBe("rejected");
  });

  it("no token and nothing from Google's answer appears in an error", async () => {
    const leak = "SECRET-BODY-TEXT jo@acme.com";
    for (const status of [400, 401, 403, 404, 429, 500]) {
      const e = await failure(provider(() => json(status, { error: { message: leak, errors: [{ reason: "x", message: leak }] } })).p.message(TOKEN, "m1", "full"));
      expect(e?.message).not.toContain("SECRET");
      expect(e?.message).not.toContain("jo@acme.com");
      expect(e?.message).not.toContain(TOKEN);
    }
  });
});
