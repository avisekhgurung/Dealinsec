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
import { memberCan } from "@shared/permissions";
import { useAuth } from "@/hooks/useAuth";
import { DataTable } from "@/components/data-table/data-table";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { unguardCell } from "@/lib/csv";
import { useToast } from "@/hooks/use-toast";
import { useUpgradeModal } from "@/components/upgrade-modal";
import { parseApiError, isUpgradeError } from "@/lib/api-error";
import { Plus, Briefcase, ChevronRight, Calendar, Search, X } from "lucide-react";
import { dealTypeMeta } from "@shared/dealTypeTaxonomy";
import type { Deal } from "@shared/schema";

type FilterType = "all" | "pending" | "active" | "completed";

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

function uuid(): string {
  try { return crypto.randomUUID(); } catch { return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
}

// Desktop table columns.
const columns: ColumnDef<Deal>[] = [
  {
    id: "dealNo",
    header: "Deal No.",
    meta: { label: "Deal No.", filter: "text", filterPlaceholder: "DL-…" },
    accessorFn: (d: Deal) => recordNo("deal", d.id),
    cell: ({ row }) => (
      <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{recordNo("deal", row.original.id)}</span>
    ),
  },
  {
    accessorKey: "brandName",
    header: "Brand",
    meta: { label: "Brand", filter: "text" },
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
    accessorKey: "dealAmount",
    header: "Amount",
    meta: { label: "Amount", align: "right", exportValue: (d) => d.dealAmount },
    cell: ({ row }) => <span className="font-semibold text-primary tabular-nums">₹{row.original.dealAmount.toLocaleString("en-IN")}</span>,
  },
  {
    accessorKey: "startDate",
    header: "Start",
    meta: { label: "Start", exportValue: (d) => d.startDate },
    cell: ({ row }) => <span className="text-muted-foreground whitespace-nowrap">{fmtDate(row.original.startDate)}</span>,
  },
  {
    accessorKey: "endDate",
    header: "End",
    meta: { label: "End", exportValue: (d) => d.endDate },
    cell: ({ row }) => <span className="text-muted-foreground whitespace-nowrap">{fmtDate(row.original.endDate)}</span>,
  },
  {
    id: "deliverables",
    accessorFn: (d) => d.deliverables.length,
    header: "Items",
    meta: { label: "Deliverables", align: "center", exportValue: (d) => d.deliverables.length },
    enableGlobalFilter: false,
    cell: ({ row }) => <span className="tabular-nums">{row.original.deliverables.length}</span>,
  },
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
  const canCreateDeal = memberCan(user as any, "deals.create");
  // ?pick=agreement — arrived from the invoice picker's "create an agreement".
  const [pickAgreement, setPickAgreement] = useState(
    () => new URLSearchParams(window.location.search).get("pick") === "agreement",
  );
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { openUpgradeModal } = useUpgradeModal();

  const { data: deals = [], isLoading } = useQuery<Deal[]>({
    queryKey: ["/api/deals"],
  });

  const filteredDeals = useMemo(() => {
    return deals.filter((deal) => {
      if (!inRange(deal.startDate, dateRange)) return false;
      if (filter === "pending" && deal.status !== "Pending") return false;
      if (filter === "active" && deal.status !== "Active") return false;
      if (filter === "completed" && deal.status !== "Completed") return false;
      if (search.trim()) {
        const q = search.toLowerCase().trim();
        return (
          deal.dealTitle.toLowerCase().includes(q) ||
          deal.brandName.toLowerCase().includes(q) ||
          deal.dealAmount.toString().includes(q)
        );
      }
      return true;
    });
  }, [deals, filter, search, dateRange]);

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

          {/* Mobile-only search + status chips (desktop uses the table toolbar) */}
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
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
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
            </div>
          </div>
        </div>
      </header>

      <main className="px-4 py-6 animate-fade-in lg:max-w-[1600px] lg:mx-auto lg:px-8 lg:py-8">
        <div className="flex items-center justify-end lg:hidden pt-1 pb-4">
          <DateRangeFilter value={dateRange} onChange={setDateRange} />
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
        ) : deals.length === 0 ? (
          <Card className="glass-card border-0">
            <CardContent className="py-12 text-center">
              <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-muted mx-auto mb-4"><Briefcase className="w-8 h-8 text-muted-foreground" /></div>
              <h3 className="font-semibold mb-1">No deals yet</h3>
              <p className="text-sm text-muted-foreground mb-4">Create your first brand deal to get started</p>
              {canCreateDeal && (
                <Link href="/deals/new">
                  <Button className="gradient-btn text-white" data-testid="button-create-deal-empty"><Plus className="w-4 h-4 mr-2" />Create Deal</Button>
                </Link>
              )}
            </CardContent>
          </Card>
        ) : (
          <>
            {/* ── Desktop: data table ── */}
            <div className="hidden lg:block">
              <DataTable
                columns={columns}
                data={filteredDeals}
                searchPlaceholder="Search deals..."
                searchKeys={["brandName", "dealTitle", "dealAmount"]}
                facetedFilters={[{
                  columnId: "status",
                  title: "Status",
                  options: [
                    { label: "Pending", value: "Pending" },
                    { label: "Active", value: "Active" },
                    { label: "Completed", value: "Completed" },
                  ],
                }]}
                onRowClick={(deal) => setLocation(`/deals/${deal.id}`)}
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
                          <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
                            <Calendar className="w-3.5 h-3.5" />
                            <span>{fmtDate(deal.startDate)} - {fmtDate(deal.endDate)}</span>
                          </div>
                          <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/10">
                            <span className="text-lg font-bold text-primary">₹{deal.dealAmount.toLocaleString()}</span>
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
          </>
        )}
      </main>

      <PickParentDialog kind="agreement" open={pickAgreement} onOpenChange={setPickAgreement} />
      <BottomNav />
    </div>
  );
}
