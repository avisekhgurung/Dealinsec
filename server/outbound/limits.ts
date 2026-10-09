/**
 * Workspace allowances for AI Outbound, all counted from the database (provider_calls, prospect_runs, llm_calls),
 * never from memory: the instance sleeps and restarts. Each is a whole number of at least 1; anything else is the default.
 *   OUTBOUND_DAILY_RUNS            discovery runs per workspace per 24 h          (default 5)
 *   OUTBOUND_DAILY_SEARCHES        search-provider calls per workspace per 24 h   (default 60)
 *   OUTBOUND_DAILY_CONTACT_LOOKUPS contact-provider lookups per workspace per 24 h (default 30)
 * Model calls have their own per-task allowances (SALES_DAILY_<TASK>_LIMIT, shared/llm-cost.ts).
 */
const int = (v: string | undefined, d: number) => { const n = Number(v); return Number.isInteger(n) && n >= 1 ? n : d; };
export const dailyRunLimit = () => int(process.env.OUTBOUND_DAILY_RUNS, 5);
export const dailySearchLimit = () => int(process.env.OUTBOUND_DAILY_SEARCHES, 60);
export const dailyContactLimit = () => int(process.env.OUTBOUND_DAILY_CONTACT_LOOKUPS, 30);
