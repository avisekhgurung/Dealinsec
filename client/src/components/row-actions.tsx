/**
 * RowActions — the table "Actions" column.
 *
 * Explicit View / Edit icon buttons instead of a bare chevron, so a register
 * reads like a professional B2B table. Edit only appears where editing is
 * actually allowed (deals lock once they leave Pending — the agreement is
 * built from the deal's terms, so changing them afterwards would silently
 * contradict a signed document).
 */
import { Link } from "wouter";
import { Eye, Pencil, Lock } from "lucide-react";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Deal } from "@shared/schema";

function IconLink({ href, label, children, testid }: {
  href: string; label: string; children: React.ReactNode; testid?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={href}
          onClick={(e) => e.stopPropagation()}
          aria-label={label}
          data-testid={testid}
          className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          {children}
        </Link>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">{label}</TooltipContent>
    </Tooltip>
  );
}

/** Generic row: view only. */
export function RowActions({ viewHref, deal }: { viewHref?: string; deal?: Deal }) {
  if (deal) {
    const editable = deal.status === "Pending";
    return (
      <div className="flex items-center justify-end gap-0.5">
        <IconLink href={`/deals/${deal.id}`} label="View deal" testid={`row-view-${deal.id}`}>
          <Eye className="w-3.5 h-3.5" />
        </IconLink>
        {editable ? (
          <IconLink href={`/deals/${deal.id}/edit`} label="Edit deal" testid={`row-edit-${deal.id}`}>
            <Pencil className="w-3.5 h-3.5" />
          </IconLink>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground/40 cursor-not-allowed"
                aria-label="Locked — this deal has moved past Pending"
              >
                <Lock className="w-3.5 h-3.5" />
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs max-w-[220px]">
              Locked — the agreement is built from these terms. Amend the agreement instead of editing the deal.
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    );
  }
  return (
    <div className="flex items-center justify-end gap-0.5">
      {viewHref && (
        <IconLink href={viewHref} label="View">
          <Eye className="w-3.5 h-3.5" />
        </IconLink>
      )}
    </div>
  );
}
