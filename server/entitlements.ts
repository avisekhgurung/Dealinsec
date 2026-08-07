/**
 * Subscription entitlements.
 *
 * Free plan: 4 monthly Deal Credits (1 credit = create 1 deal + generate its
 * quotation) — enforced inline in POST /api/deals via storage.spendDealCredit.
 * The ₹99 Deal Boost lifts the deal/quotation limit for a month but never
 * unlocks Pro features. Everything below is Pro-only.
 *
 * Error contract (machine-readable; the client's parseApiError maps both to
 * the upgrade modal):
 *   403 { code: "UPGRADE_REQUIRED", feature }  — Pro-only feature
 *   402 { code: "NO_CREDITS", feature: "deals", credits }  — free limit hit
 */
import type { RequestHandler } from "express";
import { hasActivePro } from "@shared/schema";

export type GatedFeature = "agreements" | "invoices" | "payment_tracking";

const FEATURE_LABEL: Record<GatedFeature, string> = {
  agreements: "Creating agreements",
  invoices: "Generating invoices",
  payment_tracking: "Payment tracking",
};

/** Gate a route to active Pro subscribers. Must run AFTER isAuthenticated
 *  (relies on req.user). Reads never go through this — free users keep full
 *  access to documents they created before the model change. */
export function requirePro(feature: GatedFeature): RequestHandler {
  return (req: any, res, next) => {
    if (hasActivePro(req.user)) return next();
    return res.status(403).json({
      code: "UPGRADE_REQUIRED",
      feature,
      error: `${FEATURE_LABEL[feature]} requires DealInSec Pro`,
    });
  };
}
