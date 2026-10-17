/**
 * The rules for buying DealInSec itself (Razorpay, one-time orders, India only), kept pure so they can be tested:
 * which plans can still be bought, whether a paid order may grant its plan, and whether a refund takes the plan back.
 *
 * One subscription: DealInSec Pro, paid monthly. Pro Annual and Deal Boost are no longer sold (orders already
 * completed keep everything they bought; their refund path still works), and extra team seats are an add-on for Pro.
 *
 * A grant needs Razorpay's own record of the payment to agree with the order we created: the same order, INR, exactly
 * the amount we asked for, captured (or authorized and then captured by us), and paid within ORDER_MAX_AGE_MS of the
 * order. An order is priced when it is created, so without the age limit an order created before a price change could
 * be paid at the old price weeks later.
 */

export type Sku = "pro_monthly" | "extra_seat";
export type RetiredSku = "pro_yearly" | "deal_boost";

/** How long after creation an order may still be paid and granted. Checkout completes in minutes. */
export const ORDER_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type SkuDecision =
  | { ok: true; sku: Sku }
  | { ok: false; status: number; code: string; error: string };

/** What a checkout request may buy. `hasPro` is the buyer's Pro (paid or trial) access, for the seat add-on. */
export function resolveSku(body: { plan?: unknown; credits?: unknown } | null | undefined, hasPro: boolean): SkuDecision {
  const plan = body?.plan;
  if (plan === "pro_monthly") return { ok: true, sku: "pro_monthly" };
  if (plan === "extra_seat") {
    if (!hasPro) return { ok: false, status: 403, code: "UPGRADE_REQUIRED", error: "Extra team seats are an add-on for DealInSec Pro. Upgrade to Pro first." };
    return { ok: true, sku: "extra_seat" };
  }
  // Retired plans (and the bodies older cached clients send for them): refused, never silently swapped for another price.
  if (plan === "pro_yearly" || plan === "pro" || plan === "deal_boost" || (plan === undefined && body?.credits)) {
    return { ok: false, status: 410, code: "PLAN_RETIRED", error: "That plan is no longer sold. DealInSec Pro is now one monthly plan — refresh the page to see it." };
  }
  return { ok: false, status: 400, code: "UNKNOWN_PLAN", error: "Unknown plan" };
}

/** Razorpay's record of a payment, as the payments API and webhooks return it (amount in paise, created_at in seconds). */
export interface RazorpayPayment {
  id: string;
  order_id?: string | null;
  status: string; // created | authorized | captured | refunded | failed
  amount: number;
  currency: string;
  created_at?: number;
}

/** Our order row (amount in whole rupees; createdAt when we created the Razorpay order). */
export interface OrderRecord { orderId: string; amount: number; createdAt: Date | string | null }

export type PaymentDecision =
  | { grant: true; capture: boolean }
  | { grant: false; reason: "order_expired" | "wrong_order" | "wrong_currency" | "amount_mismatch" | "not_paid" };

/**
 * May this payment grant this order's plan? `paidAt` is when the payment happened (the payment's own created_at when
 * known, else now). `capture: true` means the payment is only authorized and must be captured before granting.
 */
export function paymentDecision(order: OrderRecord, payment: RazorpayPayment, paidAt: Date): PaymentDecision {
  if (payment.order_id && payment.order_id !== order.orderId) return { grant: false, reason: "wrong_order" };
  if (String(payment.currency).toUpperCase() !== "INR") return { grant: false, reason: "wrong_currency" };
  if (payment.amount !== Math.round(order.amount * 100)) return { grant: false, reason: "amount_mismatch" };
  const created = order.createdAt ? new Date(order.createdAt).getTime() : NaN;
  if (!Number.isFinite(created) || paidAt.getTime() - created > ORDER_MAX_AGE_MS) return { grant: false, reason: "order_expired" };
  if (payment.status === "captured") return { grant: true, capture: false };
  if (payment.status === "authorized") return { grant: true, capture: true };
  return { grant: false, reason: "not_paid" };
}

/** When the payment happened, from Razorpay's record (seconds), falling back to `now`. */
export const paidAtOf = (payment: Pick<RazorpayPayment, "created_at">, now: Date): Date =>
  typeof payment.created_at === "number" && payment.created_at > 0 ? new Date(payment.created_at * 1000) : now;

/** A refund takes the plan back only when it returns the whole payment; a partial refund is for a person to review. */
export function refundIsFull(refundAmountPaise: unknown, paymentAmountPaise: unknown): boolean {
  const r = Number(refundAmountPaise), p = Number(paymentAmountPaise);
  if (!Number.isFinite(r) || !Number.isFinite(p) || p <= 0) return true; // unknown amounts: the old behaviour (full)
  return r >= p;
}
