/**
 * The workspace's AI + provider spend ceiling WITH its purchased credits.
 *
 * The plain ceiling (workspaceMonthlySpendMicroUsd, limits.ts) is sized for the plan's own allowances. A search or a
 * draft someone paid extra for must not then be refused by that same safety ceiling, so the ceiling grows by a
 * configured headroom (billing_config.spend_headroom_usd, per credit) for every purchased credit spent in the window.
 * The headroom is bounded by what was actually bought and spent, so it stays a safeguard, not an open door; the
 * platform's own daily caps (global search and model budgets) are never raised.
 *
 * Any failure to read the credit usage (tables not migrated, database hiccup) returns the plain ceiling: the safe side.
 */
import { OUTBOUND_WINDOW_DAYS } from "@shared/outbound-plans";
import { isUnlimitedOrg } from "../unlimited";
import { workspaceMonthlySpendMicroUsd } from "../outbound/limits";
import { billingConfig } from "./config-cache";

export async function workspaceCeilingMicroUsd(orgId: string | null | undefined, env: Record<string, string | undefined> = process.env, now: Date = new Date()): Promise<number> {
  const base = workspaceMonthlySpendMicroUsd(env, orgId);
  if (!orgId || isUnlimitedOrg(orgId, env)) return base;
  try {
    const { creditsConsumedSince } = await import("./credits");
    const used = await creditsConsumedSince(orgId, new Date(now.getTime() - OUTBOUND_WINDOW_DAYS * 86_400_000));
    const h = billingConfig().spendHeadroomUsd;
    return base + Math.round((used.search * h.search + used.draft * h.draft) * 1_000_000);
  } catch {
    return base;
  }
}
