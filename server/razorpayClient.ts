/**
 * Razorpay client wrapper.
 *
 * Handles credit-purchase payments (UPI QR / cards / netbanking) for
 * DealInSec. Replaces the legacy PayU integration.
 *
 * Required env vars:
 *   RAZORPAY_KEY_ID          (public — also sent to the browser checkout)
 *   RAZORPAY_KEY_SECRET      (private — server only)
 *   RAZORPAY_WEBHOOK_SECRET  (private — verifies webhook authenticity)
 *
 * Pricing: CREDIT_VALUE env var (default 299) = ₹ per contract credit.
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

export function getCreditPrice(): number {
  return parseInt(process.env.CREDIT_VALUE ?? "299", 10);
}

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
  /** Our internal receipt id (we store the same on payu_orders.orderId) */
  receipt: string;
  notes?: Record<string, string>;
}

/** Create a Razorpay order. Returns the order with razorpay order_id. */
export async function createRazorpayOrder(args: CreateOrderArgs) {
  const client = getClient();
  return client.orders.create({
    amount: Math.round(args.amountInRupees * 100), // paise
    currency: "INR",
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
