/**
 * Workspace allowances for AI Outbound, all counted from the database (provider_calls, prospect_runs, llm_calls),
 * never from memory: the instance sleeps and restarts. Each is a whole number of at least 1; anything else is the default.
 *   OUTBOUND_DAILY_RUNS            discovery runs per workspace per 24 h          (default 5)
 *   OUTBOUND_DAILY_SEARCHES        search-provider calls per workspace per 24 h   (default 60)
 *   OUTBOUND_DAILY_CONTACT_LOOKUPS contact-provider lookups per workspace per 24 h (default 30)
 *   OUTBOUND_DAILY_COMPANY_LOOKUPS company-data (Apollo) lookups per workspace per 24 h (default 100)
 * Model calls have their own per-task allowances (SALES_DAILY_<TASK>_LIMIT, shared/llm-cost.ts).
 *
 * Per plan, over a rolling 30 days (shared/outbound-plans.ts says exactly what each one counts):
 *   OUTBOUND_MONTHLY_SEARCHES_FREE / _TRIAL / _PRO   searches                         (defaults 3 / 10 / 10)
 *   OUTBOUND_MAX_COMPANIES_FREE / _TRIAL / _PRO      companies one search may look for (defaults 10 / 10 / 10)
 *   OUTBOUND_MONTHLY_PROSPECTS_FREE / _TRIAL / _PRO  researched prospects              (defaults 30 / 100 / 100)
 *   OUTBOUND_MONTHLY_DRAFTS_FREE / _TRIAL / _PRO     AI first-message drafts           (defaults 3 / 10 / 10)
 *   OUTBOUND_MONTHLY_SENDS_FREE / _TRIAL / _PRO      Gmail sends                       (defaults 3 / 10 / 10)
 *   WORKSPACE_MONTHLY_SPEND_USD                      model + provider spend per workspace (default $1.50)
 *
 * Platform-wide, every workspace together, per UTC day (on top of the above, never instead of it):
 *   OUTBOUND_GLOBAL_DAILY_SEARCHES search-provider calls                          (default 30: about 900 a month, inside Tavily's 1,000 free credits)
 *   LLM_GLOBAL_DAILY_SPEND_USD     model spend for every sales and outbound task  (default $1.00, shared/llm-cost.ts)
 */
import { OUTBOUND_ALLOWANCE_DEFAULTS, WORKSPACE_MONTHLY_SPEND_USD_DEFAULT, type OutboundAllowance, type OutboundTier } from "@shared/outbound-plans";

const int = (v: string | undefined, d: number) => { const n = Number(v); return Number.isInteger(n) && n >= 1 ? n : d; };
export const dailyRunLimit = () => int(process.env.OUTBOUND_DAILY_RUNS, 5);
export const dailySearchLimit = () => int(process.env.OUTBOUND_DAILY_SEARCHES, 60);
export const dailyContactLimit = () => int(process.env.OUTBOUND_DAILY_CONTACT_LOOKUPS, 30);
export const dailyCompanyLimit = () => int(process.env.OUTBOUND_DAILY_COMPANY_LOOKUPS, 100);
export const globalSearchLimit = () => int(process.env.OUTBOUND_GLOBAL_DAILY_SEARCHES, 30);
/** Local business searches (Google Places) across all workspaces per UTC day: 30 a day stays inside the 1,000 free a month. */
export const globalLocalSearchLimit = () => int(process.env.OUTBOUND_GLOBAL_DAILY_LOCAL_SEARCHES, 30);


/** A plan's AI Outbound allowance: the shared defaults, each overridable by its environment variable. */
export function outboundAllowance(tier: OutboundTier): OutboundAllowance {
  const d = OUTBOUND_ALLOWANCE_DEFAULTS[tier], up = tier.toUpperCase(), env = process.env;
  return {
    monthlySearches: int(env[`OUTBOUND_MONTHLY_SEARCHES_${up}`], d.monthlySearches),
    maxCompanies: int(env[`OUTBOUND_MAX_COMPANIES_${up}`], d.maxCompanies),
    monthlyProspects: int(env[`OUTBOUND_MONTHLY_PROSPECTS_${up}`], d.monthlyProspects),
    monthlyDrafts: int(env[`OUTBOUND_MONTHLY_DRAFTS_${up}`], d.monthlyDrafts),
    monthlySends: int(env[`OUTBOUND_MONTHLY_SENDS_${up}`], d.monthlySends),
  };
}

/** The workspace spend ceiling in millionths of a dollar (WORKSPACE_MONTHLY_SPEND_USD; a missing, zero or unreadable value is the default, never "no limit"). */
export function workspaceMonthlySpendMicroUsd(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.WORKSPACE_MONTHLY_SPEND_USD);
  return Math.round((Number.isFinite(n) && n > 0 ? n : WORKSPACE_MONTHLY_SPEND_USD_DEFAULT) * 1_000_000);
}
