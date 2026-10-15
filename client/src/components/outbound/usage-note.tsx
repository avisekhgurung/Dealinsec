/**
 * What a search will use, shown before it starts (GET /api/outbound/usage). Advisory only: the server enforces every
 * limit when a search starts and while it runs, so this never decides anything on its own. It shows the workspace's
 * allowance as numbers (when the server could count them) and the platform's safety caps only as a state.
 */
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Info } from "lucide-react";

export const OUTBOUND_USAGE_URL = "/api/outbound/usage";

interface Allowance { used: number; limit: number; remaining: number; nextFreesAt: string | null }
export interface OutboundUsage {
  asOf: string;
  searchReady: boolean;
  charge: "included";
  workspace: { searches: Allowance | null; webSearches: Allowance | null; contactLookups: Allowance | null };
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

/** Why a search can't start right now, from the server's answer, or null. The server refuses it either way. */
export function searchBlockedReason(u: OutboundUsage | undefined): string | null {
  if (!u) return null;
  if (!u.searchReady) return "Web search isn't set up on this server yet, so a search can't start.";
  const s = u.workspace.searches;
  if (s && s.remaining <= 0) return `You've used today's ${s.limit} searches.${s.nextFreesAt ? ` The next one frees up ${when(s.nextFreesAt)}.` : ""}`;
  if (u.platform.state === "paused") return `AI Outbound has reached today's limit across DealInSec. It starts again ${when(u.platform.resetsAt)}. This doesn't use any of your searches.`;
  return null;
}

export function UsageNote({ usage }: { usage: OutboundUsage | undefined }) {
  if (!usage) return null;
  const s = usage.workspace.searches;
  const blocked = searchBlockedReason(usage);
  return (
    <div className="space-y-1.5 text-xs" data-testid="outbound-usage" aria-live="polite">
      <p className="flex items-start gap-1.5 text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          Included in your plan, no extra charge.
          {s && s.remaining > 0 && <> <strong className="font-semibold text-foreground" data-testid="outbound-searches-left">{s.remaining} of {s.limit} searches left</strong> today (rolling 24 hours).</>}
          {" "}Each search runs up to {usage.perSearch.webSearches} web searches; one that stops before searching isn't counted.
        </span>
      </p>
      {blocked ? (
        <p className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400" role="status" data-testid="outbound-blocked">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{blocked}
        </p>
      ) : usage.platform.state === "limited" ? (
        <p className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400" data-testid="outbound-limited">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          AI Outbound is busy across DealInSec today, so a search may stop early with fewer companies. Full capacity returns {when(usage.platform.resetsAt)}.
        </p>
      ) : null}
    </div>
  );
}
