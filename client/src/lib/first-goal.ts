/**
 * The person's first goal (asked during onboarding) and whether they dismissed
 * the dashboard's "Get started" checklist. Browser-only on purpose: neither is
 * worth a database column, and the checklist's PROGRESS never lives here — it
 * is derived from real records (shared/getting-started.ts), so it resumes on
 * any device even when this storage is empty.
 *
 * Keyed by user id, so two accounts in one browser don't share answers. Every
 * access is wrapped: storage can be blocked or throw (private windows,
 * cleared site data), and that must only ever mean "not chosen / not dismissed".
 */
import { isFirstGoal, type FirstGoal } from "@shared/getting-started";

const goalKey = (userId: string) => `dis_first_goal:${userId}`;
const dismissedKey = (userId: string) => `dis_getting_started_dismissed:${userId}`;

export function getFirstGoal(userId: string | null | undefined): FirstGoal | null {
  if (!userId) return null;
  try {
    const v = localStorage.getItem(goalKey(userId));
    return isFirstGoal(v) ? v : null;
  } catch {
    return null;
  }
}

export function setFirstGoal(userId: string | null | undefined, goal: FirstGoal | null): void {
  if (!userId) return;
  try {
    if (goal && isFirstGoal(goal)) localStorage.setItem(goalKey(userId), goal);
    else localStorage.removeItem(goalKey(userId));
  } catch {
    // Not saved: the checklist falls back to its default order.
  }
}

export function isGettingStartedDismissed(userId: string | null | undefined): boolean {
  if (!userId) return false;
  try {
    return localStorage.getItem(dismissedKey(userId)) === "1";
  } catch {
    return false;
  }
}

export function dismissGettingStarted(userId: string | null | undefined): void {
  if (!userId) return;
  try {
    localStorage.setItem(dismissedKey(userId), "1");
  } catch {
    // Not saved: the checklist is hidden for this visit only.
  }
}

/**
 * Where the person wants to find clients (asked during onboarding): a country code from Client Radar's list, or "WW"
 * for worldwide. Only a starting suggestion: Client Radar shows it as a removable chip when a request names no place,
 * and it is never taken from the person's own account country.
 */
const targetKey = (userId: string) => `dis_target_market:${userId}`;
export const TARGET_MARKETS = [
  { code: "IN", label: "India" }, { code: "US", label: "United States" }, { code: "GB", label: "United Kingdom" }, { code: "CA", label: "Canada" },
  { code: "AU", label: "Australia" }, { code: "AE", label: "UAE" }, { code: "WW", label: "Worldwide" },
] as const;
export type TargetMarket = (typeof TARGET_MARKETS)[number]["code"];
const isTarget = (v: unknown): v is TargetMarket => TARGET_MARKETS.some((t) => t.code === v);

export function getTargetMarket(userId: string | null | undefined): TargetMarket | null {
  if (!userId) return null;
  try { const v = localStorage.getItem(targetKey(userId)); return isTarget(v) ? v : null; } catch { return null; }
}

export function setTargetMarket(userId: string | null | undefined, market: TargetMarket | null): void {
  if (!userId) return;
  try {
    if (market && isTarget(market)) localStorage.setItem(targetKey(userId), market);
    else localStorage.removeItem(targetKey(userId));
  } catch {
    // Not saved: Client Radar simply asks where to look.
  }
}
