/**
 * What the agent is doing right now. Every line comes from a real event the
 * server emitted (see shared/agent.ts), so there is no step here that didn't
 * happen and no timer pretending to be progress.
 */
import { Check, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActivityStep } from "@shared/agent";

export function ActivityStrip({ steps, onStop }: { steps: ActivityStep[]; onStop?: () => void }) {
  // The last few steps are enough; a long run doesn't need a wall of text.
  const shown = steps.slice(-5);
  return (
    <div className="rounded-2xl border border-border/70 bg-muted/30 px-3.5 py-3" role="status" aria-live="polite" data-testid="activity-strip">
      <ul className="space-y-1.5">
        {shown.length === 0 && (
          <li className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Getting started</li>
        )}
        {shown.map((s) => (
          <li key={s.id} className={cn("flex items-start gap-2 text-xs", s.state === "active" ? "font-medium text-foreground" : s.state === "failed" ? "text-rose-700 dark:text-rose-400" : "text-muted-foreground")}>
            {s.state === "active" ? <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-emerald-600" />
              : s.state === "failed" ? <X className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              : <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />}
            <span className="min-w-0 break-words">{s.label}</span>
          </li>
        ))}
      </ul>
      {onStop && (
        <button type="button" onClick={onStop} className="mt-2.5 text-[11px] font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" data-testid="agent-stop-link">
          Stop
        </button>
      )}
    </div>
  );
}

/** What the agent did for a finished reply, tucked away until wanted. */
export function StepsSummary({ steps }: { steps: ActivityStep[] }) {
  if (steps.length < 2) return null;
  return (
    <details className="mt-2 text-xs text-muted-foreground" data-testid="steps-summary">
      <summary className="cursor-pointer select-none font-medium hover:text-foreground">What I did ({steps.length} steps)</summary>
      <ul className="mt-1.5 space-y-1 pl-1">
        {steps.map((s) => (
          <li key={s.id} className="flex items-start gap-1.5">
            {s.state === "failed" ? <X className="mt-0.5 h-3 w-3 shrink-0 text-rose-600" /> : <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />}
            <span className="break-words">{s.label}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
