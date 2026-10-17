import crypto from "crypto";
import { afterEach, describe, expect, it } from "vitest";
import { ORDER_MAX_AGE_MS, paidAtOf, paymentDecision, refundIsFull, resolveSku } from "./purchase-rules";

describe("what can be bought: one Pro plan, seats only for Pro", () => {
  it("Pro monthly is the one plan on sale", () => {
    expect(resolveSku({ plan: "pro_monthly" }, false)).toEqual({ ok: true, sku: "pro_monthly" });
  });
  it("retired plans and the legacy bodies for them are refused, never swapped for another price", () => {
    for (const body of [{ plan: "pro_yearly" }, { plan: "pro" }, { plan: "deal_boost" }, { credits: 5 }]) {
      expect(resolveSku(body, true)).toMatchObject({ ok: false, status: 410, code: "PLAN_RETIRED" });
    }
  });
  it("extra seats are a Pro add-on (a free workspace can't buy seats)", () => {
    expect(resolveSku({ plan: "extra_seat" }, true)).toEqual({ ok: true, sku: "extra_seat" });
    expect(resolveSku({ plan: "extra_seat" }, false)).toMatchObject({ ok: false, status: 403, code: "UPGRADE_REQUIRED" });
  });
  it("anything else is unknown, and there is no separate AI Outbound or CRM plan", () => {
    for (const plan of ["ai_outbound", "crm", "pro_499", undefined]) expect(resolveSku({ plan }, true)).toMatchObject({ ok: false });
  });
});

describe("a payment grants only when Razorpay's record matches the fresh order", () => {
  const created = new Date("2026-10-17T10:00:00Z");
  const order = { orderId: "order_1", amount: 499, createdAt: created };
  const pay = (o: Partial<{ order_id: string; status: string; amount: number; currency: string }> = {}) =>
    ({ id: "pay_1", order_id: "order_1", status: "captured", amount: 49900, currency: "INR", ...o });
  const soon = new Date(created.getTime() + 5 * 60_000);

  it("captured, INR, the exact amount, within the order's life: grant", () => {
    expect(paymentDecision(order, pay(), soon)).toEqual({ grant: true, capture: false });
  });
  it("authorized only: grant after capturing it", () => {
    expect(paymentDecision(order, pay({ status: "authorized" }), soon)).toEqual({ grant: true, capture: true });
  });
  it("an order created at an old price and paid days later does not grant (needs a person)", () => {
    const old = { ...order, amount: 99 };
    expect(paymentDecision(old, pay({ amount: 9900 }), new Date(created.getTime() + ORDER_MAX_AGE_MS + 1))).toEqual({ grant: false, reason: "order_expired" });
    expect(paymentDecision(old, pay({ amount: 9900 }), new Date(created.getTime() + ORDER_MAX_AGE_MS - 1))).toMatchObject({ grant: true });
  });
  it("a different amount, currency, order or an unpaid status never grants", () => {
    expect(paymentDecision(order, pay({ amount: 9900 }), soon)).toEqual({ grant: false, reason: "amount_mismatch" });
    expect(paymentDecision(order, pay({ currency: "USD" }), soon)).toEqual({ grant: false, reason: "wrong_currency" });
    expect(paymentDecision(order, pay({ order_id: "order_2" }), soon)).toEqual({ grant: false, reason: "wrong_order" });
    for (const status of ["created", "failed", "refunded"]) expect(paymentDecision(order, pay({ status }), soon)).toEqual({ grant: false, reason: "not_paid" });
    expect(paymentDecision({ ...order, createdAt: null }, pay(), soon)).toEqual({ grant: false, reason: "order_expired" });
  });
  it("a delayed webhook is judged by when the payment happened, not when it arrived", () => {
    const p = { ...pay(), created_at: Math.floor(soon.getTime() / 1000) };
    expect(paidAtOf(p, new Date(created.getTime() + 3 * ORDER_MAX_AGE_MS))).toEqual(new Date(Math.floor(soon.getTime() / 1000) * 1000));
    expect(paymentDecision(order, p, paidAtOf(p, new Date(created.getTime() + 3 * ORDER_MAX_AGE_MS)))).toMatchObject({ grant: true });
  });
});

describe("refunds", () => {
  it("only a full refund takes the plan back; a partial one is for review", () => {
    expect(refundIsFull(49900, 49900)).toBe(true);
    expect(refundIsFull(10000, 49900)).toBe(false);
    expect(refundIsFull(undefined, undefined)).toBe(true);
  });
});

describe("Razorpay signatures (checkout and webhook)", () => {
  const saved = { k: process.env.RAZORPAY_KEY_SECRET, w: process.env.RAZORPAY_WEBHOOK_SECRET };
  afterEach(() => { process.env.RAZORPAY_KEY_SECRET = saved.k; process.env.RAZORPAY_WEBHOOK_SECRET = saved.w; });
  const hmac = (secret: string, s: string) => crypto.createHmac("sha256", secret).update(s).digest("hex");

  it("a checkout signature is accepted only for its own order and payment, with the key secret", async () => {
    process.env.RAZORPAY_KEY_SECRET = "test-secret";
    const { verifyPaymentSignature } = await import("../razorpayClient");
    const signature = hmac("test-secret", "order_1|pay_1");
    expect(verifyPaymentSignature({ orderId: "order_1", paymentId: "pay_1", signature })).toBe(true);
    expect(verifyPaymentSignature({ orderId: "order_2", paymentId: "pay_1", signature })).toBe(false);
    expect(verifyPaymentSignature({ orderId: "order_1", paymentId: "pay_1", signature: hmac("other", "order_1|pay_1") })).toBe(false);
    process.env.RAZORPAY_KEY_SECRET = "";
    expect(verifyPaymentSignature({ orderId: "order_1", paymentId: "pay_1", signature })).toBe(false); // fails closed
  });

  it("a webhook is accepted only with the webhook secret over the exact body", async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = "wh-secret";
    const { verifyWebhookSignature } = await import("../razorpayClient");
    const body = JSON.stringify({ event: "payment.captured" });
    expect(verifyWebhookSignature(body, hmac("wh-secret", body))).toBe(true);
    expect(verifyWebhookSignature(body + " ", hmac("wh-secret", body))).toBe(false);
    process.env.RAZORPAY_WEBHOOK_SECRET = "";
    expect(verifyWebhookSignature(body, hmac("wh-secret", body))).toBe(false);
  });

  it("a malformed price in the environment falls back to the default instead of breaking checkout", async () => {
    const { getProMonthlyPrice } = await import("../razorpayClient");
    const before = process.env.PRO_MONTHLY_PRICE;
    process.env.PRO_MONTHLY_PRICE = "₹499";
    expect(getProMonthlyPrice()).toBe(499);
    process.env.PRO_MONTHLY_PRICE = "1";
    expect(getProMonthlyPrice()).toBe(1); // test-mode runs at ₹1 still work
    if (before === undefined) delete process.env.PRO_MONTHLY_PRICE; else process.env.PRO_MONTHLY_PRICE = before;
  });
});
