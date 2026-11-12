/** The query keys of the credit views, and the one refresh that keeps them all in step after a purchase or a spend. */
import { queryClient } from "@/lib/queryClient";

export const WALLET_URL = "/api/credits/wallet";
export const PACKS_URL = "/api/credits/packs";
export const USAGE_URL = "/api/outbound/usage";

export const refreshCreditViews = () =>
  Promise.all([WALLET_URL, PACKS_URL, USAGE_URL].map((k) => queryClient.invalidateQueries({ queryKey: [k] })));
