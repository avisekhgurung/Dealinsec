/**
 * What a search will use, shown before it starts (GET /api/outbound/usage). Advisory only: the server enforces every
 * limit when a search starts and while it runs, so this never decides anything on its own. It shows the workspace's
 * allowance as numbers (when the server could count them) and the platform's safety caps only as a state.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertTriangle, Info } from "lucide-react";

export const OUTBOUND_USAGE_URL = "/api/outbound/usage";

interface Allowance { used: number; limit: number; remaining: number; nextFreesAt: string | null }
export interface OutboundUsage {
  asOf: string;
  searchReady: boolean;
  /** Local business search (Google Places) is configured (absent from an older server = not available). */
  localReady?: boolean;
  charge: "included";
  workspace: { searches: Allowance | null; webSearches: Allowance | null; contactLookups: Allowance | null };
  /** The plan's 30-day allowance (absent from an older server). */
  plan?: {
    tier: "free" | "trial" | "pro"; label: string; searches: Allowance | null; maxCompanies: number; windowDays: number;
    /** Separate allowances over the same days (absent from an older server; null = couldn't be counted). */
    prospects?: Allowance | null; drafts?: Allowance | null; sends?: Allowance | null; spendPercent?: number | null;
  };
  perSearch: { webSearches: number };
  platform: { state: "available" | "limited" | "paused" | "unknown"; resetsAt: string };
}

export const useOutboundUsage = (enabled = true) =>
  useQuery<{ usage: OutboundUsage }>({ queryKey: [OUTBOUND_USAGE_URL], enabled, retry: false, staleTime: 15_000 });

const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const when = (iso: string) => {
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
  if (m && m.remaining <= 0) {
    return u.plan!.tier === "free"
      ? `You've used the free plan's ${m.limit} AI Outbound searches for this ${u.plan!.windowDays}-day period. Upgrade to Pro for more.`
      : `You've used the ${m.limit} searches included in ${u.plan!.label} for this ${u.plan!.windowDays}-day period.${m.nextFreesAt ? ` The next one frees up ${when(m.nextFreesAt)}.` : ""}`;
  }
  const pr = u.plan?.prospects;
  if (mode === "web" && pr && pr.remaining <= 0) {
    return u.plan!.tier === "free"
      ? `You've used the free plan's ${pr.limit} researched prospects for this ${u.plan!.windowDays}-day period. Upgrade to Pro for more.`
      : `You've used the ${pr.limit} researched prospects included in ${u.plan!.label} for this ${u.plan!.windowDays}-day period. More become available as earlier searches pass ${u.plan!.windowDays} days.`;
  }
  if ((u.plan?.spendPercent ?? 0) >= 100) return `This workspace's AI usage for the last ${u.plan!.windowDays} days has reached its limit. It frees up as earlier usage passes ${u.plan!.windowDays} days.`;
  const s = u.workspace.searches;
  if (s && s.remaining <= 0) return `You've used today's ${s.limit} searches.${s.nextFreesAt ? ` The next one frees up ${when(s.nextFreesAt)}.` : ""}`;
  if (mode === "web" && u.platform.state === "paused") return `AI Outbound has reached today's limit across DealInSec. It starts again ${when(u.platform.resetsAt)}. This doesn't use any of your searches.`;
  return null;
}

export function UsageNote({ usage, mode = "web" }: { usage: OutboundUsage | undefined; mode?: "web" | "local" }) {
  if (!usage) return null;
  const s = usage.workspace.searches;
  const blocked = searchBlockedReason(usage, mode);
  return (
    <div className="space-y-1.5 text-xs" data-testid="outbound-usage" aria-live="polite">
      <p className="flex items-start gap-1.5 text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          {usage.plan ? <>{usage.plan.label}: </> : null}
          {usage.plan?.searches
            ? <><strong className="font-semibold text-foreground" data-testid="outbound-plan-left">{usage.plan.searches.remaining} of {usage.plan.searches.limit} searches left</strong> in the last {usage.plan.windowDays} days, up to {usage.plan.maxCompanies} companies each.</>
            : <>Included in your plan, no extra charge.</>}
          {s && s.remaining > 0 && <> <span data-testid="outbound-searches-left">{s.remaining} of {s.limit} left today.</span></>}
          {" "}One search = one credit; a search that stops before searching isn&apos;t counted.
          {usage.plan?.tier === "free" && <> <Link href="/pricing" className="font-semibold text-primary hover:underline" data-testid="outbound-upgrade">Pro includes more</Link>.</>}
        </span>
      </p>
      {usage.plan && (usage.plan.prospects || usage.plan.drafts || usage.plan.sends) && (
        <p className="pl-5 text-muted-foreground" data-testid="outbound-plan-allowances">
          {[
            usage.plan.prospects && `${usage.plan.prospects.remaining} of ${usage.plan.prospects.limit} researched prospects left`,
            usage.plan.drafts && `${usage.plan.drafts.remaining} of ${usage.plan.drafts.limit} AI drafts`,
            usage.plan.sends && `${usage.plan.sends.remaining} of ${usage.plan.sends.limit} Gmail sends`,
          ].filter(Boolean).join(" · ")}
          {typeof usage.plan.spendPercent === "number" && usage.plan.spendPercent >= 80 && <> · AI usage at {usage.plan.spendPercent}% of this period&apos;s limit</>}
        </p>
      )}
      {blocked ? (
        <p className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400" role="status" data-testid="outbound-blocked">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{blocked}
        </p>
      ) : mode === "web" && usage.platform.state === "limited" ? (
        <p className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400" data-testid="outbound-limited">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          AI Outbound is busy across DealInSec today, so a search may stop early with fewer companies. Full capacity returns {when(usage.platform.resetsAt)}.
        </p>
      ) : null}
    </div>
  );
}
