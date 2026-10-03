/** Dashboard link into the pipeline. Quietly absent where leads aren't available (no access, or not set up yet). */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ChevronRight, Target } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { canSeeModule } from "@shared/permissions";
import { listUrl, type LeadList } from "@/lib/leads";

export function LeadsStrip() {
  const { user } = useAuth();
  const allowed = canSeeModule(user as any, "deals");
  const { data } = useQuery<LeadList>({ queryKey: [listUrl({})], enabled: allowed });
  if (!allowed || !data) return null;
  const c = data.counts;
  const open = ["new", "researching", "qualified", "contacted", "replied", "meeting", "proposal"].reduce((n, s) => n + (c[s] ?? 0), 0);
  return (
    <Link href="/leads" className="flex items-center gap-3 rounded-2xl border border-border bg-background px-4 py-3 transition-colors hover:bg-muted/40" data-testid="dashboard-leads">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"><Target className="h-[18px] w-[18px]" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">Leads</span>
        <span className="block truncate text-xs text-muted-foreground">
          {data.total === 0 ? "Start your pipeline: add the companies you want to win." : `${open} open${c.won ? ` · ${c.won} won` : ""}${c.lost ? ` · ${c.lost} lost` : ""}`}
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}
