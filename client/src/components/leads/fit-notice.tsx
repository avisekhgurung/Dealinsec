/**
 * What the saved ideal client says about writing to THIS lead, shown before the person spends a draft on it.
 *
 * Two cases reach here (shared/draft-fit-gate.ts):
 *   refuse         their own exclusion list covers this company. There is no button: the way out is to change the
 *                  exclusion or archive the lead, both of which are deliberate acts elsewhere.
 *   confirm_first  nothing matched and something mismatched. The warning says exactly what, from the evidence, and
 *                  "Draft anyway" lets them overrule it — their call, made with the reason in front of them.
 *
 * It states only what the check compared. Where a fact is missing it says so rather than treating it as a mismatch.
 */
import { Ban, Check, CircleHelp, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FitGate } from "@shared/draft-fit-gate";

const ICON = { match: Check, mismatch: X, unknown: CircleHelp } as const;
const ICON_STYLE = { match: "text-emerald-600", mismatch: "text-rose-600", unknown: "text-muted-foreground" } as const;

export function FitNotice({ fit, confirmed, onConfirm }: { fit: FitGate; confirmed: boolean; onConfirm: () => void }) {
  const refused = fit.action === "refuse";
  return (
    <div
      className={`mt-1.5 space-y-2 rounded-lg border p-2.5 ${refused ? "border-rose-300 bg-rose-50/60 dark:border-rose-900 dark:bg-rose-950/30" : "border-amber-300 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30"}`}
      data-testid={`outreach-fit-${refused ? "excluded" : "weak"}`}
    >
      <p className="flex items-start gap-2 text-sm font-medium">
        {refused ? <Ban className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" aria-hidden /> : <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />}
        <span className="min-w-0 break-words">{fit.label}: {fit.headline}</span>
      </p>
      {fit.signals.length > 0 && (
        <ul className="space-y-1">
          {fit.signals.map((s) => {
            const Icon = ICON[s.status];
            return (
              <li key={s.key} className="flex items-start gap-2 text-xs text-muted-foreground">
                <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${ICON_STYLE[s.status]}`} aria-hidden />
                <span className="min-w-0 break-words">{s.detail}</span>
              </li>
            );
          })}
        </ul>
      )}
      {fit.missing.length > 0 && <p className="text-xs text-muted-foreground">Not known yet: {fit.missing.join(", ")}. Missing facts are never counted against a company.</p>}
      {fit.exclusionsNotCompared.length > 0 && (
        <p className="text-xs text-muted-foreground" data-testid="outreach-fit-wordy-exclusions">
          Written as whole sentences, so they can't be compared automatically: {fit.exclusionsNotCompared.join("; ")}. Shorten them, or use the industry and size criteria.
        </p>
      )}
      <p className="text-xs text-muted-foreground">{fit.next}</p>
      {!refused && !confirmed && (
        <Button size="sm" variant="outline" onClick={onConfirm} data-testid="outreach-fit-confirm">Draft anyway</Button>
      )}
      {!refused && confirmed && (
        <p className="text-xs font-medium" data-testid="outreach-fit-confirmed">Right — use the buttons below. The draft will still say only what the evidence carries.</p>
      )}
    </div>
  );
}
