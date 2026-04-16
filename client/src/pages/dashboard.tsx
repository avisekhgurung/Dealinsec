import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BottomNav } from "@/components/bottom-nav";
import { StatusBadge } from "@/components/status-badge";
import { Plus, Briefcase, FileCheck, Receipt, ChevronRight, LogOut } from "lucide-react";
import type { Deal, Contract, Invoice } from "@shared/schema";

export default function DashboardPage() {
  const { user } = useAuth();
  const displayName = user?.firstName && user?.lastName
    ? `${user.firstName} ${user.lastName}`
    : user?.email || "Influencer";

  const { data: deals = [], isLoading: dealsLoading } = useQuery<Deal[]>({
    queryKey: ["/api/deals"],
  });

  const { data: contracts = [], isLoading: contractsLoading } = useQuery<Contract[]>({
    queryKey: ["/api/contracts"],
  });

  const { data: invoices = [], isLoading: invoicesLoading } = useQuery<Invoice[]>({
    queryKey: ["/api/invoices"],
  });

  const activeDeals = deals.filter(d => d.status === "Pending" || d.status === "Active").length;
  const signedContracts = contracts.filter(c => c.status === "Signed" || c.status === "Active").length;
  const paidInvoices = invoices.filter(i => i.status === "Paid").length;

  const recentDeals = deals.slice(0, 3);

  const handleLogout = () => {
    window.location.href = "/api/logout";
  };

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="glass-header sticky top-0 z-40">
        <div className="flex items-center justify-between gap-4 px-4 py-4">
          <div>
            <p className="text-sm text-muted-foreground">Welcome back,</p>
            <h1 className="text-xl font-bold" data-testid="text-influencer-name">{displayName}</h1>
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
        <div className="grid gap-4 animate-fade-in">
          <div className="gradient-card-purple rounded-2xl p-5 shadow-lg">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-white/20">
                  <Briefcase className="w-6 h-6 text-white" />
                </div>
                <div>
                  <p className="text-sm font-medium text-white/80">Active Deals</p>
                  {dealsLoading ? (
                    <Skeleton className="h-8 w-12 mt-1 bg-white/20" />
                  ) : (
                    <p className="text-3xl font-bold text-white" data-testid="text-active-deals">{activeDeals}</p>
                  )}
                </div>
              </div>
              <Link href="/deals">
                <Button variant="ghost" size="icon" className="text-white hover:bg-white/20">
                  <ChevronRight className="w-5 h-5" />
                </Button>
              </Link>
            </div>
          </div>

          <div className="gradient-card-indigo rounded-2xl p-5 shadow-lg">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-white/20">
                  <FileCheck className="w-6 h-6 text-white" />
                </div>
                <div>
                  <p className="text-sm font-medium text-white/80">Signed Contracts</p>
                  {contractsLoading ? (
                    <Skeleton className="h-8 w-12 mt-1 bg-white/20" />
                  ) : (
                    <p className="text-3xl font-bold text-white" data-testid="text-signed-contracts">{signedContracts}</p>
                  )}
                </div>
              </div>
              <Link href="/contracts">
                <Button variant="ghost" size="icon" className="text-white hover:bg-white/20">
                  <ChevronRight className="w-5 h-5" />
                </Button>
              </Link>
            </div>
          </div>

          <div className="gradient-card-emerald rounded-2xl p-5 shadow-lg">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-white/20">
                  <Receipt className="w-6 h-6 text-white" />
                </div>
                <div>
                  <p className="text-sm font-medium text-white/80">Paid Invoices</p>
                  {invoicesLoading ? (
                    <Skeleton className="h-8 w-12 mt-1 bg-white/20" />
                  ) : (
                    <p className="text-3xl font-bold text-white" data-testid="text-paid-invoices">{paidInvoices}</p>
                  )}
                </div>
              </div>
              <Link href="/billing">
                <Button variant="ghost" size="icon" className="text-white hover:bg-white/20">
                  <ChevronRight className="w-5 h-5" />
                </Button>
              </Link>
            </div>
          </div>
        </div>

        {recentDeals.length > 0 && (
          <section className="space-y-3 animate-fade-in">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Recent Deals</h2>
              <Link href="/deals">
                <Button variant="ghost" size="sm" className="text-primary">
                  View All
                </Button>
              </Link>
            </div>
            <div className="space-y-3">
              {recentDeals.map((deal) => (
                <Link key={deal.id} href={`/deals/${deal.id}`}>
                  <Card className="glass-card border-0 hover-elevate active-elevate-2 cursor-pointer">
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
                      <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/10">
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
          <Card className="glass-card border-0 animate-fade-in">
            <CardContent className="py-12 text-center">
              <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-white/10 mx-auto mb-4">
                <Briefcase className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="font-semibold mb-1">No deals yet</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Create your first brand deal to get started
              </p>
              <Link href="/deals/new">
                <Button className="gradient-btn" data-testid="button-create-first-deal">
                  <Plus className="w-4 h-4 mr-2" />
                  Create Deal
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </main>

      <Link href="/deals/new">
        <button
          data-testid="fab-create-deal"
          className="gradient-btn fixed bottom-20 right-4 w-14 h-14 rounded-full shadow-lg flex items-center justify-center hover-elevate active-elevate-2 z-40"
        >
          <Plus className="w-6 h-6 text-white" />
        </button>
      </Link>

      <BottomNav />
    </div>
  );
}
