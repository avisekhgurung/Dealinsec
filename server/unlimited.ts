/**
 * Workspaces with no per-workspace usage limits: UNLIMITED_ORG_IDS, a comma-separated list of organization ids (the
 * founder's own workspaces). For them every per-workspace allowance (Client Radar searches, prospects, AI drafts and
 * sends, daily AI task limits, the 30-day spend ceiling, The Nest's tasks, neural voice) is lifted.
 *
 * The PLATFORM-wide daily safety caps (LLM_GLOBAL_DAILY_SPEND_USD, OUTBOUND_GLOBAL_DAILY_SEARCHES, the pool budgets) still
 * apply to everyone: they protect the provider bill. Raise those on the server when an unlimited workspace needs more.
 * Never set from a request: only the server's environment decides.
 */
type Env = Record<string, string | undefined>;

/** Stands in for "no limit" where a number is needed (counts and comparisons stay ordinary). */
export const UNLIMITED = 1_000_000;
/** The spend ceiling of an unlimited workspace, in millionths of a dollar ($1 billion: never reached). */
export const UNLIMITED_SPEND_MICRO_USD = 1_000_000_000_000_000;

export function unlimitedOrgIds(env: Env = process.env): Set<string> {
  return new Set(String(env.UNLIMITED_ORG_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean));
}

export const isUnlimitedOrg = (orgId: string | null | undefined, env: Env = process.env): boolean =>
  !!orgId && unlimitedOrgIds(env).has(orgId);
