/**
 * The real store and effects behind razorpay-events.ts: the payment-order claims in server/storage.ts, delivering and
 * clawing back what an order bought, and the workspace audit line. Shared by the checkout/webhook routes and the
 * operator script (script/payment-orders.ts), so a manual resolution applies a plan exactly as a payment would.
 */
import type { PayuOrder, User } from "@shared/schema";
import { storage } from "../storage";
import { DEAL_BOOST_DAYS, EXTRA_SEAT_DAYS, PRO_MONTHLY_DAYS, PRO_YEARLY_DAYS } from "../razorpayClient";
import type { PaymentAudit, PaymentEffects, PaymentOrderStore } from "./razorpay-events";

// Deliver what a completed payment order bought. Shared by the browser verify
// path and the webhook (whichever atomically claims the order first calls
// this exactly once). Legacy purposes from orders created before the
// subscription-first model ("pro_plan", "credits") are still honored.
export type GrantResult =
  | { kind: "pro"; term: "monthly" | "yearly"; user?: User }
  | { kind: "boost"; user?: User }
  | { kind: "seats"; qty: number }
  | { kind: "credits" };

export async function grantPurchase(
  purpose: string,
  userId: string,
  legacyOrder?: { credits: number; amount: number },
): Promise<GrantResult> {
  switch (purpose) {
    case "pro_monthly": {
      const user = await storage.activateProPlan(userId, PRO_MONTHLY_DAYS, "monthly");
      return { kind: "pro", term: "monthly", user };
    }
    case "pro_yearly":
    case "pro_plan": { // legacy annual orders
      const user = await storage.activateProPlan(userId, PRO_YEARLY_DAYS, "yearly");
      return { kind: "pro", term: "yearly", user };
    }
    case "deal_boost": {
      const user = await storage.activateDealBoost(userId, DEAL_BOOST_DAYS);
      return { kind: "boost", user };
    }
    case "extra_seat": {
      const buyer = await storage.getUser(userId);
      const qty = Math.max(1, legacyOrder?.credits ?? 1);
      if (!buyer?.organizationId) {
        // Paid-but-undeliverable: throw so the caller reopens the order claim
        // and a retry (or the webhook) can deliver once the org exists —
        // never silently pocket the money.
        throw new Error(`extra_seat grant: user ${userId} has no organization`);
      }
      await storage.activateExtraSeats(buyer.organizationId, qty, EXTRA_SEAT_DAYS);
      return { kind: "seats", qty };
    }
    default: { // legacy "credits" orders in flight at deploy time
      if (legacyOrder && legacyOrder.credits > 0) {
        await storage.addPurchasedCredits(userId, legacyOrder.credits, "purchase", legacyOrder.amount);
      }
      return { kind: "credits" };
    }
  }
}

export const paymentOrderStore: PaymentOrderStore = {
  getOrder: (id) => storage.getPayuOrder(id),
  getOrderByPaymentId: (id) => storage.getPayuOrderByPaymentId(id),
  completeOnce: (id, updates) => storage.completePayuOrderOnce(id, updates),
  reopenAfterFailedGrant: (id, paymentId) => storage.reopenPayuOrderAfterFailedGrant(id, paymentId),
  markFailedIfPending: (id) => storage.markPayuOrderFailedIfPending(id),
  markReviewIfOpen: (id, paymentId) => storage.markPayuOrderReviewIfOpen(id, paymentId),
  markRefundedOnce: (id) => storage.markPayuOrderRefundedOnce(id),
  closeUnfulfilledAsRefunded: (id, paymentId) => storage.closeUnfulfilledPayuOrderAsRefunded(id, paymentId),
};

const PURCHASE_LABEL: Record<string, string> = {
  pro_monthly: "DealInSec Pro — 1 month",
  pro_yearly: "DealInSec Pro — 1 year",
  pro_plan: "DealInSec Pro — 1 year",
  deal_boost: "Deal Boost — 1 month",
  extra_seat: "Extra team seats — 1 month",
};

/** The activity log's short action word (the settings table and the notification bell show it as is; the bell gives
 *  any action containing "payment" the money icon). */
const AUDIT_ACTION: Record<PaymentAudit["action"], string> = {
  payment_granted: "payment applied",
  payment_needs_review: "payment held",
  payment_grant_failed: "payment pending",
  payment_refunded: "payment refunded",
  payment_refund_closed_unfulfilled: "payment refunded",
  payment_refund_partial: "payment partly refunded",
};

/** One activity-log line per payment event in the buyer's workspace: what was bought, the amount and the order id,
 *  never card, UPI, bank or contact details. Best-effort (logActivity never throws). */
export function paymentAuditLine(order: PayuOrder, entry: PaymentAudit): string {
  const what = `${PURCHASE_LABEL[order.purpose] ?? order.purpose}, ₹${order.amount}`;
  switch (entry.action) {
    case "payment_granted": return entry.source === "operator" ? `Payment applied after review: ${what}` : `Payment applied: ${what}`;
    case "payment_needs_review": return `Payment held for review (${entry.reason.replace(/_/g, " ")}): ${what}`;
    case "payment_grant_failed": return `Payment received but not yet applied, will retry: ${what}`;
    case "payment_refunded": return entry.clawback === "revoked" ? `Refunded, access removed: ${what}` : `Refunded after the paid term had ended: ${what}`;
    case "payment_refund_closed_unfulfilled": return `Refunded before it was applied: ${what}`;
    case "payment_refund_partial": return `Partial refund recorded, plan kept for review: ${what}`;
  }
}

/** Take back what a fully refunded order granted. If the term it granted has ALREADY lapsed (a January monthly
 *  refunded in June after the user re-subscribed), subtracting a term now would destroy the freshly paid current
 *  term instead of the refunded one, so nothing is clawed back. */
async function clawbackPurchase(order: PayuOrder): Promise<"revoked" | "lapsed"> {
  const termDays: Record<string, number> = {
    pro_monthly: PRO_MONTHLY_DAYS,
    pro_yearly: PRO_YEARLY_DAYS,
    pro_plan: PRO_YEARLY_DAYS,
    deal_boost: DEAL_BOOST_DAYS,
    extra_seat: EXTRA_SEAT_DAYS,
  };
  const days = termDays[order.purpose];
  let lapsed = days != null && order.completedAt != null && Date.now() - new Date(order.completedAt).getTime() > days * 86_400_000;
  // Seat packs share ONE expiry (a top-up inherits the pack's existing end date), so purchase age is the wrong
  // signal: ask the organization when its current pack actually ends.
  if (order.purpose === "extra_seat") {
    const buyer = await storage.getUser(order.userId);
    const org = buyer?.organizationId ? await storage.getOrganization(buyer.organizationId) : null;
    lapsed = !org?.extraSeatsExpiresAt || new Date(org.extraSeatsExpiresAt).getTime() <= Date.now();
  }
  if (lapsed) return "lapsed";
  switch (order.purpose) {
    case "pro_monthly":
      await storage.revokeProPlan(order.userId, PRO_MONTHLY_DAYS);
      break;
    case "pro_yearly":
    case "pro_plan": // legacy annual orders
      await storage.revokeProPlan(order.userId, PRO_YEARLY_DAYS);
      break;
    case "deal_boost":
      await storage.revokeDealBoost(order.userId, DEAL_BOOST_DAYS);
      break;
    case "extra_seat": {
      const buyer = await storage.getUser(order.userId);
      if (buyer?.organizationId && order.credits > 0) await storage.revokeExtraSeats(buyer.organizationId, order.credits);
      break;
    }
    default: // legacy "credits" orders
      if (order.credits > 0) await storage.addPurchasedCredits(order.userId, -order.credits, "refund", order.amount);
  }
  return "revoked";
}

export const paymentEffects: PaymentEffects<GrantResult> = {
  grant: (order) => grantPurchase(order.purpose, order.userId, order),
  clawback: clawbackPurchase,
  async audit(order, entry) {
    const buyer = await storage.getUser(order.userId);
    if (!buyer?.organizationId) return;
    await storage.logActivity({
      organizationId: buyer.organizationId,
      userId: buyer.id,
      userName: [buyer.firstName, buyer.lastName].filter(Boolean).join(" ") || null,
      action: AUDIT_ACTION[entry.action],
      entityType: "payment",
      entityId: order.orderId,
      detail: paymentAuditLine(order, entry),
    });
  },
  log: (message, fields) => console.error(message, fields),
};
