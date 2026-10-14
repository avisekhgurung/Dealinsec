/**
 * Connecting and disconnecting a person's own mailbox (Gmail Release A, Milestone 1). Everything is injected
 * (gate, provider, store, clock, audit, log), so the whole flow runs in tests against FakeMailProvider and the
 * in-memory store, and the routes only translate HTTP.
 *
 * Rules held here:
 *  - The person and organization come from the signed-in session only. The browser supplies nothing but the OAuth
 *    `code` and `state`, and the state must match a single-use, unexpired record kept in that same session, for the
 *    same person in the same organization.
 *  - The Google account comes only from the validated identity token (verified email required); the scopes only
 *    from Google's token response. Without the send scope, or with any scope that reaches the mailbox, nothing is
 *    stored and the new grant is revoked.
 *  - A connection is the person's own: nobody else can disconnect it here, and nothing in this module sends.
 *  - A grant is revoked only when no live connection uses that account (revoking a Google grant ends every token
 *    the account gave DealInSec, so revoking a duplicate would cut off the connection that is in use).
 *  - Logs and audit entries carry codes and ids, never tokens, codes, secrets or provider responses.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { canReadModule, memberCan } from "@shared/permissions";
import { problemMessage, type ConnectOutcome, type GmailStatusView, type VerifyResult } from "@shared/gmail-connect";
import { sendingAvailability, type GmailConfig, type GmailStatus } from "./config";
import { FakeMailProvider } from "./fake-provider";
import type { ConnectionView, MailboxStore } from "./mailbox-store";
import { capabilitiesOf, MailProviderError, type MailProvider, type TokenGrant } from "./provider";
import type { Keyring } from "./token-crypto";

/** The signed-in person, as the auth middleware loaded them. */
export interface Member {
  id: string;
  organizationId: string | null;
  memberStatus?: string | null;
  orgRole?: string | null;
  customPermissions?: string[] | null;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

/** Kept in the server-side session between "connect" and Google's callback. Holds no token. */
export interface PendingConnect {
  stateHash: string;
  verifier: string;
  nonce: string;
  userId: string;
  orgId: string;
  provider: "gmail" | "fake";
  expiresAt: number;
}

export interface MailServiceDeps {
  status(): Promise<GmailStatus>;
  provider(config: GmailConfig): MailProvider;
  store: MailboxStore;
  now(): Date;
  /** For cleanup when the integration is switched off: the keyring and a provider to revoke with, if configured. */
  cleanup(): { keyring: Keyring | null; provider: MailProvider | null };
  audit(actor: Member, action: string, connectionId: number, detail: string): void;
  log(event: string, fields?: Record<string, string | number | boolean | null>): void;
}

export const PENDING_TTL_MS = 10 * 60_000;
const sha256 = (s: string) => createHash("sha256").update(s).digest("base64url");
const sameHash = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/** May this person connect a mailbox? An active member whose role lets them work on leads. */
export function mayConnect(u: Member | null | undefined): u is Member & { organizationId: string } {
  return !!u && !!u.organizationId && u.memberStatus !== "removed" && canReadModule(u as any, "deals") && memberCan(u as any, "deals.create");
}

/**
 * States already used, so a callback replayed before its session is saved still counts once. Per process; the
 * session record (deleted on first use) is the durable guard.
 */
export class UsedStates {
  private used = new Map<string, number>();
  claim(hash: string, nowMs: number): boolean {
    if (this.used.size > 5_000) this.used.forEach((exp, h) => { if (exp < nowMs) this.used.delete(h); });
    if (this.used.has(hash)) return false;
    this.used.set(hash, nowMs + PENDING_TTL_MS);
    return true;
  }
}

function toView(c: ConnectionView | null): GmailStatusView["connection"] {
  if (!c) return null;
  const caps = capabilitiesOf(c.scopes);
  return {
    status: c.status === "active" ? "active" : "needs_reconnect",
    accountEmail: c.accountEmail,
    capabilities: { identify: caps.identify, send: caps.send },
    connectedAt: c.connectedAt.toISOString(),
    problem: c.status === "needs_reconnect" ? { code: c.lastErrorCode ?? "reconnect_required", message: problemMessage(c.lastErrorCode)!, at: c.lastErrorAt?.toISOString() ?? null } : null,
  };
}

export async function statusFor(user: Member, deps: MailServiceDeps): Promise<GmailStatusView> {
  const s = await deps.status();
  const provider = s.enabled ? s.config.provider : null;
  let connection: ConnectionView | null = null;
  if (user.organizationId) {
    try {
      // Shown even while connecting is switched off, so a person can still see and disconnect what they connected.
      for (const p of provider ? [provider] : (["gmail", "fake"] as const)) {
        connection = await deps.store.live(user.organizationId, user.id, p);
        if (connection) break;
      }
    } catch { connection = null; } // tables not there yet: nothing connected
  }
  return { available: s.enabled, sendingEnabled: s.enabled && sendingAvailability(s.config).ok, canConnect: s.enabled && mayConnect(user), connection: toView(connection) };
}

export type StartResult = { ok: true; url: string; pending: PendingConnect } | { ok: false; status: number; code: string; message: string };

export async function startConnect(user: Member, deps: MailServiceDeps): Promise<StartResult> {
  const s = await deps.status();
  if (!s.enabled) return { ok: false, status: 503, code: "unavailable", message: "Connecting Gmail isn't available right now." };
  if (!mayConnect(user)) return { ok: false, status: 403, code: "not_allowed", message: "Your role doesn't allow connecting a mailbox. Ask your organization owner." };
  const provider = deps.provider(s.config);
  const current = await deps.store.live(user.organizationId, user.id, provider.id);
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url"); // 64 characters (RFC 7636: 43–128)
  const nonce = randomBytes(24).toString("base64url");
  let url = provider.authorizationUrl({ state, codeChallenge: sha256(verifier), nonce, redirectUri: s.config.redirectUri, loginHint: current?.accountEmail });
  if (provider.id === "fake") url = FakeMailProvider.consentRedirect(url); // local runs: consent is instant, no network
  const pending: PendingConnect = { stateHash: sha256(state), verifier, nonce, userId: user.id, orgId: user.organizationId, provider: provider.id, expiresAt: deps.now().getTime() + PENDING_TTL_MS };
  deps.log("gmail_connect_started", { provider: provider.id, reconnect: !!current });
  return { ok: true, url, pending };
}

export interface CallbackInput {
  user: Member | null; // whoever the session belongs to now (null: signed out)
  pending: PendingConnect | null; // already removed from the session by the caller
  query: Record<string, unknown>;
  used: UsedStates;
}

/** Finishes a connect. Returns only a fixed outcome code (and the connection id when one was saved). */
export async function completeConnect(input: CallbackInput, deps: MailServiceDeps): Promise<{ outcome: ConnectOutcome; connectionId?: number }> {
  const { user, pending, query } = input;
  const out = (outcome: ConnectOutcome, extra: Record<string, string | number | boolean | null> = {}) => {
    deps.log("gmail_connect_finished", { outcome, ...extra });
    return { outcome };
  };
  const state = typeof query.state === "string" && query.state.length <= 200 ? query.state : null;
  if (!state || !pending || !sameHash(sha256(state), pending.stateHash)) return out("invalid_request", { why: !state ? "no_state" : !pending ? "no_pending" : "state_mismatch" });
  if (!input.used.claim(pending.stateHash, deps.now().getTime())) return out("invalid_request", { why: "replayed" });
  if (deps.now().getTime() > pending.expiresAt) return out("expired");
  if (!user || user.id !== pending.userId || user.organizationId !== pending.orgId) return out("invalid_request", { why: "other_session" });
  if (!mayConnect(user)) return out("not_allowed");
  const s = await deps.status();
  if (!s.enabled || s.config.provider !== pending.provider) return out("unavailable");
  if (typeof query.error === "string") return out(query.error === "access_denied" ? "denied" : "failed", { why: "provider_error" });
  const code = typeof query.code === "string" && query.code.length > 0 && query.code.length <= 2048 ? query.code : null;
  if (!code) return out("invalid_request", { why: "no_code" });

  const provider = deps.provider(s.config);
  let grant: TokenGrant;
  try {
    grant = await provider.exchangeCode({ code, codeVerifier: pending.verifier, redirectUri: s.config.redirectUri, nonce: pending.nonce });
  } catch (e) {
    const kind = e instanceof MailProviderError ? e.kind : "error";
    return out(kind === "identity_invalid" ? "identity_invalid" : "failed", { why: kind });
  }

  const refuse = async (outcome: ConnectOutcome) => {
    await revokeUnlessLive(provider, grant, deps);
    return out(outcome);
  };
  if (!grant.account.emailVerified) return refuse("unverified_email");
  const caps = capabilitiesOf(grant.scopes);
  if (caps.mailboxAccess) return refuse("unexpected_scope");
  if (!caps.send || !caps.identify) return refuse("missing_send_scope");

  const saved = await deps.store.save({
    orgId: user.organizationId!, userId: user.id, provider: provider.id, account: { sub: grant.account.sub, email: grant.account.email },
    scopes: grant.scopes, refreshToken: grant.refreshToken, keyring: s.config.keyring, now: deps.now(),
  });
  if (!saved.ok) return refuse(saved.code);
  deps.audit(user, saved.reconnected ? "reconnected Gmail" : "connected Gmail", saved.connection.id, saved.connection.accountEmail);
  const o = out(saved.reconnected ? "reconnected" : "connected", { connectionId: saved.connection.id });
  return { ...o, connectionId: saved.connection.id };
}

async function revokeUnlessLive(provider: MailProvider, grant: TokenGrant, deps: MailServiceDeps): Promise<void> {
  try {
    if (await deps.store.accountLive(provider.id, grant.account.sub)) return;
    await provider.revoke(grant.refreshToken);
  } catch (e) {
    deps.log("gmail_revoke_failed", { kind: e instanceof MailProviderError ? e.kind : "error", where: "refused_connect" });
  }
}

/**
 * "Check connection": refreshes an access token once. A revoked grant or an unreadable token marks the connection
 * for reconnecting (and deletes a token that can't work); a temporary failure changes nothing.
 */
export async function verifyConnection(user: Member, deps: MailServiceDeps): Promise<{ result: VerifyResult; status: GmailStatusView }> {
  const s = await deps.status();
  if (!s.enabled || !user.organizationId) return { result: "temporarily_unavailable", status: await statusFor(user, deps) };
  const provider = deps.provider(s.config);
  const t = await deps.store.token(user.organizationId, user.id, provider.id, s.config.keyring);
  let result: VerifyResult;
  if (!t) result = "not_connected";
  else if (t.refreshToken === null) {
    await deps.store.markProblem({ orgId: user.organizationId, id: t.connection.id, code: t.reason === "unreadable" ? "token_unreadable" : t.connection.lastErrorCode ?? "reconnect_required", clearToken: t.reason === "unreadable", now: deps.now() });
    result = "needs_reconnect";
  } else {
    try {
      const access = await provider.refreshAccessToken(t.refreshToken);
      if (capabilitiesOf(access.scopes).send || access.scopes.length === 0) {
        await deps.store.markHealthy({ orgId: user.organizationId, id: t.connection.id, scopes: access.scopes.length ? access.scopes : t.connection.scopes, now: deps.now() });
        result = "ok";
      } else {
        await deps.store.markProblem({ orgId: user.organizationId, id: t.connection.id, code: "missing_send_scope", clearToken: false, now: deps.now() });
        result = "needs_reconnect";
      }
    } catch (e) {
      const kind = e instanceof MailProviderError ? e.kind : "error";
      if (kind === "invalid_grant") {
        await deps.store.markProblem({ orgId: user.organizationId, id: t.connection.id, code: "revoked", clearToken: true, now: deps.now() });
        result = "needs_reconnect";
      } else if (kind === "insufficient_scope") {
        await deps.store.markProblem({ orgId: user.organizationId, id: t.connection.id, code: "missing_send_scope", clearToken: false, now: deps.now() });
        result = "needs_reconnect";
      } else result = "temporarily_unavailable";
      deps.log("gmail_verify_failed", { kind });
    }
  }
  return { result, status: await statusFor(user, deps) };
}

/**
 * Disconnects `target`'s mailboxes in `orgId`: credentials deleted first, then the grant revoked at the provider
 * where possible. Works whether or not connecting is switched on. `actor` is who did it (the person themselves, or
 * whoever removed them from the organization); it is only recorded, it grants nothing.
 */
export async function disconnectMailboxes(
  input: { actor: Member; orgId: string; userId: string; reason: "user" | "member_removed" | "account_deleted" },
  deps: MailServiceDeps,
): Promise<{ disconnected: number; revoked: boolean | null }> {
  const s = await deps.status();
  const { keyring, provider } = s.enabled ? { keyring: s.config.keyring, provider: deps.provider(s.config) } : deps.cleanup();
  const rows = await deps.store.disconnect({ orgId: input.orgId, userId: input.userId, keyring, now: deps.now() });
  const what = input.reason === "user" ? "disconnected Gmail" : input.reason === "member_removed" ? "disconnected Gmail (member removed)" : "disconnected Gmail (account deleted)";
  let revoked: boolean | null = rows.length ? true : null;
  for (const r of rows) {
    if (r.refreshToken && provider && provider.id === r.connection.provider) {
      try {
        await provider.revoke(r.refreshToken);
      } catch (e) {
        revoked = false;
        await deps.store.noteRevokeFailed(input.orgId, r.connection.id, deps.now()).catch(() => {});
        deps.log("gmail_revoke_failed", { kind: e instanceof MailProviderError ? e.kind : "error", where: input.reason });
      }
    } else revoked = false; // nothing we could revoke with (no token left, unreadable, or no provider configured)
    deps.audit(input.actor, what, r.connection.id, r.connection.accountEmail);
  }
  if (rows.length) deps.log("gmail_disconnected", { reason: input.reason, count: rows.length, revoked });
  return { disconnected: rows.length, revoked };
}
