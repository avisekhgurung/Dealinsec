/**
 * Leads — the pipeline of companies the user is working to win, from first
 * note to a signed-off deal. Stage chips filter it, each row shows the next
 * thing to do, and a lead that is won links straight to its deal.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ChevronRight, FileUp, Plus, Search, Target, X } from "lucide-react";
import { BottomNav } from "@/components/bottom-nav";
import { NotificationBell } from "@/components/notification-bell";
import { LeadFormDialog } from "@/components/leads/lead-form-dialog";
import { LeadImportDialog } from "@/components/leads/lead-import-dialog";
import { FollowUpsPanel } from "@/components/leads/follow-ups";
import { StageBadge } from "@/components/leads/stage-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useMoney } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";
import { LEAD_STATUSES, dateLabel, isOverdue, listUrl, stageLabel, type LeadList, type LeadRowView } from "@/lib/leads";
import { formatMoney } from "@/lib/format";
import { memberCan } from "@shared/permissions";

function Value({ lead, locale }: { lead: LeadRowView; locale: string }) {
  return lead.estValueMinor && lead.currency ? <>{formatMoney(lead.estValueMinor, lead.currency, locale)}</> : <span className="text-muted-foreground">—</span>;
}

function NextAction({ lead, locale }: { lead: LeadRowView; locale: string }) {
  // A closed lead has no "next": an old open step on a won lead must not read as overdue.
  if (lead.status === "won" || lead.status === "lost") return <span className="text-muted-foreground">{lead.status === "won" ? "Won" : "Closed"}</span>;
  const t = lead.nextTicket;
  if (!t) return <span className="text-muted-foreground">No next step</span>;
  const late = isOverdue(t.dueAt);
  return (
    <span className="min-w-0">
      <span className="block truncate">{t.title}</span>
      {t.dueAt && <span className={cn("block text-xs", late ? "font-semibold text-rose-600 dark:text-rose-400" : "text-muted-foreground")}>{late ? "Overdue · " : "Due "}{dateLabel(t.dueAt, locale)}</span>}
    </span>
  );
}

export default function LeadsPage() {
  const { user } = useAuth();
  const { locale } = useMoney();
  const canEdit = memberCan(user as any, "deals.create");
  const [status, setStatus] = useState<string>("");
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const url = listUrl({ status, q: search });
  const { data, isLoading, error } = useQuery<LeadList>({ queryKey: [url] });
  // The chips always show the whole pipeline's counts, so counts come from an unfiltered read when a filter is on.
  const all = useQuery<LeadList>({ queryKey: [listUrl({})], enabled: !!(status || search) });
  const counts = (status || search ? all.data?.counts : data?.counts) ?? {};
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const rows = data?.rows ?? [];
  const notSetUp = !!error && String((error as Error).message).includes("LEADS_NOT_SETUP");

  return (
    <div className="min-h-screen bg-background pb-20 lg:pb-12">
      <header className="glass-header sticky top-0 z-40 lg:border-b lg:border-neutral-200/60 dark:lg:border-neutral-800/60">
        <div className="px-4 py-4 lg:mx-auto lg:max-w-[1600px] lg:px-8">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-xl font-bold tracking-tight lg:text-2xl">Leads</h1>
              <p className="mt-0.5 hidden text-sm text-muted-foreground lg:block">{total} {total === 1 ? "company" : "companies"} in your pipeline</p>
            </div>
            <div className="flex items-center gap-2">
              <NotificationBell className="lg:hidden" />
              {canEdit && (
                <Button size="sm" variant="outline" onClick={() => setImportOpen(true)} aria-label="Import leads from a CSV" data-testid="button-import-leads">
                  <FileUp className="h-4 w-4 lg:mr-1.5" /><span className="hidden lg:inline">Import</span>
                </Button>
              )}
              {canEdit && (
                <Button size="sm" className="gradient-btn text-white" onClick={() => setAddOpen(true)} data-testid="button-add-lead">
                  <Plus className="mr-1 h-4 w-4 lg:mr-1.5" />Add<span className="hidden lg:inline">&nbsp;lead</span>
                </Button>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="animate-fade-in space-y-4 px-4 py-5 lg:mx-auto lg:max-w-[1600px] lg:space-y-5 lg:px-8 lg:py-6">
        <FollowUpsPanel />

        {/* Stage filter: scrolls sideways inside itself, never the page. */}
        <div className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:overflow-visible lg:px-0" role="tablist" aria-label="Filter by stage">
          <div className="flex w-max gap-2 lg:w-auto lg:flex-wrap">
            {[{ key: "", label: "All", n: total }, ...LEAD_STATUSES.map((s) => ({ key: s as string, label: stageLabel(s), n: counts[s] ?? 0 }))].map((c) => (
              <button
                key={c.key || "all"} role="tab" aria-selected={status === c.key} onClick={() => setStatus(c.key)}
                className={cn("flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                  status === c.key ? "border-emerald-600 bg-emerald-600 text-white" : "border-border bg-background text-foreground hover:bg-muted")}
                data-testid={`chip-${c.key || "all"}`}
              >
                {c.label}<span className={cn("tabular-nums text-xs", status === c.key ? "text-white/80" : "text-muted-foreground")}>{c.n}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="relative lg:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search by company or website…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 pr-9" data-testid="input-search-leads" />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear search"><X className="h-4 w-4" /></button>
          )}
        </div>

        <Card className="glass-card overflow-hidden">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="space-y-3 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}</div>
            ) : notSetUp ? (
              <div className="px-6 py-14 text-center"><p className="font-semibold">Leads aren't switched on yet</p><p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">This workspace is still being set up for the lead pipeline. Try again shortly.</p></div>
            ) : error ? (
              <div className="px-6 py-14 text-center"><p className="font-semibold">Couldn't load your leads</p><p className="mt-1 text-sm text-muted-foreground">Check your connection and reload.</p></div>
            ) : rows.length === 0 ? (
              <div className="px-6 py-14 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted"><Target className="h-6 w-6 text-muted-foreground" /></div>
                <p className="font-semibold">{search || status ? "No leads match" : "No leads yet"}</p>
                <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                  {search || status ? "Try another stage or search." : "Add the companies you want to win. Work each one with a next step, and turn it into a deal when it closes."}
                </p>
                {!search && !status && canEdit && <Button size="sm" className="gradient-btn mt-4 text-white" onClick={() => setAddOpen(true)}>Add your first lead</Button>}
              </div>
            ) : (
              <>
                <div className="hidden grid-cols-[minmax(0,1.6fr)_minmax(0,0.9fr)_minmax(0,1.4fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_auto] gap-4 border-b border-border/60 bg-muted/30 px-5 py-2.5 lg:grid">
                  {["Company", "Stage", "Next step", "Value", "Updated", ""].map((h, i) => (
                    <span key={i} className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</span>
                  ))}
                </div>
                <ul className="divide-y divide-border/50">
                  {rows.map((l) => (
                    <li key={l.id}>
                      <Link href={`/leads/${l.id}`} className="block px-4 py-3.5 transition-colors hover:bg-muted/40 lg:grid lg:grid-cols-[minmax(0,1.6fr)_minmax(0,0.9fr)_minmax(0,1.4fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_auto] lg:items-center lg:gap-4 lg:px-5" data-testid={`lead-row-${l.id}`}>
                        <span className="flex items-start justify-between gap-3 lg:block">
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold">{l.companyName}</span>
                            <span className="block truncate text-xs text-muted-foreground">{[l.industry, l.location].filter(Boolean).join(" · ") || l.website || " "}</span>
                          </span>
                          <StageBadge status={l.status} className="lg:hidden" />
                        </span>
                        <span className="hidden lg:block"><StageBadge status={l.status} /></span>
                        <span className="mt-1.5 block text-sm lg:mt-0"><NextAction lead={l} locale={locale} /></span>
                        <span className="mt-1 block text-sm font-semibold tabular-nums text-primary lg:mt-0"><Value lead={l} locale={locale} /></span>
                        <span className="hidden text-xs text-muted-foreground lg:block">{dateLabel(l.updatedAt, locale)}</span>
                        <ChevronRight className="hidden h-4 w-4 text-muted-foreground lg:block" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </CardContent>
        </Card>
      </main>

      <LeadFormDialog open={addOpen} onOpenChange={setAddOpen} />
      <LeadImportDialog open={importOpen} onOpenChange={setImportOpen} />
      <BottomNav />
    </div>
  );
}
