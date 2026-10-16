/**
 * Leads — the pipeline of companies the user is working to win, from first
 * note to a signed-off deal. The pipeline summary shows every stage with its
 * count and filters the list; each row says who the company is, where the lead
 * came from, what stage it is in, and the next thing to do. A lead that is won
 * links straight to its deal from its own page.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { ChevronRight, Crosshair, FileUp, Plus, Radar, Search, Target, X } from "lucide-react";
import { BottomNav } from "@/components/bottom-nav";
import { NotificationBell } from "@/components/notification-bell";
import { LoadError } from "@/components/load-error";
import { IdealClientDialog } from "@/components/leads/ideal-client-dialog";
import { LeadFormDialog } from "@/components/leads/lead-form-dialog";
import { LeadImportDialog } from "@/components/leads/lead-import-dialog";
import { FollowUpsPanel } from "@/components/leads/follow-ups";
import { PipelineSummary } from "@/components/leads/pipeline-summary";
import { SourceChip } from "@/components/leads/source-chip";
import { StageBadge } from "@/components/leads/stage-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useMoney } from "@/hooks/use-locale";
import { press, stagger, staggerItem, useCalmMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { IDEAL_CLIENT_URL, dateLabel, hasCriteria, listUrl, profileNotSetUp, stageLabel, type IdealClientResponse, type LeadList, type LeadRowView } from "@/lib/leads";
import { formatMoney } from "@/lib/format";
import { listCoverage, rowNext } from "@shared/lead-view";
import { memberCan } from "@shared/permissions";

/** Desktop columns: company and contact, stage, source, next step, value, chevron. */
const GRID = "lg:grid lg:grid-cols-[minmax(0,1.6fr)_minmax(0,0.8fr)_minmax(0,0.9fr)_minmax(0,1.5fr)_minmax(0,0.7fr)_auto] lg:items-center lg:gap-4";

function Value({ lead, locale }: { lead: LeadRowView; locale: string }) {
  return lead.estValueMinor && lead.currency ? <>{formatMoney(lead.estValueMinor, lead.currency, locale)}</> : <span className="text-muted-foreground">—</span>;
}

/** The next step the API attached to the row, with its due date; with none, when the lead last changed. */
function NextStep({ lead, locale }: { lead: LeadRowView; locale: string }) {
  const n = rowNext(lead);
  if (n.kind === "closed") return <span className="text-muted-foreground">{n.label}</span>;
  if (n.kind === "idle") {
    return (
      <span className="min-w-0">
        <span className="block truncate text-muted-foreground">No next step</span>
        {n.lastActivity && <span className="block text-xs text-muted-foreground">Last activity {dateLabel(n.lastActivity, locale)}</span>}
      </span>
    );
  }
  return (
    <span className="min-w-0">
      <span className="block truncate"><span className="sr-only">Next step: </span>{n.title}</span>
      {n.due && <span className={cn("block text-xs", n.overdue ? "font-semibold text-rose-600 dark:text-rose-400" : "text-muted-foreground")}>{n.overdue ? "Overdue · was due " : "Due "}{dateLabel(n.due, locale)}</span>}
    </span>
  );
}

/** Who to talk to, or failing that what the company is. */
const subline = (l: LeadRowView) =>
  [l.contactName, l.contactRole].filter(Boolean).join(", ") || [l.industry, l.location].filter(Boolean).join(" · ") || l.website || "";

function LeadRow({ lead, locale, mine, index, animate }: { lead: LeadRowView; locale: string; mine: boolean; index: number; animate: boolean }) {
  return (
    <motion.li variants={animate ? staggerItem(index) : undefined} initial={animate ? undefined : false}>
      <Link href={`/leads/${lead.id}`} asChild>
        <motion.a
          {...press}
          className={cn("block px-4 py-3.5 transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500/60 lg:px-5", GRID)}
          data-testid={`lead-row-${lead.id}`}
        >
          <span className="flex items-start justify-between gap-3 lg:block">
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{lead.companyName}</span>
              <span className="block truncate text-xs text-muted-foreground">{subline(lead) || " "}</span>
            </span>
            <StageBadge status={lead.status} className="lg:hidden" />
          </span>
          <span className="hidden lg:block"><StageBadge status={lead.status} /></span>
          <span className="hidden lg:block"><SourceChip source={lead.source} mine={mine} /></span>
          <span className="mt-1.5 flex items-start justify-between gap-3 text-sm lg:mt-0 lg:block">
            <NextStep lead={lead} locale={locale} />
            <SourceChip source={lead.source} mine={mine} className="shrink-0 lg:hidden" />
          </span>
          <span className="mt-1 block text-sm font-semibold tabular-nums text-primary lg:mt-0"><Value lead={lead} locale={locale} /></span>
          <ChevronRight className="hidden h-4 w-4 text-muted-foreground lg:block" aria-hidden />
        </motion.a>
      </Link>
    </motion.li>
  );
}

/** Rows while the list loads: the same shape as a row, so nothing jumps when it lands. */
function RowsSkeleton() {
  return (
    <div role="status" aria-busy="true" data-testid="leads-skeleton">
      <span className="sr-only">Loading your leads…</span>
      <ul className="divide-y divide-border/50" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <li key={i} className={cn("px-4 py-3.5 lg:px-5", GRID)}>
            <span className="flex items-start justify-between gap-3 lg:block">
              <span className="block flex-1 space-y-1.5"><Skeleton className="h-4 w-2/3 lg:w-3/4" /><Skeleton className="h-3 w-1/2" /></span>
              <Skeleton className="h-5 w-16 rounded-full lg:hidden" />
            </span>
            <Skeleton className="hidden h-5 w-16 rounded-full lg:block" />
            <Skeleton className="hidden h-5 w-20 rounded-full lg:block" />
            <span className="mt-2 block space-y-1.5 lg:mt-0"><Skeleton className="h-3.5 w-3/5" /><Skeleton className="h-3 w-1/3" /></span>
            <Skeleton className="mt-1.5 h-4 w-14 lg:mt-0" />
            <span className="hidden w-4 lg:block" />
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function LeadsPage() {
  const { user } = useAuth();
  const { locale } = useMoney();
  const calm = useCalmMotion();
  const canEdit = memberCan(user as any, "deals.create");
  const [status, setStatus] = useState<string>("");
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [idealOpen, setIdealOpen] = useState(false);
  const ideal = useQuery<IdealClientResponse>({ queryKey: [IDEAL_CLIENT_URL] });

  const url = listUrl({ status, q: search });
  const { data, isLoading, error, refetch, isFetching } = useQuery<LeadList>({ queryKey: [url] });
  // The summary always shows the whole pipeline's counts, so counts come from an unfiltered read when a filter is on.
  const filtered = !!(status || search);
  const all = useQuery<LeadList>({ queryKey: [listUrl({})], enabled: filtered });
  const counts = filtered ? all.data?.counts : data?.counts;
  const rows = data?.rows ?? [];
  const coverage = listCoverage(rows.length, data?.total ?? 0);
  const notSetUp = !!error && String((error as Error).message).includes("LEADS_NOT_SETUP");
  const totalAll = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0;

  // Rows rise in once, on the first load only; a new filter, search or refetch shows them at once.
  const introDone = useRef(false);
  const animateRows = !calm && !introDone.current;
  useEffect(() => { if (data) introDone.current = true; }, [data]);

  const clear = () => { setStatus(""); setSearch(""); };

  return (
    <div className="min-h-screen bg-background pb-20 lg:pb-12">
      <header className="glass-header sticky top-0 z-40 lg:border-b lg:border-neutral-200/60 dark:lg:border-neutral-800/60">
        <div className="px-4 py-4 lg:mx-auto lg:max-w-[1600px] lg:px-8">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-xl font-bold tracking-tight lg:text-2xl">Leads</h1>
              <p className="mt-0.5 hidden text-sm text-muted-foreground lg:block">{totalAll} {totalAll === 1 ? "company" : "companies"} in your pipeline</p>
            </div>
            <div className="flex items-center gap-2">
              <NotificationBell className="lg:hidden" />
              <Button size="sm" variant="outline" asChild data-testid="link-outbound">
                <Link href="/outbound" aria-label="AI Outbound: find new prospects"><Radar className="h-4 w-4 lg:mr-1.5" /><span className="hidden lg:inline">AI Outbound</span></Link>
              </Button>
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
        {!notSetUp && !(error && !data) && (
          <PipelineSummary counts={counts} status={status} onStatus={setStatus} loading={!counts && (isLoading || all.isLoading)} searching={!!search.trim()} />
        )}

        {!profileNotSetUp(ideal.error) && ideal.data && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl border border-border bg-background px-4 py-2.5 text-sm" data-testid="ideal-client-line">
            <Crosshair className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" />
            <span className="min-w-0 flex-1 break-words text-muted-foreground">
              {hasCriteria(ideal.data.profile)
                ? <>Looking for: <span className="font-medium text-foreground">{[...ideal.data.profile.targetIndustries, ...ideal.data.profile.targetLocations].join(", ") || "any client"}</span>{ideal.data.profile.minDealMinor && ideal.data.profile.currency ? <> · from {formatMoney(ideal.data.profile.minDealMinor, ideal.data.profile.currency, locale)}</> : null}</>
                : "Tell us who you want to win, and each lead is checked against it."}
            </span>
            {canEdit && <Button variant="ghost" size="sm" className="h-8" onClick={() => setIdealOpen(true)} data-testid="button-ideal-client">{hasCriteria(ideal.data.profile) ? "Edit" : "Set ideal client"}</Button>}
          </div>
        )}

        <FollowUpsPanel />

        <div className="relative lg:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input placeholder="Search by company or website…" aria-label="Search leads by company or website" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 pr-9" data-testid="input-search-leads" />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear search"><X className="h-4 w-4" /></button>
          )}
        </div>

        <Card className="glass-card overflow-hidden">
          <CardContent className="p-0">
            {isLoading ? (
              <RowsSkeleton />
            ) : notSetUp ? (
              <div className="px-6 py-14 text-center"><p className="font-semibold">Leads aren't switched on yet</p><p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">This workspace is still being set up for the lead pipeline. Try again shortly.</p></div>
            ) : error && !data ? (
              <LoadError what="your leads" onRetry={() => void refetch()} retrying={isFetching} />
            ) : rows.length === 0 ? (
              filtered ? (
                <div className="px-6 py-14 text-center" data-testid="leads-no-match">
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted"><Search className="h-6 w-6 text-muted-foreground" aria-hidden /></div>
                  <p className="font-semibold">No leads match</p>
                  <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                    {search.trim() && status ? <>Nothing in {stageLabel(status)} matches “{search.trim()}”.</>
                      : search.trim() ? <>No company or website matches “{search.trim()}”.</>
                      : <>No leads are in {stageLabel(status)} right now.</>}
                  </p>
                  <Button size="sm" variant="outline" className="mt-4" onClick={clear} data-testid="button-clear-filters">Show all leads</Button>
                </div>
              ) : (
                <div className="px-6 py-14 text-center" data-testid="leads-empty">
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted"><Target className="h-6 w-6 text-muted-foreground" aria-hidden /></div>
                  <p className="font-semibold">No leads yet</p>
                  <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">Add the companies you want to win, import a list, or let AI Outbound find them. Work each one with a next step, and turn it into a deal when it closes.</p>
                  <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                    {canEdit && <Button size="sm" className="gradient-btn text-white" onClick={() => setAddOpen(true)}>Add your first lead</Button>}
                    {canEdit && <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}><FileUp className="mr-1.5 h-4 w-4" />Import a CSV</Button>}
                    <Button size="sm" variant="outline" asChild><Link href="/outbound"><Radar className="mr-1.5 h-4 w-4" />Find with AI Outbound</Link></Button>
                  </div>
                </div>
              )
            ) : (
              <>
                <div className={cn("hidden border-b border-border/60 bg-muted/30 px-5 py-2.5", GRID)} aria-hidden>
                  {["Company", "Stage", "Source", "Next step", "Value", ""].map((h, i) => (
                    <span key={i} className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</span>
                  ))}
                </div>
                <motion.ul className="divide-y divide-border/50" variants={stagger} initial={animateRows ? "hidden" : false} animate="visible" aria-label="Leads">
                  {rows.map((l, i) => (
                    <LeadRow key={l.id} lead={l} locale={locale} mine={!!user && l.ownerUserId === (user as any).id} index={i} animate={animateRows} />
                  ))}
                </motion.ul>
                {coverage.note && <p className="border-t border-border/60 px-4 py-2.5 text-xs text-muted-foreground lg:px-5" data-testid="leads-capped">{coverage.note}</p>}
              </>
            )}
          </CardContent>
        </Card>
      </main>

      <LeadFormDialog open={addOpen} onOpenChange={setAddOpen} />
      <LeadImportDialog open={importOpen} onOpenChange={setImportOpen} />
      <IdealClientDialog open={idealOpen} onOpenChange={setIdealOpen} />
      <BottomNav />
    </div>
  );
}
