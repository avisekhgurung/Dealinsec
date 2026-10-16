import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { type ColumnDef } from "@tanstack/react-table";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { BottomNav } from "@/components/bottom-nav";
import { NotificationBell } from "@/components/notification-bell";
import { StatusBadge } from "@/components/status-badge";
import { recordNo } from "@shared/schema";
import { RowActions } from "@/components/row-actions";
import { DateRangeFilter, ALL_TIME, inRange, type DateRange } from "@/components/date-range-filter";
import { PickParentDialog } from "@/components/pick-parent-dialog";
import { memberCan, canReadModule } from "@shared/permissions";
import { useAuth } from "@/hooks/useAuth";
import { useMoney, type MoneyFormat } from "@/hooks/use-locale";
import { DataTable } from "@/components/data-table/data-table";
import { LoadError } from "@/components/load-error";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { unguardCell } from "@/lib/csv";
import { useToast } from "@/hooks/use-toast";
import { useUpgradeModal } from "@/components/upgrade-modal";
import { parseApiError, isUpgradeError } from "@/lib/api-error";
import { Plus, Briefcase, ChevronRight, Calendar, Search, X, LayoutList, Columns3 } from "lucide-react";
import { dealTypeMeta } from "@shared/dealTypeTaxonomy";
import { engagementLabel, serviceLabel } from "@shared/engagement";
import type { Deal, Quote, Contract, BrandInvoice } from "@shared/schema";
import { DEALS_VIEW_KEY, parseDealsView, workflowPositions, type DealsView, type WorkflowPosition } from "@shared/deal-view";
import { useAudience } from "@/hooks/use-audience";
import { SegmentedControl } from "@/components/segmented-control";
import { motion } from "framer-motion";
import { fadeIn, useCalmMotion } from "@/lib/motion";
import { DealsBoard } from "@/components/deals/deals-board";
import { WorkflowChip } from "@/components/deals/workflow-chip";

type FilterType = "all" | "pending" | "active" | "completed";

const fmtDate = (s: string, locale: string) =>
  new Date(s).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });

function uuid(): string {
  try { return crypto.randomUUID(); } catch { return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
}

/** A deal plus its amount as the user reads it. The table's text search
 *  matches raw row keys, and the stored key is minor units — searching
 *  "650000" would find a ₹6,500 deal (650000 paise). This key is what the
 *  search looks at instead. */
type DealRow = Deal & { amountMajor: string; workflow: WorkflowPosition | null; engagementText: string; serviceText: string };

/** The engagement model and service as read (and searched, and exported), never as raw ids. */
const engagementText = (d: Deal) => engagementLabel(d.engagementModel, d.engagementTerms) ?? "";
const serviceText = (d: Deal) => serviceLabel(d.serviceCategory) ?? "";
// Facet values: a missing model or service is its own option, so "none yet" can be filtered too.
const NONE = "__none";
const facetFilter = (row: { getValue: (id: string) => unknown }, id: string, value: string[]) => value.includes(row.getValue(id) as string);

const VIEW_OPTIONS = [
  { value: "list", label: "List", Icon: LayoutList, testId: "view-list" },
  { value: "board", label: "Board", Icon: Columns3, testId: "view-board" },
] as const;

/** The List | Board choice, remembered on this device. Storage can be missing or blocked: then it's just the list. */
function useDealsView(): [DealsView, (v: DealsView) => void] {
  const [view, setView] = useState<DealsView>(() => {
    try { return parseDealsView(localStorage.getItem(DEALS_VIEW_KEY)); } catch { return "list"; }
  });
  const choose = (v: DealsView) => {
    setView(v);
    try { localStorage.setItem(DEALS_VIEW_KEY, v); } catch { /* remembered for this visit only */ }
  };
  return [view, choose];
}

// Desktop table columns. A factory rather than a constant because money and
// dates now need the org's currency and locale, which only a hook can supply.
const makeColumns = (fmt: MoneyFormat, party = "Client", withWorkflow = false): ColumnDef<DealRow>[] => [
  {
    id: "dealNo",
    header: "Deal No.",
    meta: { label: "Deal No.", filter: "text", filterPlaceholder: "DL-…" },
    accessorFn: (d: DealRow) => recordNo("deal", d.id),
    cell: ({ row }) => (
      <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{recordNo("deal", row.original.id)}</span>
    ),
  },
  {
    accessorKey: "brandName",
    header: party,
    meta: { label: party, filter: "text" },
    cell: ({ row }) => <span className="font-semibold text-foreground">{row.original.brandName}</span>,
  },
  {
    accessorKey: "dealTitle",
    header: "Deal",
    meta: { label: "Deal", filter: "text" },
    cell: ({ row }) => <span className="text-muted-foreground">{row.original.dealTitle}</span>,
  },
  {
    accessorKey: "dealType",
    header: "Type",
    meta: { label: "Type", filter: "select" },
    cell: ({ row }) => {
      const t = (row.original as any).dealType as string | undefined;
      return t ? (
        <span className="text-xs px-1.5 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20 whitespace-nowrap">
          {(dealTypeMeta as any)[t]?.emoji ?? "·"} {t}
        </span>
      ) : <span className="text-muted-foreground">—</span>;
    },
  },
  {
    id: "engagement",
    header: "Engagement",
    accessorFn: (d: DealRow) => d.engagementModel ?? NONE,
    enableGlobalFilter: false,
    meta: { label: "Engagement", exportValue: (d: DealRow) => d.engagementText },
    filterFn: facetFilter,
    cell: ({ row }) => row.original.engagementText
      ? <span className="text-xs whitespace-nowrap">{row.original.engagementText}</span>
      : <span className="text-muted-foreground">—</span>,
  },
  {
    id: "service",
    header: "Service",
    accessorFn: (d: DealRow) => d.serviceCategory ?? NONE,
    enableGlobalFilter: false,
    meta: { label: "Service", exportValue: (d: DealRow) => d.serviceText },
    filterFn: facetFilter,
    cell: ({ row }) => row.original.serviceText
      ? <span className="text-xs text-muted-foreground whitespace-nowrap">{row.original.serviceText}</span>
      : <span className="text-muted-foreground">—</span>,
  },
  {
    accessorKey: "dealAmountMinor",
    header: "Amount",
    // The CSV keeps exporting MAJOR units — a spreadsheet column of paise
    // would be a silent 100x change to a file users already reconcile against.
    meta: { label: "Amount", align: "right", exportValue: (d) => fmt.major(d.dealAmountMinor) },
    cell: ({ row }) => <span className="font-semibold text-primary tabular-nums">{fmt.money(row.original.dealAmountMinor)}</span>,
  },
  {
    accessorKey: "startDate",
    header: "Start",
    meta: { label: "Start", exportValue: (d) => d.startDate },
    cell: ({ row }) => <span className="text-muted-foreground whitespace-nowrap">{fmtDate(row.original.startDate, fmt.locale)}</span>,
  },
  {
    accessorKey: "endDate",
    header: "End",
    meta: { label: "End", exportValue: (d) => d.endDate },
    cell: ({ row }) => <span className="text-muted-foreground whitespace-nowrap">{fmtDate(row.original.endDate, fmt.locale)}</span>,
  },
  {
    id: "deliverables",
    accessorFn: (d) => d.deliverables.length,
    header: "Items",
    meta: { label: "Deliverables", align: "center", exportValue: (d) => d.deliverables.length },
    enableGlobalFilter: false,
    cell: ({ row }) => <span className="tabular-nums">{row.original.deliverables.length}</span>,
  },
  // Where each deal is in Deal → Quotation → Agreement → Invoice → Paid. Only
  // when every source could be read: a guessed "No quote yet" would mislead.
  ...(withWorkflow ? [{
    id: "workflow",
    header: "Stage",
    accessorFn: (d: DealRow) => d.workflow?.step ?? 0,
    enableGlobalFilter: false,
    meta: { label: "Stage", exportValue: (d: DealRow) => d.workflow?.label ?? "" },
    cell: ({ row }: { row: { original: DealRow } }) =>
      row.original.workflow ? <WorkflowChip position={row.original.workflow} /> : <span className="text-muted-foreground">—</span>,
  } satisfies ColumnDef<DealRow>] : []),
  {
    accessorKey: "status",
    header: "Status",
    meta: { label: "Status" },
    cell: ({ row }) => <StatusBadge status={row.original.status} size="compact" />,
    filterFn: (row, id, value: string[]) => value.includes(row.getValue(id)),
  },
  {
    id: "actions",
    header: "Actions",
    meta: { label: "Actions", align: "right" },
    enableSorting: false,
    enableHiding: false,
    cell: ({ row }) => <RowActions deal={row.original} />,
  },
];

export default function DealsPage() {
  const [filter, setFilter] = useState<FilterType>("all");
  const [search, setSearch] = useState("");
  const [dateRange, setDateRange] = useState<DateRange>(ALL_TIME);
  const { user } = useAuth();
  const fmt = useMoney();
  const audience = useAudience();
  const [view, setView] = useDealsView();
  // The view fades in only after the person switches it, never on first load.
  const [switched, setSwitched] = useState(false);
  const calm = useCalmMotion();
  const chooseView = (v: DealsView) => { if (v !== view) setSwitched(true); setView(v); };
  const canCreateDeal = memberCan(user as any, "deals.create");
  // ?pick=agreement — arrived from the invoice picker's "create an agreement".
  const [pickAgreement, setPickAgreement] = useState(
    () => new URLSearchParams(window.location.search).get("pick") === "agreement",
  );
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { openUpgradeModal } = useUpgradeModal();

  const { data: deals = [], isLoading, isError, refetch, isFetching } = useQuery<Deal[]>({
    queryKey: ["/api/deals"],
  });

  // Where each deal is in its workflow, from the three org-wide lists (the same
  // cached queries the dashboard uses): one request each, never one per deal.
  // A list this member may not read is not fetched, and a list that failed is
  // unknown, not empty — either way no position is shown rather than a guess.
  const readQuotes = canReadModule(user as any, "quotations");
  const readAgreements = canReadModule(user as any, "agreements");
  const readInvoices = canReadModule(user as any, "invoices");
  const quotesQ = useQuery<Quote[]>({ queryKey: ["/api/quotes"], enabled: !!user && readQuotes });
  const contractsQ = useQuery<Contract[]>({ queryKey: ["/api/contracts"], enabled: !!user && readAgreements });
  const invoicesQ = useQuery<BrandInvoice[]>({ queryKey: ["/api/brand-invoices"], enabled: !!user && readInvoices });
  const known = <T,>(q: { isError: boolean; data?: T }, readable: boolean): T | null => (readable && !q.isError && q.data != null ? q.data : null);
  const positions = useMemo(
    () => workflowPositions(deals, {
      quotes: known(quotesQ, readQuotes),
      agreements: known(contractsQ, readAgreements),
      invoices: known(invoicesQ, readInvoices),
    }),
    [deals, quotesQ.data, quotesQ.isError, contractsQ.data, contractsQ.isError, invoicesQ.data, invoicesQ.isError, readQuotes, readAgreements, readInvoices], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // Keyed on whether positions are known, not on their identity: a refetch must not rebuild the table's columns.
  const hasPositions = !!positions;
  const columns = useMemo(() => makeColumns(fmt, audience.party, hasPositions), [fmt, audience.party, hasPositions]);

  // Search and dates narrow both views. The status filter is the list's only:
  // the board's columns ARE the statuses, so it would just empty two of them.
  const searchedDeals = useMemo(() => {
    return deals.filter((deal) => {
      if (!inRange(deal.startDate, dateRange)) return false;
      if (search.trim()) {
        const q = search.toLowerCase().trim();
        return (
          deal.dealTitle.toLowerCase().includes(q) ||
          deal.brandName.toLowerCase().includes(q) ||
          // Match the amount the user can SEE (major units), not the stored
          // paise — "65000" must still find a ₹65,000 deal.
          String(fmt.major(deal.dealAmountMinor)).includes(q) ||
          engagementText(deal).toLowerCase().includes(q) ||
          serviceText(deal).toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [deals, search, dateRange, fmt]);

  const filteredDeals = useMemo(() => searchedDeals.filter((deal) => {
    if (filter === "pending" && deal.status !== "Pending") return false;
    if (filter === "active" && deal.status !== "Active") return false;
    if (filter === "completed" && deal.status !== "Completed") return false;
    return true;
  }), [searchedDeals, filter]);

  // The desktop table does its own search and status filtering, so it gets
  // every deal in the date range (as before), not the mobile-filtered list.
  const tableRows = useMemo<DealRow[]>(
    () => deals
      .filter((d) => inRange(d.startDate, dateRange))
      .map((d) => ({ ...d, amountMajor: String(fmt.major(d.dealAmountMinor)), workflow: positions?.get(d.id) ?? null, engagementText: engagementText(d), serviceText: serviceText(d) })),
    [deals, dateRange, fmt, positions],
  );
  // Only the models and services the workspace actually uses are offered.
  const engagementFacets = useMemo(() => {
    const opts = (pick: (d: DealRow) => string | null, label: (d: DealRow) => string, none: string) => {
      const seen = new Map<string, string>();
      for (const d of tableRows) { const v = pick(d); seen.set(v ?? NONE, v ? label(d) : none); }
      return Array.from(seen, ([value, l]) => ({ value, label: l })).sort((a, b) => (a.value === NONE ? 1 : b.value === NONE ? -1 : a.label.localeCompare(b.label)));
    };
    return {
      engagement: opts((d) => d.engagementModel, (d) => engagementLabel(d.engagementModel) ?? "", "No model"),
      service: opts((d) => d.serviceCategory, (d) => d.serviceText, "No service"),
    };
  }, [tableRows]);

  const filters: { value: FilterType; label: string }[] = [
    { value: "all", label: "All" },
    { value: "pending", label: "Pending" },
    { value: "active", label: "Active" },
    { value: "completed", label: "Completed" },
  ];

  // Bulk-create deals from an imported CSV (round-trips the export format).
  // CSV import now lives at /deals/import (full-field template + preview).
  return (
    <div className="min-h-screen bg-background pb-20 lg:pb-12">
      <header className="glass-header sticky top-0 z-40 lg:border-b lg:border-neutral-200/60 dark:lg:border-neutral-800/60">
        <div className="px-4 py-4 space-y-3 lg:max-w-[1600px] lg:mx-auto lg:px-8 lg:py-6 lg:space-y-0">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-xl lg:text-2xl font-bold tracking-tight">Deals</h1>
              <p className="hidden lg:block text-sm text-muted-foreground mt-0.5">
                {deals.length} {deals.length === 1 ? "deal" : "deals"} total
              </p>
            </div>
            <div className="flex items-center gap-1.5">
            <NotificationBell className="lg:hidden" />
            {canCreateDeal && (
              <Link href="/deals/new">
                <Button size="sm" className="gradient-btn text-white lg:h-10 lg:px-5 lg:text-sm" data-testid="button-new-deal">
                  <Plus className="w-4 h-4 mr-1 lg:mr-2" />
                  <span className="lg:inline">New</span><span className="hidden lg:inline">&nbsp;Deal</span>
                </Button>
              </Link>
            )}
            </div>
          </div>

          {/* Mobile-only search + status chips (desktop uses the table toolbar).
              The board has no status chips: its columns are the statuses. */}
          <div className="flex flex-col gap-3 lg:hidden">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search deals..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 pr-8 h-9 bg-white/50 dark:bg-white/5 rounded-xl text-sm"
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2">
                  <X className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              )}
            </div>
            {view === "list" && <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
              {filters.map((f) => (
                <Button
                  key={f.value}
                  variant={filter === f.value ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFilter(f.value)}
                  className={`flex-shrink-0 rounded-full ${filter === f.value ? "gradient-btn text-white" : ""}`}
                  data-testid={`filter-${f.value}`}
                >
                  {f.label}
                </Button>
              ))}
            </div>}
          </div>
        </div>
      </header>

      <main className="px-4 py-6 animate-fade-in lg:max-w-[1600px] lg:mx-auto lg:px-8 lg:py-8">
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 pb-4 lg:pt-0 lg:pb-5">
          {(isLoading || deals.length > 0) ? (
            <SegmentedControl label="View" value={view} onChange={chooseView} options={VIEW_OPTIONS} />
          ) : <span />}
          <div className="flex items-center gap-2">
            {/* The desktop table has its own search; the board needs one. */}
            {view === "board" && deals.length > 0 && (
              <div className="relative hidden lg:block">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
                <Input
                  placeholder="Search deals..."
                  aria-label="Search deals"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 pr-8 h-9 w-64 text-sm"
                  data-testid="board-search"
                />
                {search && (
                  <button type="button" aria-label="Clear search" onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2">
                    <X className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                )}
              </div>
            )}
            <div className={view === "board" ? "" : "lg:hidden"}>
              <DateRangeFilter value={dateRange} onChange={setDateRange} />
            </div>
          </div>
        </div>
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="glass-card border-0">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 space-y-2"><Skeleton className="h-5 w-3/4" /><Skeleton className="h-4 w-1/2" /></div>
                    <Skeleton className="h-6 w-16 rounded-full" />
                  </div>
                  <div className="flex items-center justify-between pt-3 border-t"><Skeleton className="h-6 w-24" /><Skeleton className="h-4 w-20" /></div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : isError && deals.length === 0 ? (
          <Card className="glass-card border-0">
            <CardContent className="p-0">
              <LoadError what="your deals" onRetry={() => refetch()} retrying={isFetching} />
            </CardContent>
          </Card>
        ) : deals.length === 0 ? (
          <Card className="glass-card border-0">
            <CardContent className="py-12 text-center">
              <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-muted mx-auto mb-4"><Briefcase className="w-8 h-8 text-muted-foreground" /></div>
              <h3 className="font-semibold mb-1">No deals yet</h3>
              <p className="text-sm text-muted-foreground mb-4">{audience.emptyState}</p>
              {canCreateDeal && (
                <Link href="/deals/new">
                  <Button className="gradient-btn text-white" data-testid="button-create-deal-empty"><Plus className="w-4 h-4 mr-2" />Create Deal</Button>
                </Link>
              )}
            </CardContent>
          </Card>
        ) : view === "board" ? (
          <motion.div key="board" variants={fadeIn} initial={switched && !calm ? "hidden" : false} animate="visible">
            <DealsBoard deals={searchedDeals} positions={positions} fmt={fmt} filtered={searchedDeals.length !== deals.length} />
          </motion.div>
        ) : (
          <motion.div key="list" variants={fadeIn} initial={switched && !calm ? "hidden" : false} animate="visible">
            {/* ── Desktop: data table ── */}
            <div className="hidden lg:block">
              <DataTable
                columns={columns}
                data={tableRows}
                searchPlaceholder="Search deals..."
                searchKeys={["brandName", "dealTitle", "amountMajor", "engagementText", "serviceText"]}
                facetedFilters={[...([...engagementFacets.engagement, ...engagementFacets.service].some((o) => o.value !== NONE) ? [
                  { columnId: "engagement", title: "Engagement", options: engagementFacets.engagement },
                  { columnId: "service", title: "Service", options: engagementFacets.service },
                ] : []), {
                  columnId: "status",
                  title: "Status",
                  options: [
                    { label: "Pending", value: "Pending" },
                    { label: "Active", value: "Active" },
                    { label: "Completed", value: "Completed" },
                  ],
                }]}
                onRowClick={(deal) => setLocation(`/deals/${deal.id}`)}
                rowHref={(deal) => `/deals/${deal.id}`}
                rowLabel={(deal) => `Deal: ${deal.dealTitle}, ${deal.brandName}`}
                exportFileName="deals"
                onImportClick={canCreateDeal ? () => setLocation("/deals/import") : undefined}
                toolbarExtra={<DateRangeFilter value={dateRange} onChange={setDateRange} />}
                emptyMessage="No deals match your filters."
              />
            </div>

            {/* ── Mobile: cards ── */}
            <div className="lg:hidden">
              {filteredDeals.length > 0 ? (
                <div className="flex flex-col gap-4">
                  {filteredDeals.map((deal) => (
                    <Link key={deal.id} href={`/deals/${deal.id}`}>
                      <Card className="glass-card border hover-elevate active-elevate-2 cursor-pointer rounded-xl shadow-sm" data-testid={`card-deal-${deal.id}`}>
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-semibold truncate">{deal.brandName}</p>
                                {(deal as any).dealType && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-primary/10 text-primary font-medium border border-primary/20 shrink-0">
                                    {(dealTypeMeta as any)[(deal as any).dealType]?.emoji ?? "·"} {(deal as any).dealType}
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground truncate">{deal.dealTitle}</p>
                            </div>
                            <StatusBadge status={deal.status} size="compact" />
                          </div>
                          <div className="flex items-center justify-between gap-3 mt-3">
                            <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
                              <Calendar className="w-3.5 h-3.5 shrink-0" />
                              <span className="truncate">{fmtDate(deal.startDate, fmt.locale)} - {fmtDate(deal.endDate, fmt.locale)}</span>
                            </div>
                            {positions?.get(deal.id) && <WorkflowChip position={positions.get(deal.id)!} className="shrink-0" />}
                          </div>
                          <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/10">
                            <span className="text-lg font-bold text-primary">{fmt.money(deal.dealAmountMinor)}</span>
                            <div className="flex items-center gap-1 text-muted-foreground">
                              <span className="text-xs">{deal.deliverables.length} deliverable{deal.deliverables.length !== 1 ? "s" : ""}</span>
                              <ChevronRight className="w-4 h-4" />
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  ))}
                </div>
              ) : (
                <Card className="glass-card border-0">
                  <CardContent className="py-12 text-center">
                    <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-muted mx-auto mb-4"><Briefcase className="w-8 h-8 text-muted-foreground" /></div>
                    <h3 className="font-semibold mb-1">No matches found</h3>
                    <p className="text-sm text-muted-foreground mb-4">Try a different search or filter</p>
                    <Button variant="outline" onClick={() => { setSearch(""); setFilter("all"); }}>Clear Filters</Button>
                  </CardContent>
                </Card>
              )}
            </div>
          </motion.div>
        )}
      </main>

      <PickParentDialog kind="agreement" open={pickAgreement} onOpenChange={setPickAgreement} />
      <BottomNav />
    </div>
  );
}
