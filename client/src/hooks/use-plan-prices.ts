/**
 * Live plan prices from /api/payments/config. The server's prices are
 * env-driven (see server/razorpayClient.ts), so a ₹1 test-mode run shows ₹1
 * everywhere. One cached query is shared by every surface that quotes a
 * price; the defaults mirror the server's and render until the config lands
 * (or if it fails) — so they must stay in step with razorpayClient.ts.
 */
import { useQuery } from "@tanstack/react-query";

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

export const formatRupees = (n: number) => `₹${n.toLocaleString("en-IN")}`;

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
