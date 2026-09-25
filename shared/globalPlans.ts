/**
 * The agreed international Pro price list — one source, read by both the
 * server (order creation, once international checkout is wired) and the
 * client (so a visitor outside India can see their real future price
 * instead of a rupee figure they can't pay). Moved out of
 * server/razorpayClient.ts so the client never has to import that module
 * (Razorpay SDK, server env vars) just to read a price table.
 *
 * STILL NOT WIRED TO CHECKOUT: no order, no charge and no grant reads this.
 * No public page quotes these figures any more (the Razorpay International
 * application was rejected, 2026-09-23, and marketing copy must not imply a
 * date). Kept only as the agreed list prices for when a rail exists.
 *
 * Local round numbers beat a live FX conversion: "£79" reads as a price,
 * "£78.43" reads as a glitch — and a price that moves with the exchange rate
 * can silently contradict the marketing page.
 *
 * India is the only market with a monthly plan. Everywhere else is annual
 * only (a card charge carries a fixed per-transaction cost — trivial once a
 * year, punitive twelve times on a small ticket). The INR row records the
 * list price; live ₹ orders read the env-driven getters in
 * server/razorpayClient.ts instead, so a ₹1 test-mode run keeps working.
 */

export interface PlanPrice {
  /** Amount in MAJOR units of the currency (99 = ₹99 / $99). */
  amount: number;
  currency: string;
  /** Term length in days. */
  days: number;
}

const YEAR_DAYS = 366;
const MONTH_DAYS = 31;

export const GLOBAL_PLANS: Readonly<Record<string, { monthly?: PlanPrice; yearly: PlanPrice }>> = {
  INR: {
    monthly: { amount: 99, currency: "INR", days: MONTH_DAYS },
    yearly: { amount: 999, currency: "INR", days: YEAR_DAYS },
  },
  USD: { yearly: { amount: 99, currency: "USD", days: YEAR_DAYS } },
  GBP: { yearly: { amount: 79, currency: "GBP", days: YEAR_DAYS } },
  EUR: { yearly: { amount: 89, currency: "EUR", days: YEAR_DAYS } },
  AUD: { yearly: { amount: 149, currency: "AUD", days: YEAR_DAYS } },
  CAD: { yearly: { amount: 139, currency: "CAD", days: YEAR_DAYS } },
  SGD: { yearly: { amount: 129, currency: "SGD", days: YEAR_DAYS } },
  AED: { yearly: { amount: 369, currency: "AED", days: YEAR_DAYS } },
};

/** The currency GLOBAL_PLANS falls back to when a visitor's own currency has
 *  no agreed row yet (43 of the app's 50 supported currencies don't) — a
 *  reasonable global anchor, never presented as THEIR price, only as an
 *  example of the range. */
export const GLOBAL_PLANS_FALLBACK_CURRENCY = "USD";

/** The yearly Pro price for a currency: its own row if GLOBAL_PLANS has one,
 *  else the USD anchor. Returns which one it actually is, so a caller can
 *  say "from" instead of implying it's this visitor's exact price. */
export function globalYearlyPriceFor(currency: string): { price: PlanPrice; isExact: boolean } {
  const code = currency?.trim().toUpperCase();
  const exact = code && GLOBAL_PLANS[code];
  if (exact) return { price: exact.yearly, isExact: true };
  return { price: GLOBAL_PLANS[GLOBAL_PLANS_FALLBACK_CURRENCY].yearly, isExact: false };
}
