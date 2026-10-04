/**
 * The sales agent's view of one lead: its score out of 100 with the reason for every part, what is
 * missing, and the next best action with its reason. Everything shown is computed from what is recorded
 * (no model), and what is not known is shown as unknown, never as a low mark.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { CircleHelp, Lightbulb, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { memberCan } from "@shared/permissions";
import { Card, CardContent } from "@/components/ui/card";
import { leadCall, leadError, nextActionUrl, refreshLeads, researchUrl, scoreUrl } from "@/lib/leads";
import { OutreachPanel } from "./outreach-panel";
import { cn } from "@/lib/utils";
import type { LeadScore } from "@shared/lead-score";
import type { NextAction } from "@shared/next-action";

const CONFIDENCE: Record<string, string> = { low: "Mostly unknown", medium: "Partly known", high: "Well measured" };
const TONE: Record<string, string> = {
  none: "border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/40",
  reconsider: "border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20",
};

interface ResearchView {
  id: number; status: "running" | "done" | "failed"; startedAt: string; finishedAt: string | null; errorCode: string | null;
  summary: { kept: number; confirmed: number; inferred: number; rejected: Record<string, number> } | null;
  pages: { url: string; ok: boolean; note?: string }[]; claimCount: number;
}
const FAILED: Record<string, string> = {
  no_pages: "I couldn't read the company's website.", bad_output: "The research didn't come back in a usable form.", empty_output: "The AI returned nothing for this site. Try again.", timeout: "The research took too long.",
  daily_limit: "Today's research allowance is used up.", stale: "The research was interrupted.", upstream: "The AI service had a problem.", rate_limited: "The AI service is busy.",
  cap_unavailable: "The sales agent isn't set up on this server yet.",
};
const when = (iso: string) => { try { return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };
const path = (u: string) => { try { const x = new URL(u); return x.hostname.replace(/^www\./, "") + (x.pathname === "/" ? "" : x.pathname); } catch { return u; } };

/** Reading the company's own website: start it, watch it, and see what was kept and what was thrown away. */
function ResearchPanel({ leadId, hasWebsite }: { leadId: number; hasWebsite: boolean }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const canRun = memberCan(user as any, "deals.create");
  const q = useQuery<{ research: ResearchView | null }>({
    queryKey: [researchUrl(leadId)], retry: false,
    refetchInterval: (query) => (query.state.data?.research?.status === "running" ? 2500 : false),
  });
  const run = useMutation({
    mutationFn: () => leadCall("POST", researchUrl(leadId), {}),
    onSuccess: () => { void refreshLeads(); },
    onError: (e) => toast({ title: "Couldn't start the research", description: leadError(e), variant: "destructive" }),
  });
  const r = q.data?.research ?? null;
  const wasRunning = r?.status === "running";
  // When a run finishes, the score, the facts and the next action have changed.
  const finished = r && r.status !== "running" ? r.id : null;
  useFinishedRefresh(finished);
  if (q.error) return null; // not set up on this server: the card simply has no research section
  const dropped = r?.summary ? Object.values(r.summary.rejected).reduce((n, v) => n + v, 0) : 0;

  return (
    <Card className="glass-card" data-testid="research-panel">
      <CardContent className="space-y-2.5 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Research</p>
            {!r && <p className="text-sm text-muted-foreground" data-testid="research-none">{hasWebsite ? "Not researched yet. I read the company's own website and record what it says, with the exact words as evidence." : "Add the company's website to this lead to research it."}</p>}
            {wasRunning && <p className="flex items-center gap-2 text-sm" data-testid="research-running"><Loader2 className="h-3.5 w-3.5 animate-spin" />Reading the company's website…</p>}
            {r?.status === "done" && r.summary && (
              <p className="text-sm" data-testid="research-done">
                Researched {when(r.finishedAt ?? r.startedAt)}: <strong>{r.summary.kept}</strong> finding{r.summary.kept === 1 ? "" : "s"} kept from {r.pages.filter((p) => p.ok).length} page{r.pages.filter((p) => p.ok).length === 1 ? "" : "s"}
                {r.summary.kept > 0 && <span className="text-muted-foreground"> ({r.summary.confirmed} stated on the site, {r.summary.inferred} my reading of it)</span>}.
              </p>
            )}
            {r?.status === "failed" && <p className="text-sm text-amber-700 dark:text-amber-400" data-testid="research-failed">{FAILED[r.errorCode ?? ""] ?? "The research didn't finish."}</p>}
          </div>
          {canRun && hasWebsite && !wasRunning && (
            <Button size="sm" variant={r ? "outline" : "default"} className="shrink-0" onClick={() => run.mutate()} disabled={run.isPending} data-testid="research-run">
              {run.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="mr-1.5 h-4 w-4" />}{r ? "Research again" : "Research this company"}
            </Button>
          )}
        </div>
        {r?.status === "done" && dropped > 0 && <p className="text-xs text-muted-foreground" data-testid="research-dropped">{dropped} other finding{dropped === 1 ? " was" : "s were"} left out because the words weren't found on the page, or didn't check out.</p>}
        {r && r.pages.length > 0 && (
          <ul className="space-y-0.5 text-xs text-muted-foreground" data-testid="research-pages">
            {r.pages.map((p) => <li key={p.url} className="break-all">{p.ok ? "✓" : "✗"} {path(p.url)}{!p.ok && p.note ? ` (${p.note.replace(/_/g, " ")})` : ""}</li>)}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Refresh the score, facts and next action once, when a run reaches an end. */
function useFinishedRefresh(runId: number | null) {
  const seen = useRef<number | null>(null);
  useEffect(() => { if (runId !== null && seen.current !== null && seen.current !== runId) void refreshLeads(); if (runId !== null) seen.current = runId; }, [runId]);
}

export function SalesCard({ leadId, hasWebsite = true }: { leadId: number; hasWebsite?: boolean }) {
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
      <ResearchPanel leadId={leadId} hasWebsite={hasWebsite} />
      <OutreachPanel leadId={leadId} />
    </div>
  );
}
