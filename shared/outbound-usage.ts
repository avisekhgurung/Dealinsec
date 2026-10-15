/**
 * The rules behind the AI Outbound usage view (server/outbound/usage.ts), kept pure so they can be tested and shared
 * with the store's SQL and the test world.
 */

/**
 * Whether a search (a prospect run) uses one of the workspace's daily searches: while it runs, and afterwards only if it
 * made at least one web search. A search that ended before doing any work (stopped by a platform cap, cancelled at
 * once, failed to start) cost nothing and isn't held against the person. The store's countRunsSince applies the same
 * rule in SQL, and starting a search is refused on that count.
 */
export const runCountsTowardLimit = (r: { status: string; counters: unknown }): boolean =>
  r.status === "running" || Number((r.counters as { searched?: unknown } | null)?.searched ?? 0) > 0;

export type PlatformState = "available" | "limited" | "paused" | "unknown";

/** Under a fifth of the AI Outbound model budget left reads as "limited". */
export const LIMITED_SHARE = 0.2;

/**
 * The platform's safety caps as one state, never as numbers: paused when either cap is used up (a search would stop at
 * once), limited when a full search no longer fits (it may stop early), otherwise available. Amounts are micro-dollars.
 */
export function platformState(o: { searchesLeft: number; perSearch: number; poolLimit: number; poolSpent: number; overallLimit: number; overallSpent: number }): PlatformState {
  const values = Object.values(o);
  if (values.some((v) => !Number.isFinite(v))) return "unknown";
  const modelLeft = Math.min(o.poolLimit - o.poolSpent, o.overallLimit - o.overallSpent);
  if (o.searchesLeft <= 0 || modelLeft <= 0) return "paused";
  if (o.searchesLeft < o.perSearch || modelLeft < o.poolLimit * LIMITED_SHARE) return "limited";
  return "available";
}
