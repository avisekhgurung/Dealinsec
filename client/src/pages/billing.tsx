import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BottomNav } from "@/components/bottom-nav";
import { StatusBadge } from "@/components/status-badge";
import { Receipt, Calendar, ChevronRight, Briefcase, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { Deal, BrandInvoice } from "@shared/schema";

type FilterType = "all" | "paid" | "unpaid";

export default function BillingPage() {
  const [filter, setFilter] = useState<FilterType>("all");
  const [search, setSearch] = useState("");

  const { data: brandInvoices = [], isLoading } = useQuery<BrandInvoice[]>({
    queryKey: ["/api/brand-invoices"],
  });

  const { data: deals = [] } = useQuery<Deal[]>({
    queryKey: ["/api/deals"],
  });

  const getDeal = (dealId: number) => deals.find(d => d.id === dealId);

  const filteredInvoices = useMemo(() => {
    return brandInvoices.filter((invoice) => {
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
  }, [brandInvoices, filter, search, deals]);

  // Group filtered invoices by deal
  const groupedByDeal = useMemo(() => {
    const groups = new Map<number, BrandInvoice[]>();
    for (const inv of filteredInvoices) {
      const existing = groups.get(inv.dealId) || [];
      existing.push(inv);
      groups.set(inv.dealId, existing);
    }
    return Array.from(groups.entries());
  }, [filteredInvoices]);

  const totalPaid = brandInvoices
    .filter(i => i.status === "Paid")
    .reduce((sum, i) => sum + Number(i.dealAmount), 0);

  const totalUnpaid = brandInvoices
    .filter(i => i.status === "Unpaid")
    .reduce((sum, i) => sum + Number(i.dealAmount), 0);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const filters: { value: FilterType; label: string }[] = [
    { value: "all", label: "All" },
    { value: "paid", label: "Paid" },
    { value: "unpaid", label: "Unpaid" },
  ];

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="glass-header sticky top-0 z-40">
        <div className="px-4 py-4 space-y-3">
          <h1 className="text-xl font-bold">Invoices</h1>

          {/* Search bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by deal, brand, or invoice..."
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
                className={`flex-shrink-0 rounded-full ${
                  filter === f.value
                    ? "gradient-btn text-white"
                    : "glass-card border-white/20"
                }`}
                data-testid={`filter-${f.value}`}
              >
                {f.label}
              </Button>
            ))}
          </div>
        </div>
      </header>

      <main className="px-4 py-6 space-y-6 animate-fade-in">
        {!isLoading && brandInvoices.length > 0 && (
          <div className="grid grid-cols-2 gap-4">
            <div className="gradient-card-emerald rounded-2xl p-3 sm:p-4 shadow-lg overflow-hidden">
              <p className="text-[10px] sm:text-xs font-medium text-white/80 mb-1">
                Total Paid
              </p>
              <p className="text-lg sm:text-xl font-bold text-white truncate leading-tight" data-testid="text-total-paid">
                ₹{totalPaid.toLocaleString("en-IN")}
              </p>
            </div>
            <div className="gradient-card-rose rounded-2xl p-3 sm:p-4 shadow-lg overflow-hidden">
              <p className="text-[10px] sm:text-xs font-medium text-white/80 mb-1">
                Total Unpaid
              </p>
              <p className="text-lg sm:text-xl font-bold text-white truncate leading-tight" data-testid="text-total-unpaid">
                ₹{totalUnpaid.toLocaleString("en-IN")}
              </p>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="glass-card border-0">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-2">
                      <Skeleton className="h-5 w-32" />
                      <Skeleton className="h-4 w-24" />
                    </div>
                    <Skeleton className="h-6 w-16 rounded-full" />
                  </div>
                  <Skeleton className="h-8 w-28" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : groupedByDeal.length > 0 ? (
          <div className="flex flex-col gap-6">
            {groupedByDeal.map(([dealId, invoices]) => {
              const deal = getDeal(dealId);
              const totalDealAmount = invoices.reduce((s, inv) => s + Number(inv.dealAmount), 0);

              return (
                <Card key={dealId} className="glass-card border-0 rounded-2xl overflow-hidden">
                  {/* Deal group header */}
                  <div className="bg-muted/40 px-4 py-3 border-b border-white/10">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 flex-shrink-0">
                          <Briefcase className="w-4 h-4 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold truncate">
                            {deal?.dealTitle || invoices[0]?.brandName || "Deal"}
                          </p>
                          <p className="text-[11px] text-muted-foreground truncate">
                            {deal?.brandName || invoices[0]?.brandName}
                          </p>
                        </div>
                      </div>
                      <p className="text-sm font-bold text-primary flex-shrink-0 ml-3">
                        ₹{totalDealAmount.toLocaleString("en-IN")}
                      </p>
                    </div>
                  </div>

                  {/* Invoice rows inside the card */}
                  <CardContent className="p-0">
                    {invoices.map((invoice, idx) => {
                      const isAdvance = invoice.invoiceType === "advance";
                      const isFinal = invoice.invoiceType === "final";
                      const isSplit = isAdvance || isFinal;
                      const isLast = idx === invoices.length - 1;

                      return (
                        <Link key={invoice.id} href={`/brand-invoices/${invoice.id}`}>
                          <div
                            className={`flex items-center gap-3 px-4 py-3.5 hover:bg-muted/30 active:bg-muted/50 transition-colors cursor-pointer ${
                              !isLast ? "border-b border-white/5" : ""
                            }`}
                            data-testid={`card-invoice-${invoice.id}`}
                          >
                            {/* Icon */}
                            <div className={`flex items-center justify-center w-9 h-9 rounded-lg flex-shrink-0 ${
                              isAdvance
                                ? "bg-blue-100 dark:bg-blue-900/30"
                                : isFinal
                                ? "bg-teal-100 dark:bg-teal-900/30"
                                : "bg-gray-100 dark:bg-gray-800/30"
                            }`}>
                              <Receipt className={`w-4 h-4 ${
                                isAdvance
                                  ? "text-blue-600 dark:text-blue-400"
                                  : isFinal
                                  ? "text-teal-600 dark:text-teal-400"
                                  : "text-muted-foreground"
                              }`} />
                            </div>

                            {/* Info */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-medium truncate">
                                  {isSplit ? (isAdvance ? "Advance" : "Final") : "Full Invoice"}
                                </p>
                                {isSplit && invoice.splitPercentage && (
                                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                                    isAdvance
                                      ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                                      : "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400"
                                  }`}>
                                    {invoice.splitPercentage}%
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-[11px] text-muted-foreground">{invoice.invoiceNumber}</span>
                                <span className="text-[11px] text-muted-foreground">· {formatDate(invoice.invoiceDate)}</span>
                              </div>
                            </div>

                            {/* Amount + Status */}
                            <div className="flex flex-col items-end gap-1 flex-shrink-0">
                              <span className="text-sm font-bold text-primary">
                                ₹{Number(invoice.dealAmount).toLocaleString("en-IN")}
                              </span>
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
              <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-white/10 mx-auto mb-4">
                <Receipt className="w-8 h-8 text-muted-foreground" />
              </div>
              {search || filter !== "all" ? (
                <>
                  <h3 className="font-semibold mb-1">No matches found</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Try a different search or filter
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => { setSearch(""); setFilter("all"); }}
                    className="glass-card"
                  >
                    Clear Filters
                  </Button>
                </>
              ) : (
                <>
                  <h3 className="font-semibold mb-1">No invoices yet</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Invoices will appear here after signing agreements
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
