import { cn } from "@/lib/utils";
import { STAGE_STYLE, stageLabel, type LeadStatus } from "@/lib/leads";

export function StageBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn("inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold", STAGE_STYLE[status as LeadStatus] ?? STAGE_STYLE.new, className)}
      data-testid={`stage-${status}`}
    >
      {stageLabel(status)}
    </span>
  );
}
