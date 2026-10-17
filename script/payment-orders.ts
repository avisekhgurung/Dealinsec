/**
 * Operator view of Razorpay payment orders. READ-ONLY unless a subcommand is given AND --apply is passed.
 *
 *   npx tsx --env-file=.env script/payment-orders.ts                       list open orders (DB only, read-only session)
 *   npx tsx --env-file=.env script/payment-orders.ts --razorpay            also read each open order's payments from
 *                                                                          Razorpay (GET only; ids, status and amounts)
 *   npx tsx --env-file=.env script/payment-orders.ts grant-reviewed <order_id>          check a parked order (dry run)
 *   npx tsx --env-file=.env script/payment-orders.ts grant-reviewed <order_id> --apply  apply its plan after review
 *
 * "Open" means pending, failed or needs_review. Nothing here refunds money: refund from the Razorpay dashboard, and the
 * refund webhook closes the order (a parked or unpaid order is closed with nothing to claw back; a completed one has
 * its plan taken back). grant-reviewed applies a parked order's plan only when Razorpay holds exactly the captured,
 * unrefunded INR payment it was parked with, for the order's own amount (reviewedGrantCheck), and writes an audit line.
 *
 * Dev and production share one Neon database: this reads production. Emails are masked; no payment details beyond
 * ids, status and amounts are printed.
 */
import pg from "pg";
import { paymentDecision, ORDER_MAX_AGE_MS } from "../server/billing/purchase-rules";

// The columns are zone-less timestamps holding UTC (the database runs in GMT); read them as UTC whatever this
// machine's zone is (node-postgres would otherwise read them as local time).
pg.types.setTypeParser(1114, (v: string) => new Date(v.replace(" ", "T") + "Z"));

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
const host = (() => { try { return new URL(url).host; } catch { return "unknown host"; } })();
const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const positional = args.filter((a) => !a.startsWith("--"));

const mask = (email: string | null) => {
  if (!email) return "(no email)";
  const [u, d] = email.split("@");
  return `${u.slice(0, 1)}***@${d ?? ""}`;
};
const ageOf = (d: Date) => {
  const h = (Date.now() - d.getTime()) / 3_600_000;
  return h < 48 ? `${h.toFixed(1)}h` : `${(h / 24).toFixed(1)}d`;
};

async function inspect() {
  const c = new pg.Client({ connectionString: url, options: "-c TimeZone=UTC" });
  await c.connect();
  await c.query("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
  console.log(`Payment orders on ${host} (read-only)\n`);
  const counts = (await c.query(`SELECT status, purpose, amount, count(*)::int AS n FROM payu_orders GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`)).rows;
  console.log("By status, purpose and amount (₹):");
  for (const r of counts) console.log(`  ${r.status.padEnd(13)} ${r.purpose.padEnd(12)} ₹${String(r.amount).padEnd(6)} × ${r.n}`);
  const open = (await c.query(`
    SELECT o.order_id, o.status, o.purpose, o.amount, o.credits, o.payu_txn_id, o.created_at, u.id AS user_id, u.email, u.plan, u.plan_expires_at
    FROM payu_orders o LEFT JOIN users u ON u.id = o.user_id
    WHERE o.status IN ('pending', 'failed', 'needs_review') ORDER BY o.created_at`)).rows;
  await c.end();

  console.log(`\nOpen orders: ${open.length}`);
  const { getProMonthlyPrice, fetchRazorpayOrderPayments, isRazorpayConfigured } = await import("../server/razorpayClient");
  const current = getProMonthlyPrice();
  for (const o of open) {
    const created = new Date(o.created_at);
    // What would happen if this order's full amount were captured right now.
    const ifPaidNow = paymentDecision({ orderId: o.order_id, amount: o.amount, createdAt: created }, { id: "x", order_id: o.order_id, status: "captured", amount: o.amount * 100, currency: "INR" }, new Date());
    console.log(`\n  ${o.order_id}  ${o.status}  ${o.purpose}  ₹${o.amount}${o.purpose === "pro_monthly" && o.amount !== current ? `  (old price; Pro is ₹${current} now)` : ""}`);
    console.log(`    created ${created.toISOString()} (${ageOf(created)} ago; orders older than ${ORDER_MAX_AGE_MS / 3_600_000}h never grant automatically)`);
    console.log(`    buyer ${o.user_id ?? "?"} ${mask(o.email)}  plan=${o.plan ?? "?"}${o.plan_expires_at ? ` until ${new Date(o.plan_expires_at).toISOString().slice(0, 10)}` : ""}`);
    console.log(`    payment on order: ${o.payu_txn_id ?? "none"}   if paid now: ${ifPaidNow.grant ? "would grant" : `parked for review (${ifPaidNow.reason})`}`);
    if (flag("--razorpay")) {
      if (!isRazorpayConfigured()) { console.log("    Razorpay: not configured here"); continue; }
      try {
        const payments = await fetchRazorpayOrderPayments(o.order_id);
        if (!payments.length) console.log("    Razorpay: no payment attempts on this order");
        for (const p of payments) console.log(`    Razorpay: ${p.id} ${p.status} ₹${p.amount / 100} ${p.currency}${p.amount_refunded ? ` refunded ₹${p.amount_refunded / 100}` : ""} at ${p.created_at ? new Date(p.created_at * 1000).toISOString() : "?"}`);
      } catch (e) {
        console.log(`    Razorpay: could not read (${(e as any)?.error?.code ?? (e as Error)?.name ?? "error"})`);
      }
    }
  }
  console.log(`\nNothing was changed.${flag("--razorpay") ? "" : " Add --razorpay to also read Razorpay's record of each open order (read-only)."}`);
}

async function grantReviewed(orderId: string | undefined) {
  if (!orderId) { console.error("Usage: payment-orders.ts grant-reviewed <order_id> [--apply]"); process.exit(1); }
  const apply = flag("--apply");
  const { storage } = await import("../server/storage");
  const { fetchRazorpayOrderPayments } = await import("../server/razorpayClient");
  const { reviewedGrantCheck } = await import("../server/billing/razorpay-events");
  const order = await storage.getPayuOrder(orderId);
  if (!order) { console.error(`No order ${orderId} on ${host}.`); process.exit(1); }
  const payments = await fetchRazorpayOrderPayments(orderId);
  const check = reviewedGrantCheck(order, payments);
  console.log(`${orderId} on ${host}: ${order.status}, ${order.purpose}, ₹${order.amount}, payment ${order.payuTxnId ?? "none"}`);
  for (const p of payments) console.log(`  Razorpay: ${p.id} ${p.status} ₹${p.amount / 100} ${p.currency}${p.amount_refunded ? ` refunded ₹${p.amount_refunded / 100}` : ""}`);
  if (!check.ok) { console.log(`\nNot eligible: ${check.reason}. Nothing was changed.`); process.exit(2); }
  if (!apply) { console.log(`\nEligible: applying would grant ${order.purpose} to user ${order.userId}. Dry run, nothing changed; re-run with --apply to apply it.`); return; }

  const { paymentEffects } = await import("../server/billing/payment-deps");
  const claimed = await storage.completeReviewedPayuOrderOnce(orderId, check.paymentId);
  if (!claimed) { console.log("Someone else changed this order first; nothing was changed."); process.exit(2); }
  try {
    await paymentEffects.grant(claimed);
  } catch (e) {
    await storage.returnPayuOrderToReview(orderId, check.paymentId);
    console.error(`Grant failed (${(e as Error).message}); the order is back in needs_review.`);
    process.exit(1);
  }
  await paymentEffects.audit(claimed, { action: "payment_granted", source: "operator" });
  console.log(`Applied: ${order.purpose} granted to user ${order.userId}; order ${orderId} is completed (audit line written).`);
}

const cmd = positional[0];
(cmd === "grant-reviewed" ? grantReviewed(positional[1]) : cmd ? Promise.reject(new Error(`Unknown command ${cmd}`)) : inspect())
  .then(() => process.exit(0))
  .catch((e) => { console.error((e as Error).message); process.exit(1); });
