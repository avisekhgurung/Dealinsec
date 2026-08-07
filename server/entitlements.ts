/**
 * Organization context, role-based access control and subscription
 * entitlements.
 *
 * Every business resource belongs to an organization; members access only
 * their org's data (routes compare resource.organizationId to the caller's).
 * WRITES are gated by role permissions (shared/permissions.ts). Subscription
 * entitlements resolve through the org OWNER's user row, where billing lives:
 *
 *   free owner  -> org has 4 Deal Credits/month, 1 seat
 *   Pro owner   -> unlimited workflow, 5 seats (+ purchased extra seats)
 *   Deal Boost  -> unlimited deals+quotations for the whole org
 *
 * Error contract (client's parseApiError routes these):
 *   403 { code: "UPGRADE_REQUIRED", feature }    — org's plan lacks the feature
 *   403 { code: "FORBIDDEN", permission }        — member's role lacks the action
 *   402 { code: "NO_CREDITS", feature: "deals" } — org's free limit hit
 */
import type { RequestHandler } from "express";
import { hasActivePro, type User } from "@shared/schema";
import { hasPermission, type Permission } from "@shared/permissions";
import { storage } from "./storage";

export type GatedFeature = "agreements" | "invoices" | "payment_tracking";

const FEATURE_LABEL: Record<GatedFeature, string> = {
  agreements: "Creating agreements",
  invoices: "Generating invoices",
  payment_tracking: "Payment tracking",
};

/** The user whose plan/credits power the org: its OWNER. Zero extra queries
 *  when the caller is the owner themselves. */
export async function getBillingUser(reqUser: User): Promise<User> {
  if (reqUser.orgRole === "OWNER" || !reqUser.organizationId) return reqUser;
  const owner = await storage.getOrgOwner(reqUser.organizationId);
  return owner ?? reqUser;
}

/** Gate a route to a role permission. Runs AFTER isAuthenticated. */
export function requireOrgPermission(permission: Permission): RequestHandler {
  return (req: any, res, next) => {
    if (hasPermission(req.user?.orgRole, permission)) return next();
    return res.status(403).json({
      code: "FORBIDDEN",
      permission,
      error: "Your role doesn't allow this action. Ask your organization owner.",
    });
  };
}

/** Gate a route to orgs whose OWNER has an active Pro subscription.
 *  Must run AFTER isAuthenticated. Reads never go through this. */
export function requirePro(feature: GatedFeature): RequestHandler {
  return async (req: any, res, next) => {
    try {
      const billing = await getBillingUser(req.user);
      if (hasActivePro(billing)) return next();
      return res.status(403).json({
        code: "UPGRADE_REQUIRED",
        feature,
        error: `${FEATURE_LABEL[feature]} requires DealInSec Pro`,
      });
    } catch (err) {
      console.error("entitlement check failed:", err);
      return res.status(500).json({ error: "Could not verify subscription" });
    }
  };
}

/** Load the caller's organization row onto req.org (team/settings routes). */
export const withOrg: RequestHandler = async (req: any, res, next) => {
  try {
    if (!req.user?.organizationId) {
      return res.status(403).json({ error: "No organization on this account" });
    }
    const org = await storage.getOrganization(req.user.organizationId);
    if (!org) return res.status(403).json({ error: "Organization not found" });
    req.org = org;
    next();
  } catch (err) {
    console.error("org load failed:", err);
    res.status(500).json({ error: "Could not load organization" });
  }
};

/** Fire-and-forget audit line for the org's activity feed. */
export function logOrgActivity(
  user: User,
  action: string,
  entityType: string,
  entityId?: string | number | null,
  detail?: string,
) {
  if (!user.organizationId) return;
  void storage.logActivity({
    organizationId: user.organizationId,
    userId: user.id,
    userName: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || "Someone",
    action,
    entityType,
    entityId: entityId != null ? String(entityId) : null,
    detail: detail ?? null,
  });
}
