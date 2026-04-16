import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BottomNav } from "@/components/bottom-nav";
import { StatusBadge } from "@/components/status-badge";
import { Receipt, Calendar, ChevronRight } from "lucide-react";
import type { Invoice } from "@shared/schema";

type FilterType = "all" | "paid" | "unpaid";

export default function BillingPage() {
  const [filter, setFilter] = useState<FilterType>("all");

  const { data: invoices = [], isLoading } = useQuery<Invoice[]>({
    queryKey: ["/api/invoices"],
  });

  const filteredInvoices = invoices.filter((invoice) => {
    if (filter === "all") return true;
    if (filter === "paid") return invoice.status === "Paid";
    if (filter === "unpaid") return invoice.status === "Unpaid";
    return true;
  });

  const totalPaid = invoices
    .filter(i => i.status === "Paid")
    .reduce((sum, i) => sum + i.totalAmount, 0);

  const totalUnpaid = invoices
    .filter(i => i.status === "Unpaid")
    .reduce((sum, i) => sum + i.totalAmount, 0);

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
        <div className="px-4 py-4">
          <h1 className="text-xl font-bold mb-4">Billing</h1>
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
        {!isLoading && invoices.length > 0 && (
          <div className="grid grid-cols-2 gap-4">
            <div className="gradient-card-emerald rounded-2xl p-4 shadow-lg">
              <p className="text-xs font-medium text-white/80 mb-1">
                Total Paid
              </p>
              <p className="text-2xl font-bold text-white" data-testid="text-total-paid">
                ₹{totalPaid.toLocaleString()}
              </p>
            </div>
            <div className="gradient-card-rose rounded-2xl p-4 shadow-lg">
              <p className="text-xs font-medium text-white/80 mb-1">
                Total Unpaid
              </p>
              <p className="text-2xl font-bold text-white" data-testid="text-total-unpaid">
                ₹{totalUnpaid.toLocaleString()}
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
        ) : filteredInvoices.length > 0 ? (
          <div className="space-y-4">
            {filteredInvoices.map((invoice) => (
              <Link key={invoice.id} href={`/billing/invoice/${invoice.id}`}>
                <Card
                  className="glass-card border-0 shadow-sm hover-elevate active-elevate-2 cursor-pointer"
                  data-testid={`card-invoice-${invoice.id}`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div>
                        <p className="font-semibold font-mono text-sm">
                          {invoice.invoiceNumber}
                        </p>
                        <p className="text-sm text-muted-foreground truncate">
                          {invoice.brandName}
                        </p>
                      </div>
                      <StatusBadge status={invoice.status} />
                    </div>

                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                      <Calendar className="w-3.5 h-3.5" />
                      <span>{formatDate(invoice.invoiceDate)}</span>
                    </div>

                    <div className="flex items-center justify-between pt-3 border-t border-white/10">
                      <span className="text-2xl font-bold">
                        ₹{invoice.totalAmount.toLocaleString()}
                      </span>
                      <ChevronRight className="w-5 h-5 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <Card className="glass-card border-0">
            <CardContent className="py-12 text-center">
              <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-white/10 mx-auto mb-4">
                <Receipt className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="font-semibold mb-1">No invoices yet</h3>
              <p className="text-sm text-muted-foreground mb-4">
                {filter === "all"
                  ? "Invoices will appear here after signing contracts"
                  : `No ${filter} invoices found`}
              </p>
              {filter !== "all" && (
                <Button
                  variant="outline"
                  onClick={() => setFilter("all")}
                  className="glass-card"
                  data-testid="button-view-all-invoices"
                >
                  View All Invoices
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
