import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BrandBottomNav } from "@/components/brand-bottom-nav";
import { StatusBadge } from "@/components/status-badge";
import { ArrowLeft, Receipt, Calendar, ChevronRight } from "lucide-react";
import type { Invoice } from "@shared/schema";

export default function BrandBillingPage() {
  const { data: invoices = [], isLoading } = useQuery<Invoice[]>({
    queryKey: ["/api/brand/received-invoices"],
  });

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="sticky top-0 z-40 glass-header border-b border-border">
        <div className="px-4 py-4 flex items-center gap-3">
          <Link href="/">
            <button className="p-1 -ml-1 rounded-lg hover:bg-muted transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </button>
          </Link>
          <h1 className="text-xl font-bold">Billing</h1>
        </div>
      </header>

      <main className="px-4 py-6 space-y-4">
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
        ) : invoices.length > 0 ? (
          <div className="space-y-4">
            {invoices.map((invoice) => (
              <Link key={invoice.id} href={`/brand-invoices/${invoice.id}`}>
                <Card
                  className="glass-card border-0 hover-elevate active-elevate-2 cursor-pointer"
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
                        <p className="text-sm text-muted-foreground truncate">
                          {invoice.influencerName}
                        </p>
                      </div>
                      <StatusBadge status={invoice.status} />
                    </div>

                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                      <Calendar className="w-3.5 h-3.5" />
                      <span>{formatDate(invoice.invoiceDate)}</span>
                    </div>

                    <div className="flex items-center justify-between pt-3 border-t border-border">
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
              <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-muted mx-auto mb-4">
                <Receipt className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="font-semibold mb-1">No invoices yet</h3>
              <p className="text-sm text-muted-foreground">
                Invoices from influencers will appear here
              </p>
            </CardContent>
          </Card>
        )}
      </main>

      <BrandBottomNav />
    </div>
  );
}
