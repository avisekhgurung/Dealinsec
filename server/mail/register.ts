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
import { gmailStatus } from "./status";
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
};

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
  registerGmailRoutes(app, { ...deps, auth: isAuthenticated, currentUser, send: sendDeps });
  startRecoverySweep();
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
