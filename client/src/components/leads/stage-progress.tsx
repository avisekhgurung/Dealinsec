/**
 * Where a lead sits in its lifecycle, New → … → Proposal → Won (or Lost). A
 * picture only: every step is text plus an icon, the current one is marked with
 * aria-current, and nothing here moves the lead (that stays with the page's
 * "Move to" controls, which offer only the moves the server allows).
 */
import { Check, Circle, CircleDot, Minus, Trophy, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { stageProgress, type StepState } from "@shared/lead-view";

const STATE_TEXT: Record<StepState, string> = { done: "done", current: "current stage", upcoming: "not yet", not_reached: "not reached" };

export function StageProgress({ status, lostFrom }: { status: string; lostFrom?: string | null }) {
  const p = stageProgress(status, lostFrom);
  return (
    <div data-testid="stage-progress">
      <p className="mb-2 text-xs text-muted-foreground" data-testid="stage-position">
        {p.closed === "won" ? "Won: turned into a deal." : p.closed === "lost" ? "Closed as lost." : `Stage ${p.position} of ${p.steps.length}: ${p.steps[p.position - 1].label}`}
      </p>
      <ol className="flex items-start" aria-label="Lead stage">
        {p.steps.map((s, i) => {
          const current = s.state === "current";
          const Icon = s.state === "done" ? Check
            : current ? (s.status === "won" ? Trophy : s.status === "lost" ? X : CircleDot)
            : s.state === "not_reached" ? Minus : Circle;
          return (
            <li key={s.status} className="flex min-w-0 flex-1 flex-col items-center" aria-current={current ? "step" : undefined} data-state={s.state} data-testid={`progress-${s.status}`}>
              <span className="flex w-full items-center">
                <span className={cn("h-0.5 flex-1", i === 0 ? "invisible" : s.state === "done" || current ? "bg-emerald-500/70" : "bg-border")} aria-hidden />
                <span
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
                    s.state === "done" && "border-emerald-600 bg-emerald-600 text-white",
                    current && s.status !== "lost" && "border-emerald-600 bg-emerald-50 text-emerald-700 ring-2 ring-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-300",
                    current && s.status === "lost" && "border-neutral-400 bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
                    (s.state === "upcoming" || s.state === "not_reached") && "border-border bg-background text-muted-foreground",
                  )}
                  aria-hidden
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className={cn("h-0.5 flex-1", i === p.steps.length - 1 ? "invisible" : p.steps[i + 1].state === "done" || p.steps[i + 1].state === "current" ? "bg-emerald-500/70" : "bg-border")} aria-hidden />
              </span>
              {/* A phone has no room for eight names: the line above names the current one, and every name is still read out. */}
              <span className={cn("sr-only mt-1 max-w-full truncate px-0.5 text-center text-[11px] leading-tight sm:not-sr-only",
                current ? "font-semibold text-foreground" : "text-muted-foreground",
                s.state === "not_reached" && "line-through decoration-muted-foreground/50")}>
                {s.label}<span className="sr-only">: {STATE_TEXT[s.state]}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
