import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { type ColumnDef } from "@tanstack/react-table";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { BottomNav } from "@/components/bottom-nav";
import { DateRangeFilter, ALL_TIME, inRange, type DateRange } from "@/components/date-range-filter";
import { NotificationBell } from "@/components/notification-bell";
import { StatusBadge } from "@/components/status-badge";
import { DataTable } from "@/components/data-table/data-table";
import { FileText, Calendar, Shield, ChevronRight, FileCheck, Search, X, Plus } from "lucide-react";
import type { Contract, Deal } from "@shared/schema";

type FilterType = "all" | "active" | "completed";

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

const columns: ColumnDef<Contract>[] = [
  {
    accessorKey: "contractName",
    header: "Agreement",
    meta: { label: "Agreement" },
    cell: ({ row }) => <span className="font-semibold text-foreground">{row.original.contractName}</span>,
  },
  {
    accessorKey: "brandName",
    header: "Brand",
    meta: { label: "Brand" },
    cell: ({ row }) => <span className="text-muted-foreground">{row.original.brandName}</span>,
  },
  {
    accessorKey: "contractValue",
    header: "Value",
    meta: { label: "Value", align: "right", exportValue: (c) => c.contractValue },
    cell: ({ row }) => <span className="font-semibold text-primary tabular-nums">₹{row.original.contractValue.toLocaleString("en-IN")}</span>,
  },
  {
    accessorKey: "startDate",
    header: "Start",
    meta: { label: "Start", exportValue: (c) => c.startDate },
    cell: ({ row }) => <span className="text-muted-foreground whitespace-nowrap">{fmtDate(row.original.startDate)}</span>,
  },
  {
    accessorKey: "endDate",
    header: "End",
    meta: { label: "End", exportValue: (c) => c.endDate },
    cell: ({ row }) => <span className="text-muted-foreground whitespace-nowrap">{fmtDate(row.original.endDate)}</span>,
  },
  {
    id: "exclusive",
    accessorFn: (c) => (c.exclusive ? "Yes" : "No"),
    header: "Exclusive",
    meta: { label: "Exclusive", align: "center", exportValue: (c) => (c.exclusive ? "Yes" : "No") },
    enableGlobalFilter: false,
    cell: ({ row }) => row.original.exclusive
      ? <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"><Shield className="w-3 h-3 mr-1" />Yes</Badge>
      : <span className="text-muted-foreground">—</span>,
  },
  {
    id: "proof",
    accessorFn: (c) => (c.proofFileName ? "Yes" : "No"),
    header: "Proof",
    meta: { label: "Proof", align: "center", exportValue: (c) => (c.proofFileName ? "Yes" : "No") },
    enableGlobalFilter: false,
    cell: ({ row }) => row.original.proofFileName
      ? <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"><FileCheck className="w-3 h-3 mr-1" />Yes</Badge>
      : <span className="text-muted-foreground">—</span>,
  },
  {
    accessorKey: "status",
    header: "Status",
    meta: { label: "Status" },
    cell: ({ row }) => <StatusBadge status={row.original.status} size="compact" />,
    filterFn: (row, id, value: string[]) => value.includes(row.getValue(id)),
  },
  { id: "actions", header: "", enableSorting: false, enableHiding: false, cell: () => <ChevronRight className="w-4 h-4 text-muted-foreground" /> },
];

export default function ContractsPage() {
  const [filter, setFilter] = useState<FilterType>("all");
  const [search, setSearch] = useState("");
  const [dateRange, setDateRange] = useState<DateRange>(ALL_TIME);
  const [, setLocation] = useLocation();

  const { data: contracts = [], isLoading } = useQuery<Contract[]>({ queryKey: ["/api/contracts"] });
  const { data: deals = [] } = useQuery<Deal[]>({ queryKey: ["/api/deals"] });
  const getDeal = (dealId: number | null) => deals.find((d) => d.id === dealId);

  const filteredContracts = useMemo(() => {
    return contracts.filter((contract) => {
      if (!inRange(contract.startDate, dateRange)) return false;
      if (filter === "active" && contract.status !== "Active" && contract.status !== "Signed") return false;
      if (filter === "completed" && contract.status !== "Completed") return false;
      if (search.trim()) {
        const q = search.toLowerCase().trim();
        const deal = getDeal(contract.dealId);
        return (
          contract.contractName.toLowerCase().includes(q) ||
          contract.brandName.toLowerCase().includes(q) ||
          (deal?.dealTitle || "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [contracts, filter, search, deals, dateRange]);

  const filters: { value: FilterType; label: string }[] = [
    { value: "all", label: "All" },
    { value: "active", label: "Active" },
    { value: "completed", label: "Completed" },
  ];

  return (
    <div className="min-h-screen bg-background pb-20 lg:pb-12">
      <header className="glass-header sticky top-0 z-40 lg:border-b lg:border-neutral-200/60 dark:lg:border-neutral-800/60">
        <div className="px-4 py-4 space-y-3 lg:max-w-[1600px] lg:mx-auto lg:px-8 lg:py-6 lg:space-y-0">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-xl lg:text-2xl font-bold tracking-tight">Agreements</h1>
              <p className="hidden lg:block text-sm text-muted-foreground mt-0.5">
                {contracts.length} {contracts.length === 1 ? "agreement" : "agreements"} total
              </p>
            </div>
            <div className="flex items-center gap-2">
              {/* Agreements start from a deal — the CTA routes there */}
              <Link href="/deals" className="hidden lg:block">
                <Button className="gradient-btn text-white lg:h-10 lg:px-5 lg:text-sm font-semibold" data-testid="button-new-agreement">
                  <Plus className="w-4 h-4 mr-1.5" />
                  New Agreement
                </Button>
              </Link>
              <NotificationBell className="lg:hidden" />
            </div>
          </div>

          {/* Mobile-only search + chips */}
          <div className="flex flex-col gap-3 lg:hidden">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search by deal or brand..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 pr-8 h-9 bg-white/50 dark:bg-white/5 rounded-xl text-sm" />
              {search && <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2"><X className="w-3.5 h-3.5 text-muted-foreground" /></button>}
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
              {filters.map((f) => (
                <Button key={f.value} variant={filter === f.value ? "default" : "outline"} size="sm" onClick={() => setFilter(f.value)}
                  className={`flex-shrink-0 rounded-full ${filter === f.value ? "gradient-btn text-white" : ""}`} data-testid={`filter-${f.value}`}>
                  {f.label}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <main className="px-4 py-6 animate-fade-in lg:max-w-[1600px] lg:mx-auto lg:px-8 lg:py-8">
        <div className="flex justify-end mb-3">
          <DateRangeFilter value={dateRange} onChange={setDateRange} />
        </div>
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="glass-card border-0"><CardContent className="p-4 space-y-3"><Skeleton className="h-5 w-3/4" /><Skeleton className="h-4 w-1/2" /><div className="flex gap-2 pt-2"><Skeleton className="h-6 w-16 rounded-full" /><Skeleton className="h-6 w-20 rounded-full" /></div></CardContent></Card>
            ))}
          </div>
        ) : contracts.length === 0 ? (
          <Card className="glass-card border-0">
            <CardContent className="py-12 text-center">
              <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-muted mx-auto mb-4"><FileText className="w-8 h-8 text-muted-foreground" /></div>
              <h3 className="font-semibold mb-1">No agreements yet</h3>
              <p className="text-sm text-muted-foreground mb-4">Accept a deal to create your first agreement</p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* ── Desktop: data table ── */}
            <div className="hidden lg:block">
              <DataTable
                columns={columns}
                data={filteredContracts}
                searchPlaceholder="Search agreements..."
                searchKeys={["contractName", "brandName"]}
                facetedFilters={[{
                  columnId: "status",
                  title: "Status",
                  options: [
                    { label: "Signed", value: "Signed" },
                    { label: "Active", value: "Active" },
                    { label: "Completed", value: "Completed" },
                  ],
                }]}
                onRowClick={(c) => setLocation(`/contracts/${c.id}`)}
                exportFileName="agreements"
                emptyMessage="No agreements match your filters."
              />
            </div>

            {/* ── Mobile: cards ── */}
            <div className="lg:hidden">
              {filteredContracts.length > 0 ? (
                <div className="flex flex-col gap-4">
                  {filteredContracts.map((contract) => (
                    <Link key={contract.id} href={`/contracts/${contract.id}`}>
                      <Card className="glass-card border hover-elevate active-elevate-2 cursor-pointer rounded-xl shadow-sm" data-testid={`card-contract-${contract.id}`}>
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-3 mb-3">
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold truncate">{contract.contractName}</p>
                              <p className="text-sm text-muted-foreground truncate">{contract.brandName}</p>
                            </div>
                            <StatusBadge status={contract.status} />
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                            <Calendar className="w-3.5 h-3.5" />
                            <span>{fmtDate(contract.startDate)} - {fmtDate(contract.endDate)}</span>
                          </div>
                          <div className="flex items-center justify-between pt-3 border-t border-white/10">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {contract.exclusive && <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 no-default-hover-elevate no-default-active-elevate"><Shield className="w-3 h-3 mr-1" />Exclusive</Badge>}
                              {contract.proofFileName && <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 no-default-hover-elevate no-default-active-elevate"><FileCheck className="w-3 h-3 mr-1" />Proof</Badge>}
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="font-bold text-primary">₹{contract.contractValue.toLocaleString()}</span>
                              <ChevronRight className="w-4 h-4 text-muted-foreground" />
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
                    <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-muted mx-auto mb-4"><FileText className="w-8 h-8 text-muted-foreground" /></div>
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

      <BottomNav />
    </div>
  );
}
