/**
 * Client Radar's Results view: what happened to the companies researched in a window, from research to won deals
 * (GET /api/outbound/funnel, shared/sales-funnel.ts). Counts of companies, each a subset of the stage before.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FUNNEL_WINDOWS, type FunnelView } from "@shared/sales-funnel";

export function SalesFunnel() {
  const [days, setDays] = useState<number>(90);
  const q = useQuery<{ funnel: FunnelView }>({ queryKey: [`/api/outbound/funnel?days=${days}`], retry: false });
  const f = q.data?.funnel;
  const top = f?.stages[0].count || 0;
  return (
    <Card className="glass-card" data-testid="sales-funnel">
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">From research to revenue</p>
            <p className="text-xs text-muted-foreground">The companies researched in the last {days} days, and how far each one got.</p>
          </div>
          <div className="flex gap-1" role="group" aria-label="Window">
            {FUNNEL_WINDOWS.map((d) => (
              <button key={d} onClick={() => setDays(d)} aria-pressed={days === d} data-testid={`funnel-days-${d}`}
                className={cn("rounded-full border px-2.5 py-1 text-xs", days === d ? "border-emerald-600 bg-emerald-600 text-white" : "border-border hover:bg-muted")}>
                {d === 365 ? "1 year" : `${d} days`}
              </button>
            ))}
          </div>
        </div>

        {q.isLoading ? <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}</div>
          : q.isError || !f ? <p className="text-sm text-muted-foreground" data-testid="funnel-error">The results couldn't be loaded right now.</p>
          : top === 0 ? <p className="text-sm text-muted-foreground" data-testid="funnel-empty">No company researched in this window yet. Run a search and research a few companies; their progress shows up here.</p>
          : (
            <>
              <ol className="space-y-1.5" data-testid="funnel-stages">
                {f.stages.map((s) => (
                  <li key={s.key} className="grid grid-cols-[8.5rem_1fr_auto] items-center gap-2 text-sm sm:grid-cols-[10rem_1fr_auto]" data-testid={`funnel-${s.key}`}>
                    <span className="truncate">{s.label}</span>
                    <span className="h-2.5 overflow-hidden rounded-full bg-muted">
                      <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${top ? Math.max(s.count ? 3 : 0, (s.count / top) * 100) : 0}%` }} />
                    </span>
                    <span className="w-20 text-right tabular-nums">
                      <span className="font-semibold">{s.count}</span>
                      {s.fromPrevious !== null && <span className="ml-1 text-[11px] text-muted-foreground">{s.fromPrevious}%</span>}
                    </span>
                  </li>
                ))}
              </ol>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>Won revenue: <span className="font-medium text-foreground">{formatMoney(f.revenueMinor, f.currency, f.currency === "INR" ? "en-IN" : "en-US")}</span></span>
                <span>Lost: {f.lost}</span>
                <span>Opted out: {f.optedOut}</span>
              </div>
              <ul className="ml-4 list-disc text-[11px] text-muted-foreground">
                {f.notes.map((n, i) => <li key={i}>{n}</li>)}
                <li>This shows what happened, not why: a stage reached doesn't prove a message or signal caused it.</li>
              </ul>
            </>
          )}
      </CardContent>
    </Card>
  );
}
