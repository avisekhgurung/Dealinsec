/**
 * AI Outbound research allowances per plan: the one definition the server enforces (server/outbound/limits.ts reads
 * these as defaults, each overridable by an environment variable) and every pricing surface quotes.
 *
 * One credit = one AI Outbound search: a search that actually ran on the web (a search that stopped before searching
 * doesn't count; shared/outbound-usage.ts runCountsTowardLimit). Each search looks for up to `maxCompanies` companies,
 * checks their websites and researches the best ones. Allowances run over a rolling 30 days, on top of the daily limit
 * every workspace has.
 *
 * Sizing (Oct 2026, measured on production runs): a completed search cost $0.07 on average, $0.15 at the 90th
 * percentile (search provider + model calls), for about 22 companies requested. Pro's 25 searches a month is therefore
 * about $1.75 on average and under $4 at the 90th percentile, inside ₹499. Free and trial are small, real tastes.
 */
export type OutboundTier = "free" | "trial" | "pro";

export interface OutboundAllowance {
  /** Searches per rolling 30 days. */
  monthlySearches: number;
  /** The most companies one search may look for. */
  maxCompanies: number;
}

export const OUTBOUND_ALLOWANCE_DEFAULTS: Readonly<Record<OutboundTier, OutboundAllowance>> = {
  free: { monthlySearches: 3, maxCompanies: 10 },
  trial: { monthlySearches: 10, maxCompanies: 25 },
  pro: { monthlySearches: 25, maxCompanies: 25 },
};

export const OUTBOUND_WINDOW_DAYS = 30;

export const TIER_LABEL: Record<OutboundTier, string> = { free: "Free plan", trial: "Pro trial", pro: "Pro" };
