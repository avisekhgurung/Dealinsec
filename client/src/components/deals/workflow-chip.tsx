/**
 * Where a deal is in Deal → Quotation → Agreement → Invoice → Paid, small
 * enough for a table cell or a board card: five ticks and a short label.
 * Done steps are filled, the step being worked on is marked, the rest are
 * empty — the same reading as the deal page's stepper. The position comes from
 * shared/deal-view.ts; when it isn't known, render nothing rather than guess.
 */
import { WORKFLOW_DONE, WORKFLOW_STEPS, type WorkflowPosition, type WorkflowTone } from "@shared/deal-view";
import { cn } from "@/lib/utils";

const TONE_TEXT: Record<WorkflowTone, string> = {
  todo: "text-foreground/80",
  waiting: "text-amber-700 dark:text-amber-400",
  attention: "text-rose-700 dark:text-rose-400",
  done: "text-emerald-700 dark:text-emerald-400",
};

export function WorkflowChip({ position, className }: { position: WorkflowPosition; className?: string }) {
  const doneCount = Math.min(position.step - 1, WORKFLOW_STEPS.length);
  const where = position.step >= WORKFLOW_DONE ? "all steps done" : `at ${WORKFLOW_STEPS[position.step - 1].label}, step ${position.step} of ${WORKFLOW_STEPS.length}`;
  return (
    <span className={cn("inline-flex items-center gap-1.5 min-w-0", className)} data-testid="workflow-chip">
      <span className="flex items-center gap-0.5 shrink-0" aria-hidden="true">
        {WORKFLOW_STEPS.map((s) => (
          <span
            key={s.key}
            className={cn(
              "h-1.5 w-2.5 rounded-full",
              s.step <= doneCount
                ? "bg-emerald-500"
                : s.step === position.step
                ? position.tone === "attention" ? "bg-rose-400" : "bg-amber-400"
                : "bg-muted-foreground/20",
            )}
          />
        ))}
      </span>
      <span className={cn("text-[11px] font-medium truncate", TONE_TEXT[position.tone])}>
        {position.label}
        <span className="sr-only">, {where}</span>
      </span>
    </span>
  );
}
