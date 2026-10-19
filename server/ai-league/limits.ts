/**
 * AI League's own allowances, per plan, all overridable from the environment (the ₹199 Pro price is a hypothesis, so
 * these are settings, not code). Each task ALSO spends the allowance of the feature it uses, enforced there as before:
 * Nibo's research uses Client Radar's searches and researched prospects, Mika's drafts the plan's AI drafts, Zee's
 * summary a small model call under the workspace spend ceiling. Nothing here is unlimited.
 *
 *   LEAGUE_MONTHLY_RUNS_FREE / _PRO     tasks started in a rolling 30 days      (defaults 10 / 60)
 *   LEAGUE_CONCURRENT_FREE / _PRO       tasks working at once, per workspace   (defaults 1 / 2)
 *   LEAGUE_SCHEDULES_FREE / _PRO        recurring tasks, per workspace          (defaults 1 / 5)
 *   LEAGUE_RUN_MAX_MINUTES              how long a task may take before it stops (default 45)
 */
import type { OutboundTier } from "@shared/outbound-plans";

import { LEAGUE_ALLOWANCE_DEFAULTS, LEAGUE_WINDOW_DAYS as WINDOW } from "@shared/ai-league";

export interface LeagueAllowance { monthlyRuns: number; concurrent: number; schedules: number }
const DEFAULTS: Record<"free" | "pro", LeagueAllowance> = LEAGUE_ALLOWANCE_DEFAULTS;
const int = (v: string | undefined, d: number, max = 10_000) => { const n = Number(v); return v !== undefined && v.trim() !== "" && Number.isInteger(n) && n >= 0 && n <= max ? n : d; };

export function leagueAllowance(tier: OutboundTier, env: NodeJS.ProcessEnv = process.env): LeagueAllowance {
  const k = tier === "free" ? "free" : "pro", K = k.toUpperCase();
  return {
    monthlyRuns: int(env[`LEAGUE_MONTHLY_RUNS_${K}`], DEFAULTS[k].monthlyRuns),
    concurrent: Math.max(1, int(env[`LEAGUE_CONCURRENT_${K}`], DEFAULTS[k].concurrent, 10)),
    schedules: int(env[`LEAGUE_SCHEDULES_${K}`], DEFAULTS[k].schedules, 50),
  };
}
export const runMaxMs = (env: NodeJS.ProcessEnv = process.env) => int(env.LEAGUE_RUN_MAX_MINUTES, 45, 600) * 60_000;
export const LEAGUE_WINDOW_DAYS = WINDOW;
