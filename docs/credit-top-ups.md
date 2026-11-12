# Credit top-ups

Extra Client Radar searches and AI drafts, bought one-time (no renewal, no trial, no unlimited plan), spent only after
the plan's own allowance. Pro stays ₹299 a month, paid monthly, never auto-renewing; nothing about plans, trials or
`UNLIMITED_ORG_IDS` changed.

## Deploy order (production)

1. **Run the migration on the production database first** (additive, idempotent, safe to repeat):
   `npx tsx --env-file=.env script/migrate-credits.ts`
   The new build refuses to boot without its columns (`schema gate: credit columns present`), so the old build keeps
   serving until this has run.
2. Deploy as usual: `bash script/deploy.sh` (rebuild after the commit first).
3. Make yourself the operator, once, by hand (there is deliberately no route or flag that does this):
   `UPDATE users SET is_platform_admin = true WHERE email = '<your email>';`
   then open `/admin/credits`.
4. Check the packs and the expiry on the Packs tab, buy the smallest pack with a real ₹49 payment, confirm the lot shows
   in `/wallet`, then refund it from the Razorpay dashboard and confirm the unspent credits go to zero.

Rollback: the migration is additive. The previous build ignores every new table and column. Do not drop `credit_lots`
or `credit_ledger` once anything was sold (they hold paid-for balances); `script/migrate-credits.ts` has the statements.

## What was built

| Piece | Where |
|---|---|
| Tables | `credit_packs`, `credit_purchases`, `credit_lots`, `credit_ledger`, `billing_config`, `admin_audit_log`; `funded_by` on `prospect_runs`, `lead_messages`, `channel_messages`; `users.is_platform_admin` |
| Credit store (consume, undo, grant, refund, admin ops) | `server/billing/credits.ts` |
| Pack order creation (terms frozen at order time) | `server/billing/credit-orders.ts` |
| Grant / clawback through the existing payment pipeline | `server/billing/payment-deps.ts` (+ `razorpay-events.ts` unchanged) |
| DB-driven config with env/code fallback | `shared/billing-config.ts`, `server/billing/config-cache.ts`, `config-store.ts` |
| Spend ceiling that grows with spent credits | `server/billing/spend-ceiling.ts` |
| Wallet API + page | `server/billing/wallet.ts`, `routes.ts`; `client/src/pages/wallet.tsx` |
| Hints (80% / 100%) | `client/src/lib/credits.ts`, `draft-allowance.ts`, `search-usage.ts`, `components/credits/top-up.tsx` |
| Admin API + page | `server/admin/routes.ts`, `guard.ts`; `client/src/pages/admin-credits.tsx` |

## How spending works (and why it cannot overspend)

* **Plan first, credits second.** A search or draft counts against the plan's rolling 30-day window as before. Only when
  that window is full does a credit pay, and the action row is marked `funded_by = 'credit'` so the plan's own counts
  skip it: the plan allowance and the purchased balance never mix.
* **Atomic.** Searches: `createRun` (server/outbound/store.ts) counts and consumes inside the same transaction and under
  the same per-workspace advisory lock the plan counts already used; the lot row is `FOR UPDATE`. Drafts: the same, inside
  the draft insert (`message-store.ts`, `channels/store.ts`) under `DRAFT_ALLOWANCE_LOCK`. A refused spend rolls the
  draft/run back: nothing is ever saved unpaid.
* **No negatives.** `credit_lots.remaining` has a CHECK (`0 <= remaining <= units`).
* **Idempotent.** Every consume, undo and refund writes a ledger line keyed `(reason, source_ref)` under a partial unique
  index; replays change nothing. A duplicate draft (unique unsent-draft index) or a duplicate search (idempotency key)
  fails before or rolls back its consume.
* **Failures cost nothing.** A credit-funded search that ends without a single web search gets its credit back, on every
  settle path (finish, cancel, local-search failure), once. Failed model calls never reach the insert.
* **Free:** editing, copying, viewing, manual sends, "Improve" rewrites and self-written messages never touch credits.
* **Ledger invariant** (tested after every case): for each workspace and kind, the sum of every ledger `delta` equals the
  sum of every lot's `remaining`.

## Payments

`plan: "credit_pack", packId` goes through the same `/api/payments/razorpay/order`, `/verify` and webhook as Pro. The pack
is read from the database at order time and its kind, units, price and expiry are frozen in `credit_purchases`, so editing
or retiring a pack never changes what a buyer already ordered or paid. The order is granted once (`completeOnce`), only
when Razorpay's own payment record matches the order's amount, and a double click reuses the still-pending order.
A full refund takes back the lot's **unspent** credits once (spent ones stay spent); a refund arriving before its
capture closes the order, so the later capture grants nothing; a partial refund is recorded for a person.

## Configuration (all editable in `/admin/credits`, no deploy)

Precedence for every allowance: **admin override > environment variable > `OUTBOUND_ALLOWANCE_DEFAULTS`**. Overrides
apply to the free and pro plans only (never to the unlimited grant). Also stored as rows: warning threshold (50–99%),
notification switches, credits per action (1–5), spend headroom per spent credit, default expiry for new packs.
The process reads the table at boot and every 30 seconds; an admin save refreshes the process it was made on at once.

## Decisions for the founder

1. **Expiry.** Seeded packs expire 12 months after purchase, shown before checkout and in the wallet. Never silently:
   a lot that has expired stays visible as "Expired". Change per pack, or clear it for "never expire". Nothing expires
   when a subscription renews or lapses.
2. **The window is rolling, not a calendar reset.** The wallet therefore says *"the next one frees up on <date>"*
   (earliest counted use + 30 days) instead of a made-up first-of-the-month. Changing to a calendar month would
   re-count every workspace's usage at once; it is shown on the admin screen as a fixed rule, not a form field.
3. **Public pages quote code defaults.** Pricing, landing, JSON-LD and llms.txt read `OUTBOUND_ALLOWANCE_DEFAULTS`
   (guarded by `landing-copy.test.ts`). If you override an allowance in the admin screen, change the default in
   `shared/outbound-plans.ts` too, or those pages will quote the old number. The admin screen warns when they differ.
4. **No emails for the 80% / 100% notices.** They are in-app (the draft panel, the Client Radar note, the wallet),
   switchable and with a configurable threshold. Emailing needs a send decision (sender, footer) that is yours.
5. **Credit categories.** Only `search` and `draft` exist; a third category needs an enum value, a CHECK change in the
   migration and the action that spends it, not just a new row.
