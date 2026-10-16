/**
 * Connecting with reply sync on (Release B): read access is asked for only then, accepted only when asked for, and a
 * person who unticks it still connects for sending. Disconnecting deletes what was synced. Service level, no HTTP
 * (the HTTP flow is gmail-connect.test.ts).
 */
import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { connectDisclosure } from "@shared/gmail-connect";
import { resolveGmailConfig, type GmailStatus } from "./config";
import { completeConnect, disconnectMailboxes, startConnect, statusFor, UsedStates, type MailServiceDeps, type Member } from "./connect-service";
import { FakeMailProvider } from "./fake-provider";
import { MemoryMailboxStore } from "./memory-store";
import { GMAIL_READONLY_SCOPE, GMAIL_SEND_SCOPE, RELEASE_A_SCOPES } from "./provider";
import { loadKeyring } from "./token-crypto";

const KEYS = { MAILBOX_TOKEN_KEYS: `1:${randomBytes(32).toString("base64")}`, MAILBOX_TOKEN_KEY_CURRENT: "1" };
const ana: Member = { id: "ana", organizationId: "org-a", memberStatus: "active", orgRole: "SALES" };

let fake: FakeMailProvider;
let store: MemoryMailboxStore;
let syncOn: boolean;
let purged: [string, number][];
let syncRow: { state: string; lastSuccessAt: Date | null; bootstrappedAt: Date | null } | null;
const clock = new Date("2026-10-15T12:00:00Z");
const deps: MailServiceDeps = {
  status: async () => resolveGmailConfig({ GMAIL_INTEGRATION_ENABLED: "true", MAIL_PROVIDER: "fake", NODE_ENV: "test", GMAIL_OAUTH_REDIRECT_URI: "http://localhost:5072/api/integrations/gmail/callback", ...KEYS }) as GmailStatus,
  provider: () => fake,
  get store() { return store; },
  now: () => clock,
  cleanup: () => ({ keyring: loadKeyring(KEYS), provider: fake }),
  audit: () => {},
  log: () => {},
  replySync: async () => syncOn,
  syncState: async () => syncRow,
  purgeSynced: async (orgId, id) => { purged.push([orgId, id]); return 3; },
};

async function connect(granted?: string[]) {
  if (granted) fake.setAccount({ sub: "g-ana", email: "ana@agency.test", emailVerified: true }, granted);
  const s = await startConnect(ana, deps);
  if (!s.ok) throw new Error(s.code);
  const q = Object.fromEntries(new URL(FakeMailProvider.consentRedirect(fakeAuthorizeUrl(s.url))).searchParams);
  return { start: s, done: await completeConnect({ user: ana, pending: s.pending, query: q, used: new UsedStates() }, deps) };
}
/** startConnect already turned the fake's URL into the callback URL; rebuild the consent URL from it for the helper. */
function fakeAuthorizeUrl(callbackUrl: string) {
  const u = new URL(callbackUrl);
  const a = new URL("https://fake-mail-provider.invalid/authorize");
  a.search = new URLSearchParams({ code: u.searchParams.get("code")!, state: u.searchParams.get("state")!, redirect_uri: `${u.origin}${u.pathname}` }).toString();
  return a.toString();
}

beforeEach(() => {
  fake = new FakeMailProvider({ account: { sub: "g-ana", email: "ana@agency.test", emailVerified: true }, now: () => clock });
  store = new MemoryMailboxStore();
  syncOn = true; purged = []; syncRow = null;
});

describe("connecting with reply sync", () => {
  it("asks for read access only while reply sync is on for the organization", async () => {
    const on = await connect();
    expect(on.start.ok && on.start.pending.replySync).toBe(true);
    expect(on.done.outcome).toBe("connected");
    expect(store.rows[0].scopes).toContain(GMAIL_READONLY_SCOPE);

    syncOn = false; store = new MemoryMailboxStore(); fake = new FakeMailProvider({ account: { sub: "g-ana", email: "ana@agency.test", emailVerified: true }, now: () => clock });
    const off = await connect();
    expect(off.start.ok && off.start.pending.replySync).toBe(false);
    expect(store.rows[0].scopes).not.toContain(GMAIL_READONLY_SCOPE);
  });

  it("read access granted without being asked for is refused, as before", async () => {
    syncOn = false;
    expect((await connect([...RELEASE_A_SCOPES, GMAIL_READONLY_SCOPE])).done.outcome).toBe("unexpected_scope");
    expect(store.rows).toEqual([]);
  });

  it("anything that could change or delete mail is refused even with reply sync on", async () => {
    for (const extra of ["https://www.googleapis.com/auth/gmail.modify", "https://mail.google.com/"]) {
      store = new MemoryMailboxStore();
      expect((await connect([...RELEASE_A_SCOPES, GMAIL_READONLY_SCOPE, extra])).done.outcome).toBe("unexpected_scope");
      expect(store.rows).toEqual([]);
    }
  });

  it("unticking \"read\" still connects for sending; Settings then offers to allow it", async () => {
    expect((await connect(["openid", "email", GMAIL_SEND_SCOPE])).done.outcome).toBe("connected");
    const s = await statusFor(ana, deps);
    expect(s.connection!.capabilities).toEqual({ identify: true, send: true, read: false });
    expect(s.replySync).toEqual({ available: true, granted: false, state: "needs_permission", lastSyncedAt: null });
  });

  it("Settings shows the sync's own state once reading is allowed", async () => {
    await connect();
    expect((await statusFor(ana, deps)).replySync.state).toBe("starting");
    syncRow = { state: "ok", lastSuccessAt: clock, bootstrappedAt: clock };
    expect((await statusFor(ana, deps)).replySync).toEqual({ available: true, granted: true, state: "ok", lastSyncedAt: clock.toISOString() });
    syncRow = { state: "retrying", lastSuccessAt: clock, bootstrappedAt: clock };
    expect((await statusFor(ana, deps)).replySync.state).toBe("retrying");
    syncOn = false;
    expect((await statusFor(ana, deps)).replySync.state).toBe("off");
  });

  it("disconnecting deletes everything synced from that mailbox", async () => {
    await connect();
    const id = store.rows[0].id;
    await disconnectMailboxes({ actor: ana, orgId: "org-a", userId: "ana", reason: "user" }, deps);
    expect(purged).toEqual([["org-a", id]]);
  });

  it("the consent text says what reading is for and what is kept, only when reading is asked for", () => {
    expect(connectDisclosure(false).join(" ")).toContain("can't read, change or delete");
    const withSync = connectDisclosure(true).join(" ");
    expect(withSync).toContain("read your mail");
    expect(withSync).toContain("only to find replies to your outreach");
    expect(withSync).toContain("every synced message");
  });
});
