/**
 * Where the person is in AI Outbound, from real state only: what they've typed and confirmed, the selected search's
 * status and stage, whether its prospects reached Leads, and the outreach queue counts this session has loaded.
 * A step is checked only when the thing it names has actually happened; nothing advances on a timer.
 *
 *   1 Describe who you want          current: nothing selected yet, or reading a new description
 *   2 Confirm the profile            current: the profile is shown for confirming
 *   3 Research                       current: the selected search is running (with its real stage), or it stopped
 *                                    or finished with nothing that passed; done: the search finished
 *   4 Review prospects               current: a search has results, or All prospects is open;
 *                                    done: a prospect from it is in Leads, or outreach has messages
 *   5 Add to Leads & first message   current: Outreach is open with nothing in it; done: outreach has a message
 *   6 Approve, send, mark sent       current: Outreach is open with messages; done: a message is recorded as sent
 */
import { AlertTriangle, Check, CircleDot, Loader2 } from "lucide-react";
import { RUN_STAGE_LABEL } from "@/lib/outbound";
import { FLOW_STEPS, flowState as flowStateWith, type FlowInput, type FlowState } from "@shared/outbound-flow";

export { FLOW_STEPS };
export type { FlowInput, FlowState };
/** The rules live in shared/outbound-flow.ts (tested); this binds the run stages' labels. */
export const flowState = (i: FlowInput): FlowState => flowStateWith(i, RUN_STAGE_LABEL);
import { cn } from "@/lib/utils";

export function FlowSteps({ state }: { state: FlowState }) {
  const { current, done, notes, warn, working } = state;
  const label = FLOW_STEPS[current - 1];
  const note = notes[current - 1];
  return (
    <nav aria-label="Where you are in AI Outbound" data-testid="outbound-flow">
      {/* Phones and tablets: one line. */}
      <div className="lg:hidden">
        <p className="flex items-center gap-1.5 text-sm" aria-current="step" data-testid="outbound-flow-compact">
          {working ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-emerald-700 dark:text-emerald-400" aria-hidden /> : warn[current - 1] ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden /> : <CircleDot className="h-3.5 w-3.5 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden />}
          <span className="font-semibold">Step {current} of {FLOW_STEPS.length}</span>
          <span className="min-w-0 truncate">· {label}{note ? ` · ${note}` : ""}</span>
        </p>
        <div className="mt-1.5 flex gap-1" aria-hidden>
          {FLOW_STEPS.map((s, n) => <span key={s} className={cn("h-1 flex-1 rounded-full", n + 1 === current ? "bg-emerald-600" : done[n] ? "bg-emerald-600/40" : "bg-muted")} />)}
        </div>
      </div>
      {/* Wider screens: every step, the current one marked by icon, weight and aria-current. */}
      <ol className="hidden flex-wrap items-center gap-x-1 gap-y-2 lg:flex">
        {FLOW_STEPS.map((s, n) => {
          const step = n + 1;
          const isCurrent = step === current;
          const isDone = !isCurrent && done[n];
          const isWarn = warn[n];
          return (
            <li key={s} className="flex items-center gap-1" aria-current={isCurrent ? "step" : undefined} data-testid={`flow-step-${step}`} data-state={isCurrent ? "current" : isDone ? "done" : "todo"}>
              {n > 0 && <span className="mx-0.5 hidden h-px w-3 bg-border xl:block" aria-hidden />}
              <span className={cn("flex items-center gap-1.5 rounded-full px-2 py-1 text-xs", isCurrent ? "border border-emerald-600/50 bg-emerald-50 font-semibold text-foreground dark:bg-emerald-950/30" : isDone ? "text-foreground" : "text-muted-foreground")}>
                <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold tabular-nums", isWarn ? "text-amber-600" : isCurrent ? "bg-emerald-600 text-white" : isDone ? "bg-emerald-600/15 text-emerald-700 dark:text-emerald-400" : "border border-border")} aria-hidden>
                  {isWarn ? <AlertTriangle className="h-3.5 w-3.5" /> : isCurrent ? (working ? <Loader2 className="h-3 w-3 animate-spin" /> : step) : isDone ? <Check className="h-3 w-3" /> : step}
                </span>
                <span>{s}{notes[n] ? <span className={cn("font-normal", isWarn ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}> · {notes[n]}</span> : null}</span>
                <span className="sr-only">{isCurrent ? " (current step)" : isDone ? " (done)" : ""}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
