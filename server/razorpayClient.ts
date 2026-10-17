/**
 * Razorpay client wrapper.
 *
 * Handles subscription payments (UPI QR / cards / netbanking) for DealInSec.
 * Replaces the legacy PayU integration.
 *
 * Required env vars:
 *   RAZORPAY_KEY_ID          (public — also sent to the browser checkout)
 *   RAZORPAY_KEY_SECRET      (private — server only)
 *   RAZORPAY_WEBHOOK_SECRET  (private — verifies webhook authenticity)
 *
 * Pricing (₹, env-overridable for test-mode runs; a value that isn't a whole
 * number of rupees ≥ 1 is ignored in favour of the default):
 *   PRO_MONTHLY_PRICE (default 499)   — DealInSec Pro, 1 month. The ONE plan on
 *                                       sale (India launch price, Oct 2026).
 *   EXTRA_SEAT_PRICE  (default 99)    — one extra seat, 1 month (Pro add-on)
 *   PRO_YEARLY_PRICE  (default 999)   — Pro Annual: NO LONGER SOLD (the order
 *                                       route refuses it, see
 *                                       server/billing/purchase-rules.ts); the
 *                                       getter stays for old orders' records.
 *   DEAL_BOOST_PRICE  (default 99)    — retired; refused the same way.
 * The client mirrors these defaults in client/src/hooks/use-plan-prices.ts.
 *
 * GLOBAL PRICING — NOT LIVE (Sep 2026). Every order this file creates is in ₹ on
 * the domestic Razorpay account, so today only a customer in India can buy. The
 * pricing page shows everyone else a "paid plans aren't available in your
 * country yet" note in place of a buy button (usePlanCheckoutAvailable in
 * client/src/hooks/use-plan-prices.ts), and createRazorpayOrder refuses any
 * other currency. The Razorpay International application was rejected (2026-09-23), so there
 * is no international payment rail yet.
 *
 * GLOBAL_PLANS (now in shared/globalPlans.ts) is the agreed price list for
 * when it opens: India keeps monthly + annual in ₹, everywhere else is
 * ANNUAL ONLY in a local currency. The pricing page reads it to show an
 * international visitor their real future price instead of a rupee figure
 * they can't pay — checkout itself still refuses every non-₹ order below.
 * Annual-only abroad is deliberate: a card charge carries a fixed
 * per-transaction cost, which is trivial once a year and punitive twelve
 * times a year on a small ticket.
 *
 * To be confirmed on activation, not assumed: how international payments settle
 * to us and what export paperwork they produce. Razorpay's pricing page
 * (https://razorpay.com/pricing/) lists an auto-generated eFIRC for
 * international bank transfers; that says nothing about card payments. Any
 * plain gateway also leaves us the seller of record, so foreign VAT/sales-tax
 * exposure would be ours and grows with volume — weigh a Merchant of Record
 * before wiring this.
 */
import Razorpay from "razorpay";
import crypto from "crypto";

let _client: Razorpay | null = null;

export function isRazorpayConfigured(): boolean {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

export function getRazorpayKeyId(): string {
  return process.env.RAZORPAY_KEY_ID || "";
}

// Sold like Vyapar's licenses: one-time payments for fixed terms, no
// auto-debit mandate (true autopay = Razorpay Subscriptions API, future work).
// 31/366 cover the longest month/leap year so a paid term is never short.
export const PRO_MONTHLY_DAYS = 31;
export const PRO_YEARLY_DAYS = 366;
export const DEAL_BOOST_DAYS = 31;

/** A whole number of rupees from the environment, or the default (logged) when it isn't one. */
function rupees(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (Number.isInteger(n) && n >= 1) return n;
  console.error(`[razorpay] ${name} is not a whole number of rupees; using the default ₹${fallback}`);
  return fallback;
}

export function getProMonthlyPrice(): number {
  return rupees("PRO_MONTHLY_PRICE", 499);
}

// Pro Annual is no longer sold (Oct 2026: one monthly plan). Kept for the records
// of annual orders already completed.
export function getProYearlyPrice(): number {
  return rupees("PRO_YEARLY_PRICE", 999);
}

export function getDealBoostPrice(): number {
  return rupees("DEAL_BOOST_PRICE", 99);
}

// Extra seats beyond the plan's included 5 (Pro): ₹99/seat/month.
export const EXTRA_SEAT_DAYS = 31;

export function getExtraSeatPrice(): number {
  return rupees("EXTRA_SEAT_PRICE", 99);
}

// GLOBAL_PLANS (the agreed international price list) now lives in
// shared/globalPlans.ts, so the CLIENT can read prices for display without
// importing this whole module (the Razorpay SDK, server env vars). Still not
// wired to checkout: no order, charge or grant here reads it — see that
// file's header for what "safe to display, not safe to charge" means.
export type { PlanPrice } from "@shared/globalPlans";
export { GLOBAL_PLANS } from "@shared/globalPlans";

function getClient(): Razorpay {
  if (_client) return _client;
  if (!isRazorpayConfigured()) {
    throw new Error(
      "Razorpay not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.",
    );
  }
  _client = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID!,
    key_secret: process.env.RAZORPAY_KEY_SECRET!,
  });
  return _client;
}

export interface CreateOrderArgs {
  /** Amount in INR (rupees) — converted to paise internally */
  amountInRupees: number;
  /** ISO-4217. Only INR is accepted until international checkout is live (see
   *  the header); anything else throws before Razorpay is called. Optional so
   *  existing callers are untouched. */
  currency?: string;
  /** Our internal receipt id (we store the same on payu_orders.orderId) */
  receipt: string;
  notes?: Record<string, string>;
}

/** Create a Razorpay order. Returns the order with razorpay order_id. */
export async function createRazorpayOrder(args: CreateOrderArgs) {
  const currency = (args.currency || "INR").toUpperCase();
  // Fail closed. International checkout is not wired: no screen quotes a
  // foreign price, the grant path has never seen one, and the ×100 below is
  // wrong for a zero-decimal currency like JPY. A non-INR order would either be
  // refused by Razorpay mid-checkout or charge a figure nobody was shown.
  if (currency !== "INR") {
    throw new Error(`International checkout is not live yet, so a ${currency} order cannot be created.`);
  }
  const client = getClient();
  return client.orders.create({
    amount: Math.round(args.amountInRupees * 100), // paise
    currency,
    receipt: args.receipt,
    notes: args.notes,
  });
}

/** Razorpay's own record of a payment (status, amount in paise, currency, order). Read-only. */
export async function fetchRazorpayPayment(paymentId: string): Promise<import("./billing/purchase-rules").RazorpayPayment> {
  const p: any = await getClient().payments.fetch(paymentId);
  return { id: String(p.id), order_id: p.order_id ?? null, status: String(p.status), amount: Number(p.amount), currency: String(p.currency), created_at: Number(p.created_at) || undefined };
}

/** Captures an authorized payment for exactly the amount it was authorized for (an account with manual capture). */
export async function captureRazorpayPayment(paymentId: string, amountPaise: number): Promise<string> {
  const p: any = await getClient().payments.capture(paymentId, amountPaise, "INR");
  return String(p.status);
}

/**
 * Verify the signature returned by Razorpay Checkout after a successful
 * payment. Returns true if the signature is valid.
 *
 * signature = HMAC_SHA256(order_id + "|" + payment_id, key_secret)
 */
export function verifyPaymentSignature(args: {
  orderId: string;
  paymentId: string;
  signature: string;
}): boolean {
  const secret = process.env.RAZORPAY_KEY_SECRET || "";
  if (!secret) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${args.orderId}|${args.paymentId}`)
    .digest("hex");
  // timing-safe compare
  const a = Buffer.from(expected);
  const b = Buffer.from(args.signature || "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Verify a Razorpay webhook payload using the webhook secret.
 * signature = HMAC_SHA256(rawBody, webhook_secret)
 */
export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET || "";
  if (!secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature || "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
