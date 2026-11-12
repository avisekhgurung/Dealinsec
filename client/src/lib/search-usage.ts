/**
 * The pure rules behind the Client Radar usage note (components/outbound/usage-note.tsx): why a search can't start, and
 * whether the "buy extra searches" offer belongs beside it. Advisory only: the server enforces every limit when a search
 * starts. Purchased search credits pay once the plan's own searches are used up, so they un-block a search here exactly
 * as the server lets them (server/outbound/store.ts createRun).
 */
import { featureStatus, type CreditsView, type WarnView } from "@/lib/credits";

export interface Allowance { used: number; limit: number; remaining: number; nextFreesAt: string | null }
export interface OutboundUsage {
  asOf: string;
  searchReady: boolean;
  /** Local business search (Google Places) is configured (absent from an older server = not available). */
  localReady?: boolean;
  charge: "included";
  workspace: { searches: Allowance | null; webSearches: Allowance | null; contactLookups: Allowance | null };
  /** The plan's 30-day allowance (absent from an older server). */
  plan?: {
    tier: "free" | "trial" | "pro" | "unlimited"; label: string; searches: Allowance | null; maxCompanies: number; windowDays: number;
    /** Separate allowances over the same days (absent from an older server; null = couldn't be counted). */
    prospects?: Allowance | null; drafts?: Allowance | null; sends?: Allowance | null; spendPercent?: number | null;
    /** Bulk list sweeps, a pool of its own (absent from an older server; null = couldn't be counted). */
    lists?: Allowance | null;
  };
  perSearch: { webSearches: number };
  /** Purchased credits, spent after the plan's own allowance (absent from an older server). */
  credits?: CreditsView | null;
  /** The admin's warning threshold and notice switches (absent from an older server = 80%, both on). */
  warn?: WarnView;
  platform: { state: "available" | "limited" | "paused" | "unknown"; resetsAt: string };
}

const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
export const when = (iso: string) => {
  const d = new Date(iso), today = new Date();
  return d.toDateString() === today.toDateString() ? `at ${time(iso)}` : `${d.toLocaleDateString(undefined, { weekday: "short" })} at ${time(iso)}`;
};

/** Why a search can't start right now, from the server's answer, or null. The server refuses it either way. A local
 *  business search needs its own source, uses one search credit and researches nothing by itself (so the researched
 *  prospects allowance and the web-search platform cap don't stop it). */
export function searchBlockedReason(u: OutboundUsage | undefined, mode: "web" | "local" = "web"): string | null {
  if (!u) return null;
  if (mode === "local" && !u.localReady) return "Local business search isn't switched on yet. Search for companies online meanwhile.";
  if (mode === "web" && !u.searchReady) return "Web search isn't set up on this server yet, so a search can't start.";
  const m = u.plan?.searches;
  // Purchased search credits pay once the plan's searches are used: the search is not blocked, the server spends one.
  const paid = (u.credits?.search.balance ?? 0) >= (u.credits?.search.cost ?? 1);
  if (m && m.remaining <= 0 && !paid) {
    return u.plan!.tier === "free"
      ? `You've used the free plan's ${m.limit} Client Radar searches for this ${u.plan!.windowDays}-day period. Upgrade to Pro for more.`
      : `You've used the ${m.limit} searches included in ${u.plan!.label} for this ${u.plan!.windowDays}-day period.${m.nextFreesAt ? ` The next one frees up ${when(m.nextFreesAt)}.` : ""}`;
  }
  const pr = u.plan?.prospects;
  if (mode === "web" && pr && pr.remaining <= 0 && !paid) {
    return u.plan!.tier === "free"
      ? `You've used the free plan's ${pr.limit} researched prospects for this ${u.plan!.windowDays}-day period. Upgrade to Pro for more.`
      : `You've used the ${pr.limit} researched prospects included in ${u.plan!.label} for this ${u.plan!.windowDays}-day period. More become available as earlier searches pass ${u.plan!.windowDays} days.`;
  }
  if ((u.plan?.spendPercent ?? 0) >= 100) return `This workspace's AI usage for the last ${u.plan!.windowDays} days has reached its limit. It frees up as earlier usage passes ${u.plan!.windowDays} days.`;
  const s = u.workspace.searches;
  if (s && s.remaining <= 0) return `You've used today's ${s.limit} searches.${s.nextFreesAt ? ` The next one frees up ${when(s.nextFreesAt)}.` : ""}`;
  if (mode === "web" && u.platform.state === "paused") return `Client Radar has reached today's limit across DealInSec. It starts again ${when(u.platform.resetsAt)}. This doesn't use any of your searches.`;
  return null;
}

/** Whether the "buy extra searches" offer belongs under this search note: the plan's searches (or researched prospects) are
 *  used up with no credits to cover them, or the warning threshold is reached; the admin can switch each notice off. */
export function searchTopUpOffered(u: OutboundUsage | undefined): boolean {
  if (!u?.plan || u.plan.tier === "unlimited") return false;
  const st = featureStatus(u.plan.searches, u.credits?.search, u.warn);
  if (st?.state === "warn") return u.warn?.warn !== false;
  const pr = u.plan.prospects;
  const prospectsOut = !!pr && pr.remaining <= 0 && !((u.credits?.search.balance ?? 0) >= (u.credits?.search.cost ?? 1));
  return (st?.state === "out" || prospectsOut) && u.warn?.exhausted !== false;
}

