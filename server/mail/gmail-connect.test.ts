/**
 * Connecting and disconnecting Gmail, end to end over HTTP: a real Express app with real sessions (express-session,
 * in memory), the real routes and service, FakeMailProvider and the in-memory store. Each "browser" is its own
 * cookie jar. No database, no network beyond 127.0.0.1, no email.
 */
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import express from "express";
import session from "express-session";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CONNECT_OUTCOMES, type GmailStatusView } from "@shared/gmail-connect";
import { resolveGmailConfig, type GmailStatus } from "./config";
import { completeConnect, disconnectMailboxes, startConnect, UsedStates, type MailServiceDeps, type Member } from "./connect-service";
import { FakeMailProvider } from "./fake-provider";
import { MemoryMailboxStore } from "./memory-store";
import { GMAIL_SEND_SCOPE } from "./provider";
import { registerGmailRoutes, SESSION_KEY } from "./routes";
import { decryptToken, loadKeyring } from "./token-crypto";

const KEYS = { MAILBOX_TOKEN_KEYS: `1:${randomBytes(32).toString("base64")}`, MAILBOX_TOKEN_KEY_CURRENT: "1" };

let base = "";
let server: ReturnType<express.Express["listen"]>;
let fake: FakeMailProvider;
let store: MemoryMailboxStore;
let enabled = true;
let allowedOrgs: string | undefined;
let clock = new Date("2026-10-14T12:00:00Z");
let testStart = clock;
const logs: { event: string; fields: Record<string, unknown> }[] = [];
const audits: { actor: string; org: string | null; action: string; id: number; detail: string }[] = [];
const users = new Map<string, Member>();

function env() {
  return { GMAIL_INTEGRATION_ENABLED: enabled ? "true" : "false", GMAIL_ALLOWED_ORG_IDS: allowedOrgs, MAIL_PROVIDER: "fake", NODE_ENV: "test", GMAIL_OAUTH_REDIRECT_URI: `${base.replace("127.0.0.1", "localhost")}/api/integrations/gmail/callback`, ...KEYS };
}
const deps: MailServiceDeps = {
  status: async () => resolveGmailConfig(env()) as GmailStatus,
  provider: () => fake,
  get store() { return store; },
  now: () => clock,
  cleanup: () => ({ keyring: loadKeyring(KEYS), provider: fake }),
  audit: (actor, action, id, detail) => audits.push({ actor: actor.id, org: actor.organizationId, action, id, detail }),
  log: (event, fields = {}) => logs.push({ event, fields }),
};

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test-secret", resave: false, saveUninitialized: false, store: new session.MemoryStore() }));
  app.post("/t/login", (req: any, res) => { req.session.userId = req.body.userId; req.session.save(() => res.json({ ok: true })); });
  app.get("/t/pending", (req: any, res) => res.json({ pending: req.session?.[SESSION_KEY] ?? null }));
  const load = (req: any) => { const u = users.get(req.session?.userId); return u && u.memberStatus !== "removed" ? u : null; };
  registerGmailRoutes(app, {
    ...deps,
    get store() { return store; },
    auth: (req: any, res, next) => { const u = load(req); if (!u) return res.status(401).json({ message: "Unauthorized" }); req.user = u; next(); },
    currentUser: async (req) => load(req),
    send: {} as any, // sending has its own suite (gmail-send.test.ts); nothing here reaches it
  });
  await new Promise<void>((ok) => { server = app.listen(0, "127.0.0.1", () => ok()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((ok) => server.close(() => ok())));

beforeEach(() => {
  fake = new FakeMailProvider({ account: { sub: "g-sub-ana", email: "ana@agency.test", emailVerified: true }, now: () => clock });
  store = new MemoryMailboxStore();
  enabled = true;
  allowedOrgs = undefined;
  // each test starts two hours after the last, so per-person rate limits never carry over
  clock = testStart = new Date(testStart.getTime() + 2 * 3_600_000);
  logs.length = 0; audits.length = 0; users.clear();
  users.set("ana", { id: "ana", organizationId: "org-a", memberStatus: "active", orgRole: "SALES", email: "ana@dealinsec.test" });
  users.set("ben", { id: "ben", organizationId: "org-a", memberStatus: "active", orgRole: "SALES" });
  users.set("admin", { id: "admin", organizationId: "org-a", memberStatus: "active", orgRole: "ADMIN" });
  users.set("acct", { id: "acct", organizationId: "org-a", memberStatus: "active", orgRole: "ACCOUNTS" });
  users.set("zed", { id: "zed", organizationId: "org-b", memberStatus: "active", orgRole: "OWNER" });
});

/** A browser: its own cookie jar; follows nothing automatically. */
class Browser {
  cookie = "";
  async req(method: string, path: string, opts: { json?: unknown; headers?: Record<string, string>; raw?: string } = {}) {
    const headers: Record<string, string> = { ...(this.cookie ? { cookie: this.cookie } : {}), ...(opts.json !== undefined ? { "content-type": "application/json" } : {}), ...opts.headers };
    const res = await fetch(path.startsWith("http") ? path : base + path, { method, headers, body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.raw, redirect: "manual" });
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    return res;
  }
  async login(userId: string) { await this.req("POST", "/t/login", { json: { userId } }); return this; }
  async status(): Promise<GmailStatusView> { return (await this.req("GET", "/api/integrations/gmail")).json(); }
  /** Starts a connect; returns the callback URL the fake "Google" sends the browser back to. */
  async start(): Promise<string> {
    const r = await this.req("POST", "/api/integrations/gmail/connect", { json: {} });
    expect(r.status, await r.clone().text()).toBe(200);
    return (await r.json()).url;
  }
  /** Follows the callback URL; returns the outcome code it redirected to Settings with. */
  async callback(url: string): Promise<string> {
    const r = await this.req("GET", url.replace("localhost", "127.0.0.1"));
    expect(r.status).toBe(303);
    const loc = new URL(r.headers.get("location")!, base);
    expect(loc.pathname).toBe("/settings");
    expect([...loc.searchParams.keys()]).toEqual(["gmail"]);
    return loc.searchParams.get("gmail")!;
  }
}
const browser = async (user?: string) => { const b = new Browser(); if (user) await b.login(user); return b; };
const allLogged = () => JSON.stringify(logs) + JSON.stringify(audits);
const keyring = loadKeyring(KEYS);

describe("Gmail connect: the happy path", () => {
  it("connects: identity from the provider, token sealed to the row, status shows capabilities, audit records it, nothing is sent", async () => {
    const ana = await browser("ana");
    // the fake provider can complete a send (Milestone 2); the real Gmail adapter can't in this build (config.test.ts)
    expect(await ana.status()).toEqual({ available: true, sendingEnabled: true, canConnect: true, connection: null, replySync: { available: false, granted: false, state: "off", lastSyncedAt: null } });
    const url = await ana.start();
    expect(new URL(url).pathname).toBe("/api/integrations/gmail/callback");
    expect(await ana.callback(url)).toBe("connected");
    const s = await ana.status();
    expect(s.connection).toMatchObject({ status: "active", accountEmail: "ana@agency.test", capabilities: { identify: true, send: true, read: false }, problem: null });
    expect(s.sendingEnabled).toBe(true);
    const row = store.rows[0];
    expect(row).toMatchObject({ organizationId: "org-a", userId: "ana", accountSub: "g-sub-ana", status: "active" });
    expect(row.refreshTokenEnc).toMatch(/^mbt1\./);
    const token = decryptToken(row.refreshTokenEnc!, { organizationId: "org-a", userId: "ana", connectionId: row.id, provider: "fake" }, keyring);
    expect(fake.isLive(token)).toBe(true);
    expect(JSON.stringify(s)).not.toContain(token);
    expect(audits).toEqual([{ actor: "ana", org: "org-a", action: "connected Gmail", id: row.id, detail: "ana@agency.test" }]);
    expect(fake.outbox).toHaveLength(0);
    expect(fake.calls.map((c) => c.op)).toEqual(["exchange"]);
    // the pending record is gone from the session
    expect((await (await ana.req("GET", "/t/pending")).json()).pending).toBeNull();
    // nothing secret in logs or audit: tokens, codes, state, verifier
    const code = new URL(url).searchParams.get("code")!, state = new URL(url).searchParams.get("state")!;
    for (const secret of [token, code, state, KEYS.MAILBOX_TOKEN_KEYS.slice(2, 20)]) expect(allLogged()).not.toContain(secret);
  });

  it("reconnecting the same account after a problem restores it (login hint from the stored account, never the browser)", async () => {
    const ana = await browser("ana");
    await ana.callback(await ana.start());
    fake.revokeAllExternally();
    const v = await (await ana.req("POST", "/api/integrations/gmail/verify", { json: {} })).json();
    expect(v.result).toBe("needs_reconnect");
    expect(v.status.connection).toMatchObject({ status: "needs_reconnect", problem: { code: "revoked", message: expect.stringContaining("Reconnect") } });
    expect(store.rows[0].refreshTokenEnc).toBeNull(); // a dead token isn't kept
    const url = await ana.start();
    expect(await ana.callback(url)).toBe("reconnected");
    expect((await ana.status()).connection).toMatchObject({ status: "active", problem: null });
    expect(store.rows).toHaveLength(1);
  });
});

describe("Gmail connect: the state", () => {
  it("is single-use: replaying the callback (same browser) is refused and changes nothing", async () => {
    const ana = await browser("ana");
    const url = await ana.start();
    expect(await ana.callback(url)).toBe("connected");
    expect(await ana.callback(url)).toBe("invalid_request");
    expect(store.rows).toHaveLength(1);
    expect(fake.calls.filter((c) => c.op === "exchange")).toHaveLength(1);
  });

  it("is single-use even when two callbacks race before the session is saved", async () => {
    const ana = await browser("ana");
    const url = await ana.start();
    const outcomes = await Promise.all([ana.callback(url), ana.callback(url)]);
    expect(outcomes.sort()).toEqual(["connected", "invalid_request"]);
    expect(store.rows).toHaveLength(1);
  });

  it("two callbacks that both read the session before either saved it: the state still counts once (one exchange, one row)", async () => {
    await browser(); // the server's redirect URI needs the port
    const ana = users.get("ana")!;
    const started = await startConnect(ana, deps);
    if (!started.ok) throw new Error(started.code);
    const query = Object.fromEntries(new URL(started.url).searchParams);
    const used = new UsedStates();
    const both = await Promise.all([1, 2].map(() => completeConnect({ user: ana, pending: started.pending, query, used }, deps)));
    expect(both.map((r) => r.outcome).sort()).toEqual(["connected", "invalid_request"]);
    expect(fake.calls.filter((c) => c.op === "exchange")).toHaveLength(1);
    expect(store.rows).toHaveLength(1);
  });

  it("belongs to the session that started it: another browser, signed out, or another user can't use it", async () => {
    const ana = await browser("ana");
    const url = await ana.start();
    expect(await (await browser("ben")).callback(url)).toBe("invalid_request"); // other person's session
    expect(await (await browser()).callback(url)).toBe("invalid_request"); // signed out
    expect(await (await browser("zed")).callback(url)).toBe("invalid_request"); // other organization
    expect(store.rows).toHaveLength(0);
    expect(fake.calls).toHaveLength(0); // no code was exchanged
  });

  it("the same session, now signed in as someone else, can't finish it", async () => {
    const b = await browser("ana");
    const url = await b.start();
    await b.login("ben");
    expect(await b.callback(url)).toBe("invalid_request");
    expect(store.rows).toHaveLength(0);
  });

  it("refuses when the person moved organization since starting", async () => {
    const ana = await browser("ana");
    const url = await ana.start();
    users.set("ana", { ...users.get("ana")!, organizationId: "org-b" });
    expect(await ana.callback(url)).toBe("invalid_request");
    expect(store.rows).toHaveLength(0);
  });

  it("refuses a tampered or missing state, an expired one, and a missing code", async () => {
    const ana = await browser("ana");
    let url = new URL(await ana.start());
    url.searchParams.set("state", url.searchParams.get("state")!.slice(0, -2) + "xx");
    expect(await ana.callback(url.toString())).toBe("invalid_request");
    url = new URL(await ana.start());
    url.searchParams.delete("state");
    expect(await ana.callback(url.toString())).toBe("invalid_request");
    url = new URL(await ana.start());
    clock = new Date(clock.getTime() + 11 * 60_000);
    expect(await ana.callback(url.toString())).toBe("expired");
    url = new URL(await ana.start());
    url.searchParams.delete("code");
    expect(await ana.callback(url.toString())).toBe("invalid_request");
    expect(store.rows).toHaveLength(0);
  });

  it("a new connect replaces the pending one: only the latest state works", async () => {
    const ana = await browser("ana");
    const first = await ana.start();
    const second = await ana.start();
    expect(await ana.callback(first)).toBe("invalid_request");
    expect(await ana.callback(second)).toBe("invalid_request"); // the failed attempt consumed the pending record
    expect(await ana.callback(await ana.start())).toBe("connected");
  });

  it("the person cancelling at Google is 'denied'; other provider errors are 'failed'", async () => {
    const ana = await browser("ana");
    const u = new URL(await ana.start());
    u.searchParams.delete("code"); u.searchParams.set("error", "access_denied");
    expect(await ana.callback(u.toString())).toBe("denied");
    const v = new URL(await ana.start());
    v.searchParams.delete("code"); v.searchParams.set("error", "server_error");
    expect(await ana.callback(v.toString())).toBe("failed");
  });
});

describe("Gmail connect: what Google returned", () => {
  it("without the send scope: nothing stored, the new grant revoked", async () => {
    fake.setAccount({ sub: "g-sub-ana", email: "ana@agency.test", emailVerified: true }, ["openid", "email"]);
    const ana = await browser("ana");
    expect(await ana.callback(await ana.start())).toBe("missing_send_scope");
    expect(store.rows).toHaveLength(0);
    expect(fake.calls.map((c) => c.op)).toEqual(["exchange", "revoke"]);
  });

  it("with any mailbox-reading scope: refused and revoked (Release A never holds read access)", async () => {
    fake.setAccount({ sub: "g-sub-ana", email: "ana@agency.test", emailVerified: true }, ["openid", "email", GMAIL_SEND_SCOPE, "https://www.googleapis.com/auth/gmail.readonly"]);
    const ana = await browser("ana");
    expect(await ana.callback(await ana.start())).toBe("unexpected_scope");
    expect(store.rows).toHaveLength(0);
  });

  it("an unverified email is refused; a nonce mismatch (identity token not for this request) is identity_invalid", async () => {
    fake.setAccount({ sub: "g-sub-x", email: "x@agency.test", emailVerified: false });
    const ana = await browser("ana");
    expect(await ana.callback(await ana.start())).toBe("unverified_email");
    fake.setAccount({ sub: "g-sub-ana", email: "ana@agency.test", emailVerified: true });
    fake.failNext("exchange", "identity_invalid");
    expect(await ana.callback(await ana.start())).toBe("identity_invalid");
    expect(store.rows).toHaveLength(0);
  });

  it("identity mismatch: a different Google account while one is connected is refused; the connected one keeps working", async () => {
    const ana = await browser("ana");
    await ana.callback(await ana.start());
    const kept = store.rows[0].refreshTokenEnc;
    fake.setAccount({ sub: "g-sub-other", email: "other@agency.test", emailVerified: true });
    expect(await ana.callback(await ana.start())).toBe("identity_mismatch");
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ accountSub: "g-sub-ana", refreshTokenEnc: kept, status: "active" });
  });

  it("an account already connected (by a colleague, or in another organization) is refused without revoking the colleague's grant", async () => {
    const ana = await browser("ana");
    await ana.callback(await ana.start());
    const token = decryptToken(store.rows[0].refreshTokenEnc!, { organizationId: "org-a", userId: "ana", connectionId: store.rows[0].id, provider: "fake" }, keyring);
    const ben = await browser("ben"), zed = await browser("zed");
    expect(await ben.callback(await ben.start())).toBe("account_in_use");
    expect(await zed.callback(await zed.start())).toBe("account_in_use");
    expect(fake.isLive(token)).toBe(true);
    expect(fake.calls.filter((c) => c.op === "revoke")).toHaveLength(0);
    // the message names no person or organization
    expect(CONNECT_OUTCOMES.account_in_use).not.toMatch(/ana|org/i);
  });

  it("an exchange failure (provider down) is 'failed' and stores nothing", async () => {
    fake.failNext("exchange", "unavailable");
    const ana = await browser("ana");
    expect(await ana.callback(await ana.start())).toBe("failed");
    expect(store.rows).toHaveLength(0);
  });
});

describe("Gmail connect: who may, and isolation", () => {
  it("roles: a member who can't work on leads can't start; owners/admins see only their own mailbox", async () => {
    const acct = await browser("acct");
    expect((await acct.status()).canConnect).toBe(false);
    const r = await acct.req("POST", "/api/integrations/gmail/connect", { json: {} });
    expect(r.status).toBe(403);
    const ana = await browser("ana");
    await ana.callback(await ana.start());
    const admin = await browser("admin");
    expect((await admin.status()).connection).toBeNull(); // not Ana's
    expect((await (await browser("zed")).status()).connection).toBeNull();
  });

  it("ignores any user, organization, email or account the browser supplies", async () => {
    const ana = await browser("ana");
    await ana.callback(await ana.start());
    const admin = await browser("admin");
    // an admin trying to act on Ana's mailbox through the body or query only ever touches their own (none)
    const d = await admin.req("POST", "/api/integrations/gmail/disconnect?userId=ana&organizationId=org-a", { json: { userId: "ana", organizationId: "org-a", connectionId: store.rows[0].id, email: "ana@agency.test" } });
    expect(await d.json()).toMatchObject({ disconnected: 0 });
    const v = await admin.req("POST", "/api/integrations/gmail/verify", { json: { userId: "ana" } });
    expect((await v.json()).result).toBe("not_connected");
    expect(store.rows[0].status).toBe("active");
    // and a callback can't be pointed at another person by adding parameters
    const url = new URL(await admin.start());
    url.searchParams.set("userId", "ana");
    url.searchParams.set("email", "ana@agency.test");
    fake.setAccount({ sub: "g-sub-admin", email: "admin@agency.test", emailVerified: true });
    expect(await admin.callback(url.toString())).toBe("connected");
    expect(store.rows.find((r) => r.accountSub === "g-sub-admin")).toMatchObject({ userId: "admin", accountEmail: "admin@agency.test" });
  });

  it("there is no way to send: no route, and the provider's send is never called", async () => {
    const ana = await browser("ana");
    await ana.callback(await ana.start());
    for (const path of ["/api/integrations/gmail/send", "/api/integrations/gmail/messages"]) {
      expect((await ana.req("POST", path, { json: {} })).status).toBe(404);
    }
    expect(fake.calls.some((c) => c.op === "send")).toBe(false);
  });
});

describe("Gmail connect: CSRF and switches", () => {
  it("state-changing calls must be same-origin JSON", async () => {
    const ana = await browser("ana");
    const cross = await ana.req("POST", "/api/integrations/gmail/connect", { json: {}, headers: { "sec-fetch-site": "cross-site" } });
    expect(cross.status).toBe(403);
    const foreignOrigin = await ana.req("POST", "/api/integrations/gmail/disconnect", { json: {}, headers: { origin: "https://evil.example" } });
    expect(foreignOrigin.status).toBe(403);
    const form = await ana.req("POST", "/api/integrations/gmail/connect", { raw: "a=1", headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(form.status).toBe(415);
    const sameOrigin = await ana.req("POST", "/api/integrations/gmail/connect", { json: {}, headers: { "sec-fetch-site": "same-origin", origin: base } });
    expect(sameOrigin.status).toBe(200);
    expect((await ana.req("POST", "/api/integrations/gmail/connect", { json: {} , headers: {} })).status).toBe(200);
    const anon = await (await browser()).req("POST", "/api/integrations/gmail/connect", { json: {} });
    expect(anon.status).toBe(401);
  });

  it("switched off: unavailable to start or finish, and the card's status says so; an existing connection stays visible and disconnectable", async () => {
    const ana = await browser("ana");
    const url = await ana.start();
    enabled = false;
    expect(await ana.callback(url)).toBe("unavailable");
    expect((await ana.req("POST", "/api/integrations/gmail/connect", { json: {} })).status).toBe(503);
    expect(await ana.status()).toEqual({ available: false, sendingEnabled: false, canConnect: false, connection: null, replySync: { available: false, granted: false, state: "off", lastSyncedAt: null } });
    enabled = true;
    await ana.callback(await ana.start());
    enabled = false;
    expect((await ana.status()).connection).toMatchObject({ status: "active" });
    const d = await (await ana.req("POST", "/api/integrations/gmail/disconnect", { json: {} })).json();
    expect(d).toMatchObject({ disconnected: 1, revoked: true });
  });

  it("errors are plain sentences: nothing internal, no stack, no secrets", async () => {
    const ana = await browser("ana");
    store.save = async () => { throw new Error(`boom ${KEYS.MAILBOX_TOKEN_KEYS}`); };
    expect(await ana.callback(await ana.start())).toBe("failed");
    store.live = async () => { throw new Error("db exploded at /srv/app"); };
    const r = await ana.req("POST", "/api/integrations/gmail/connect", { json: {} });
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ code: "internal", error: "Something went wrong on our side." });
    expect(allLogged()).not.toContain(KEYS.MAILBOX_TOKEN_KEYS.slice(2, 20));
    expect(allLogged()).not.toContain("/srv/app");
    for (const msg of Object.values(CONNECT_OUTCOMES)) expect(msg).not.toMatch(/token|error:|exception|stack|\{|undefined/i);
  });

  it("rate-limits starting a connect", async () => {
    const ana = await browser("ana");
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await ana.req("POST", "/api/integrations/gmail/connect", { json: {} })).status);
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes[10]).toBe(429);
  });
});

describe("Gmail disconnect", () => {
  it("revokes at Google, deletes the credentials, keeps minimal audit metadata, frees the account", async () => {
    const ana = await browser("ana");
    await ana.callback(await ana.start());
    const id = store.rows[0].id;
    const token = decryptToken(store.rows[0].refreshTokenEnc!, { organizationId: "org-a", userId: "ana", connectionId: id, provider: "fake" }, keyring);
    const r = await (await ana.req("POST", "/api/integrations/gmail/disconnect", { json: {} })).json();
    expect(r).toMatchObject({ disconnected: 1, revoked: true, status: { connection: null } });
    expect(fake.isLive(token)).toBe(false);
    expect(store.rows[0]).toMatchObject({ id, status: "disconnected", refreshTokenEnc: null, tokenKeyVersion: null, accountEmail: "ana@agency.test", lastErrorCode: null });
    expect(store.rows[0].disconnectedAt).toEqual(clock);
    expect(audits.at(-1)).toEqual({ actor: "ana", org: "org-a", action: "disconnected Gmail", id, detail: "ana@agency.test" });
    // nothing left to disconnect; the account can be connected again
    expect(await (await ana.req("POST", "/api/integrations/gmail/disconnect", { json: {} })).json()).toMatchObject({ disconnected: 0, revoked: null });
    expect(await ana.callback(await ana.start())).toBe("connected");
  });

  it("when Google can't confirm the revoke, the credentials are still deleted and the person is told", async () => {
    const ana = await browser("ana");
    await ana.callback(await ana.start());
    fake.failNext("revoke", "unavailable");
    const r = await (await ana.req("POST", "/api/integrations/gmail/disconnect", { json: {} })).json();
    expect(r).toMatchObject({ disconnected: 1, revoked: false });
    expect(store.rows[0]).toMatchObject({ status: "disconnected", refreshTokenEnc: null, lastErrorCode: "revoke_failed" });
  });

  it("an unreadable stored token (key removed): check marks it for reconnecting and deletes it", async () => {
    const ana = await browser("ana");
    await ana.callback(await ana.start());
    store.rows[0].refreshTokenEnc = store.rows[0].refreshTokenEnc!.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
    const v = await (await ana.req("POST", "/api/integrations/gmail/verify", { json: {} })).json();
    expect(v.result).toBe("needs_reconnect");
    expect(v.status.connection.problem.code).toBe("token_unreadable");
    expect(store.rows[0].refreshTokenEnc).toBeNull();
  });

  it("check: a temporary Google failure changes nothing; a healthy connection stays healthy", async () => {
    const ana = await browser("ana");
    await ana.callback(await ana.start());
    fake.failNext("refresh", "unavailable");
    expect((await (await ana.req("POST", "/api/integrations/gmail/verify", { json: {} })).json()).result).toBe("temporarily_unavailable");
    expect(store.rows[0].status).toBe("active");
    expect((await (await ana.req("POST", "/api/integrations/gmail/verify", { json: {} })).json()).result).toBe("ok");
  });
});

describe("member removal", () => {
  it("disconnects and revokes the removed member's mailbox (recorded as the admin's action); colleagues and other orgs untouched", async () => {
    const ana = await browser("ana");
    await ana.callback(await ana.start());
    const anaToken = decryptToken(store.rows[0].refreshTokenEnc!, { organizationId: "org-a", userId: "ana", connectionId: store.rows[0].id, provider: "fake" }, keyring);
    fake.setAccount({ sub: "g-sub-ben", email: "ben@agency.test", emailVerified: true });
    const ben = await browser("ben");
    await ben.callback(await ben.start());
    fake.setAccount({ sub: "g-sub-zed", email: "zed@other.test", emailVerified: true });
    const zed = await browser("zed");
    await zed.callback(await zed.start());

    // what the team route does after marking Ana removed
    users.set("ana", { ...users.get("ana")!, memberStatus: "removed" });
    const r = await disconnectMailboxes({ actor: users.get("admin")!, orgId: "org-a", userId: "ana", reason: "member_removed" }, deps);
    expect(r).toEqual({ disconnected: 1, revoked: true });
    expect(fake.isLive(anaToken)).toBe(false);
    expect(store.rows.find((x) => x.userId === "ana")).toMatchObject({ status: "disconnected", refreshTokenEnc: null });
    expect(store.rows.find((x) => x.userId === "ben")).toMatchObject({ status: "active" });
    expect(store.rows.find((x) => x.userId === "zed")).toMatchObject({ status: "active" });
    expect(audits.at(-1)).toMatchObject({ actor: "admin", org: "org-a", action: "disconnected Gmail (member removed)" });
    // the admin did not gain anything: their own status shows no mailbox
    expect((await (await browser("admin")).status()).connection).toBeNull();
    // and the removed member's session is dead
    expect((await ana.req("GET", "/api/integrations/gmail")).status).toBe(401);
  });

  it("removal in one organization can't touch another organization's member with the same id", async () => {
    const zed = await browser("zed");
    await zed.callback(await zed.start());
    expect(await disconnectMailboxes({ actor: users.get("admin")!, orgId: "org-a", userId: "zed", reason: "member_removed" }, deps)).toEqual({ disconnected: 0, revoked: null });
    expect(store.rows[0].status).toBe("active");
  });

  it("still deletes credentials when the integration is switched off (revoking with the provider if it's configured)", async () => {
    const ana = await browser("ana");
    await ana.callback(await ana.start());
    enabled = false;
    expect(await disconnectMailboxes({ actor: users.get("admin")!, orgId: "org-a", userId: "ana", reason: "member_removed" }, deps)).toEqual({ disconnected: 1, revoked: true });
    expect(store.rows[0].refreshTokenEnc).toBeNull();
    // and with no keys or provider at all, the credentials are still deleted (revoke not possible)
    enabled = true;
    await ana.login("ana");
    users.set("ana", { ...users.get("ana")!, memberStatus: "active" });
    await ana.callback(await ana.start());
    enabled = false;
    const blind = await disconnectMailboxes({ actor: users.get("admin")!, orgId: "org-a", userId: "ana", reason: "member_removed" }, { ...deps, cleanup: () => ({ keyring: null, provider: null }) });
    expect(blind).toEqual({ disconnected: 1, revoked: false });
    expect(store.rows.every((x) => x.refreshTokenEnc === null)).toBe(true);
  });
});

describe("switched on for some organizations only (GMAIL_ALLOWED_ORG_IDS)", () => {
  it("a listed organization sees and uses it; any other sees it as off and can't start or finish a connect", async () => {
    allowedOrgs = "org-a";
    const ana = await browser("ana"), zed = await browser("zed");
    expect((await ana.status()).available).toBe(true);
    expect(await zed.status()).toEqual({ available: false, sendingEnabled: false, canConnect: false, connection: null, replySync: { available: false, granted: false, state: "off", lastSyncedAt: null } });
    expect((await zed.req("POST", "/api/integrations/gmail/connect", { json: {} })).status).toBe(503);
    expect((await (await zed.req("POST", "/api/integrations/gmail/verify", { json: {} })).json()).result).toBe("temporarily_unavailable");
    // a connect started while org-b was listed, finished after it was taken off the list: refused
    allowedOrgs = "org-a,org-b";
    const url = await zed.start();
    allowedOrgs = "org-a";
    expect(await zed.callback(url)).toBe("unavailable");
    expect(store.rows).toHaveLength(0);
    expect(await ana.callback(await ana.start())).toBe("connected");
  });

  it("taken off the list after connecting: the connection is still shown and can always be disconnected (credentials removed)", async () => {
    const ana = await browser("ana");
    expect(await ana.callback(await ana.start())).toBe("connected");
    allowedOrgs = "org-b";
    const s = await ana.status();
    expect(s).toMatchObject({ available: false, canConnect: false, connection: { status: "active" } });
    expect(await (await ana.req("POST", "/api/integrations/gmail/disconnect", { json: {} })).json()).toMatchObject({ disconnected: 1, revoked: true });
    expect(store.rows[0]).toMatchObject({ status: "disconnected", refreshTokenEnc: null });
  });
});

describe("the same-origin check behind a proxy", () => {
  it("accepts the public host the proxy forwards (X-Forwarded-Host), and still refuses any other origin", async () => {
    const ana = await browser("ana");
    const forwarded = { origin: "https://www.dealinsec.com", "x-forwarded-host": "www.dealinsec.com", "sec-fetch-site": "same-origin" };
    expect((await ana.req("POST", "/api/integrations/gmail/connect", { json: {}, headers: forwarded })).status).toBe(200);
    expect((await ana.req("POST", "/api/integrations/gmail/connect", { json: {}, headers: { ...forwarded, origin: "https://evil.example" } })).status).toBe(403);
    expect((await ana.req("POST", "/api/integrations/gmail/connect", { json: {}, headers: { origin: "https://www.dealinsec.com" } })).status).toBe(403); // no forwarded host: compared with Host
  });
});
