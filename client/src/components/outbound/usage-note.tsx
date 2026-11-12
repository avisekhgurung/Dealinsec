/**
 * What a search will use, shown before it starts (GET /api/outbound/usage). Advisory only: the server enforces every
 * limit when a search starts and while it runs, so this never decides anything on its own. It shows the workspace's
 * allowance as numbers (when the server could count them) and the platform's safety caps only as a state.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertTriangle, Info } from "lucide-react";
import { TopUpPrompt } from "@/components/credits/top-up";
import { featureStatus } from "@/lib/credits";
import { searchBlockedReason, searchTopUpOffered, when, type OutboundUsage } from "@/lib/search-usage";
export { searchBlockedReason, searchTopUpOffered };
export type { OutboundUsage };

export const OUTBOUND_USAGE_URL = "/api/outbound/usage";

export const useOutboundUsage = (enabled = true) =>
  useQuery<{ usage: OutboundUsage }>({ queryKey: [OUTBOUND_USAGE_URL], enabled, retry: false, staleTime: 15_000 });

export function UsageNote({ usage, mode = "web" }: { usage: OutboundUsage | undefined; mode?: "web" | "local" }) {
  if (!usage) return null;
  const s = usage.workspace.searches;
  const blocked = searchBlockedReason(usage, mode);
  const status = usage.plan && usage.plan.tier !== "unlimited" ? featureStatus(usage.plan.searches, usage.credits?.search, usage.warn) : null;
  return (
    <div className="space-y-1.5 text-xs" data-testid="outbound-usage" aria-live="polite">
      <p className="flex items-start gap-1.5 text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          {usage.plan ? <>{usage.plan.label}: </> : null}
          {usage.plan?.tier === "unlimited"
            ? <><strong className="font-semibold text-foreground" data-testid="outbound-plan-left">no monthly or daily limits</strong> on searches, prospects, AI drafts or sends, up to {usage.plan.maxCompanies} companies a search.</>
            : usage.plan?.searches
            ? <><strong className="font-semibold text-foreground" data-testid="outbound-plan-left">{usage.plan.searches.remaining} of {usage.plan.searches.limit} searches left</strong> in the last {usage.plan.windowDays} days, up to {usage.plan.maxCompanies} companies each.</>
            : <>Included in your plan, no extra charge.</>}
          {s && s.remaining > 0 && usage.plan?.tier !== "unlimited" && <> <span data-testid="outbound-searches-left">{s.remaining} of {s.limit} left today.</span></>}
          {" "}One search = one credit; a search that stops before searching isn&apos;t counted.
          {usage.plan?.tier === "free" && <> <Link href="/pricing" className="font-semibold text-primary hover:underline" data-testid="outbound-upgrade">Pro includes more</Link>.</>}
        </span>
      </p>
      {usage.plan && usage.plan.tier !== "unlimited" && (usage.plan.prospects || usage.plan.drafts || usage.plan.sends || usage.plan.lists) && (
        <p className="pl-5 text-muted-foreground" data-testid="outbound-plan-allowances">
          {[
            usage.plan.lists && `${usage.plan.lists.remaining} of ${usage.plan.lists.limit} list sweeps left`,
            usage.plan.prospects && `${usage.plan.prospects.remaining} of ${usage.plan.prospects.limit} researched prospects left`,
            usage.plan.drafts && `${usage.plan.drafts.remaining} of ${usage.plan.drafts.limit} AI drafts`,
            usage.plan.sends && `${usage.plan.sends.remaining} of ${usage.plan.sends.limit} sends from Gmail or WhatsApp Business`,
          ].filter(Boolean).join(" · ")}
          {typeof usage.plan.spendPercent === "number" && usage.plan.spendPercent >= 80 && <> · AI usage at {usage.plan.spendPercent}% of this period&apos;s limit</>}
        </p>
      )}
      {status?.state === "warn" && !blocked && (
        <p className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400" role="status" data-testid="outbound-warn">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />You&apos;ve used {status.percent}% of this period&apos;s searches.
        </p>
      )}
      {status?.state === "credits" && (
        <p className="flex items-start gap-1.5 text-muted-foreground" role="status" data-testid="outbound-credits">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />Your plan&apos;s searches are used. This search uses {status.cost} of your {status.balance} purchased search credit{status.balance === 1 ? "" : "s"}.
        </p>
      )}
      {searchTopUpOffered(usage) && <div className="pl-5"><TopUpPrompt kind="search" label="Buy extra searches" /></div>}
      {blocked ? (
        <p className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400" role="status" data-testid="outbound-blocked">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{blocked}
        </p>
      ) : mode === "web" && usage.platform.state === "limited" ? (
        <p className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400" data-testid="outbound-limited">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Client Radar is busy across DealInSec today, so a search may stop early with fewer companies. Full capacity returns {when(usage.platform.resetsAt)}.
        </p>
      ) : null}
    </div>
  );
}
