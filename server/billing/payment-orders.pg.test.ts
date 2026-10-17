/**
 * The payment-order claims (server/storage.ts) against a REAL Postgres, driven through razorpay-events.ts with the
 * real storage: concurrent claims grant once, a refund that arrives before its capture closes the order, a failed
 * grant reopens only an order still completed by the same payment, and parked or refunded orders are never claimable.
 * Fixture events only: this proves the database guards, not a real Razorpay transaction.
 *
 * Runs only with MAILBOX_PG_TEST_URL set to a disposable LOCAL database with the full schema. Fresh user and order ids
 * per case; only their rows are deleted.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PaymentEffects, PaymentOrderStore } from "./razorpay-events";

const URL_ = process.env.MAILBOX_PG_TEST_URL;
const loopback = (u?: string) => { try { return !!u && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(u).hostname); } catch { return false; } };

describe.skipIf(!URL_ || !loopback(URL_))("payment orders (real Postgres)", () => {
  let pg: any, q: any;
  let storage: typeof import("../storage").storage;
  let events: typeof import("./razorpay-events");
  let store: PaymentOrderStore;
  const users: string[] = [], orgs: string[] = [];

  beforeAll(async () => {
    // UTC like production (Neon): plan and trial times are zone-less columns written with NOW(), so a session in
    // another zone (this local database defaults to Asia/Kolkata) would shift every expiry by its offset.
    const utc = new URL(URL_!); utc.searchParams.set("options", "-c TimeZone=UTC");
    process.env.DATABASE_URL = utc.toString();
    storage = (await import("../storage")).storage;
    events = await import("./razorpay-events");
    store = {
      getOrder: (id) => storage.getPayuOrder(id),
      getOrderByPaymentId: (id) => storage.getPayuOrderByPaymentId(id),
      completeOnce: (id, u) => storage.completePayuOrderOnce(id, u),
      reopenAfterFailedGrant: (id, p) => storage.reopenPayuOrderAfterFailedGrant(id, p),
      markFailedIfPending: (id) => storage.markPayuOrderFailedIfPending(id),
      markReviewIfOpen: (id, p) => storage.markPayuOrderReviewIfOpen(id, p),
      markRefundedOnce: (id) => storage.markPayuOrderRefundedOnce(id),
      closeUnfulfilledAsRefunded: (id, p) => storage.closeUnfulfilledPayuOrderAsRefunded(id, p),
    };
    ({ default: pg } = await import("pg"));
    q = new pg.Client({ connectionString: process.env.DATABASE_URL }); await q.connect();
  });
  afterAll(async () => {
    for (const u of users) {
      await q.query(`DELETE FROM payu_orders WHERE user_id = $1`, [u]).catch(() => {});
      await q.query(`DELETE FROM users WHERE id = $1`, [u]).catch(() => {});
    }
    for (const o of orgs) {
      await q.query(`DELETE FROM users WHERE organization_id = $1`, [o]).catch(() => {});
      await q.query(`DELETE FROM organizations WHERE id = $1`, [o]).catch(() => {});
    }
    await q?.end();
  });

  const fx = (o: { fail?: boolean } = {}) => {
    const grants: string[] = [];
    const e: PaymentEffects<true> = {
      grant: async (ord) => { if (o.fail) throw new Error("grant failed"); grants.push(ord.orderId); return true; },
      clawback: async () => "revoked",
      audit: async () => {},
      log: () => {},
    };
    return { e, grants };
  };

  async function seed(status = "pending", payuTxnId: string | null = null) {
    const u = `u-${randomBytes(4).toString("hex")}`; users.push(u);
    await q.query(`INSERT INTO users (id, email, first_name) VALUES ($1, $2, 'Ana')`, [u, `${u}@example.test`]);
    const orderId = `order_t${randomBytes(5).toString("hex")}`, paymentId = `pay_t${randomBytes(5).toString("hex")}`;
    await q.query(`INSERT INTO payu_orders (user_id, order_id, amount, credits, purpose, status, payu_txn_id, created_at) VALUES ($1, $2, 499, 0, 'pro_monthly', $3, $4, now() - interval '5 minutes')`, [u, orderId, status, payuTxnId]);
    const entity = { id: paymentId, order_id: orderId, status: "captured", amount: 49_900, currency: "INR", created_at: Math.floor(Date.now() / 1000) - 60 };
    return { orderId, paymentId, entity };
  }
  const statusOf = async (orderId: string) => (await q.query(`SELECT status, payu_txn_id FROM payu_orders WHERE order_id = $1`, [orderId])).rows[0];

  it("ten concurrent capture deliveries grant exactly once", async () => {
    const s = await seed(); const f = fx();
    const out = await Promise.all(Array.from({ length: 10 }, () => events.handleWebhookEvent({ event: "payment.captured", payload: { payment: { entity: s.entity } } }, store, f.e)));
    expect(out.filter((o) => o.kind === "granted")).toHaveLength(1);
    expect(f.grants).toEqual([s.orderId]);
    expect(await statusOf(s.orderId)).toEqual({ status: "completed", payu_txn_id: s.paymentId });
  });

  it("a refund before its capture closes the order; the capture afterwards grants nothing", async () => {
    const s = await seed(); const f = fx();
    const refund = { event: "refund.processed", payload: { refund: { entity: { payment_id: s.paymentId, amount: 49_900 } }, payment: { entity: { ...s.entity, status: "refunded" } } } };
    expect(await events.handleWebhookEvent(refund, store, f.e)).toMatchObject({ kind: "refund_closed_unfulfilled" });
    expect(await events.handleWebhookEvent({ event: "payment.captured", payload: { payment: { entity: s.entity } } }, store, f.e)).toMatchObject({ kind: "already_claimed" });
    expect(f.grants).toEqual([]);
    expect(await statusOf(s.orderId)).toEqual({ status: "refunded", payu_txn_id: s.paymentId });
  });

  it("closing as refunded never touches a completed order or one another payment is recorded on", async () => {
    const done = await seed("completed", "pay_x");
    expect(await storage.closeUnfulfilledPayuOrderAsRefunded(done.orderId, "pay_x")).toBeUndefined();
    const other = await seed("needs_review", "pay_y");
    expect(await storage.closeUnfulfilledPayuOrderAsRefunded(other.orderId, "pay_z")).toBeUndefined();
    expect((await statusOf(other.orderId)).status).toBe("needs_review");
    expect((await storage.closeUnfulfilledPayuOrderAsRefunded(other.orderId, "pay_y"))?.status).toBe("refunded");
  });

  it("a failed grant reopens the order; the reopen refuses a refunded order or a different payment", async () => {
    const s = await seed(); const failing = fx({ fail: true });
    await expect(events.handleWebhookEvent({ event: "payment.captured", payload: { payment: { entity: s.entity } } }, store, failing.e)).rejects.toThrow();
    expect((await statusOf(s.orderId)).status).toBe("pending");
    const ok = fx();
    expect(await events.handleWebhookEvent({ event: "payment.captured", payload: { payment: { entity: s.entity } } }, store, ok.e)).toMatchObject({ kind: "granted" });

    expect(await storage.reopenPayuOrderAfterFailedGrant(s.orderId, "pay_someone_else")).toBe(false);
    await storage.markPayuOrderRefundedOnce(s.orderId);
    expect(await storage.reopenPayuOrderAfterFailedGrant(s.orderId, s.paymentId)).toBe(false);
    expect((await statusOf(s.orderId)).status).toBe("refunded");
  });

  it("needs_review and refunded orders are never claimable", async () => {
    for (const status of ["needs_review", "refunded"]) {
      const s = await seed(status, "pay_old");
      expect(await storage.completePayuOrderOnce(s.orderId, { payuTxnId: "pay_new" })).toBeUndefined();
      expect(await statusOf(s.orderId)).toEqual({ status, payu_txn_id: "pay_old" });
    }
  });

  it("a refund takes Pro away on the very next request, for the owner and every member, whatever their session holds", async () => {
    const { isAuthenticated } = await import("../auth");
    const { requirePro } = await import("../entitlements");
    const org = `o-${randomBytes(4).toString("hex")}`; orgs.push(org);
    await q.query(`INSERT INTO organizations (id, name) VALUES ($1, 'Test agency')`, [org]);
    const owner = `u-${randomBytes(4).toString("hex")}`, member = `u-${randomBytes(4).toString("hex")}`;
    await q.query(`INSERT INTO users (id, email, organization_id, org_role, member_status, trial_ends_at) VALUES ($1, $2, $3, 'OWNER', 'active', now() - interval '1 day'), ($4, $5, $3, 'MEMBER', 'active', now() - interval '1 day')`,
      [owner, `${owner}@example.test`, org, member, `${member}@example.test`]);
    await storage.activateProPlan(owner, 30, "monthly");

    /** One request on a session that has held this user since before the refund, through the real middleware. */
    const call = async (userId: string) => {
      const req: any = { session: { userId, user: { plan: "pro" } } };
      let status = 200;
      const res: any = { status(c: number) { status = c; return this; }, json() { return this; } };
      let passed = false;
      await isAuthenticated(req, res, () => { passed = true; });
      if (!passed) return status;
      passed = false;
      await requirePro("agreements")(req, res, () => { passed = true; });
      return passed ? 200 : status;
    };
    expect([await call(owner), await call(member)]).toEqual([200, 200]);
    await storage.revokeProPlan(owner, 30);
    expect([await call(owner), await call(member)]).toEqual([403, 403]);
  });
});
