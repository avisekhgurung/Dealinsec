import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createMailProvider, DEFAULT_SEND_DAILY_CAP, GMAIL_SENDING_ENABLED, gmailIntegrationGate, MAX_SEND_DAILY_CAP, parseDailyCap, resolveGmailConfig, sendingAvailability } from "./config";
import { FakeMailProvider } from "./fake-provider";
import { GmailProvider } from "./gmail-provider";
import { MAILBOX_TABLES, type Exec } from "./mailbox-schema";

const KEYS = { MAILBOX_TOKEN_KEYS: `1:${randomBytes(32).toString("base64")}`, MAILBOX_TOKEN_KEY_CURRENT: "1" };
const GMAIL = { GMAIL_OAUTH_CLIENT_ID: "123-abc.apps.googleusercontent.com", GMAIL_OAUTH_CLIENT_SECRET: "s3cret", GMAIL_OAUTH_REDIRECT_URI: "https://www.dealinsec.com/api/integrations/gmail/callback" };
const FAKE_ON = { GMAIL_INTEGRATION_ENABLED: "true", MAIL_PROVIDER: "fake", NODE_ENV: "development", GMAIL_OAUTH_REDIRECT_URI: "http://localhost:5072/api/integrations/gmail/callback", ...KEYS };

/** A catalog that has (or lacks) the mailbox tables, answering the queries mailboxSchemaPresent makes. */
function catalog(present: boolean, calls = { n: 0 }): Exec {
  return async (text, params) => {
    calls.n++;
    const name = String(params?.[0] ?? "");
    const t = MAILBOX_TABLES.find((x) => x.name === name);
    if (text.includes("FROM pg_class c WHERE c.oid = to_regclass")) return { rows: present && t ? [{ oid: MAILBOX_TABLES.indexOf(t) + 1, relkind: "r" }] : [] };
    const spec = MAILBOX_TABLES[Number(params?.[0]) - 1];
    if (text.includes("FROM pg_attribute")) return { rows: spec.columns.map(([c]) => ({ name: c, type: "x", notNull: false, default: null })) };
    if (text.includes("FROM pg_constraint")) return { rows: spec.checks.map(([c]) => ({ name: c, type: "c", def: "x" })) };
    if (text.includes("FROM pg_index")) return { rows: spec.indexes.map((i) => ({ name: i.name, unique: false, primary: false, method: "btree", predicate: null, columns: [] })) };
    throw new Error(`unexpected query: ${text}`);
  };
}

describe("Gmail integration switch", () => {
  it("is off by default and for every falsy spelling; an unrecognised value is a misconfiguration, still off", () => {
    expect(resolveGmailConfig({})).toEqual({ enabled: false, reason: "disabled" });
    for (const v of ["", "false", "0", " FALSE "]) expect(resolveGmailConfig({ GMAIL_INTEGRATION_ENABLED: v, ...KEYS, ...GMAIL })).toEqual({ enabled: false, reason: "disabled" });
    expect(resolveGmailConfig({ GMAIL_INTEGRATION_ENABLED: "yes", ...KEYS, ...GMAIL })).toMatchObject({ enabled: false, reason: "misconfigured" });
  });

  it("stays off when it is switched on but keys or Google settings are missing or wrong", () => {
    const on = { GMAIL_INTEGRATION_ENABLED: "true" };
    const r = resolveGmailConfig({ ...on, ...GMAIL });
    expect(r).toMatchObject({ enabled: false, reason: "misconfigured" });
    expect((r as any).problems.join(" ")).toMatch(/MAILBOX_TOKEN_KEYS is not set/);
    expect(resolveGmailConfig({ ...on, ...KEYS })).toMatchObject({ enabled: false, reason: "misconfigured" });
    for (const [k, v] of [
      ["GMAIL_OAUTH_CLIENT_ID", "not-a-google-client"],
      ["GMAIL_OAUTH_CLIENT_SECRET", ""],
      ["GMAIL_OAUTH_REDIRECT_URI", "http://www.dealinsec.com/api/integrations/gmail/callback"], // not https
      ["GMAIL_OAUTH_REDIRECT_URI", "https://www.dealinsec.com/api/auth/google/callback"], // the sign-in callback
      ["GMAIL_OAUTH_REDIRECT_URI", "https://www.dealinsec.com/api/integrations/gmail/callback?next=/x"],
      ["GMAIL_OAUTH_REDIRECT_URI", "not a url"],
    ]) expect(resolveGmailConfig({ ...on, ...KEYS, ...GMAIL, [k]: v }), `${k}=${v}`).toMatchObject({ enabled: false, reason: "misconfigured" });
    expect(resolveGmailConfig({ ...on, ...KEYS, ...GMAIL, GMAIL_OAUTH_REDIRECT_URI: "http://localhost:5072/api/integrations/gmail/callback", NODE_ENV: "production" })).toMatchObject({ enabled: false, reason: "misconfigured" });
    expect(resolveGmailConfig({ ...on, ...KEYS, ...GMAIL, MAIL_PROVIDER: "outlook" })).toMatchObject({ enabled: false, reason: "misconfigured" });
    const ok = resolveGmailConfig({ ...on, ...KEYS, ...GMAIL });
    expect(ok).toMatchObject({ enabled: true, config: { provider: "gmail", redirectUri: GMAIL.GMAIL_OAUTH_REDIRECT_URI } });
    expect(resolveGmailConfig({ ...on, ...KEYS, ...GMAIL, GMAIL_OAUTH_REDIRECT_URI: "http://localhost:5072/api/integrations/gmail/callback" })).toMatchObject({ enabled: true });
  });

  it("refuses the fake provider in production, both in config and when building it", () => {
    const prod = resolveGmailConfig({ ...FAKE_ON, NODE_ENV: "production", GMAIL_OAUTH_REDIRECT_URI: "https://www.dealinsec.com/api/integrations/gmail/callback" });
    expect(prod).toEqual({ enabled: false, reason: "misconfigured", problems: ["MAIL_PROVIDER=fake is not allowed in production"] });
    const r = resolveGmailConfig(FAKE_ON);
    if (!r.enabled) throw new Error("expected enabled");
    expect(createMailProvider(r.config, { NODE_ENV: "development" })).toBeInstanceOf(FakeMailProvider);
    expect(() => createMailProvider(r.config, { NODE_ENV: "production" })).toThrow(/not allowed in production/);
  });

  it("the gate: a correct gmail config is on once migrated, and builds the Gmail adapter (one per process); sending stays off", async () => {
    const gate = gmailIntegrationGate(() => catalog(true), { env: { GMAIL_INTEGRATION_ENABLED: "true", ...KEYS, ...GMAIL } });
    const s = await gate();
    if (!s.enabled) throw new Error(`expected enabled, got ${s.reason}`);
    expect(s.config).toMatchObject({ provider: "gmail", redirectUri: GMAIL.GMAIL_OAUTH_REDIRECT_URI, oauth: { clientId: GMAIL.GMAIL_OAUTH_CLIENT_ID } });
    const p = createMailProvider(s.config);
    expect(p).toBeInstanceOf(GmailProvider);
    expect(createMailProvider(s.config)).toBe(p);
    expect(GMAIL_SENDING_ENABLED).toBe(false);
    expect(() => createMailProvider({ ...s.config, oauth: null })).toThrow(/OAuth settings/);
  });

  it("sending: never through the real Gmail adapter in this build; the fake only outside production; an invalid cap stops it", () => {
    const gmail = resolveGmailConfig({ GMAIL_INTEGRATION_ENABLED: "true", ...KEYS, ...GMAIL });
    if (!gmail.enabled) throw new Error("expected enabled");
    expect(sendingAvailability(gmail.config)).toEqual({ ok: false, reason: "sending_disabled" });
    expect(sendingAvailability(gmail.config, { NODE_ENV: "development", GMAIL_SENDING_ENABLED: "true", MAIL_FAKE_SEND: "true" } as any)).toEqual({ ok: false, reason: "sending_disabled" });
    const fake = resolveGmailConfig(FAKE_ON);
    if (!fake.enabled) throw new Error("expected enabled");
    expect(sendingAvailability(fake.config, { NODE_ENV: "development" })).toEqual({ ok: true, cap: DEFAULT_SEND_DAILY_CAP });
    expect(sendingAvailability(fake.config, { NODE_ENV: "production" })).toEqual({ ok: false, reason: "sending_disabled" });
    for (const bad of ["0", "-1", "abc", "1.5", "2001", "1e3", " 10x"]) {
      const c = resolveGmailConfig({ ...FAKE_ON, MAIL_SEND_DAILY_CAP: bad });
      if (!c.enabled) throw new Error("the cap must not switch connecting off");
      expect(c.config.sendDailyCap, bad).toBeNull();
      expect(sendingAvailability(c.config, { NODE_ENV: "development" })).toEqual({ ok: false, reason: "cap_invalid" });
    }
    expect(parseDailyCap("25")).toBe(25);
    expect(parseDailyCap(undefined)).toBe(DEFAULT_SEND_DAILY_CAP);
    expect(parseDailyCap(String(MAX_SEND_DAILY_CAP))).toBe(MAX_SEND_DAILY_CAP);
  });

  it("the fake provider needs a valid redirect URI too", () => {
    const { GMAIL_OAUTH_REDIRECT_URI: _r, ...noRedirect } = FAKE_ON;
    expect(resolveGmailConfig(noRedirect)).toMatchObject({ enabled: false, reason: "misconfigured" });
    expect(resolveGmailConfig({ ...FAKE_ON, GMAIL_OAUTH_REDIRECT_URI: "http://evil.test/api/integrations/gmail/callback" })).toMatchObject({ enabled: false, reason: "misconfigured" });
  });

  it("the gate: off without the migrated tables (rechecked, not cached), on once they exist (then cached); a failing check stays off", async () => {
    let present = false;
    const calls = { n: 0 };
    const gate = gmailIntegrationGate(() => (t, p) => catalog(present, calls)(t, p), { env: FAKE_ON, recheckMs: 0 });
    const off = await gate();
    expect(off).toMatchObject({ enabled: false, reason: "not_migrated" });
    expect((off as any).missing).toEqual(["mailbox_connections", "mail_send_jobs"]);
    present = true;
    expect(await gate()).toMatchObject({ enabled: true, config: { provider: "fake" } });
    const n = calls.n;
    expect(await gate()).toMatchObject({ enabled: true });
    expect(calls.n).toBe(n); // cached
    const broken = gmailIntegrationGate(() => async () => { throw new Error("db down"); }, { env: FAKE_ON, recheckMs: 0 });
    expect(await broken()).toMatchObject({ enabled: false, reason: "not_migrated" });
    // switched off: never even looks at the database
    const offExec = vi.fn(catalog(true));
    expect(await gmailIntegrationGate(() => offExec, { env: {} })()).toEqual({ enabled: false, reason: "disabled" });
    expect(offExec).not.toHaveBeenCalled();
  });

  it("the gate: a table missing one column, check or index is not migrated", async () => {
    const partial: Exec = async (t, p) => {
      const r = await catalog(true)(t, p);
      if (t.includes("FROM pg_index")) return { rows: r.rows.filter((x: any) => x.name !== "mail_send_jobs_message_uq") };
      return r;
    };
    const s = await gmailIntegrationGate(() => partial, { env: FAKE_ON })();
    expect(s).toMatchObject({ enabled: false, reason: "not_migrated", missing: ["mail_send_jobs_message_uq"] });
  });
});
