import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { BrandBottomNav } from "@/components/brand-bottom-nav";
import { Briefcase, FileCheck, ChevronRight, LogOut, Building2 } from "lucide-react";
import type { Deal, Contract } from "@shared/schema";

export default function BrandDashboardPage() {
  const { user } = useAuth();
  const displayName = user?.firstName && user?.lastName 
    ? `${user.firstName} ${user.lastName}` 
    : user?.email || "Brand";

  const { data: deals = [], isLoading: dealsLoading } = useQuery<Deal[]>({
    queryKey: ["/api/brand/deals"],
  });

  const { data: contracts = [], isLoading: contractsLoading } = useQuery<Contract[]>({
    queryKey: ["/api/brand/contracts"],
  });

  const activeDeals = deals.filter(d => d.status === "Pending" || d.status === "Active").length;
  const signedContracts = contracts.filter(c => c.status === "Signed" || c.status === "Active").length;

  const recentDeals = deals.slice(0, 3);

  const handleLogout = () => {
    window.location.href = "/api/logout";
  };

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border">
        <div className="flex items-center justify-between gap-4 px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10">
              <Building2 className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Brand Portal</p>
              <h1 className="text-xl font-bold" data-testid="text-brand-name">{displayName}</h1>
            </div>
          </div>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={handleLogout}
            data-testid="button-logout"
          >
            <LogOut className="w-5 h-5" />
          </Button>
        </div>
      </header>

      <main className="px-4 py-6 space-y-6">
        <div className="grid gap-4">
          <Card className="border-0 shadow-md">
            <CardContent className="p-5">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10">
                    <Briefcase className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Active Deals</p>
                    {dealsLoading ? (
                      <Skeleton className="h-8 w-12 mt-1" />
                    ) : (
                      <p className="text-3xl font-bold" data-testid="text-active-deals">{activeDeals}</p>
                    )}
                  </div>
                </div>
                <Link href="/brand/deals">
                  <Button variant="ghost" size="icon">
                    <ChevronRight className="w-5 h-5" />
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-md">
            <CardContent className="p-5">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-violet-100 dark:bg-violet-900/30">
                    <FileCheck className="w-6 h-6 text-violet-600 dark:text-violet-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Active Contracts</p>
                    {contractsLoading ? (
                      <Skeleton className="h-8 w-12 mt-1" />
                    ) : (
                      <p className="text-3xl font-bold" data-testid="text-signed-contracts">{signedContracts}</p>
                    )}
                  </div>
                </div>
                <Link href="/brand/contracts">
                  <Button variant="ghost" size="icon">
                    <ChevronRight className="w-5 h-5" />
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>

        {recentDeals.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Recent Deals</h2>
              <Link href="/brand/deals">
                <Button variant="ghost" size="sm" className="text-primary">
                  View All
                </Button>
              </Link>
            </div>
            <div className="space-y-3">
              {recentDeals.map((deal) => (
                <Link key={deal.id} href={`/brand/deals/${deal.id}`}>
                  <Card className="border-0 shadow-sm hover-elevate active-elevate-2 cursor-pointer">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold truncate" data-testid={`text-deal-title-${deal.id}`}>
                            {deal.dealTitle}
                          </p>
                          <p className="text-sm text-muted-foreground truncate">{deal.brandName}</p>
                        </div>
                        <StatusBadge status={deal.status} />
                      </div>
                      <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
                        <span className="text-lg font-bold text-primary">
                          {"\u20B9"}{deal.dealAmount.toLocaleString()}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {deal.deliverables.length} deliverable{deal.deliverables.length !== 1 ? "s" : ""}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        )}

        {deals.length === 0 && !dealsLoading && (
          <Card className="border-0 shadow-sm">
            <CardContent className="py-12 text-center">
              <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-muted mx-auto mb-4">
                <Briefcase className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="font-semibold mb-1">No deals shared with you</h3>
              <p className="text-sm text-muted-foreground">
                When influencers assign you to their deals, they will appear here
              </p>
            </CardContent>
          </Card>
        )}
      </main>

      <BrandBottomNav />
    </div>
  );
}
