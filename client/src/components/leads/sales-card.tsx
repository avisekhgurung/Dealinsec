/**
 * The sales agent's view of one lead: its score out of 100 with the reason for every part, what is
 * missing, and the next best action with its reason. Everything shown is computed from what is recorded
 * (no model), and what is not known is shown as unknown, never as a low mark.
 */
import { useQuery } from "@tanstack/react-query";
import { CircleHelp, Lightbulb } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { nextActionUrl, scoreUrl } from "@/lib/leads";
import { cn } from "@/lib/utils";
import type { LeadScore } from "@shared/lead-score";
import type { NextAction } from "@shared/next-action";

const CONFIDENCE: Record<string, string> = { low: "Mostly unknown", medium: "Partly known", high: "Well measured" };
const TONE: Record<string, string> = {
  none: "border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/40",
  reconsider: "border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20",
};

export function SalesCard({ leadId }: { leadId: number }) {
  const score = useQuery<{ score: LeadScore }>({ queryKey: [scoreUrl(leadId)], retry: false });
  const next = useQuery<{ next: NextAction }>({ queryKey: [nextActionUrl(leadId)], retry: false });
  if (score.isLoading || next.isLoading) return <Card className="glass-card" data-testid="sales-card-loading"><CardContent className="p-4"><div className="h-4 w-1/3 animate-pulse rounded bg-muted" /></CardContent></Card>;
  if (score.error || next.error || !score.data || !next.data) return null;
  const s = score.data.score, n = next.data.next;

  return (
    <div className="space-y-3" data-testid="sales-card">
      <Card className={cn("border", TONE[n.action === "none" ? "none" : n.action === "reconsider" ? "reconsider" : ""] ?? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/50 dark:bg-emerald-950/20")} data-testid="next-action">
        <CardContent className="flex items-start gap-3 p-4">
          <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" />
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Next best action</p>
            <p className="text-sm font-semibold" data-testid="next-action-label">{n.label}</p>
            <p className="mt-0.5 text-sm text-muted-foreground" data-testid="next-action-reason">{n.reason}</p>
          </div>
        </CardContent>
      </Card>

      <Card className="glass-card" data-testid="score-card">
        <CardContent className="space-y-3 p-4">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Lead score</p>
              <p className="text-2xl font-bold tabular-nums" data-testid="score-total">{s.total}<span className="text-sm font-medium text-muted-foreground"> / 100</span></p>
            </div>
            <div className="text-right text-xs text-muted-foreground">
              <p data-testid="score-confidence">{CONFIDENCE[s.confidence]}</p>
              <p>{s.unknownPoints > 0 ? `${s.unknownPoints} of 100 points unknown` : "All 100 points measured"}</p>
            </div>
          </div>
          <ul className="space-y-2">
            {s.components.map((c) => (
              <li key={c.key} className="flex items-start gap-3 text-sm" data-testid={`score-${c.key}`}>
                <span className={cn("w-14 shrink-0 text-right font-semibold tabular-nums", c.points === null && "text-muted-foreground")}>
                  {c.points === null ? <span className="inline-flex items-center gap-1"><CircleHelp className="h-3.5 w-3.5" aria-label="unknown" />?</span> : `${c.points}/${c.max}`}
                </span>
                <span className="min-w-0"><span className="font-medium">{c.label}</span><span className="block break-words text-xs text-muted-foreground">{c.reason}</span></span>
              </li>
            ))}
          </ul>
          {s.missing.length > 0 && (
            <div className="border-t pt-2.5" data-testid="score-missing">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Missing</p>
              <ul className="space-y-0.5 text-xs text-muted-foreground">{s.missing.map((m) => <li key={m}>– {m}</li>)}</ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
