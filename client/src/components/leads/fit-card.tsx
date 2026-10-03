/** How well a lead matches the ideal client, with the reason for every signal. Renders nothing where the profile feature is off. */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, CircleHelp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { IdealClientDialog } from "@/components/leads/ideal-client-dialog";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { fitUrl, profileNotSetUp } from "@/lib/leads";
import { VERDICT_LABEL, type FitResult } from "@shared/fit";
import { memberCan } from "@shared/permissions";

const VERDICT_STYLE: Record<string, string> = {
  strong: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  partial: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  weak: "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300",
  excluded: "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300",
  unclear: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  no_profile: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

export function FitCard({ leadId }: { leadId: number }) {
  const { user } = useAuth();
  const canEdit = memberCan(user as any, "deals.create");
  const [open, setOpen] = useState(false);
  const { data, error } = useQuery<{ fit: FitResult; profileSet: boolean }>({ queryKey: [fitUrl(leadId)] });
  if (profileNotSetUp(error) || !data) return null;
  const f = data.fit;

  return (
    <Card className="glass-card" data-testid="fit-card">
      <CardContent className="space-y-2.5 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Fit with your ideal client</p>
            <p className="mt-0.5 break-words text-sm font-medium">{f.headline}</p>
          </div>
          <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", VERDICT_STYLE[f.verdict])} data-testid={`fit-${f.verdict}`}>{VERDICT_LABEL[f.verdict]}</span>
        </div>
        {f.signals.length > 0 && (
          <ul className="space-y-1.5">
            {f.signals.map((s) => (
              <li key={s.key} className="flex items-start gap-2 text-sm">
                {s.status === "match" ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : s.status === "mismatch" ? <X className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" /> : <CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                <span className="min-w-0 break-words text-muted-foreground">{s.detail}</span>
              </li>
            ))}
          </ul>
        )}
        {f.missing.length > 0 && <p className="text-xs text-muted-foreground">Add {f.missing.join(", ")} to this lead to check more.</p>}
        {canEdit && (
          <Button variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="button-edit-ideal">{data.profileSet ? "Edit your ideal client" : "Set your ideal client"}</Button>
        )}
      </CardContent>
      <IdealClientDialog open={open} onOpenChange={setOpen} />
    </Card>
  );
}
