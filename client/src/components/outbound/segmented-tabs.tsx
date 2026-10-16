/**
 * A small segmented tab bar for AI Outbound's views. The active tab is always visible as text and weight, and an
 * indicator slides to it (framer layoutId, unique per instance so two bars on one page never share an indicator).
 * Arrow keys move between tabs, one tab stop for the whole bar.
 */
import { motion } from "framer-motion";
import { useId, useRef, type ReactNode } from "react";
import { tSpring } from "@/lib/motion";
import { cn } from "@/lib/utils";

export interface SegmentedTab<T extends string> { value: T; label: ReactNode; testId?: string }

export function SegmentedTabs<T extends string>({ value, onChange, tabs, label, className }: { value: T; onChange: (v: T) => void; tabs: readonly SegmentedTab<T>[]; label: string; className?: string }) {
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = Math.max(0, tabs.findIndex((t) => t.value === value));
  const move = (i: number) => {
    const n = (i + tabs.length) % tabs.length;
    onChange(tabs[n].value);
    refs.current[n]?.focus();
  };
  return (
    <div className={cn("flex max-w-full gap-1 rounded-xl border bg-muted/40 p-1 sm:w-fit", className)} role="tablist" aria-label={label}>
      {tabs.map((t, i) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={i === current ? 0 : -1}
            onClick={() => onChange(t.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") { e.preventDefault(); move(current + 1); }
              if (e.key === "ArrowLeft") { e.preventDefault(); move(current - 1); }
              if (e.key === "Home") { e.preventDefault(); move(0); }
              if (e.key === "End") { e.preventDefault(); move(tabs.length - 1); }
            }}
            className={cn(
              "relative z-0 min-w-0 flex-1 rounded-lg px-2 py-1.5 text-[13px] sm:px-4 sm:text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-emerald-500/60 sm:flex-none",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
            data-testid={t.testId}
          >
            {active && <motion.span layoutId={`outbound-tab-${id}`} transition={tSpring} aria-hidden="true" className="absolute inset-0 -z-10 rounded-lg bg-background shadow-sm ring-1 ring-border/60" />}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
