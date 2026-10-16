/**
 * A small segmented control for choosing between views (List | Board). A radio group: the selected option is always
 * visible as text and weight, arrow keys move between options (one tab stop for the whole control), and an indicator
 * slides to the new one (framer layoutId, unique per instance so two controls on one page never share an indicator).
 * Choosing only changes the view; it never changes data.
 */
import { motion } from "framer-motion";
import { useId, useRef } from "react";
import type { LucideIcon } from "lucide-react";
import { tSpring } from "@/lib/motion";
import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  Icon?: LucideIcon;
  testId?: string;
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly SegmentedOption<T>[];
  /** The group's accessible name: "View". */
  label: string;
  className?: string;
}) {
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = Math.max(0, options.findIndex((o) => o.value === value));
  const move = (i: number) => {
    const n = (i + options.length) % options.length;
    onChange(options[n].value);
    refs.current[n]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className={cn("relative inline-flex items-center rounded-lg bg-muted p-0.5 ring-1 ring-border", className)}>
      {options.map((o, i) => {
        const active = i === current;
        return (
          <button
            key={o.value}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); move(current + 1); }
              if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); move(current - 1); }
              if (e.key === "Home") { e.preventDefault(); move(0); }
              if (e.key === "End") { e.preventDefault(); move(options.length - 1); }
            }}
            data-testid={o.testId}
            className={cn(
              "relative z-0 flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-emerald-500/60",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active && (
              <motion.span
                layoutId={`segmented-${id}`}
                transition={tSpring}
                aria-hidden="true"
                className="absolute inset-0 -z-10 rounded-md bg-background shadow-sm ring-1 ring-border/60"
              />
            )}
            {o.Icon && <o.Icon className="h-3.5 w-3.5" aria-hidden="true" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
