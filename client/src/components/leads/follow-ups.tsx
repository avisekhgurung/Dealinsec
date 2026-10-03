/**
 * What to do on the pipeline today: overdue steps first, then today's, then
 * what is coming up. Each row opens its lead; "Done" closes the step in one tap.
 * Renders nothing where there is nothing due or leads are unavailable.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useMoney } from "@/hooks/use-locale";
import { useToast } from "@/hooks/use-toast";
import { trackEvent } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import { FOLLOWUPS_URL, dateLabel, leadCall, leadError, refreshLeads, type FollowUps, type FollowUpView } from "@/lib/leads";
import { canSeeModule, memberCan } from "@shared/permissions";

export function FollowUpsPanel({ max = 5, className }: { max?: number; className?: string }) {
  const { user } = useAuth();
  const { locale } = useMoney();
  const { toast } = useToast();
  const allowed = canSeeModule(user as any, "deals");
  const canEdit = memberCan(user as any, "deals.create");
  const { data } = useQuery<FollowUps>({ queryKey: [FOLLOWUPS_URL], enabled: allowed });
  const done = useMutation({
    mutationFn: (f: FollowUpView) => leadCall("PATCH", `/api/leads/${f.leadId}/tickets/${f.id}`, { status: "done" }),
    onSuccess: () => { trackEvent("lead_ticket_done", { surface: "follow_ups" }); refreshLeads(); toast({ title: "Marked done" }); },
    onError: (e) => toast({ title: "Couldn't do that", description: leadError(e), variant: "destructive" }),
  });
  if (!allowed || !data) return null;

  const groups: { key: string; label: string; items: FollowUpView[]; tone: string }[] = [
    { key: "overdue", label: "Overdue", items: data.overdue, tone: "text-rose-600 dark:text-rose-400" },
    { key: "today", label: "Due today", items: data.dueToday, tone: "text-amber-700 dark:text-amber-400" },
    { key: "soon", label: "Coming up", items: data.upcoming, tone: "text-muted-foreground" },
  ];
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  if (!total) return null;
  let budget = max;

  return (
    <section className={cn("rounded-2xl border border-border bg-background", className)} aria-label="Lead follow-ups" data-testid="follow-ups">
      <header className="flex items-center justify-between px-4 pt-3.5">
        <h2 className="text-sm font-semibold">Follow-ups</h2>
        <span className="text-xs text-muted-foreground">{total} next {total === 1 ? "step" : "steps"}</span>
      </header>
      <div className="px-2 pb-2 pt-1">
        {groups.map((g) => {
          const shown = g.items.slice(0, Math.max(0, budget));
          budget -= shown.length;
          if (!shown.length) return null;
          return (
            <div key={g.key} className="mt-1">
              <p className={cn("px-2 pb-0.5 text-[10px] font-bold uppercase tracking-wider", g.tone)}>{g.label}{g.items.length > shown.length ? ` (${g.items.length})` : ""}</p>
              <ul>
                {shown.map((f) => (
                  <li key={f.id} className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-muted/40" data-testid={`followup-${f.id}`}>
                    <Link href={`/leads/${f.leadId}`} className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{f.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">{f.companyName} · {dateLabel(f.due, locale)}</span>
                    </Link>
                    {canEdit && (
                      <Button size="sm" variant="outline" className="h-8 shrink-0" disabled={done.isPending} onClick={() => done.mutate(f)} aria-label={`Mark done: ${f.title}`} data-testid={`followup-done-${f.id}`}>
                        <Check className="mr-1 h-3.5 w-3.5" />Done
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {total > Math.max(0, max) && <Link href="/leads" className="mt-1 block px-2 text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-400">See all leads</Link>}
      </div>
    </section>
  );
}
