/**
 * Workspace allowances for AI Outbound, all counted from the database (provider_calls, prospect_runs, llm_calls),
 * never from memory: the instance sleeps and restarts. Each is a whole number of at least 1; anything else is the default.
 *   OUTBOUND_DAILY_RUNS            discovery runs per workspace per 24 h          (default 5)
 *   OUTBOUND_DAILY_SEARCHES        search-provider calls per workspace per 24 h   (default 60)
 *   OUTBOUND_DAILY_CONTACT_LOOKUPS contact-provider lookups per workspace per 24 h (default 30)
 *   OUTBOUND_DAILY_COMPANY_LOOKUPS company-data (Apollo) lookups per workspace per 24 h (default 100)
 * Model calls have their own per-task allowances (SALES_DAILY_<TASK>_LIMIT, shared/llm-cost.ts).
 *
 * Platform-wide, every workspace together, per UTC day (on top of the above, never instead of it):
 *   OUTBOUND_GLOBAL_DAILY_SEARCHES search-provider calls                          (default 30: about 900 a month, inside Tavily's 1,000 free credits)
 *   LLM_GLOBAL_DAILY_SPEND_USD     model spend for every sales and outbound task  (default $1.00, shared/llm-cost.ts)
 */
const int = (v: string | undefined, d: number) => { const n = Number(v); return Number.isInteger(n) && n >= 1 ? n : d; };
export const dailyRunLimit = () => int(process.env.OUTBOUND_DAILY_RUNS, 5);
export const dailySearchLimit = () => int(process.env.OUTBOUND_DAILY_SEARCHES, 60);
export const dailyContactLimit = () => int(process.env.OUTBOUND_DAILY_CONTACT_LOOKUPS, 30);
export const dailyCompanyLimit = () => int(process.env.OUTBOUND_DAILY_COMPANY_LOOKUPS, 100);
export const globalSearchLimit = () => int(process.env.OUTBOUND_GLOBAL_DAILY_SEARCHES, 30);
