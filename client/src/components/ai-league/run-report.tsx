/**
 * One task: its truthful milestones while it works, and its report when it's done. Everything shown comes from the
 * run's stored events and report; the page never invents progress. Results first; the details (what was asked, when,
 * tokens) sit behind a disclosure.
 */
import { useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertTriangle, ArrowRight, Check, CircleDashed, ExternalLink, Loader2, RotateCcw, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { BOT_IDENTITY, isTerminal } from "@shared/ai-league";
import { leagueCall, refreshLeague, runUrl, useRun, when, type EventView, type RunView } from "@/lib/ai-league";
import { leadError } from "@/lib/leads";
import { Mascot } from "./mascot";
import { showTime } from "@shared/league-campaign";

const STATUS_TONE: Record<string, string> = {
  completed: "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900",
  partial: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900",
  failed: "bg-red-50 text-red-800 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900",
  cancelled: "bg-muted text-muted-foreground ring-border",
  queued: "bg-muted text-muted-foreground ring-border",
  running: "bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900",
  waiting: "bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900",
};
export function StatusPill({ run }: { run: Pick<RunView, "status" | "statusLabel" | "cancelRequested"> }) {
  const active = !isTerminal(run.status);
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1", STATUS_TONE[run.status])} data-testid="run-status">
      {active && <Loader2 className="h-3 w-3 motion-safe:animate-spin" aria-hidden />}
      {run.cancelRequested && active ? "Stopping…" : run.statusLabel}
    </span>
  );
}

const ITEM_ICON = {
  done: <Check className="h-3.5 w-3.5 text-emerald-600" aria-label="Done" />,
  needs_you: <CircleDashed className="h-3.5 w-3.5 text-amber-600" aria-label="Needs you" />,
  skipped: <X className="h-3.5 w-3.5 text-muted-foreground" aria-label="Skipped" />,
  failed: <AlertTriangle className="h-3.5 w-3.5 text-red-600" aria-label="Failed" />,
  info: <span className="mx-1 h-1.5 w-1.5 rounded-full bg-muted-foreground/60" aria-hidden />,
} as const;

export function Timeline({ events, active }: { events: EventView[]; active: boolean }) {
  return (
    <ol className="space-y-2" aria-label="Progress" data-testid="run-timeline">
      {events.map((e, i) => {
        const last = i === events.length - 1;
        return (
          <li key={e.id} className="flex gap-2.5 text-sm">
            <span className="mt-1.5 flex flex-col items-center">
              <span className={cn("h-2 w-2 rounded-full", last && active ? "bg-sky-500 motion-safe:animate-pulse" : e.kind === "failed" ? "bg-red-500" : e.kind === "cancelled" ? "bg-muted-foreground" : "bg-emerald-500")} aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              {e.href ? <Link href={e.href} className="hover:underline">{e.message}</Link> : e.message}
              <span className="ml-2 text-[11px] text-muted-foreground">{when(e.at)}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function RunDetail({ id, onClose }: { id: string; onClose?: () => void }) {
  const { toast } = useToast();
  const q = useRun(id);
  const fail = (title: string) => (e: unknown) => toast({ title, description: leadError(e), variant: "destructive" });
  const cancel = useMutation({ mutationFn: () => leagueCall("POST", `${runUrl(id)}/cancel`), onSuccess: () => void refreshLeague(), onError: fail("Couldn't cancel") });
  const retry = useMutation({ mutationFn: () => leagueCall<{ run: RunView }>("POST", `${runUrl(id)}/retry`), onSuccess: () => { void refreshLeague(); toast({ title: "Started again" }); }, onError: fail("Couldn't start it again") });
  if (q.isLoading) return <div className="space-y-2 p-1" aria-busy="true"><div className="h-4 w-1/2 animate-pulse rounded bg-muted" /><div className="h-16 animate-pulse rounded bg-muted" /></div>;
  if (q.isError || !q.data) return <p className="text-sm text-muted-foreground">{leadError(q.error, "This task couldn't be loaded.")}</p>;
  const { run, events } = q.data;
  const active = !isTerminal(run.status);
  const r = run.report;
  const id_ = BOT_IDENTITY[run.bot];
  return (
    <article className="space-y-4" data-testid="run-detail" aria-live="polite">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={cn("text-[11px] font-semibold uppercase tracking-wider", id_.accent.fg)}>{id_.name} · {run.taskLabel}</p>
          <h3 className="mt-0.5 text-base font-semibold leading-snug">{r?.headline ?? (active ? "Working on it…" : run.statusLabel)}</h3>
          {run.request && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">“{run.request}”</p>}
          {run.timing && (
            <p className="mt-1 text-xs text-muted-foreground" data-testid="run-timing">
              {run.timing.startAt && active && run.stage === "start" ? `Starts ${showTime(new Date(run.timing.startAt), run.timing.timezone)} · ` : ""}
              {run.timing.deliverAt ? `Report due ${showTime(new Date(run.timing.deliverAt), run.timing.timezone)}` : "Report when the research ends"}
            </p>
          )}
          {active && run.stage === "deliver" && run.timing?.deliverAt && (
            <p className="mt-1 rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" data-testid="run-held">
              The report is ready and saved; it will be delivered {showTime(new Date(run.timing.deliverAt), run.timing.timezone)}, as you asked.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <StatusPill run={run} />
          {onClose && <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></Button>}
        </div>
      </header>

      {r && r.counts.length > 0 && (
        <dl className="grid grid-cols-3 gap-2 sm:grid-cols-6" data-testid="run-counts">
          {r.counts.map((c) => (
            <div key={c.label} className="rounded-lg border bg-background/60 px-2.5 py-2">
              <dd className="text-lg font-semibold tabular-nums leading-none">{c.value}</dd>
              <dt className="mt-1 text-[11px] leading-tight text-muted-foreground">{c.label}</dt>
            </div>
          ))}
        </dl>
      )}
      {r?.summary && <p className={cn("rounded-lg px-3 py-2 text-sm", id_.accent.soft)} data-testid="run-summary">{r.summary}</p>}

      {r && r.items.length > 0 && (
        <ul className="divide-y rounded-lg border" data-testid="run-items">
          {r.items.slice(0, 40).map((it, i) => (
            <li key={i} className="flex gap-2.5 px-3 py-2.5 text-sm">
              <span className="mt-0.5 shrink-0">{it.bot ? <Mascot bot={it.bot} size={26} /> : ITEM_ICON[it.status]}</span>
              <div className="min-w-0 flex-1">
                {it.href ? <Link href={it.href} className={cn("font-medium hover:underline", it.bot && BOT_IDENTITY[it.bot].accent.fg)}>{it.title}</Link> : <span className={cn("font-medium", it.bot && BOT_IDENTITY[it.bot].accent.fg)}>{it.title}</span>}
                {it.detail && <p className={it.bot ? "mt-0.5 text-sm text-foreground/90" : "text-xs text-muted-foreground"}>{it.detail}</p>}
                {it.sources && it.sources.length > 0 && (
                  <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
                    {it.sources.slice(0, 3).map((s) => <a key={s} href={s} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex max-w-[16rem] items-center gap-1 truncate text-muted-foreground hover:text-foreground"><ExternalLink className="h-3 w-3 shrink-0" aria-hidden /><span className="truncate">{s.replace(/^https?:\/\/(www\.)?/, "")}</span></a>)}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {r?.next && (
        <Button asChild size="sm" className="gradient-btn text-white"><Link href={r.next.href} data-testid="run-next">{r.next.label}<ArrowRight className="ml-1.5 h-4 w-4" /></Link></Button>
      )}
      {r?.notes && r.notes.length > 0 && <ul className="space-y-1 text-xs text-muted-foreground">{r.notes.map((n) => <li key={n}>· {n}</li>)}</ul>}
      {r && !active && r.items.length > 0 && (
        <p className="flex flex-wrap items-center gap-2 text-xs" data-testid="run-downloads">
          <span className="text-muted-foreground">Download:</span>
          <a href={`${runUrl(id)}/report.csv`} className="rounded-md border px-2 py-1 font-medium hover:bg-muted" download>CSV</a>
          <a href={`${runUrl(id)}/report.md`} className="rounded-md border px-2 py-1 font-medium hover:bg-muted" download>Markdown</a>
        </p>
      )}

      {(active || !r) && events.length > 0 && <Timeline events={events} active={active} />}

      <div className="flex flex-wrap gap-2">
        {active && <Button size="sm" variant="outline" onClick={() => cancel.mutate()} disabled={cancel.isPending || run.cancelRequested} data-testid="run-cancel"><Square className="mr-1.5 h-3.5 w-3.5" />{run.cancelRequested ? "Stopping…" : "Stop"}</Button>}
        {["failed", "partial", "cancelled"].includes(run.status) && <Button size="sm" variant="outline" onClick={() => retry.mutate()} disabled={retry.isPending} data-testid="run-retry"><RotateCcw className="mr-1.5 h-3.5 w-3.5" />Try again</Button>}
      </div>

      <details className="rounded-lg border px-3 py-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none font-medium text-foreground/80">Details</summary>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt>Started from</dt><dd>{run.source === "schedule" ? "A schedule" : run.source === "chat" ? `Chat with ${id_.name}` : "The AI League page"}</dd>
          <dt>Queued</dt><dd>{when(run.createdAt)}</dd>
          {run.startedAt && <><dt>Started</dt><dd>{when(run.startedAt)}</dd></>}
          {run.finishedAt && <><dt>Finished</dt><dd>{when(run.finishedAt)}</dd></>}
          {run.tokens > 0 && <><dt>AI tokens</dt><dd>{run.tokens.toLocaleString()} (an estimate of model use, not a bill)</dd></>}
          {run.errorCode && <><dt>Reason code</dt><dd>{run.errorCode}</dd></>}
        </dl>
        {r && events.length > 0 && <div className="mt-3"><Timeline events={events} active={false} /></div>}
      </details>
    </article>
  );
}
