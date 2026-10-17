# Razorpay launch checklist (operator)

Manual steps for the founder before and after opening paid checkout. Nothing here is run by code or by an
assistant: every payment and refund below is made by a person, from their own card or the Razorpay dashboard.

What the code guarantees is covered by tests (`server/billing/*.test.ts`, `server/billing/payment-orders.pg.test.ts`):
a plan is granted only from Razorpay's own payment record, at most once per order; only a full refund takes it
back, once; a refund that arrives before its capture closes the order; a failed grant is retried by Razorpay's
webhook. Those tests use made-up events. **They do not show that the live account sends those events, or that a
real payment and refund behave the same way.** Only the steps below can show that.

## 1. Razorpay dashboard (live mode)

- [ ] **Settings → Webhooks.** One webhook with URL `https://dealinsec.com/api/payments/razorpay/webhook`, active,
      with a secret that equals Render's `RAZORPAY_WEBHOOK_SECRET`. Events:
      `payment.captured`, `order.paid`, `payment.failed`, `refund.processed`, `payment.refunded`.
      (`refund.created` and `refund.failed` are ignored, so they can be left on or off.)
- [ ] **Settings → Payment capture.** Automatic capture on (recommended). If it is manual, the checkout confirmation
      captures the payment itself, and the webhook waits for `payment.captured`.
- [ ] The keys on Render (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`) are **live** keys (`rzp_live_…`) from this account.
- [ ] Render has no `PRO_MONTHLY_PRICE` override, or it is `499`. Check `GET /api/payments/config`: it must report
      `proMonthlyPrice: 499` and `plans: ["pro_monthly","extra_seat"]`.

## 2. Live ₹499 purchase (a real payment, made by you)

Use a workspace you own, located in India, on the free plan or a trial.

- [ ] Open `/pricing`, buy **Pro, ₹499**, and pay with UPI or a card.
- [ ] The app shows Pro as active within a minute. If it says "being confirmed", wait for the webhook (up to a few minutes).
- [ ] The receipt email arrives (₹499, payment id).
- [ ] Settings → Activity shows "Payment applied: DealInSec Pro — 1 month, ₹499".
- [ ] Razorpay dashboard → the payment is **Captured**, ₹499.00, with the order id the app created.
- [ ] Webhooks → recent deliveries show `payment.captured` (and `order.paid`) answered **200**.
- [ ] `npx tsx --env-file=.env script/payment-orders.ts`: the order is not listed as open (it is completed).
- [ ] Pro-only screens (agreements, invoices) open; AI Outbound shows the Pro allowance.

## 3. Live refund (from the Razorpay dashboard)

- [ ] Refund the ₹499 payment in **full** from the dashboard.
- [ ] Webhooks → `refund.processed` and `payment.refunded` answered **200** (whichever arrives second is a no-op).
- [ ] Within a minute the workspace is back on free or its trial. Pro-only actions are refused on the **next**
      request (no sign-out needed), for the owner and for every member.
- [ ] Settings → Activity shows "Refunded, access removed: …".
- [ ] Trying the old checkout again (back button, replay) does not restore Pro.

Optional: a **partial** refund (for example ₹100) on a second purchase keeps Pro. Activity shows "Partial refund
recorded, plan kept for review", and you decide what to do by hand.

## 4. Parked payments (needs_review)

A payment that doesn't match its order (a late payment on an order over 24 hours old, a different amount, a
currency other than INR) is never granted automatically. The buyer is told to email support.

- [ ] List the open orders (read-only): `npx tsx --env-file=.env script/payment-orders.ts --razorpay`
- [ ] To **refund** a parked payment, refund it in the Razorpay dashboard. The refund webhook closes the order, with
      nothing to claw back.
- [ ] To **honour** it instead, start with a dry run: `script/payment-orders.ts grant-reviewed <order_id>`.
      Then run the same command with `--apply`. It grants only when Razorpay holds exactly the captured, unrefunded
      INR payment for that order's own amount, and it writes an audit line.

Orders created at an old price (₹99 Pro) are never changed or refunded by any script. Once older than 24 hours, a
payment against one is parked for review.

## 5. AI Outbound budget (Render environment)

The platform caps default low: 30 web searches a day, and $1 a day for the model, split $0.50 for AI Outbound and
$0.50 for lead research and drafting. Set the launch values on Render deliberately:
`OUTBOUND_GLOBAL_DAILY_SEARCHES`, `LLM_GLOBAL_DAILY_SPEND_USD`, `LLM_OUTBOUND_DAILY_SPEND_USD` and
`LLM_SALES_DAILY_SPEND_USD`. Keep the global value at least the sum of the two pools.

Watch real usage with `npx tsx --env-file=.env script/outbound-costs.ts 14` (read-only), and revisit after the first week.
