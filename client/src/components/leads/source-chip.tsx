/** Where a lead came from, from its real `source` field: always words, the icon only repeats them. */
import { Bot, FileUp, PenLine, Radar, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { leadSource, type LeadSourceKey } from "@shared/lead-view";

const ICON: Record<LeadSourceKey, LucideIcon> = { outbound: Radar, import: FileUp, manual: PenLine, agent: Bot, other: PenLine };

export function SourceChip({ source, mine, className }: { source: string; mine?: boolean; className?: string }) {
  const s = leadSource(source, { mine });
  const Icon = ICON[s.key];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium",
        s.key === "outbound" ? "border-emerald-300/70 text-emerald-800 dark:border-emerald-800/70 dark:text-emerald-300" : "border-border text-muted-foreground",
        className,
      )}
      data-testid={`source-${s.key}`}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      {s.label}
    </span>
  );
}
