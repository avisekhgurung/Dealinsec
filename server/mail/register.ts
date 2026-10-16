/**
 * Wires the Gmail connection into the app: the real gate, Postgres stores, session auth and activity log, and the
 * outreach side of a send (the do-not-contact tables, the lead timeline, the follow-up). Also the hook the team and
 * account routes call when a member is removed or deletes their account.
 */
import type { Express, Request } from "express";
import { isAuthenticated } from "../auth";
import { storage } from "../storage";
import { createMailProvider, resolveGmailConfig } from "./config";
import { disconnectMailboxes, type MailServiceDeps, type Member } from "./connect-service";
import { pgMailboxStore } from "./mailbox-store-pg";
import { leadsStore } from "../leads/store";
import { outreachSafetyReady } from "../sales/message-store";
import type { SendDeps } from "./send-service";
import { pgSendStore } from "./send-store-pg";
import { registerGmailRoutes } from "./routes";
import { gmailStatus, mailSyncSchemaReady } from "./status";
import { pgSyncStore } from "./sync-store-pg";
import { replySyncFor, syncDueMailboxes, syncMailbox, type SyncDeps } from "./sync-service";
import { loadKeyring } from "./token-crypto";

const deps: MailServiceDeps = {
  status: gmailStatus,
  provider: (config) => createMailProvider(config),
  store: pgMailboxStore,
  now: () => new Date(),
  cleanup() {
    // Switched off, but credentials may still be stored: delete them, and revoke if the provider is still configured.
    let keyring = null;
    try { keyring = loadKeyring(); } catch { keyring = null; }
    const r = resolveGmailConfig({ ...process.env, GMAIL_INTEGRATION_ENABLED: "true" });
    let provider = null;
    try { provider = r.enabled ? createMailProvider(r.config) : null; } catch { provider = null; }
    return { keyring, provider };
  },
  audit(actor, action, connectionId, detail) {
    if (!actor.organizationId) return;
    void storage.logActivity({
      organizationId: actor.organizationId,
      userId: actor.id,
      userName: [actor.firstName, actor.lastName].filter(Boolean).join(" ") || actor.email || "Someone",
      action,
      entityType: "integration",
      entityId: String(connectionId),
      detail,
    }).catch(() => {});
  },
  log(event, fields = {}) {
    // Codes and ids only; never tokens, authorization codes, secrets or provider responses.
    console.log(JSON.stringify({ at: new Date().toISOString(), event, ...fields }));
  },
  async replySync(orgId) { return (await replySyncFor(orgId, syncDeps)).on; },
  syncState: (orgId, connectionId) => pgSyncStore.state(orgId, connectionId).catch(() => null),
  async purgeSynced(orgId, connectionId) {
    if (!(await mailSyncSchemaReady())) return 0;
    return pgSyncStore.purge(orgId, connectionId);
  },
};

/** Reply sync (Release B): the real gate, the Gmail adapter's read calls, Postgres stores. */
const syncDeps: SyncDeps = {
  status: gmailStatus,
  syncSchemaReady: mailSyncSchemaReady,
  provider: (config) => createMailProvider(config),
  mailbox: pgMailboxStore,
  store: pgSyncStore,
  now: () => new Date(),
  random: Math.random,
  log: (event, fields) => deps.log(event, fields),
};

/** "Check for replies now", for the signed-in person's own mailbox. */
async function syncNow(user: Member): Promise<{ outcome: string; stored: number }> {
  if (!user.organizationId) return { outcome: "off", stored: 0 };
  const gate = await replySyncFor(user.organizationId, syncDeps);
  if (!gate.on) return { outcome: "off", stored: 0 };
  const conn = await pgMailboxStore.live(user.organizationId, user.id, gate.config.provider);
  if (!conn) return { outcome: "not_connected", stored: 0 };
  const r = await syncMailbox({ orgId: user.organizationId, userId: user.id, connectionId: conn.id, force: true }, syncDeps);
  return { outcome: r.outcome, stored: r.stored };
}

/** The session's person, loaded the way isAuthenticated does, but answering null instead of 401. */
async function currentUser(req: Request): Promise<Member | null> {
  const userId = (req.session as any)?.userId;
  if (!userId) return null;
  const user: any = await storage.getUser(userId);
  if (!user || user.memberStatus === "removed") return null;
  if (user.customRoleId) {
    const role = await storage.getOrgRole(user.customRoleId);
    user.customPermissions = role && role.organizationId === user.organizationId ? role.permissions : [];
  }
  return user;
}

const sendDeps: SendDeps = {
  status: gmailStatus,
  provider: (config) => createMailProvider(config),
  mailbox: pgMailboxStore,
  sends: pgSendStore,
  now: () => new Date(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  random: Math.random,
  listReady: () => outreachSafetyReady(),
  async afterSent(actor, info) {
    const { afterMessageSent } = await import("../sales/outreach"); // the outreach module, loaded when first needed
    await afterMessageSent(actor as any, { leadId: info.leadId, messageId: info.messageId, channel: info.via, now: new Date() });
  },
  async leadEvent(orgId, leadId, kind, data, actorUserId) {
    await leadsStore.addEvent(orgId, leadId, { kind, data, actor: "user", actorUserId });
  },
  async isActiveMember(orgId, userId) {
    const u: any = await storage.getUser(userId);
    return !!u && u.organizationId === orgId && u.memberStatus !== "removed";
  },
  log: deps.log,
};

export function registerGmail(app: Express): void {
  registerGmailRoutes(app, { ...deps, auth: isAuthenticated, currentUser, send: sendDeps, syncNow });
  startRecoverySweep();
  startReplySync();
}

/**
 * Every two minutes, while the process is up: send leases that ran out become "uncertain" (never resent), and follow-ups
 * a crash interrupted are finished from their outbox entries (once). Both are also done on the paths people use; this
 * covers what nobody looks at. Errors are logged by code only and retried on the next pass.
 */
let sweeping: NodeJS.Timeout | null = null;
function startRecoverySweep(): void {
  if (sweeping || process.env.NODE_ENV === "test") return;
  sweeping = setInterval(async () => {
    try {
      if ((await gmailStatus()).enabled) await pgSendStore.recoverExpired({ now: new Date() });
    } catch (err) { deps.log("gmail_sweep_failed", { errorType: (err as Error)?.name ?? "Error", where: "leases" }); }
    const { repairAfterSend } = await import("../sales/outreach");
    await repairAfterSend(undefined, 50);
  }, 120_000);
  sweeping.unref?.();
}

/**
 * Reply sync, every minute while the process is up: a few due mailboxes per tick, one pass each (a pass reads at most
 * a bounded number of messages; leases keep two processes off the same mailbox). Does nothing unless
 * GMAIL_REPLY_SYNC_ENABLED is on and its tables are migrated. A sleeping instance simply catches up when it wakes: the
 * cursor is in the database.
 */
let replyTimer: NodeJS.Timeout | null = null;
let replyRunning = false;
function startReplySync(): void {
  if (replyTimer || process.env.NODE_ENV === "test") return;
  replyTimer = setInterval(async () => {
    if (replyRunning) return;
    replyRunning = true;
    try { await syncDueMailboxes(syncDeps, { limit: 5 }); } finally { replyRunning = false; }
  }, 60_000);
  replyTimer.unref?.();
}

/**
 * A member left the organization (removed by an admin, or deleted their account): their mailbox is disconnected
 * and its grant revoked. Never throws; a failure is logged and left for the next attempt (the person can no
 * longer sign in, and nothing sends from a mailbox whose owner isn't an active member).
 */
export async function disconnectMailboxesOf(actor: Member, orgId: string, userId: string, reason: "member_removed" | "account_deleted"): Promise<void> {
  try {
    await disconnectMailboxes({ actor, orgId, userId, reason }, deps);
  } catch (err) {
    deps.log("gmail_cleanup_failed", { reason, errorType: (err as Error)?.name ?? "Error" });
  }
}
