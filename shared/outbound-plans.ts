/**
 * Client Radar research allowances per plan: the one definition the server enforces (server/outbound/limits.ts reads
 * these as defaults, each overridable by an environment variable) and every pricing surface quotes.
 *
 * One credit = one Client Radar search: a search that actually ran on the web (a search that stopped before searching
 * doesn't count; shared/outbound-usage.ts runCountsTowardLimit). Each search looks for up to `maxCompanies` companies,
 * checks their websites and researches the best ones. Allowances run over a rolling 30 days, on top of the daily limit
 * every workspace has.
 *
 * Sizing (measured on production runs, Oct 2026): a completed search cost $0.073 on average and $0.235 at the 90th
 * percentile (search provider + model calls). At Pro's ₹199 (about $2.40), 10 searches a month is about $0.73 on
 * average and about $2.35 at the 90th percentile; the earlier 25 (sized for ₹499) could cost more than the plan earns.
 * The trial gets Pro's allowance; free is a small, real taste.
 */
/** "unlimited": a workspace listed in UNLIMITED_ORG_IDS (server/unlimited.ts), never a plan anyone buys. */
export type OutboundTier = "free" | "trial" | "pro" | "unlimited";

export interface OutboundAllowance {
  /** Searches per rolling 30 days. */
  monthlySearches: number;
  /** The most companies one search may look for, and so the most it researches in depth. */
  maxCompanies: number;
  /** Researched prospects per rolling 30 days: companies a search researched in depth (careers, news, team pages). */
  monthlyProspects: number;
  /** AI-written first messages per rolling 30 days (template follow-ups are not counted). */
  monthlyDrafts: number;
  /** Messages sent through a connected Gmail account per rolling 30 days, across the workspace. */
  monthlySends: number;
}

/**
 * Four separate allowances, each counted over the same rolling 30 days:
 *   searches   one search that ran on the web (one that stopped before searching isn't counted)
 *   prospects  a company a search researched in depth; a running search holds its requested number until it ends,
 *              then only what it really researched counts (a search that found fewer is charged fewer)
 *   drafts     an AI first message that was saved (a draft the checks rejected costs nothing)
 *   sends      a message handed to Gmail (sending or sent; a send that certainly failed frees its slot)
 * Pro's 10 searches of up to 10 companies make the 100-prospect allowance; a search often finds fewer than 10 that fit.
 */
export const OUTBOUND_ALLOWANCE_DEFAULTS: Readonly<Record<OutboundTier, OutboundAllowance>> = {
  free: { monthlySearches: 3, maxCompanies: 10, monthlyProspects: 30, monthlyDrafts: 3, monthlySends: 3 },
  trial: { monthlySearches: 10, maxCompanies: 10, monthlyProspects: 100, monthlyDrafts: 10, monthlySends: 10 },
  pro: { monthlySearches: 10, maxCompanies: 10, monthlyProspects: 100, monthlyDrafts: 10, monthlySends: 10 },
  // Per search it looks for as many companies as Pro (one search stays one search); there is just no monthly count.
  unlimited: { monthlySearches: 1_000_000, maxCompanies: 10, monthlyProspects: 1_000_000, monthlyDrafts: 1_000_000, monthlySends: 1_000_000 },
};

/**
 * A workspace's AI and provider spend ceiling over the same rolling 30 days, in US dollars (WORKSPACE_MONTHLY_SPEND_USD).
 * A safeguard against runaway cost, sized against Pro's ₹199 (about $2.40): at the measured $0.05–0.12 per 10-company
 * search plus about $0.002 per draft, Pro's allowances fit well inside it. Every metered model call and web search
 * reserves against it before it is made.
 */
export const WORKSPACE_MONTHLY_SPEND_USD_DEFAULT = 1.5;

export const OUTBOUND_WINDOW_DAYS = 30;

export const TIER_LABEL: Record<OutboundTier, string> = { free: "Free plan", trial: "Pro trial", pro: "Pro", unlimited: "Unlimited" };
