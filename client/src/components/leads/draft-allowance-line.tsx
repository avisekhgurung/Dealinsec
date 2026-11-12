/**
 * One line beside the "write with AI" buttons: how many AI drafts the plan still has, or that they are used up.
 * `useDraftAllowance` reads the numbers the Client Radar page already loads (same request, shared), and its answer is
 * advisory: absent numbers mean no line and working buttons.
 */
import { Link } from "wouter";
import { queryClient } from "@/lib/queryClient";
import { draftAllowanceNote, type DraftAllowanceNote } from "@/lib/draft-allowance";
import { OUTBOUND_USAGE_URL, useOutboundUsage } from "@/components/outbound/usage-note";
import { TopUpPrompt } from "@/components/credits/top-up";
import { WALLET_URL } from "@/lib/credit-keys";

export const useDraftAllowance = (enabled = true): DraftAllowanceNote | null => {
  const usage = useOutboundUsage(enabled).data?.usage;
  return draftAllowanceNote(usage?.plan, usage ? { credits: usage.credits?.draft ?? null, warn: usage.warn ?? null } : undefined);
};
/** After a draft was written or refused, the count on screen (and the wallet) is out of date. */
export const refreshDraftAllowance = () => Promise.all([queryClient.invalidateQueries({ queryKey: [OUTBOUND_USAGE_URL] }), queryClient.invalidateQueries({ queryKey: [WALLET_URL] })]);

export function DraftAllowanceLine({ note, own = false }: { note: DraftAllowanceNote | null; /** This place also lets the person write the message themselves. */ own?: boolean }) {
  if (!note) return null;
  return (
    <div className="space-y-1.5">
      <p className={note.out || note.warn ? "text-xs text-amber-800 dark:text-amber-300" : "text-xs text-muted-foreground"} role={note.out || note.warn ? "status" : undefined} data-testid="draft-allowance" data-state={note.out ? "out" : note.warn ? "warn" : note.credits ? "credits" : "left"}>
        {note.text}
        {note.out && own && <> You can still write this one yourself.</>}
        {note.upgrade && <> <Link href="/pricing" className="font-semibold text-primary underline-offset-2 hover:underline" data-testid="draft-allowance-upgrade">Pro includes more</Link>.</>}
      </p>
      {note.topUp && <TopUpPrompt kind="draft" label="Buy extra AI drafts" />}
    </div>
  );
}
