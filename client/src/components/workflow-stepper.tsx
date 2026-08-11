/**
 * WorkflowStepper — the Deal → Quote → Agreement → Invoice progress bar.
 *
 * Every step that has a destination is a link. The bar was previously read-only
 * on the agreement page, which is the wrong instinct: it is the clearest map of
 * a deal a user ever sees, so it should also be how they move around it. A step
 * with no destination yet (no quotation raised, no invoice) renders as plain
 * text rather than a dead link, and the step you are standing on is not a link
 * to itself.
 *
 * Shared so the agreement page and the deal page cannot drift apart.
 */
import { Link } from "wouter";
import { CheckCircle2 } from "lucide-react";

export interface WorkflowStep {
  label: string;
  step: number;
  /** null when the record does not exist yet, or when it IS the current page. */
  href: string | null;
}

export function WorkflowStepper({
  steps,
  currentStep,
  className = "",
}: {
  steps: WorkflowStep[];
  /** The furthest step reached. Steps below it render as done. */
  currentStep: number;
  className?: string;
}) {
  return (
    <nav aria-label="Deal progress" className={`flex items-center justify-between px-1 ${className}`}>
      {steps.map((s, idx, arr) => {
        const isDone = s.step < currentStep;
        const isActive = s.step === currentStep;

        const dot = (
          <span
            className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold transition-all
              ${isDone
                ? "bg-emerald-500 text-white shadow-sm shadow-emerald-200 dark:shadow-emerald-900"
                : isActive
                ? "bg-amber-400 text-white shadow-sm shadow-amber-200 dark:shadow-amber-900 ring-2 ring-amber-300/50"
                : "bg-muted text-muted-foreground"}`}
          >
            {isDone ? <CheckCircle2 className="w-3.5 h-3.5" /> : s.step}
          </span>
        );

        const label = (
          <span
            className={`text-[10px] font-semibold whitespace-nowrap
              ${isDone ? "text-emerald-600 dark:text-emerald-400"
                : isActive ? "text-amber-600 dark:text-amber-400"
                : "text-muted-foreground"}`}
          >
            {s.label}
          </span>
        );

        return (
          <div key={s.step} className="flex items-center flex-1 min-w-0">
            {s.href ? (
              <Link
                href={s.href}
                aria-label={`Go to ${s.label}`}
                data-testid={`step-link-${s.label.toLowerCase()}`}
                className="flex flex-col items-center gap-0.5 rounded-lg px-1 py-0.5 -mx-1 cursor-pointer transition-transform hover:-translate-y-0.5 active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {dot}
                {label}
              </Link>
            ) : (
              <span className="flex flex-col items-center gap-0.5 px-1 py-0.5" aria-current={isActive ? "step" : undefined}>
                {dot}
                {label}
              </span>
            )}

            {idx < arr.length - 1 && (
              <span
                aria-hidden="true"
                className={`flex-1 h-0.5 mx-1 rounded-full transition-colors
                  ${s.step < currentStep ? "bg-emerald-400" : "bg-muted"}`}
              />
            )}
          </div>
        );
      })}
    </nav>
  );
}
