/**
 * "What's working": what each outreach strategy actually achieved, as plain counts of real events
 * (GET /api/sales/outreach/strategy-stats, shared/strategy-stats.ts). Shares name their denominator and are
 * withheld on small samples; nothing here is predicted and no winner is declared off a handful of messages.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { MIN_TO_COMPARE, STRATEGY_WINDOWS, chosenShare, replyShare, sampleNote, type StrategyStatRow, type StrategyWindow } from "@shared/strategy-stats";
import { STRATEGY_LABEL, type OutreachStrategy } from "@shared/outreach-strategy";

const COLS: { key: string; label: string; of: (r: StrategyStatRow) => number }[] = [
  { key: "generated", label: "Written", of: (r) => r.generated },
  { key: "chosen", label: "Picked", of: (r) => r.chosen },
  { key: "approved", label: "Approved", of: (r) => r.approved },
  { key: "edited", label: "Edited first", of: (r) => r.edited },
  { key: "sent", label: "Sent", of: (r) => r.sent },
  { key: "replied", label: "Replies", of: (r) => r.replied },
  { key: "bounced", label: "Bounces", of: (r) => r.bounced },
  { key: "optedOut", label: "Opt-outs", of: (r) => r.optedOut },
];

export function StrategyStats() {
  const [days, setDays] = useState<StrategyWindow>(30);
  const q = useQuery<{ days: StrategyWindow; rows: StrategyStatRow[] }>({ queryKey: [`/api/sales/outreach/strategy-stats?days=${days}`], retry: false });
  const rows = q.data?.rows ?? [];
  const note = sampleNote(rows);
  return (
    <Card className="glass-card" data-testid="strategy-stats">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">What's working</p>
            <p className="text-xs text-muted-foreground">What happened to the AI-written first messages of the last {days} days, by how each one opened. Real counts, no predictions.</p>
          </div>
          <div className="flex gap-1" role="group" aria-label="Window">
            {STRATEGY_WINDOWS.map((d) => (
              <button key={d} onClick={() => setDays(d)} aria-pressed={days === d} data-testid={`strategy-days-${d}`}
                className={cn("rounded-full border px-2.5 py-1 text-xs", days === d ? "border-emerald-600 bg-emerald-600 text-white" : "border-border hover:bg-muted")}>
                {d} days
              </button>
            ))}
          </div>
        </div>

        {q.isLoading ? <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}</div>
          : q.isError ? <p className="text-sm text-muted-foreground" data-testid="strategy-stats-error">This couldn't be loaded right now.</p>
          : rows.length === 0 ? <p className="text-sm text-muted-foreground" data-testid="strategy-stats-empty">No AI-written messages in this window yet. Write one from a lead (or three versions to compare) and its story shows up here.</p>
          : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[40rem] text-sm" data-testid="strategy-stats-table">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="py-1.5 pr-2 font-semibold">Opens with</th>
                      {COLS.map((c) => <th key={c.key} className="px-2 py-1.5 text-right font-semibold">{c.label}</th>)}
                      <th className="px-2 py-1.5 text-right font-semibold" title={`Replies as a share of sent messages. Shown once a strategy has ${MIN_TO_COMPARE} sent.`}>Reply share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const reply = replyShare(r), picked = chosenShare(r);
                      return (
                        <tr key={`${r.strategy}:${r.promptVersion}`} className="border-t border-border/60" data-testid={`strategy-row-${r.strategy}`}>
                          <td className="py-1.5 pr-2">
                            <span className="font-medium">{STRATEGY_LABEL[r.strategy as OutreachStrategy] ?? r.strategy}</span>
                            <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">{r.promptVersion}</span>
                          </td>
                          {COLS.map((c) => (
                            <td key={c.key} className={cn("px-2 py-1.5 text-right tabular-nums", c.of(r) === 0 && "text-muted-foreground")}>
                              {c.key === "chosen" && r.shown > 0
                                ? <span title={picked === null ? `Picked of the ${r.shown} shown beside other versions.` : `Picked ${picked}% of the ${r.shown} times it was shown beside other versions.`}>{r.chosen}/{r.shown}</span>
                                : c.of(r)}
                            </td>
                          ))}
                          <td className="px-2 py-1.5 text-right tabular-nums" data-testid={`reply-share-${r.strategy}`}>
                            {reply === null ? <span className="text-muted-foreground" title={`Shown once ${MIN_TO_COMPARE} messages with this opening have been sent.`}>—</span> : `${reply}%`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {note && <p className="text-[11px] text-muted-foreground" data-testid="strategy-stats-note">{note}</p>}
              <p className="text-[11px] text-muted-foreground">
                Counted from your own messages and what really came back. "Picked" is chosen of shown when versions were compared; "Reply share" is replies ÷ sent. A reply counts once, whether you recorded it or Gmail saw it.
              </p>
            </>
          )}
      </CardContent>
    </Card>
  );
}
