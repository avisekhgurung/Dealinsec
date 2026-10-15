import { useRef } from "react";
import { Check, Radar, Receipt, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import { FIRST_GOALS, FIRST_GOAL_META, type FirstGoal } from "@shared/getting-started";

const ICONS: Record<FirstGoal, typeof Radar> = {
  find_clients: Radar,
  manage_deals: Target,
  get_paid: Receipt,
};

/**
 * "What do you want to do first?" — three cards, at most one selected, styled
 * like AudiencePicker. Optional: nothing is selected until the person chooses.
 * A real radio group for the keyboard: Tab enters on the selected card (or the
 * first), arrow keys move and select, Space/Enter select.
 */
export function FirstGoalPicker({
  value,
  onChange,
  labelledBy,
  describedBy,
  idPrefix = "first-goal",
}: {
  value: FirstGoal | null;
  onChange: (next: FirstGoal) => void;
  labelledBy?: string;
  describedBy?: string;
  idPrefix?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const focusIndex = value ? FIRST_GOALS.indexOf(value) : 0;

  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const n = (i + step + FIRST_GOALS.length) % FIRST_GOALS.length;
    onChange(FIRST_GOALS[n]);
    refs.current[n]?.focus();
  };

  return (
    <div role="radiogroup" aria-labelledby={labelledBy} aria-describedby={describedBy} className="grid gap-3">
      {FIRST_GOALS.map((g, i) => {
        const selected = value === g;
        const Icon = ICONS[g];
        const { label, description } = FIRST_GOAL_META[g];
        return (
          <button
            key={g}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={i === focusIndex ? 0 : -1}
            onClick={() => onChange(g)}
            onKeyDown={(e) => onKeyDown(e, i)}
            data-testid={`${idPrefix}-${g}`}
            className={cn(
              "relative flex items-start gap-3 rounded-xl border p-4 text-left transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2",
              selected
                ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40"
                : "border-border bg-background hover:border-emerald-300",
            )}
          >
            <span
              className={cn(
                "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                selected ? "bg-emerald-600 text-white" : "bg-muted text-muted-foreground",
              )}
            >
              <Icon className="h-5 w-5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold leading-tight">{label}</span>
              <span className="mt-1 block text-xs leading-snug text-muted-foreground">{description}</span>
            </span>
            {selected && <Check className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}
