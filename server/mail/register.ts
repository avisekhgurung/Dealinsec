/**
 * Wires the Gmail connection into the app: the real gate, Postgres stores, session auth and activity log, and the
 * outreach side of a send (the do-not-contact tables, the lead timeline, the follow-up). Also the hook the team and
 * account routes call when a member is removed or deletes their account.
 */
import type { Express, Request } from "express";
import { isAuthenticated } from "../auth";
import { storage } from "../storage";
import { createMailProvider, resolveGmailConfig, sendingAvailability } from "./config";
import { disconnectMailboxes, type MailServiceDeps, type Member } from "./connect-service";
import { pgMailboxStore } from "./mailbox-store-pg";
import { leadsStore } from "../leads/store";
import { outreachSafetyReady } from "../sales/message-store";
import type { SendDeps } from "./send-service";
import { pgSendStore } from "./send-store-pg";
import { registerGmailRoutes } from "./routes";
import { gmailStatus, mailSyncSchemaReady } from "./status";
import { pgSyncStore, purgeExpiredBodies, retentionDays } from "./sync-store-pg";
import { applyPendingReplies, applyReply, type ApplyDeps } from "./reply-apply";
import { registerInboxRoutes } from "./inbox-routes";
import { followupThread } from "./followup-thread";
import { followupPolicy } from "@shared/followup-policy";
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
  retentionDays: () => retentionDays(process.env.MAIL_SYNC_RETENTION_DAYS).days,
  async purgeSynced(orgId, connectionId) {
    if (!(await mailSyncSchemaReady())) return 0;
    return pgSyncStore.purge(orgId, connectionId);
  },
};

/** What a synced reply changes (reply-apply.ts). Notices go to the activity log: the company and what happened, no message content. */
const applyDeps: ApplyDeps = {
  now: () => new Date(),
  log: (event, fields) => deps.log(event, fields),
  async notify(n) {
    const what = { replied: "replied to your outreach", opted_out: "asked not to be contacted", bounced: "outreach bounced", review: "a reply needs your review" }[n.what];
    await storage.logActivity({ organizationId: n.orgId, userId: n.userId ?? "system", userName: "Gmail", action: what, entityType: "lead", entityId: String(n.leadId), detail: n.companyName });
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
  applyReply: (orgId, id) => applyReply(orgId, id, applyDeps),
  applyPending: () => applyPendingReplies(applyDeps, { limit: 50 }),
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
  async planSendCap(user) {
    const [{ outboundTier }, { outboundAllowance }, { OUTBOUND_WINDOW_DAYS }] = await Promise.all([import("../outbound/plan"), import("../outbound/limits"), import("@shared/outbound-plans")]);
    return { since: new Date(Date.now() - OUTBOUND_WINDOW_DAYS * 86_400_000), max: outboundAllowance(await outboundTier(user as any)).monthlySends };
  },
  async threadFor(orgId, messageId) {
    return (await mailSyncSchemaReady()) ? followupThread(orgId, messageId) : null;
  },
};

export function registerGmail(app: Express): void {
  registerGmailRoutes(app, { ...deps, auth: isAuthenticated, currentUser, send: sendDeps, syncNow });
  registerInboxRoutes(app, { auth: isAuthenticated, apply: applyDeps, log: deps.log });
  logStartupConfig();
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
    // Follow-ups that fell due become drafts for review (never sent from here), and synced text past retention goes.
    if (await mailSyncSchemaReady()) {
      const { draftDueFollowups } = await import("../sales/followups");
      await draftDueFollowups(followupDeps, { limit: 10 });
      const keep = retentionDays(process.env.MAIL_SYNC_RETENTION_DAYS).days;
      if (keep) {
        try { const n = await purgeExpiredBodies(keep, new Date()); if (n) deps.log("gmail_retention_purged", { messages: n, days: keep }); }
        catch (err) { deps.log("gmail_sweep_failed", { errorType: (err as Error)?.name ?? "Error", where: "retention" }); }
      }
    }
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

const followupDeps = {
  now: () => new Date(),
  log: (event: string, fields?: Record<string, string | number | boolean | null>) => deps.log(event, fields),
  async senderName(orgId: string, userId: string | null) {
    const u: any = userId ? await storage.getUser(userId) : null;
    const name = u && u.organizationId === orgId ? [u.firstName, u.lastName].filter(Boolean).join(" ").trim() : "";
    return name || (await storage.getOrganization(orgId))?.name || "The team";
  },
  async notify(n: { orgId: string; leadId: number; companyName: string }) {
    await storage.logActivity({ organizationId: n.orgId, userId: "system", userName: "Follow-ups", action: "follow-up ready for review", entityType: "lead", entityId: String(n.leadId), detail: n.companyName });
  },
};

/**
 * Settings that are wrong are said once at startup, by name (never their values): a Gmail switch that is on but
 * unusable, a malformed follow-up or retention setting. The app keeps running with the feature off or the default.
 */
function logStartupConfig(): void {
  const g = resolveGmailConfig();
  const problems = [
    ...(g.enabled ? [] : g.reason === "misconfigured" ? g.problems : []),
    followupPolicy(process.env.OUTREACH_FOLLOWUP_BUSINESS_DAYS).problem,
    retentionDays(process.env.MAIL_SYNC_RETENTION_DAYS).problem,
  ].filter((p): p is string => !!p);
  deps.log("gmail_config", {
    integration: g.enabled, reason: g.enabled ? null : g.reason, provider: g.enabled ? g.config.provider : null,
    sending: g.enabled ? sendingAvailability(g.config).ok : false, replySync: g.enabled ? g.config.replySync : false, problems: problems.join(" | ") || null,
  });
}
