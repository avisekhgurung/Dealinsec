/**
 * Live plan prices from /api/payments/config. The server's prices are
 * env-driven (see server/razorpayClient.ts), so a ₹1 test-mode run shows ₹1
 * everywhere. One cached query is shared by every surface that quotes a
 * price; the defaults mirror the server's and render until the config lands
 * (or if it fails) — so they must stay in step with razorpayClient.ts.
 */
import { useQuery } from "@tanstack/react-query";
import { formatMoney } from "@/lib/format";
import { useLocale, useMoney } from "@/hooks/use-locale";
import { toMinor } from "@shared/schema";
import { globalYearlyPriceFor } from "@shared/globalPlans";

export const PLAN_PRICE_DEFAULTS = {
  proMonthlyPrice: 99,
  proYearlyPrice: 999,
  extraSeatPrice: 99,
} as const;

interface PaymentsConfig {
  proMonthlyPrice?: number;
  proYearlyPrice?: number;
  extraSeatPrice?: number;
}

/**
 * The DealInSec subscription price — pinned to INR on purpose, and the one
 * money string in the app that does NOT follow the user's currency.
 *
 * Every plan order is created in rupees on a domestic Razorpay account.
 * International checkout is NOT live — it is pending Razorpay International
 * approval, and the agreed foreign price list (GLOBAL_PLANS in
 * server/razorpayClient.ts) is not wired to anything. So the only price that
 * can actually be charged is a rupee price, and only a customer in India can
 * pay it (see usePlanCheckoutAvailable). Printing "£79" would advertise a
 * price nothing can charge. Their own deals still render in their own
 * currency — this is our price, not their money.
 *
 * `PaymentsConfig` quotes whole rupees (see server/razorpayClient.ts), so it
 * crosses into minor units here rather than the caller doing it ad hoc.
 */
export const formatRupees = (n: number) => formatMoney(toMinor(n, "INR"), "INR", "en-IN");

/** The one country a plan can be bought from until international checkout is
 *  live. A country code, not a tax rule: it only decides who sees a buy button. */
const PLAN_CHECKOUT_COUNTRY = "IN";

/**
 * Whether this person may be shown a buy button for a plan today. False means
 * show the plans with an "international checkout is coming soon" note instead
 * — a buy button there would either fail at Razorpay or charge rupees to
 * someone who was never told that is what they are paying.
 *
 * BOTH the person's own country and their workspace's must be India. Either
 * alone gets a real case wrong: Settings edits only the workspace's country,
 * so the person's row can be stale; and a member abroad in an Indian
 * workspace pays with their own card, not the workspace's. Failing closed on
 * either costs a rare Indian customer an email to support; failing open
 * charges someone the wrong way.
 *
 * India stays exactly as it was: every pre-expansion row backfilled to IN, and
 * while the workspace row loads useMoney() falls back to the person's own
 * country — so an Indian account never renders a single frame without its buy
 * buttons.
 */
export function usePlanCheckoutAvailable(): boolean {
  const { country: personCountry } = useLocale();
  const { settings: { country: workspaceCountry } } = useMoney();
  return personCountry === PLAN_CHECKOUT_COUNTRY && workspaceCountry === PLAN_CHECKOUT_COUNTRY;
}

/**
 * What an international visitor will eventually pay, once checkout opens for
 * their country — read from shared/globalPlans.ts, NEVER from a live order
 * (checkout still refuses every non-₹ order; see usePlanCheckoutAvailable).
 * `isExact` is false when their own currency has no agreed row yet (43 of the
 * 50 the app supports don't) and this is the USD anchor instead — the caller
 * should say "from $99/year", not imply that figure is their own price.
 */
export function useInternationalPlanPrice(): { label: string; isExact: boolean; currency: string } {
  const { settings } = useMoney();
  const { price, isExact } = globalYearlyPriceFor(settings.currency);
  return {
    label: formatMoney(toMinor(price.amount, price.currency), price.currency, settings.locale),
    isExact,
    currency: price.currency,
  };
}

export function usePlanPrices({ enabled = true }: { enabled?: boolean } = {}) {
  const { data } = useQuery<PaymentsConfig>({
    queryKey: ["/api/payments/config"],
    enabled,
    // Prices change on a deploy, not mid-session.
    staleTime: 10 * 60 * 1000,
  });
  return {
    proMonthlyPrice: data?.proMonthlyPrice || PLAN_PRICE_DEFAULTS.proMonthlyPrice,
    proYearlyPrice: data?.proYearlyPrice || PLAN_PRICE_DEFAULTS.proYearlyPrice,
    extraSeatPrice: data?.extraSeatPrice || PLAN_PRICE_DEFAULTS.extraSeatPrice,
  };
}
