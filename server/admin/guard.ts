/**
 * Platform-admin gate: the operator (the founder), not an organization role. Org RBAC (shared/permissions.ts) governs a
 * workspace's own members; this governs the platform's pricing, allowances and per-account credit adjustments, which no
 * workspace role — not even OWNER — may touch. The flag is users.is_platform_admin, set only by hand on the database;
 * there is no route that sets it and no email-based fallback.
 *
 * Fails closed: a missing user, a missing flag or anything but `true` is a 403 (a 401 when not signed in is isAuthenticated's).
 */
import type { RequestHandler } from "express";

export const isPlatformAdmin = (user: { isPlatformAdmin?: unknown } | null | undefined): boolean => user?.isPlatformAdmin === true;

/** Must run AFTER isAuthenticated. */
export const requirePlatformAdmin: RequestHandler = (req: any, res, next) => {
  if (isPlatformAdmin(req.user)) return next();
  return res.status(403).json({ code: "FORBIDDEN", error: "This area is for the DealInSec operator only." });
};
