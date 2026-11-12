/**
 * What the app says about running low on a plan allowance and about purchased credits, kept pure so the rules are
 * tested and every surface (the search note, the draft panel, the wallet) words them the same way.
 *
 * Advisory only: the server counts, decides and refuses (server/outbound/usage.ts is the one place the numbers come
 * from, server/billing/credits.ts the one place credits are spent). A number that can't be read means no hint, and the
 * buttons keep working until the server says no.
 *
 * Order of spending, told the same everywhere: the plan's allowance first, purchased credits second.
 */
export type CreditKind = "search" | "draft";
export interface Allowance { used: number; limit: number; remaining: number; nextFreesAt: string | null }
export interface CreditKindView { balance: number; cost: number; nextExpiry: { units: number; at: string } | null }
export interface CreditsView { search: CreditKindView; draft: CreditKindView }
export interface WarnView { percent: number; warn: boolean; exhausted: boolean }

export type FeatureState = "ok" | "warn" | "credits" | "out";
export interface FeatureStatus {
  state: FeatureState;
  /** Share of the plan allowance used, 0–100. */
  percent: number;
  /** Purchased credits usable now. */
  balance: number;
  /** Credits one action costs once the plan's allowance is used up. */
  cost: number;
}

export const usedPercent = (a: Pick<Allowance, "used" | "limit">): number =>
  !Number.isFinite(a.used) || !Number.isFinite(a.limit) || a.limit <= 0 ? 100 : Math.min(100, Math.floor((100 * Math.max(0, a.used)) / a.limit));

/**
 *   ok       room in the plan, below the warning threshold
 *   warn     room in the plan, at or over the threshold (and the admin has warnings on)
 *   credits  plan used up, but purchased credits cover the next action
 *   out      plan used up and no purchased credits: this feature (only) is blocked
 */
export function featureStatus(a: Allowance | null | undefined, credits: CreditKindView | null | undefined, warn: WarnView | null | undefined): FeatureStatus | null {
  if (!a || !Number.isFinite(a.limit) || !Number.isFinite(a.remaining) || a.limit <= 0) return null;
  const percent = usedPercent(a);
  const balance = Math.max(0, credits?.balance ?? 0), cost = Math.max(1, credits?.cost ?? 1);
  if (a.remaining > 0) {
    const threshold = warn?.percent ?? 80;
    return { state: warn?.warn !== false && percent >= threshold ? "warn" : "ok", percent, balance, cost };
  }
  return { state: balance >= cost ? "credits" : "out", percent: 100, balance, cost };
}

export const creditNoun = (kind: CreditKind, n: number) => (kind === "search" ? `search credit${n === 1 ? "" : "s"}` : `AI draft credit${n === 1 ? "" : "s"}`);

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
export const dayLabel = day;

/** "Valid until 12 Nov 2027" for the soonest-expiring credits, or "" when they never expire. */
export const expiryNote = (e: { units: number; at: string } | null | undefined): string =>
  e ? ` ${e.units} of them expire${e.units === 1 ? "s" : ""} on ${day(e.at)}.` : "";

/** What the wallet's ledger reason means, in plain words. */
export const LEDGER_LABEL: Record<string, string> = {
  purchase: "Bought",
  consume: "Used",
  consume_undo: "Returned (nothing was searched)",
  refund: "Refunded",
  admin_grant: "Added by DealInSec",
  admin_deduct: "Removed by DealInSec",
};
