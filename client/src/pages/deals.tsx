import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BottomNav } from "@/components/bottom-nav";
import { StatusBadge } from "@/components/status-badge";
import { Plus, Briefcase, ChevronRight, Calendar } from "lucide-react";
import type { Deal } from "@shared/schema";

export default function DealsPage() {
  const { data: deals = [], isLoading } = useQuery<Deal[]>({
    queryKey: ["/api/deals"],
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
      <header className="glass-header sticky top-0 z-40">
        <div className="flex items-center justify-between gap-4 px-4 py-4">
          <h1 className="text-xl font-bold">Brand Deals</h1>
          <Link href="/deals/new">
            <Button size="sm" className="gradient-btn text-white" data-testid="button-new-deal">
              <Plus className="w-4 h-4 mr-1" />
              New
            </Button>
          </Link>
        </div>
      </header>

      <main className="px-4 py-6 animate-fade-in">
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="glass-card border-0">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-5 w-3/4" />
                      <Skeleton className="h-4 w-1/2" />
                    </div>
                    <Skeleton className="h-6 w-16 rounded-full" />
                  </div>
                  <div className="flex items-center justify-between pt-3 border-t">
                    <Skeleton className="h-6 w-24" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : deals.length > 0 ? (
          <div className="space-y-4">
            {deals.map((deal) => (
              <Link key={deal.id} href={`/deals/${deal.id}`}>
                <Card
                  className="glass-card border-0 hover-elevate active-elevate-2 cursor-pointer"
                  data-testid={`card-deal-${deal.id}`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate">{deal.dealTitle}</p>
                        <p className="text-sm text-muted-foreground truncate">{deal.brandName}</p>
                      </div>
                      <StatusBadge status={deal.status} size="compact" />
                    </div>

                    <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
                      <Calendar className="w-3.5 h-3.5" />
                      <span>{formatDate(deal.startDate)} - {formatDate(deal.endDate)}</span>
                    </div>

                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/10">
                      <span className="text-lg font-bold text-primary">
                        ₹{deal.dealAmount.toLocaleString()}
                      </span>
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <span className="text-xs">
                          {deal.deliverables.length} deliverable{deal.deliverables.length !== 1 ? "s" : ""}
                        </span>
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
              <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-muted mx-auto mb-4">
                <Briefcase className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="font-semibold mb-1">No deals yet</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Create your first brand deal to get started
              </p>
              <Link href="/deals/new">
                <Button className="gradient-btn text-white" data-testid="button-create-deal-empty">
                  <Plus className="w-4 h-4 mr-2" />
                  Create Deal
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
