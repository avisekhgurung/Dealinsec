import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { BottomNav } from "@/components/bottom-nav";
import { StatusBadge } from "@/components/status-badge";
import { Plus, Briefcase, ChevronRight, Calendar, Search, X } from "lucide-react";
import type { Deal } from "@shared/schema";

type FilterType = "all" | "pending" | "active" | "completed";

export default function DealsPage() {
  const [filter, setFilter] = useState<FilterType>("all");
  const [search, setSearch] = useState("");

  const { data: deals = [], isLoading } = useQuery<Deal[]>({
    queryKey: ["/api/deals"],
  });

  const filteredDeals = useMemo(() => {
    return deals.filter((deal) => {
      // Status filter
      if (filter === "pending" && deal.status !== "Pending") return false;
      if (filter === "active" && deal.status !== "Active") return false;
      if (filter === "completed" && deal.status !== "Completed") return false;

      // Search filter
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
  }, [deals, filter, search]);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const filters: { value: FilterType; label: string }[] = [
    { value: "all", label: "All" },
    { value: "pending", label: "Pending" },
    { value: "active", label: "Active" },
    { value: "completed", label: "Completed" },
  ];

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="glass-header sticky top-0 z-40">
        <div className="px-4 py-4 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-xl font-bold">Deals</h1>
            <Link href="/deals/new">
              <Button size="sm" className="gradient-btn text-white" data-testid="button-new-deal">
                <Plus className="w-4 h-4 mr-1" />
                New
              </Button>
            </Link>
          </div>

          {/* Search bar */}
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

          {/* Filters */}
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
        ) : filteredDeals.length > 0 ? (
          <div className="flex flex-col gap-4">
            {filteredDeals.map((deal) => (
              <Link key={deal.id} href={`/deals/${deal.id}`}>
                <Card
                  className="glass-card border hover-elevate active-elevate-2 cursor-pointer rounded-xl shadow-sm"
                  data-testid={`card-deal-${deal.id}`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate">{deal.brandName}</p>
                        <p className="text-sm text-muted-foreground truncate">{deal.dealTitle}</p>
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
              {search || filter !== "all" ? (
                <>
                  <h3 className="font-semibold mb-1">No matches found</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Try a different search or filter
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => { setSearch(""); setFilter("all"); }}
                  >
                    Clear Filters
                  </Button>
                </>
              ) : (
                <>
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
