/**
 * Razorpay checkout confirmation and webhooks (razorpay-events.ts) against fixture events: duplicates, out-of-order
 * and late deliveries, partial and full refunds, grant failures and historical orders. The in-memory store applies the
 * same status guards as the SQL claims in server/storage.ts (payment-orders.pg.test.ts runs these against Postgres).
 * These are code-level checks with made-up events: they prove what the code does with such events, not that Razorpay
 * sends them this way in production.
 */
import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PayuOrder } from "@shared/schema";
import { confirmCheckout, handleWebhookEvent, parseWebhook, type PaymentAudit, type PaymentEffects, type PaymentOrderStore, type RazorpayEvent } from "./razorpay-events";
import type { RazorpayPayment } from "./purchase-rules";
import { verifyPaymentSignature, verifyWebhookSignature } from "../razorpayClient";

const NOW = new Date("2026-10-17T10:00:00Z");
const sec = (d: Date) => Math.floor(d.getTime() / 1000);
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const HOUR = 3_600_000, DAY = 24 * HOUR;

function memoryStore(rows: PayuOrder[]): PaymentOrderStore & { rows: PayuOrder[] } {
  const find = (id: string) => rows.find((r) => r.orderId === id);
  const update = (id: string, when: (r: PayuOrder) => boolean, set: Partial<PayuOrder>) => {
    const r = find(id);
    if (!r || !when(r)) return undefined;
    Object.assign(r, set);
    return { ...r };
  };
  return {
    rows,
    getOrder: async (id) => { const r = find(id); return r && { ...r }; },
    getOrderByPaymentId: async (p) => { const r = rows.find((x) => x.payuTxnId === p); return r && { ...r }; },
    completeOnce: async (id, u) => update(id, (r) => r.status === "pending" || r.status === "failed", { ...u, status: "completed" }),
    reopenAfterFailedGrant: async (id, p) => !!update(id, (r) => r.status === "completed" && r.payuTxnId === p, { status: "pending", completedAt: null }),
    markFailedIfPending: async (id) => { update(id, (r) => r.status === "pending", { status: "failed" }); },
    markReviewIfOpen: async (id, p) => !!update(id, (r) => r.status === "pending" || r.status === "failed", { status: "needs_review", payuTxnId: p }),
    markRefundedOnce: async (id) => update(id, (r) => r.status === "completed", { status: "refunded" }),
    closeUnfulfilledAsRefunded: async (id, p) => update(id, (r) => ["pending", "failed", "needs_review"].includes(r.status) && (!r.payuTxnId || r.payuTxnId === p), { status: "refunded", payuTxnId: p }),
  };
}

const order = (o: Partial<PayuOrder> = {}): PayuOrder => ({
  id: 1, userId: "u1", orderId: "order_A", amount: 499, credits: 0, purpose: "pro_monthly", status: "pending",
  payuTxnId: null, payuHash: null, createdAt: ago(10 * 60_000), completedAt: null, ...o,
});

function effects(o: { grantFails?: number; onGrant?: () => Promise<void> } = {}) {
  let fails = o.grantFails ?? 0;
  const grants: string[] = [], clawbacks: string[] = [], audits: (PaymentAudit & { orderId: string })[] = [];
  const fx: PaymentEffects<{ ok: true }> = {
    grant: async (ord) => {
      await o.onGrant?.();
      if (fails > 0) { fails--; throw new Error("transient grant failure"); }
      grants.push(ord.orderId);
      return { ok: true };
    },
    clawback: async (ord) => { clawbacks.push(ord.orderId); return "revoked"; },
    audit: async (ord, entry) => { audits.push({ ...entry, orderId: ord.orderId }); },
    log: () => {},
  };
  return { fx, grants, clawbacks, audits };
}

const payment = (o: Record<string, unknown> = {}) => ({
  id: "pay_1", order_id: "order_A", status: "captured", amount: 49_900, currency: "INR", created_at: sec(ago(5 * 60_000)), amount_refunded: 0, ...o,
});
const captured = (p: Record<string, unknown> = {}): RazorpayEvent => ({ event: "payment.captured", payload: { payment: { entity: payment(p) } } });
const orderPaid = (p: Record<string, unknown> = {}): RazorpayEvent => ({ event: "order.paid", payload: { payment: { entity: payment(p) } } });
const refundProcessed = (amount: number, p: Record<string, unknown> = {}): RazorpayEvent => ({
  event: "refund.processed",
  payload: { refund: { entity: { id: `rfnd_${amount}`, payment_id: p.id ?? "pay_1", amount, currency: "INR", status: "processed" } }, payment: { entity: payment({ status: "refunded", ...p }) } },
});
const paymentRefunded = (amountRefunded: number, p: Record<string, unknown> = {}): RazorpayEvent => ({
  event: "payment.refunded", payload: { payment: { entity: payment({ status: "refunded", amount_refunded: amountRefunded, ...p }) } },
});

describe("webhook authentication (parseWebhook)", () => {
  const SECRET = "whsec_test_only";
  const sign = (raw: string) => crypto.createHmac("sha256", SECRET).update(raw).digest("hex");
  beforeEach(() => { process.env.RAZORPAY_WEBHOOK_SECRET = SECRET; return () => { delete process.env.RAZORPAY_WEBHOOK_SECRET; }; });

  it("accepts the exact bytes Razorpay signed, even when re-serialising would change them", () => {
    const raw = '{ "event" : "payment.captured",  "payload": {} }';
    const r = parseWebhook(Buffer.from(raw), sign(raw), verifyWebhookSignature);
    expect(r).toMatchObject({ ok: true, event: { event: "payment.captured" } });
  });

  it("refuses a missing raw body, a missing or wrong signature, a tampered body and invalid JSON", () => {
    const raw = JSON.stringify(captured());
    expect(parseWebhook(undefined, sign(raw), verifyWebhookSignature)).toMatchObject({ ok: false, status: 400 });
    expect(parseWebhook(Buffer.from(raw), undefined, verifyWebhookSignature)).toMatchObject({ ok: false, status: 400 });
    expect(parseWebhook(Buffer.from(raw), "0".repeat(64), verifyWebhookSignature)).toMatchObject({ ok: false, status: 400 });
    expect(parseWebhook(Buffer.from(raw.replace("49900", "1")), sign(raw), verifyWebhookSignature)).toMatchObject({ ok: false, status: 400 });
    expect(parseWebhook(Buffer.from("not json"), sign("not json"), verifyWebhookSignature)).toMatchObject({ ok: false, status: 400 });
  });

  it("refuses everything when no webhook secret is configured", () => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    const raw = JSON.stringify(captured());
    expect(parseWebhook(Buffer.from(raw), sign(raw), verifyWebhookSignature)).toMatchObject({ ok: false });
  });
});

describe("payment.captured / order.paid", () => {
  it("grants once; a re-delivered payment.captured and the order.paid that follows are no-ops", async () => {
    const store = memoryStore([order()]); const e = effects();
    expect(await handleWebhookEvent(captured(), store, e.fx, NOW)).toMatchObject({ kind: "granted", orderId: "order_A", paymentId: "pay_1" });
    expect(await handleWebhookEvent(captured(), store, e.fx, NOW)).toMatchObject({ kind: "already_claimed" });
    expect(await handleWebhookEvent(orderPaid(), store, e.fx, NOW)).toMatchObject({ kind: "already_claimed" });
    expect(e.grants).toEqual(["order_A"]);
    expect(store.rows[0]).toMatchObject({ status: "completed", payuTxnId: "pay_1" });
    expect(e.audits.map((a) => a.action)).toEqual(["payment_granted"]);
  });

  it("the checkout confirmation and the webhook racing grant exactly once", async () => {
    const store = memoryStore([order()]); const e = effects();
    const deps = { store, fx: e.fx, verifySignature: () => true, fetchPayment: async () => payment() as RazorpayPayment, capturePayment: vi.fn(), now: NOW };
    const [a, b] = await Promise.all([
      confirmCheckout({ userId: "u1", orderId: "order_A", paymentId: "pay_1", signature: "sig" }, deps),
      handleWebhookEvent(captured(), store, e.fx, NOW),
    ]);
    expect(e.grants).toEqual(["order_A"]);
    expect([a.kind, b.kind].filter((k) => k === "granted")).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ status: "completed", payuTxnId: "pay_1" });
  });

  it("a webhook delivered days late still grants when the payment itself was made in time", async () => {
    const store = memoryStore([order({ createdAt: ago(3 * DAY + HOUR) })]); const e = effects();
    const late = captured({ created_at: sec(ago(3 * DAY)) }); // paid an hour after the order, delivered three days later
    expect(await handleWebhookEvent(late, store, e.fx, NOW)).toMatchObject({ kind: "granted" });
  });

  it("a payment that doesn't match the order (amount, currency) is parked for review, never granted", async () => {
    for (const [p, reason] of [[{ amount: 100 }, "amount_mismatch"], [{ currency: "USD" }, "wrong_currency"]] as const) {
      const store = memoryStore([order()]); const e = effects();
      expect(await handleWebhookEvent(captured(p), store, e.fx, NOW)).toMatchObject({ kind: "needs_review", reason });
      expect(store.rows[0].status).toBe("needs_review");
      expect(e.grants).toEqual([]);
      // ...and stays parked: a re-delivery or a matching retry on the same order can't claim it.
      expect(await handleWebhookEvent(captured(), store, e.fx, NOW)).toMatchObject({ kind: "already_claimed" });
      expect(e.grants).toEqual([]);
    }
  });

  it("an authorized-only payment waits for its capture; an event for an order we never created is ignored", async () => {
    const store = memoryStore([order()]); const e = effects();
    expect(await handleWebhookEvent(captured({ status: "authorized" }), store, e.fx, NOW)).toEqual({ kind: "ignored", reason: "not_captured_yet" });
    expect(await handleWebhookEvent(captured({ order_id: "order_elsewhere" }), store, e.fx, NOW)).toEqual({ kind: "ignored", reason: "unknown_order" });
    expect(await handleWebhookEvent({ event: "order.paid", payload: {} }, store, e.fx, NOW)).toEqual({ kind: "ignored", reason: "no_payment_entity" });
    expect(store.rows[0].status).toBe("pending");
  });
});

describe("historical ₹99 orders (created before the ₹499 launch, never paid)", () => {
  const historical = () => order({ orderId: "order_99", amount: 99, createdAt: new Date("2026-10-09T08:00:00Z") });

  it("paid now, a ₹99 order is past its 24 hours: parked for review, not granted", async () => {
    const store = memoryStore([historical()]); const e = effects();
    expect(await handleWebhookEvent(captured({ order_id: "order_99", amount: 9_900, created_at: sec(NOW) }), store, e.fx, NOW))
      .toMatchObject({ kind: "needs_review", reason: "order_expired" });
    expect(e.grants).toEqual([]);
    expect(e.audits).toEqual([{ action: "payment_needs_review", reason: "order_expired", orderId: "order_99" }]);
  });

  it("a ₹499 payment against a ₹99 order is an amount mismatch, not a grant", async () => {
    const store = memoryStore([historical()]); const e = effects();
    expect(await handleWebhookEvent(captured({ order_id: "order_99", amount: 49_900, created_at: sec(NOW) }), store, e.fx, NOW))
      .toMatchObject({ kind: "needs_review", reason: "amount_mismatch" });
    expect(e.grants).toEqual([]);
  });

  it("the browser can't grant it either, and once parked it reports review instead of success", async () => {
    const store = memoryStore([historical()]); const e = effects();
    const deps = { store, fx: e.fx, verifySignature: () => true, fetchPayment: async () => payment({ order_id: "order_99", amount: 9_900, created_at: sec(NOW) }) as RazorpayPayment, capturePayment: vi.fn(), now: NOW };
    const input = { userId: "u1", orderId: "order_99", paymentId: "pay_1", signature: "sig" };
    expect(await confirmCheckout(input, deps)).toMatchObject({ kind: "needs_review", reason: "order_expired" });
    expect(await confirmCheckout(input, deps)).toMatchObject({ kind: "needs_review" });
    expect(e.grants).toEqual([]);
  });

  it("refunding a parked ₹99 payment from the dashboard closes the order without clawing anything back", async () => {
    const store = memoryStore([historical()]); const e = effects();
    await handleWebhookEvent(captured({ order_id: "order_99", amount: 9_900, created_at: sec(NOW) }), store, e.fx, NOW);
    expect(await handleWebhookEvent(refundProcessed(9_900, { order_id: "order_99", amount: 9_900 }), store, e.fx, NOW)).toMatchObject({ kind: "refund_closed_unfulfilled" });
    expect(store.rows[0].status).toBe("refunded");
    expect(e.clawbacks).toEqual([]);
  });
});

describe("payment.failed", () => {
  it("marks only a pending order failed, and a successful retry on the same order still grants", async () => {
    const store = memoryStore([order()]); const e = effects();
    expect(await handleWebhookEvent({ event: "payment.failed", payload: { payment: { entity: payment({ id: "pay_0", status: "failed" }) } } }, store, e.fx, NOW)).toMatchObject({ kind: "marked_failed" });
    expect(store.rows[0].status).toBe("failed");
    expect(await handleWebhookEvent(captured(), store, e.fx, NOW)).toMatchObject({ kind: "granted" });
    // A late failure event for the earlier attempt doesn't touch the completed order.
    await handleWebhookEvent({ event: "payment.failed", payload: { payment: { entity: payment({ id: "pay_0", status: "failed" }) } } }, store, e.fx, NOW);
    expect(store.rows[0].status).toBe("completed");
  });
});

describe("refunds", () => {
  const paid = () => memoryStore([order({ status: "completed", payuTxnId: "pay_1", completedAt: ago(HOUR) })]);

  it("a full refund takes the plan back once, however many refund events arrive", async () => {
    const store = paid(); const e = effects();
    expect(await handleWebhookEvent(refundProcessed(49_900), store, e.fx, NOW)).toMatchObject({ kind: "refunded", clawback: "revoked" });
    expect(await handleWebhookEvent(refundProcessed(49_900), store, e.fx, NOW)).toMatchObject({ kind: "ignored", reason: "refund_already_applied" });
    expect(await handleWebhookEvent(paymentRefunded(49_900), store, e.fx, NOW)).toMatchObject({ kind: "ignored" });
    expect(e.clawbacks).toEqual(["order_A"]);
    expect(store.rows[0].status).toBe("refunded");
  });

  it("a partial refund keeps the plan and is recorded for review", async () => {
    const store = paid(); const e = effects();
    expect(await handleWebhookEvent(refundProcessed(10_000), store, e.fx, NOW)).toMatchObject({ kind: "refund_partial" });
    expect(await handleWebhookEvent(paymentRefunded(10_000), store, e.fx, NOW)).toMatchObject({ kind: "refund_partial" });
    expect(store.rows[0].status).toBe("completed");
    expect(e.clawbacks).toEqual([]);
    expect(e.audits.map((a) => a.action)).toEqual(["payment_refund_partial", "payment_refund_partial"]);
  });

  it("partial refunds that add up to the whole payment count as a full refund", async () => {
    const viaPaymentRefunded = paid(); const e1 = effects();
    await handleWebhookEvent(paymentRefunded(20_000), viaPaymentRefunded, e1.fx, NOW);
    expect(await handleWebhookEvent(paymentRefunded(49_900), viaPaymentRefunded, e1.fx, NOW)).toMatchObject({ kind: "refunded" });
    const viaRefundProcessed = paid(); const e2 = effects();
    await handleWebhookEvent(refundProcessed(20_000, { amount_refunded: 20_000 }), viaRefundProcessed, e2.fx, NOW);
    expect(await handleWebhookEvent(refundProcessed(29_900, { amount_refunded: 49_900 }), viaRefundProcessed, e2.fx, NOW)).toMatchObject({ kind: "refunded" });
    expect([e1.clawbacks, e2.clawbacks]).toEqual([["order_A"], ["order_A"]]);
  });

  it("a refund that arrives BEFORE its capture closes the order, so the late capture can't grant", async () => {
    const store = memoryStore([order()]); const e = effects();
    expect(await handleWebhookEvent(refundProcessed(49_900), store, e.fx, NOW)).toMatchObject({ kind: "refund_closed_unfulfilled", orderId: "order_A" });
    expect(await handleWebhookEvent(captured(), store, e.fx, NOW)).toMatchObject({ kind: "already_claimed" });
    expect(e.grants).toEqual([]);
    expect(e.clawbacks).toEqual([]);
    // The browser replaying the checkout afterwards is refused too.
    const deps = { store, fx: e.fx, verifySignature: () => true, fetchPayment: async () => payment() as RazorpayPayment, capturePayment: vi.fn(), now: NOW };
    expect(await confirmCheckout({ userId: "u1", orderId: "order_A", paymentId: "pay_1", signature: "sig" }, deps)).toEqual({ kind: "refunded" });
  });

  it("a refund for a different payment than the one that paid the order claws nothing back", async () => {
    const store = paid(); const e = effects();
    expect(await handleWebhookEvent(refundProcessed(49_900, { id: "pay_other" }), store, e.fx, NOW)).toEqual({ kind: "refund_unmatched", paymentId: "pay_other" });
    expect(store.rows[0].status).toBe("completed");
    expect(e.clawbacks).toEqual([]);
  });

  it("refund.created and refund.failed change nothing", async () => {
    const store = paid(); const e = effects();
    for (const ev of ["refund.created", "refund.failed"]) {
      expect(await handleWebhookEvent({ ...refundProcessed(49_900), event: ev }, store, e.fx, NOW)).toEqual({ kind: "ignored", reason: "event_not_handled" });
    }
    expect(store.rows[0].status).toBe("completed");
  });
});

describe("a grant that fails", () => {
  it("reopens the order and throws, so Razorpay's retry delivers it exactly once", async () => {
    const store = memoryStore([order()]); const e = effects({ grantFails: 1 });
    await expect(handleWebhookEvent(captured(), store, e.fx, NOW)).rejects.toThrow("transient grant failure");
    expect(store.rows[0]).toMatchObject({ status: "pending", completedAt: null });
    expect(e.audits.map((a) => a.action)).toEqual(["payment_grant_failed"]);
    expect(await handleWebhookEvent(captured(), store, e.fx, NOW)).toMatchObject({ kind: "granted" });
    expect(e.grants).toEqual(["order_A"]);
  });

  it("never reopens an order a refund closed in the meantime", async () => {
    const store = memoryStore([order()]);
    const e = effects({ grantFails: 1, onGrant: async () => { await store.markRefundedOnce("order_A"); } });
    await expect(handleWebhookEvent(captured(), store, e.fx, NOW)).rejects.toThrow();
    expect(store.rows[0].status).toBe("refunded");
    expect(await handleWebhookEvent(captured(), store, e.fx, NOW)).toMatchObject({ kind: "already_claimed" });
    expect(e.grants).toEqual([]);
  });

  it("from the checkout path too: the error surfaces and the webhook can deliver later", async () => {
    const store = memoryStore([order()]); const e = effects({ grantFails: 1 });
    const deps = { store, fx: e.fx, verifySignature: () => true, fetchPayment: async () => payment() as RazorpayPayment, capturePayment: vi.fn(), now: NOW };
    await expect(confirmCheckout({ userId: "u1", orderId: "order_A", paymentId: "pay_1", signature: "sig" }, deps)).rejects.toThrow();
    expect(store.rows[0].status).toBe("pending");
    expect(await handleWebhookEvent(captured(), store, e.fx, NOW)).toMatchObject({ kind: "granted" });
  });
});

describe("checkout confirmation (confirmCheckout)", () => {
  const SECRET = "rzp_key_secret_test_only";
  const sig = (o: string, p: string) => crypto.createHmac("sha256", SECRET).update(`${o}|${p}`).digest("hex");
  const setup = (o: Partial<PayuOrder> = {}, pay: Record<string, unknown> = {}) => {
    const store = memoryStore([order(o)]); const e = effects();
    const capturePayment = vi.fn(async () => ({}));
    const fetchPayment = vi.fn(async () => payment(pay) as RazorpayPayment);
    return { store, e, capturePayment, fetchPayment, deps: { store, fx: e.fx, verifySignature: verifyPaymentSignature, fetchPayment, capturePayment, now: NOW } };
  };
  beforeEach(() => { process.env.RAZORPAY_KEY_SECRET = SECRET; return () => { delete process.env.RAZORPAY_KEY_SECRET; }; });
  const input = (s = sig("order_A", "pay_1")) => ({ userId: "u1", orderId: "order_A", paymentId: "pay_1", signature: s });

  it("grants only after the signature AND Razorpay's own payment record check out", async () => {
    const t = setup();
    expect(await confirmCheckout(input(), t.deps)).toMatchObject({ kind: "granted" });
    expect(t.fetchPayment).toHaveBeenCalledWith("pay_1");
    expect(t.store.rows[0]).toMatchObject({ status: "completed", payuTxnId: "pay_1" });
    expect(await confirmCheckout(input(), t.deps)).toEqual({ kind: "already_processed" });
    expect(t.e.grants).toEqual(["order_A"]);
  });

  it("a forged signature grants nothing and asks Razorpay nothing", async () => {
    const t = setup();
    expect(await confirmCheckout(input("f".repeat(64)), t.deps)).toEqual({ kind: "bad_signature" });
    expect(t.fetchPayment).not.toHaveBeenCalled();
    expect(t.store.rows[0].status).toBe("failed");
  });

  it("someone else's order is refused before anything else", async () => {
    const t = setup();
    expect(await confirmCheckout({ ...input(), userId: "intruder" }, t.deps)).toEqual({ kind: "forbidden" });
    expect(t.store.rows[0].status).toBe("pending");
  });

  it("when Razorpay can't be reached, or capture fails, nothing is granted and the order stays open for the webhook", async () => {
    const down = setup(); down.fetchPayment.mockRejectedValueOnce(new Error("ETIMEDOUT"));
    expect(await confirmCheckout(input(), down.deps)).toEqual({ kind: "pending" });
    expect(down.store.rows[0].status).toBe("pending");
    expect(await handleWebhookEvent(captured(), down.store, down.e.fx, NOW)).toMatchObject({ kind: "granted" });

    const auth = setup({}, { status: "authorized" }); auth.capturePayment.mockRejectedValueOnce(new Error("BAD_REQUEST"));
    expect(await confirmCheckout(input(), auth.deps)).toEqual({ kind: "pending" });
    expect(auth.e.grants).toEqual([]);
  });

  it("an authorized payment is captured for its exact amount, then granted", async () => {
    const t = setup({}, { status: "authorized" });
    expect(await confirmCheckout(input(), t.deps)).toMatchObject({ kind: "granted" });
    expect(t.capturePayment).toHaveBeenCalledWith("pay_1", 49_900);
  });

  it("a payment Razorpay reports as failed, or for another order, is parked for review", async () => {
    const failed = setup({}, { status: "failed" });
    expect(await confirmCheckout(input(), failed.deps)).toMatchObject({ kind: "needs_review", reason: "not_paid" });
    const other = setup({}, { order_id: "order_B" });
    expect(await confirmCheckout(input(), other.deps)).toMatchObject({ kind: "needs_review", reason: "wrong_order" });
    expect([failed.e.grants, other.e.grants]).toEqual([[], []]);
  });

  it("replaying the checkout after a refund is refused", async () => {
    const t = setup({ status: "refunded", payuTxnId: "pay_1" });
    expect(await confirmCheckout(input(), t.deps)).toEqual({ kind: "refunded" });
    expect(t.e.grants).toEqual([]);
  });
});

describe("operator review of a parked order (reviewedGrantCheck)", () => {
  const parked = { status: "needs_review", payuTxnId: "pay_1", amount: 99 };
  const pay = (o: Record<string, unknown> = {}) => ({ ...payment({ amount: 9_900 }), amount_refunded: 0, ...o }) as any;
  it("allows only the exact captured, unrefunded INR payment the order was parked with", async () => {
    const { reviewedGrantCheck } = await import("./razorpay-events");
    expect(reviewedGrantCheck(parked, [pay(), pay({ id: "pay_0", status: "failed" })])).toEqual({ ok: true, paymentId: "pay_1" });
    expect(reviewedGrantCheck({ ...parked, status: "pending" }, [pay()])).toMatchObject({ ok: false });
    expect(reviewedGrantCheck({ ...parked, payuTxnId: null }, [pay()])).toMatchObject({ ok: false });
    expect(reviewedGrantCheck(parked, [])).toMatchObject({ ok: false });
    expect(reviewedGrantCheck(parked, [pay(), pay({ id: "pay_2" })])).toMatchObject({ ok: false });
    expect(reviewedGrantCheck(parked, [pay({ id: "pay_2" })])).toMatchObject({ ok: false });
    expect(reviewedGrantCheck(parked, [pay({ amount_refunded: 100 })])).toMatchObject({ ok: false });
    expect(reviewedGrantCheck(parked, [pay({ status: "refunded", amount_refunded: 9_900 })])).toMatchObject({ ok: false });
    expect(reviewedGrantCheck(parked, [pay({ currency: "USD" })])).toMatchObject({ ok: false });
    expect(reviewedGrantCheck(parked, [pay({ amount: 49_900 })])).toMatchObject({ ok: false, reason: "the payment is ₹499, the order ₹99" });
  });
});
