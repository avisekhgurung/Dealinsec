/**
 * The pipeline at a glance: one segment per stage with its count, from the
 * server's per-stage counts for the whole pipeline (archived leads left out).
 * A segment filters the list to that stage; pressing it again shows all.
 * The bar is only a picture of the same numbers, so it is hidden from screen readers.
 */
import { cn } from "@/lib/utils";
import { pipelineSummary } from "@shared/lead-view";
import type { LeadStatus } from "@shared/leads";

const BAR: Record<LeadStatus, string> = {
  new: "bg-slate-400 dark:bg-slate-500",
  researching: "bg-sky-500",
  qualified: "bg-indigo-500",
  contacted: "bg-violet-500",
  replied: "bg-amber-500",
  meeting: "bg-orange-500",
  proposal: "bg-fuchsia-500",
  won: "bg-emerald-500",
  lost: "bg-neutral-300 dark:bg-neutral-600",
};

export function PipelineSummary({
  counts, status, onStatus, loading, searching,
}: {
  counts: Record<string, number> | undefined;
  /** The stage filter in force; "" is all. */
  status: string;
  onStatus: (status: string) => void;
  loading?: boolean;
  /** A search is on: the counts still describe the whole pipeline, and say so. */
  searching?: boolean;
}) {
  const p = pipelineSummary(counts);
  const chip = (key: string, label: string, n: number | null, i: number) => {
    const on = status === key;
    return (
      <button
        key={key || "all"} type="button" aria-pressed={on}
        onClick={() => onStatus(on && key ? "" : key)}
        className={cn(
          "flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60",
          on ? "border-emerald-600 bg-emerald-600 text-white" : "border-border bg-background text-foreground hover:bg-muted",
          i === 8 && "lg:ml-2", // a small gap before the two ends
        )}
        data-testid={`chip-${key || "all"}`}
      >
        {key && <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", on ? "bg-white/80" : BAR[key as LeadStatus])} />}
        {label}
        <span className={cn("tabular-nums text-xs", on ? "text-white/80" : "text-muted-foreground")}>{n === null ? "…" : n}</span>
      </button>
    );
  };

  return (
    <section className="rounded-2xl border border-border bg-background p-3 lg:p-4" aria-label="Pipeline by stage" data-testid="pipeline-summary">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-1">
        <h2 className="text-sm font-semibold">Pipeline</h2>
        <p className="text-xs text-muted-foreground" data-testid="pipeline-totals">
          {loading ? "Counting…" : <>{p.open} open · {p.won} won · {p.lost} lost{searching ? " · whole pipeline, not just this search" : ""}</>}
        </p>
      </div>
      <div className="mt-2.5 flex h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        {p.segments.filter((s) => s.count > 0).map((s) => (
          <span key={s.status} className={cn("h-full", BAR[s.status], status && status !== s.status && "opacity-40")} style={{ width: `${s.share * 100}%` }} />
        ))}
      </div>
      {/* Scrolls sideways inside itself on a phone, never the page. */}
      <div className="relative -mx-3 mt-3 overflow-x-auto px-3 pb-0.5 lg:mx-0 lg:overflow-visible lg:px-0" role="group" aria-label="Filter by stage">
        <div className="flex w-max gap-1.5 lg:w-auto lg:flex-wrap">
          {chip("", "All", loading ? null : p.total, -1)}
          {p.segments.map((s, i) => chip(s.status, s.label, loading ? null : s.count, i + 1))}
        </div>
      </div>
    </section>
  );
}
