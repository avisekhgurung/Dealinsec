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
 * Pricing (₹, env-overridable for test-mode runs):
 *   PRO_MONTHLY_PRICE (default 99)    — Pro, 1 month
 *   PRO_YEARLY_PRICE  (default 999)   — Pro, 1 year (≈ ₹83/month; ₹189 less
 *                                       than 12 × monthly — NOT "2 months free")
 *   EXTRA_SEAT_PRICE  (default 99)    — one extra seat, 1 month
 *   DEAL_BOOST_PRICE  (default 99)    — unlimited deals+quotations, 1 month.
 *                                       Retired from every UI surface; the SKU
 *                                       stays for cached clients and refunds.
 * The client mirrors these defaults in client/src/hooks/use-plan-prices.ts.
 *
 * GLOBAL PRICING — NOT LIVE (Sep 2026). Every order this file creates is in ₹ on
 * the domestic Razorpay account, so today only a customer in India can buy. The
 * pricing page shows everyone else an "international checkout is coming soon"
 * note in place of a buy button (usePlanCheckoutAvailable in
 * client/src/hooks/use-plan-prices.ts), and createRazorpayOrder refuses any
 * other currency. International checkout is pending Razorpay International
 * approval.
 *
 * GLOBAL_PLANS below is the agreed price list for when it opens: India keeps
 * monthly + annual in ₹, everywhere else is ANNUAL ONLY in a local currency.
 * Nothing reads it yet. Annual-only abroad is deliberate: a card charge carries
 * a fixed per-transaction cost, which is trivial once a year and punitive
 * twelve times a year on a small ticket.
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

export function getProMonthlyPrice(): number {
  return parseInt(process.env.PRO_MONTHLY_PRICE ?? "99", 10);
}

// Default is the ₹999/yr list price the site advertises — the marketing copy
// and the charge must never disagree, so change both together.
// PRO_YEARLY_PRICE still overrides it (e.g. ₹1 for test-mode runs).
export function getProYearlyPrice(): number {
  return parseInt(process.env.PRO_YEARLY_PRICE ?? "999", 10);
}

export function getDealBoostPrice(): number {
  return parseInt(process.env.DEAL_BOOST_PRICE ?? "99", 10);
}

// Extra seats beyond the plan's included 5 (Pro): ₹99/seat/month.
export const EXTRA_SEAT_DAYS = 31;

export function getExtraSeatPrice(): number {
  return parseInt(process.env.EXTRA_SEAT_PRICE ?? "99", 10);
}

export interface PlanPrice {
  /** Amount in MAJOR units of the currency (99 = ₹99 / $99). */
  amount: number;
  currency: string;
  /** Term length in days, mirroring PRO_*_DAYS. */
  days: number;
}

/**
 * NOT WIRED — the agreed price list for international checkout, which is
 * pending Razorpay International approval (see the header). No route, order or
 * screen reads this. Do not quote or charge from it until checkout is live
 * end to end: order creation, the pricing page and the grant path together.
 *
 * Local round numbers beat a live FX conversion: "£79" reads as a price,
 * "£78.43" reads as a glitch — and a price that moves with the exchange rate
 * can silently contradict the marketing page.
 *
 * India is the only market with a monthly plan. Everywhere else is annual only.
 * The INR row records the list price; live ₹ orders read the env-driven
 * getters above instead, so a ₹1 test-mode run keeps working.
 */
export const GLOBAL_PLANS: Readonly<Record<string, { monthly?: PlanPrice; yearly: PlanPrice }>> = {
  INR: {
    monthly: { amount: 99, currency: "INR", days: PRO_MONTHLY_DAYS },
    yearly: { amount: 999, currency: "INR", days: PRO_YEARLY_DAYS },
  },
  USD: { yearly: { amount: 99, currency: "USD", days: PRO_YEARLY_DAYS } },
  GBP: { yearly: { amount: 79, currency: "GBP", days: PRO_YEARLY_DAYS } },
  EUR: { yearly: { amount: 89, currency: "EUR", days: PRO_YEARLY_DAYS } },
  AUD: { yearly: { amount: 149, currency: "AUD", days: PRO_YEARLY_DAYS } },
  CAD: { yearly: { amount: 139, currency: "CAD", days: PRO_YEARLY_DAYS } },
  SGD: { yearly: { amount: 129, currency: "SGD", days: PRO_YEARLY_DAYS } },
  AED: { yearly: { amount: 369, currency: "AED", days: PRO_YEARLY_DAYS } },
};

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
