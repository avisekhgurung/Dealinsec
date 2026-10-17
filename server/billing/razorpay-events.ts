/**
 * What a Razorpay checkout confirmation (the browser's verify call) and a Razorpay webhook do to our payment orders,
 * kept free of Express and the database so every case can be tested: duplicate and re-delivered events, events that
 * arrive late or out of order (a refund before its capture), partial and full refunds, and a grant that fails.
 *
 * The rules:
 *  - Only Razorpay's own record of a payment can grant: the webhook's signed payment entity, or the payment fetched
 *    from Razorpay after a verified checkout signature (paymentDecision checks order, INR, exact amount, captured,
 *    order age). A browser redirect alone grants nothing.
 *  - An order is granted at most once: completeOnce is an atomic pending/failed → completed claim, and refunded and
 *    needs_review are never claimable.
 *  - Only a FULL refund takes the plan back, once (markRefundedOnce is completed → refunded). A partial refund is
 *    recorded for a person to decide.
 *  - A full refund for an order that never granted (its capture hasn't arrived, or it was parked for review) closes
 *    it as refunded, so a capture arriving afterwards can't grant a plan for money already returned.
 *  - If delivering a claimed order throws, the claim is reopened (only while it is still completed by this payment)
 *    and the error is re-thrown, so Razorpay retries the webhook and the money is never kept without delivering.
 *
 * Routes (server/routes.ts) supply the store, the grant/clawback effects and the Razorpay API calls.
 */
import type { PayuOrder } from "@shared/schema";
import { paidAtOf, paymentDecision, refundIsFull, type PaymentDecision, type RazorpayPayment } from "./purchase-rules";

export interface PaymentOrderStore {
  getOrder(orderId: string): Promise<PayuOrder | undefined>;
  getOrderByPaymentId(paymentId: string): Promise<PayuOrder | undefined>;
  completeOnce(orderId: string, updates: Partial<PayuOrder>): Promise<PayuOrder | undefined>;
  reopenAfterFailedGrant(orderId: string, paymentId: string): Promise<boolean>;
  markFailedIfPending(orderId: string): Promise<void>;
  markReviewIfOpen(orderId: string, paymentId: string): Promise<boolean>;
  markRefundedOnce(orderId: string): Promise<PayuOrder | undefined>;
  closeUnfulfilledAsRefunded(orderId: string, paymentId: string): Promise<PayuOrder | undefined>;
}

/** An audit line for the buyer's workspace activity log: ids and amounts only, never card, UPI or contact details. */
export type PaymentAudit =
  | { action: "payment_granted"; source: "checkout" | "webhook" | "operator" }
  | { action: "payment_needs_review"; reason: string }
  | { action: "payment_grant_failed" }
  | { action: "payment_refunded"; clawback: "revoked" | "lapsed" }
  | { action: "payment_refund_closed_unfulfilled" }
  | { action: "payment_refund_partial" };

export interface PaymentEffects<G = unknown> {
  /** Deliver what the order bought. Throws if it can't be delivered yet. */
  grant(order: PayuOrder): Promise<G>;
  /** Take back what a fully refunded order granted, unless that term already lapsed on its own. */
  clawback(order: PayuOrder): Promise<"revoked" | "lapsed">;
  audit(order: PayuOrder, entry: PaymentAudit): Promise<void>;
  log(message: string, fields: Record<string, unknown>): void;
}

// ── Webhook ───────────────────────────────────────────────────────────────────────────────────────────────────────

export type WebhookParse = { ok: true; event: RazorpayEvent } | { ok: false; status: 400; error: string };

export interface RazorpayEvent {
  event?: string;
  payload?: {
    payment?: { entity?: Record<string, unknown> };
    refund?: { entity?: Record<string, unknown> };
  };
}

/**
 * Authenticate a webhook: the HMAC is over the exact bytes Razorpay sent, so a request whose raw body wasn't kept is
 * refused rather than re-serialised (JSON.stringify of a parsed body is not guaranteed to reproduce those bytes, and
 * accepting it would make the check depend on our own parser).
 */
export function parseWebhook(rawBody: Buffer | string | undefined | null, signature: unknown, verify: (raw: string, sig: string) => boolean): WebhookParse {
  if (rawBody == null || (typeof rawBody !== "string" && !Buffer.isBuffer(rawBody))) return { ok: false, status: 400, error: "Missing webhook body" };
  if (typeof signature !== "string" || !signature) return { ok: false, status: 400, error: "Invalid webhook signature" };
  const raw = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  if (!verify(raw, signature)) return { ok: false, status: 400, error: "Invalid webhook signature" };
  try {
    const event = JSON.parse(raw);
    if (!event || typeof event !== "object") return { ok: false, status: 400, error: "Invalid webhook body" };
    return { ok: true, event };
  } catch {
    return { ok: false, status: 400, error: "Invalid webhook body" };
  }
}

export type WebhookOutcome<G = unknown> =
  | { kind: "ignored"; reason: string }
  | { kind: "granted"; orderId: string; order: PayuOrder; paymentId: string; result: G }
  | { kind: "already_claimed"; orderId: string }
  | { kind: "needs_review"; orderId: string; reason: string }
  | { kind: "marked_failed"; orderId: string }
  | { kind: "refund_partial"; paymentId: string }
  | { kind: "refunded"; orderId: string; clawback: "revoked" | "lapsed" }
  | { kind: "refund_closed_unfulfilled"; orderId: string }
  | { kind: "refund_unmatched"; paymentId: string };

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : typeof v === "number" ? String(v) : null);

function paymentOf(entity: Record<string, unknown>): RazorpayPayment {
  return {
    id: String(entity.id),
    order_id: str(entity.order_id),
    status: String(entity.status),
    amount: Number(entity.amount),
    currency: String(entity.currency),
    created_at: Number(entity.created_at) || undefined,
  };
}

/** Handle one authenticated webhook event. Throws only when Razorpay should retry (a grant that couldn't deliver). */
export async function handleWebhookEvent<G>(event: RazorpayEvent, store: PaymentOrderStore, fx: PaymentEffects<G>, now: Date = new Date()): Promise<WebhookOutcome<G>> {
  const name = event.event;
  const paymentEntity = event.payload?.payment?.entity;

  if (name === "payment.captured" || name === "order.paid") {
    // Only a payment entity can grant: it carries the amount, currency and status to check (an order.paid without one
    // waits for payment.captured, which every captured payment also sends).
    const orderId = str(paymentEntity?.order_id), paymentId = str(paymentEntity?.id);
    if (!paymentEntity || !orderId || !paymentId) return { kind: "ignored", reason: "no_payment_entity" };
    const order = await store.getOrder(orderId);
    if (!order) return { kind: "ignored", reason: "unknown_order" };
    const payment = paymentOf(paymentEntity);
    const decision = paymentDecision({ orderId: order.orderId, amount: order.amount, createdAt: order.createdAt }, payment, paidAtOf(payment, now));
    if (!decision.grant) return review(order, paymentId, decision, store, fx);
    // An authorized-only payment is captured by the checkout path (or auto-capture); its payment.captured follows.
    if (decision.capture) return { kind: "ignored", reason: "not_captured_yet" };
    const done = await claimAndGrant(order, paymentId, { payuTxnId: paymentId, completedAt: now }, "webhook", store, fx);
    return done.kind === "granted" ? { ...done, paymentId } : done;
  }

  if (name === "payment.failed") {
    // A failed attempt only marks a still-pending order failed (which stays claimable, so a successful retry on the
    // same order still grants); a completed, refunded or review order is never touched.
    const orderId = str(paymentEntity?.order_id);
    if (!orderId) return { kind: "ignored", reason: "no_order" };
    const order = await store.getOrder(orderId);
    if (!order) return { kind: "ignored", reason: "unknown_order" };
    await store.markFailedIfPending(orderId);
    return { kind: "marked_failed", orderId };
  }

  if (name === "refund.processed" || name === "payment.refunded") {
    const refundEntity = event.payload?.refund?.entity;
    const paymentId = str(refundEntity?.payment_id) ?? str(paymentEntity?.id);
    if (!paymentId) return { kind: "ignored", reason: "no_payment" };
    // Full when this refund, or everything refunded on the payment so far (several partial refunds), covers it.
    const paymentAmount = paymentEntity?.amount;
    const full = name === "payment.refunded"
      ? refundIsFull(paymentEntity?.amount_refunded, paymentAmount)
      : refundIsFull(refundEntity?.amount, paymentAmount)
        || (paymentEntity?.amount_refunded != null && refundIsFull(paymentEntity.amount_refunded, paymentAmount));

    // The order this payment completed or was parked under; failing that (the refund arrived before the capture
    // webhook recorded the payment), the payment's own order, but only if no other payment is recorded on it.
    let order = await store.getOrderByPaymentId(paymentId);
    if (!order) {
      const orderId = str(paymentEntity?.order_id);
      const byOrder = orderId ? await store.getOrder(orderId) : undefined;
      if (byOrder && (!byOrder.payuTxnId || byOrder.payuTxnId === paymentId)) order = byOrder;
    }
    if (!order) {
      fx.log("Razorpay webhook: refund for a payment no order records", { paymentId });
      return { kind: "refund_unmatched", paymentId };
    }
    if (!full) {
      fx.log("Razorpay webhook: partial refund, plan kept for review", { orderId: order.orderId, paymentId });
      await fx.audit(order, { action: "payment_refund_partial" });
      return { kind: "refund_partial", paymentId };
    }
    const claimed = await store.markRefundedOnce(order.orderId);
    if (claimed) {
      const clawback = await fx.clawback(claimed);
      await fx.audit(claimed, { action: "payment_refunded", clawback });
      return { kind: "refunded", orderId: claimed.orderId, clawback };
    }
    const closed = await store.closeUnfulfilledAsRefunded(order.orderId, paymentId);
    if (closed) {
      await fx.audit(closed, { action: "payment_refund_closed_unfulfilled" });
      return { kind: "refund_closed_unfulfilled", orderId: closed.orderId };
    }
    return { kind: "ignored", reason: "refund_already_applied" };
  }

  return { kind: "ignored", reason: "event_not_handled" };
}

async function review<G>(order: PayuOrder, paymentId: string, decision: Extract<PaymentDecision, { grant: false }>, store: PaymentOrderStore, fx: PaymentEffects<G>): Promise<WebhookOutcome<G>> {
  if (await store.markReviewIfOpen(order.orderId, paymentId)) {
    fx.log("Razorpay: payment not granted, parked for review", { orderId: order.orderId, reason: decision.reason });
    await fx.audit(order, { action: "payment_needs_review", reason: decision.reason });
  }
  return { kind: "needs_review", orderId: order.orderId, reason: decision.reason };
}

async function claimAndGrant<G>(order: PayuOrder, paymentId: string, updates: Partial<PayuOrder>, source: "checkout" | "webhook", store: PaymentOrderStore, fx: PaymentEffects<G>): Promise<{ kind: "granted"; orderId: string; result: G; order: PayuOrder } | { kind: "already_claimed"; orderId: string }> {
  const claimed = await store.completeOnce(order.orderId, updates);
  if (!claimed) return { kind: "already_claimed", orderId: order.orderId };
  let result: G;
  try {
    result = await fx.grant(claimed);
  } catch (error) {
    // Reopen so a retry (or Razorpay's webhook retry) can deliver; otherwise a transient failure is paid-but-never-
    // delivered, because every retry would lose the claim.
    await store.reopenAfterFailedGrant(order.orderId, paymentId).catch(() => false);
    await fx.audit(claimed, { action: "payment_grant_failed" }).catch(() => {});
    throw error;
  }
  await fx.audit(claimed, { action: "payment_granted", source });
  return { kind: "granted", orderId: order.orderId, result, order: claimed };
}

// ── Checkout confirmation (the browser's verify call) ────────────────────────────────────────────────────────────

export interface CheckoutDeps<G> {
  store: PaymentOrderStore;
  fx: PaymentEffects<G>;
  verifySignature(args: { orderId: string; paymentId: string; signature: string }): boolean;
  fetchPayment(paymentId: string): Promise<RazorpayPayment>;
  capturePayment(paymentId: string, amountPaise: number): Promise<unknown>;
  now?: Date;
}

export type CheckoutOutcome<G> =
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "already_processed" }
  | { kind: "refunded" }
  | { kind: "needs_review"; reason: string }
  | { kind: "bad_signature" }
  | { kind: "pending" }
  | { kind: "granted"; order: PayuOrder; result: G };

/**
 * Confirm a checkout the browser reports. A valid checkout signature proves the checkout, not the money, so Razorpay's
 * own payment record decides; when Razorpay can't be reached, nothing is granted here (`pending`) and the
 * payment.captured webhook grants it instead.
 */
export async function confirmCheckout<G>(input: { userId: string; orderId: string; paymentId: string; signature: string }, deps: CheckoutDeps<G>): Promise<CheckoutOutcome<G>> {
  const { store, fx } = deps;
  const now = deps.now ?? new Date();
  const order = await store.getOrder(input.orderId);
  if (!order) return { kind: "not_found" };
  if (order.userId !== input.userId) return { kind: "forbidden" };
  if (order.status === "completed") return { kind: "already_processed" };
  // Refunded is terminal: the checkout signature stays valid forever, so a replay after a refund must not re-grant.
  if (order.status === "refunded") return { kind: "refunded" };
  // Parked for a person: never claimable automatically (and saying "success" here would be untrue).
  if (order.status === "needs_review") return { kind: "needs_review", reason: "under_review" };

  if (!deps.verifySignature({ orderId: input.orderId, paymentId: input.paymentId, signature: input.signature })) {
    await store.markFailedIfPending(input.orderId);
    return { kind: "bad_signature" };
  }

  let payment: RazorpayPayment;
  try {
    payment = await deps.fetchPayment(input.paymentId);
  } catch (error) {
    fx.log("Razorpay verify: payment fetch failed", { orderId: input.orderId, errorType: (error as Error)?.name ?? "Error" });
    return { kind: "pending" };
  }
  const decision = paymentDecision({ orderId: order.orderId, amount: order.amount, createdAt: order.createdAt }, payment, now);
  if (!decision.grant) {
    await review(order, input.paymentId, decision, store, fx);
    return { kind: "needs_review", reason: decision.reason };
  }
  if (decision.capture) {
    try {
      await deps.capturePayment(input.paymentId, payment.amount);
    } catch (error) {
      fx.log("Razorpay verify: capture failed", { orderId: input.orderId, errorType: (error as Error)?.name ?? "Error" });
      return { kind: "pending" };
    }
  }

  const done = await claimAndGrant(order, input.paymentId, { payuTxnId: input.paymentId, payuHash: input.signature, completedAt: now }, "checkout", store, fx);
  if (done.kind === "granted") return { kind: "granted", order: done.order, result: done.result };
  // The webhook claimed it first; report what the order is now.
  const latest = await store.getOrder(input.orderId);
  if (latest?.status === "refunded") return { kind: "refunded" };
  if (latest?.status === "needs_review") return { kind: "needs_review", reason: "under_review" };
  return { kind: "already_processed" };
}

// ── Operator review (script/payment-orders.ts) ───────────────────────────────────────────────────────────────────

export interface OrderPaymentRecord extends RazorpayPayment { amount_refunded: number }

/**
 * May a person apply the plan of an order parked for review? Only when Razorpay holds exactly the payment it was
 * parked with, captured, in INR, for the order's own amount, with nothing refunded. Anything else is for a refund
 * from the Razorpay dashboard (whose webhook then closes the order), never for a grant.
 */
export function reviewedGrantCheck(order: Pick<PayuOrder, "status" | "payuTxnId" | "amount">, payments: OrderPaymentRecord[]):
  { ok: true; paymentId: string } | { ok: false; reason: string } {
  if (order.status !== "needs_review") return { ok: false, reason: `order is ${order.status}, not needs_review` };
  if (!order.payuTxnId) return { ok: false, reason: "no payment is recorded on the order" };
  const captured = payments.filter((p) => p.status === "captured" || p.status === "refunded");
  if (captured.length !== 1) return { ok: false, reason: `Razorpay holds ${captured.length} captured payments for this order` };
  const p = captured[0];
  if (p.id !== order.payuTxnId) return { ok: false, reason: "the captured payment is not the one the order was parked with" };
  if (p.status !== "captured" || p.amount_refunded > 0) return { ok: false, reason: "the payment has been (partly) refunded" };
  if (String(p.currency).toUpperCase() !== "INR") return { ok: false, reason: "the payment is not in INR" };
  if (p.amount !== Math.round(order.amount * 100)) return { ok: false, reason: `the payment is ₹${p.amount / 100}, the order ₹${order.amount}` };
  return { ok: true, paymentId: p.id };
}
