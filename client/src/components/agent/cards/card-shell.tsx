import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The frame every action card shares: a labelled, rounded panel that never overflows. */
export function CardShell({
  label, icon, tone = "neutral", children, className, testId,
}: {
  /** Omit when the content already carries its own heading. */
  label?: string;
  icon?: ReactNode;
  tone?: "neutral" | "emerald" | "amber" | "rose";
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  const head = {
    neutral: "bg-muted/60 text-muted-foreground",
    emerald: "bg-emerald-500/[0.08] text-emerald-700 dark:text-emerald-400",
    amber: "bg-amber-500/[0.10] text-amber-800 dark:text-amber-300",
    rose: "bg-rose-500/[0.08] text-rose-700 dark:text-rose-400",
  }[tone];
  const border = {
    neutral: "border-border",
    emerald: "border-emerald-300/60 dark:border-emerald-800/60",
    amber: "border-amber-300/60 dark:border-amber-800/60",
    rose: "border-rose-300/60 dark:border-rose-800/60",
  }[tone];
  return (
    <section className={cn("min-w-0 overflow-hidden rounded-2xl border bg-background", border, className)} data-testid={testId}>
      {label && (
        <header className={cn("flex items-center gap-1.5 px-3.5 py-2 text-[10px] font-bold uppercase tracking-wider", head)}>
          {icon}<span className="truncate">{label}</span>
        </header>
      )}
      {children}
    </section>
  );
}

export const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="min-w-0">
    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
    <p className={cn("break-words text-sm", typeof children === "string" && (children.includes("\n") || children.length > 120) ? "whitespace-pre-line font-normal" : "font-semibold")}>{children}</p>
  </div>
);
