/**
 * Test fixture (no test cases here): an organization with members, a lead, an approved message and a connected fake
 * mailbox, wired into SendDeps. Used by gmail-send.test.ts. Nothing reaches a database or the network.
 */
import { createHash, randomBytes } from "node:crypto";
import { hashDraft } from "@shared/outreach-hash";
import { resolveGmailConfig, type GmailStatus } from "./config";
import type { Member } from "./connect-service";
import { FakeMailProvider } from "./fake-provider";
import { MemoryMailboxStore } from "./memory-store";
import { RELEASE_A_SCOPES } from "./provider";
import { MemorySendWorld, type MemMessage } from "./send-memory";
import type { SendDeps } from "./send-service";
import { decryptToken, loadKeyring } from "./token-crypto";

export const KEYS = { MAILBOX_TOKEN_KEYS: `1:${randomBytes(32).toString("base64")}`, MAILBOX_TOKEN_KEY_CURRENT: "1" };
export const SUBJECT = "A quick idea for Acme's spring menu";
export const BODY = "Hi Jo,\n\nI saw Acme opened a second kitchen in Porto. We help small restaurant groups plan seasonal menus.\n\nWould a short call next week help?\n\nAna";

export function makeWorld(opts: { env?: Record<string, string | undefined> } = {}) {
  const mailbox = new MemoryMailboxStore();
  const world = new MemorySendWorld(mailbox);
  const fake = new FakeMailProvider({ account: { sub: "g-ana", email: "ana@agency.test", emailVerified: true } });
  let clock = new Date("2026-10-14T12:00:00Z");
  const env: Record<string, string | undefined> = { GMAIL_INTEGRATION_ENABLED: "true", MAIL_PROVIDER: "fake", NODE_ENV: "test", GMAIL_OAUTH_REDIRECT_URI: "http://localhost:5072/api/integrations/gmail/callback", ...KEYS, ...opts.env };
  const keyring = loadKeyring(KEYS);
  const logs: { event: string; fields: Record<string, unknown> }[] = [];
  const leadEvents: { orgId: string; leadId: number; kind: string; data: Record<string, unknown>; actor: string }[] = [];
  const afterSent: { actor: string; leadId: number; messageId: number; via: string }[] = [];
  const sleeps: number[] = [];
  const members: Record<string, Member> = {
    ana: { id: "ana", organizationId: "org-a", memberStatus: "active", orgRole: "SALES", firstName: "Ana", lastName: "Silva" },
    ben: { id: "ben", organizationId: "org-a", memberStatus: "active", orgRole: "SALES" },
    admin: { id: "admin", organizationId: "org-a", memberStatus: "active", orgRole: "ADMIN" },
    acct: { id: "acct", organizationId: "org-a", memberStatus: "active", orgRole: "ACCOUNTS" },
    zed: { id: "zed", organizationId: "org-b", memberStatus: "active", orgRole: "OWNER" },
  };
  for (const m of Object.values(members)) world.users.set(m.id, { id: m.id, organizationId: m.organizationId, memberStatus: m.memberStatus ?? "active", orgRole: m.orgRole ?? "SALES" });

  const deps: SendDeps = {
    status: async () => resolveGmailConfig(env) as GmailStatus,
    provider: () => fake,
    mailbox,
    get sends() { return world; },
    now: () => clock,
    sleep: async (ms) => { sleeps.push(ms); },
    random: () => 0.5,
    listReady: async () => true,
    afterSent: async (actor, info) => { afterSent.push({ actor: actor.id, ...info }); },
    leadEvent: async (orgId, leadId, kind, data, actor) => { leadEvents.push({ orgId, leadId, kind, data, actor }); },
    isActiveMember: async (orgId, userId) => { const u = world.users.get(userId); return !!u && u.organizationId === orgId && u.memberStatus !== "removed"; },
    log: (event, fields = {}) => logs.push({ event, fields }),
  };

  let leadSeq = 0, msgSeq = 0;
  /** A lead with one approved message. */
  function approved(o: { org?: string; to?: string; subject?: string; body?: string } = {}): MemMessage {
    const org = o.org ?? "org-a";
    const leadId = ++leadSeq;
    world.leads.set(leadId, { id: leadId, organizationId: org, doNotContact: false });
    const subject = o.subject ?? SUBJECT, body = o.body ?? BODY;
    const m: MemMessage = { id: ++msgSeq, organizationId: org, leadId, direction: "out", status: "approved", subject, body, bodyHash: hashDraft(subject, body), toAddress: o.to ?? `jo${leadId}@acme-foods.test`, sentAt: null, updatedAt: clock };
    world.messages.set(m.id, m);
    return m;
  }
  /** Connects `who`'s mailbox through the fake's real OAuth steps (so its refresh token is live there). */
  async function connect(who: string, account = { sub: `g-${who}`, email: `${who}@agency.test`, emailVerified: true }, scopes?: string[]) {
    const u = members[who];
    fake.setAccount(account, scopes ?? [...RELEASE_A_SCOPES]);
    const verifier = "v".repeat(50);
    const url = fake.authorizationUrl({ state: "s", codeChallenge: createHash("sha256").update(verifier).digest("base64url"), nonce: "n", redirectUri: env.GMAIL_OAUTH_REDIRECT_URI! });
    const grant = await fake.exchangeCode({ code: new URL(url).searchParams.get("code")!, codeVerifier: verifier, redirectUri: env.GMAIL_OAUTH_REDIRECT_URI!, nonce: "n" });
    const r = await mailbox.save({ orgId: u.organizationId!, userId: who, provider: "fake", account: { sub: account.sub, email: account.email }, scopes: grant.scopes, refreshToken: grant.refreshToken, keyring, now: clock });
    if (!r.ok) throw new Error(r.code);
    return r.connection;
  }
  const tokenOf = (who: string) => {
    const row = mailbox.rows.find((r) => r.userId === who && r.refreshTokenEnc)!;
    return decryptToken(row.refreshTokenEnc!, { organizationId: row.organizationId, userId: who, connectionId: row.id, provider: "fake" }, keyring);
  };
  return {
    world, mailbox, fake, deps, env, logs, leadEvents, afterSent, sleeps, members, approved, connect, tokenOf,
    get clock() { return clock; },
    tick(ms: number) { clock = new Date(clock.getTime() + ms); },
  };
}
