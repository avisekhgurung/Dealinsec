/**
 * One line beside the "write with AI" buttons: how many AI drafts the plan still has, or that they are used up.
 * `useDraftAllowance` reads the numbers the Client Radar page already loads (same request, shared), and its answer is
 * advisory: absent numbers mean no line and working buttons.
 */
import { Link } from "wouter";
import { queryClient } from "@/lib/queryClient";
import { draftAllowanceNote, type DraftAllowanceNote } from "@/lib/draft-allowance";
import { OUTBOUND_USAGE_URL, useOutboundUsage } from "@/components/outbound/usage-note";

export const useDraftAllowance = (enabled = true): DraftAllowanceNote | null => draftAllowanceNote(useOutboundUsage(enabled).data?.usage.plan);
/** After a draft was written or refused, the count on screen is out of date. */
export const refreshDraftAllowance = () => queryClient.invalidateQueries({ queryKey: [OUTBOUND_USAGE_URL] });

export function DraftAllowanceLine({ note, own = false }: { note: DraftAllowanceNote | null; /** This place also lets the person write the message themselves. */ own?: boolean }) {
  if (!note) return null;
  return (
    <p className={note.out ? "text-xs text-amber-800 dark:text-amber-300" : "text-xs text-muted-foreground"} role={note.out ? "status" : undefined} data-testid="draft-allowance" data-state={note.out ? "out" : "left"}>
      {note.text}
      {note.out && own && <> You can still write this one yourself.</>}
      {note.upgrade && <> <Link href="/pricing" className="font-semibold text-primary underline-offset-2 hover:underline" data-testid="draft-allowance-upgrade">Pro includes more</Link>.</>}
    </p>
  );
}
