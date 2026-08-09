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
import { RowActions } from "@/components/row-actions";
import { recordNo } from "@shared/schema";
import { DateRangeFilter, ALL_TIME, inRange, type DateRange } from "@/components/date-range-filter";
import { PickParentDialog } from "@/components/pick-parent-dialog";
import { memberCan } from "@shared/permissions";
import { useAuth } from "@/hooks/useAuth";
import { NotificationBell } from "@/components/notification-bell";
import { StatusBadge } from "@/components/status-badge";
import { DataTable } from "@/components/data-table/data-table";
import { Receipt, Calendar, ChevronRight, Briefcase, Search, X, Plus } from "lucide-react";
import type { Deal, BrandInvoice } from "@shared/schema";

type FilterType = "all" | "paid" | "unpaid";

const fmtDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

const typeLabel = (t: string) => (t === "advance" ? "Advance" : t === "final" ? "Final" : "Full");

const columns: ColumnDef<BrandInvoice>[] = [
  {
    accessorKey: "invoiceNumber",
    header: "Invoice #",
    meta: { label: "Invoice #" },
    cell: ({ row }) => <span className="font-medium text-foreground">{row.original.invoiceNumber}</span>,
  },
  {
    accessorKey: "brandName",
    header: "Client",
    meta: { label: "Client" },
    cell: ({ row }) => <span className="text-muted-foreground">{row.original.brandName}</span>,
  },
  {
    id: "type",
    accessorFn: (i) => i.invoiceType,
    header: "Type",
    meta: { label: "Type", exportValue: (i) => typeLabel(i.invoiceType) + (i.splitPercentage ? ` (${i.splitPercentage}%)` : "") },
    cell: ({ row }) => {
      const i = row.original;
      const adv = i.invoiceType === "advance";
      const fin = i.invoiceType === "final";
      return (
        <Badge variant="secondary" className={
          adv ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
          : fin ? "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400"
          : "bg-muted text-muted-foreground"
        }>
          {typeLabel(i.invoiceType)}{i.splitPercentage ? ` ${i.splitPercentage}%` : ""}
        </Badge>
      );
    },
  },
  {
    id: "amount",
    accessorFn: (i) => Number(i.dealAmount),
    header: "Amount",
    meta: { label: "Amount", align: "right", exportValue: (i) => Number(i.dealAmount) },
    cell: ({ row }) => <span className="font-semibold text-primary tabular-nums">₹{Number(row.original.dealAmount).toLocaleString("en-IN")}</span>,
  },
  {
    accessorKey: "invoiceDate",
    header: "Date",
    meta: { label: "Date", exportValue: (i) => i.invoiceDate },
    cell: ({ row }) => <span className="text-muted-foreground whitespace-nowrap">{fmtDate(row.original.invoiceDate)}</span>,
  },
  {
    id: "dueDate",
    accessorFn: (i) => i.dueDate ?? "",
    header: "Due",
    meta: { label: "Due", exportValue: (i) => i.dueDate ?? "" },
    enableGlobalFilter: false,
    cell: ({ row }) => <span className="text-muted-foreground whitespace-nowrap">{fmtDate(row.original.dueDate)}</span>,
  },
  {
    accessorKey: "status",
    header: "Status",
    meta: { label: "Status" },
    cell: ({ row }) => <StatusBadge status={row.original.status} size="compact" />,
    filterFn: (row, id, value: string[]) => value.includes(row.getValue(id)),
  },
  { id: "actions", header: "Actions", meta: { label: "Actions", align: "right" }, enableSorting: false, enableHiding: false,
    cell: ({ row }: any) => <RowActions viewHref={`/brand-invoices/${row.original.id}`} /> },
];

export default function BillingPage() {
  const [filter, setFilter] = useState<FilterType>("all");
  const [search, setSearch] = useState("");
  const [dateRange, setDateRange] = useState<DateRange>(ALL_TIME);
  const [pickOpen, setPickOpen] = useState(false);
  const { user } = useAuth();
  const canCreate = memberCan(user as any, "invoices.create");
  const [, setLocation] = useLocation();

  const { data: brandInvoices = [], isLoading } = useQuery<BrandInvoice[]>({ queryKey: ["/api/brand-invoices"] });
  const { data: deals = [] } = useQuery<Deal[]>({ queryKey: ["/api/deals"] });
  const getDeal = (dealId: number) => deals.find((d) => d.id === dealId);

  const filteredInvoices = useMemo(() => {
    return brandInvoices.filter((invoice) => {
      if (!inRange(invoice.invoiceDate, dateRange)) return false;
      if (filter === "paid" && invoice.status !== "Paid") return false;
      if (filter === "unpaid" && invoice.status !== "Unpaid") return false;
      if (search.trim()) {
        const q = search.toLowerCase().trim();
        const deal = getDeal(invoice.dealId);
        return (
          invoice.brandName.toLowerCase().includes(q) ||
          (deal?.dealTitle || "").toLowerCase().includes(q) ||
          invoice.invoiceNumber.toLowerCase().includes(q) ||
          invoice.dealAmount.toString().includes(q)
        );
      }
      return true;
    });
  }, [brandInvoices, filter, search, deals, dateRange]);

  const groupedByDeal = useMemo(() => {
    const groups = new Map<number, BrandInvoice[]>();
    for (const inv of filteredInvoices) {
      const existing = groups.get(inv.dealId) || [];
      existing.push(inv);
      groups.set(inv.dealId, existing);
    }
    return Array.from(groups.entries());
  }, [filteredInvoices]);

  const totalPaid = brandInvoices.filter((i) => i.status === "Paid").reduce((s, i) => s + Number(i.dealAmount), 0);
  const totalUnpaid = brandInvoices.filter((i) => i.status === "Unpaid").reduce((s, i) => s + Number(i.dealAmount), 0);

  const filters: { value: FilterType; label: string }[] = [
    { value: "all", label: "All" },
    { value: "paid", label: "Paid" },
    { value: "unpaid", label: "Unpaid" },
  ];

  return (
    <div className="min-h-screen bg-background pb-20 lg:pb-12">
      <header className="glass-header sticky top-0 z-40 lg:border-b lg:border-neutral-200/60 dark:lg:border-neutral-800/60">
        <div className="px-4 py-4 space-y-3 lg:max-w-[1600px] lg:mx-auto lg:px-8 lg:py-6 lg:space-y-0">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-xl lg:text-2xl font-bold tracking-tight">Invoices</h1>
              <p className="hidden lg:block text-sm text-muted-foreground mt-0.5">
                {brandInvoices.length} {brandInvoices.length === 1 ? "invoice" : "invoices"} total
              </p>
            </div>
            <div className="flex items-center gap-2">
              {/* Invoices are generated from a signed agreement — route there */}
              {canCreate && (
                <Button className="hidden lg:inline-flex gradient-btn text-white lg:h-10 lg:px-5 lg:text-sm font-semibold" onClick={() => setPickOpen(true)} data-testid="button-new-invoice">
                  <Plus className="w-4 h-4 mr-1.5" />
                  New Invoice
                </Button>
              )}
              <NotificationBell className="lg:hidden" />
            </div>
          </div>

          {/* Mobile-only search + chips */}
          <div className="flex flex-col gap-3 lg:hidden">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search by deal, brand, or invoice..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 pr-8 h-9 bg-white/50 dark:bg-white/5 rounded-xl text-sm" />
              {search && <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2"><X className="w-3.5 h-3.5 text-muted-foreground" /></button>}
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
              {filters.map((f) => (
                <Button key={f.value} variant={filter === f.value ? "default" : "outline"} size="sm" onClick={() => setFilter(f.value)}
                  className={`flex-shrink-0 rounded-full ${filter === f.value ? "gradient-btn text-white" : "glass-card border-white/20"}`} data-testid={`filter-${f.value}`}>
                  {f.label}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <main className="px-4 py-6 space-y-6 animate-fade-in lg:max-w-[1600px] lg:mx-auto lg:px-8 lg:py-8">
        <div className="flex justify-end lg:hidden">
          <DateRangeFilter value={dateRange} onChange={setDateRange} />
        </div>
        {/* Paid/unpaid analytics live on the Dashboard — this page is the register. */}

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="glass-card border-0"><CardContent className="p-4 space-y-3"><div className="flex items-start justify-between gap-3"><div className="space-y-2"><Skeleton className="h-5 w-32" /><Skeleton className="h-4 w-24" /></div><Skeleton className="h-6 w-16 rounded-full" /></div><Skeleton className="h-8 w-28" /></CardContent></Card>
            ))}
          </div>
        ) : brandInvoices.length === 0 ? (
          <Card className="glass-card border-0">
            <CardContent className="py-12 text-center">
              <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-white/10 mx-auto mb-4"><Receipt className="w-8 h-8 text-muted-foreground" /></div>
              <h3 className="font-semibold mb-1">No invoices yet</h3>
              <p className="text-sm text-muted-foreground mb-4">Invoices will appear here after signing agreements</p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* ── Desktop: data table (flat) ── */}
            <div className="hidden lg:block">
              <DataTable
                columns={columns}
                data={filteredInvoices}
                toolbarExtra={<DateRangeFilter value={dateRange} onChange={setDateRange} />}
                searchPlaceholder="Search invoices..."
                searchKeys={["invoiceNumber", "brandName"]}
                facetedFilters={[{
                  columnId: "status",
                  title: "Status",
                  options: [
                    { label: "Paid", value: "Paid" },
                    { label: "Unpaid", value: "Unpaid" },
                  ],
                }]}
                onRowClick={(inv) => setLocation(`/brand-invoices/${inv.id}`)}
                exportFileName="invoices"
                emptyMessage="No invoices match your filters."
              />
            </div>

            {/* ── Mobile: grouped cards ── */}
            <div className="lg:hidden">
              {groupedByDeal.length > 0 ? (
                <div className="flex flex-col gap-6">
                  {groupedByDeal.map(([dealId, invoices]) => {
                    const deal = getDeal(dealId);
                    const totalDealAmount = invoices.reduce((s, inv) => s + Number(inv.dealAmount), 0);
                    return (
                      <Card key={dealId} className="glass-card border-0 rounded-2xl overflow-hidden">
                        <div className="bg-muted/40 px-4 py-3 border-b border-white/10">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 flex-shrink-0"><Briefcase className="w-4 h-4 text-primary" /></div>
                              <div className="min-w-0">
                                <p className="text-sm font-semibold truncate">{deal?.dealTitle || invoices[0]?.brandName || "Deal"}</p>
                                <p className="text-[11px] text-muted-foreground truncate">{deal?.brandName || invoices[0]?.brandName}</p>
                              </div>
                            </div>
                            <p className="text-sm font-bold text-primary flex-shrink-0 ml-3">₹{totalDealAmount.toLocaleString("en-IN")}</p>
                          </div>
                        </div>
                        <CardContent className="p-0">
                          {invoices.map((invoice, idx) => {
                            const isAdvance = invoice.invoiceType === "advance";
                            const isFinal = invoice.invoiceType === "final";
                            const isSplit = isAdvance || isFinal;
                            const isLast = idx === invoices.length - 1;
                            return (
                              <Link key={invoice.id} href={`/brand-invoices/${invoice.id}`}>
                                <div className={`flex items-center gap-3 px-4 py-3.5 hover:bg-muted/30 active:bg-muted/50 transition-colors cursor-pointer ${!isLast ? "border-b border-white/5" : ""}`} data-testid={`card-invoice-${invoice.id}`}>
                                  <div className={`flex items-center justify-center w-9 h-9 rounded-lg flex-shrink-0 ${isAdvance ? "bg-blue-100 dark:bg-blue-900/30" : isFinal ? "bg-teal-100 dark:bg-teal-900/30" : "bg-gray-100 dark:bg-gray-800/30"}`}>
                                    <Receipt className={`w-4 h-4 ${isAdvance ? "text-blue-600 dark:text-blue-400" : isFinal ? "text-teal-600 dark:text-teal-400" : "text-muted-foreground"}`} />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <p className="text-sm font-medium truncate">{isSplit ? (isAdvance ? "Advance" : "Final") : "Full Invoice"}</p>
                                      {isSplit && invoice.splitPercentage && (
                                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${isAdvance ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" : "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400"}`}>{invoice.splitPercentage}%</span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2 mt-0.5">
                                      <span className="text-[11px] text-muted-foreground">{invoice.invoiceNumber}</span>
                                      <span className="text-[11px] text-muted-foreground">· {fmtDate(invoice.invoiceDate)}</span>
                                    </div>
                                  </div>
                                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                                    <span className="text-sm font-bold text-primary">₹{Number(invoice.dealAmount).toLocaleString("en-IN")}</span>
                                    <StatusBadge status={invoice.status} />
                                  </div>
                                  <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                                </div>
                              </Link>
                            );
                          })}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              ) : (
                <Card className="glass-card border-0">
                  <CardContent className="py-12 text-center">
                    <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-white/10 mx-auto mb-4"><Receipt className="w-8 h-8 text-muted-foreground" /></div>
                    <h3 className="font-semibold mb-1">No matches found</h3>
                    <p className="text-sm text-muted-foreground mb-4">Try a different search or filter</p>
                    <Button variant="outline" onClick={() => { setSearch(""); setFilter("all"); }} className="glass-card">Clear Filters</Button>
                  </CardContent>
                </Card>
              )}
            </div>
          </>
        )}
      </main>

      <PickParentDialog kind="invoice" open={pickOpen} onOpenChange={setPickOpen} />
      <BottomNav />
    </div>
  );
}
