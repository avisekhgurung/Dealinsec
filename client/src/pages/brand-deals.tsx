import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { BrandBottomNav } from "@/components/brand-bottom-nav";
import { ArrowLeft, Briefcase } from "lucide-react";
import type { Deal } from "@shared/schema";

export default function BrandDealsPage() {
  const { data: deals = [], isLoading } = useQuery<Deal[]>({
    queryKey: ["/api/brand/deals"],
  });

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border">
        <div className="flex items-center gap-4 px-4 py-4">
          <Link href="/">
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <h1 className="text-xl font-bold">Your Deals</h1>
        </div>
      </header>

      <main className="px-4 py-6 space-y-4">
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="border-0 shadow-sm">
                <CardContent className="p-4">
                  <Skeleton className="h-5 w-3/4 mb-2" />
                  <Skeleton className="h-4 w-1/2 mb-4" />
                  <Skeleton className="h-6 w-24" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : deals.length > 0 ? (
          <div className="space-y-3">
            {deals.map((deal) => (
              <Link key={deal.id} href={`/brand/deals/${deal.id}`}>
                <Card className="border-0 shadow-sm hover-elevate active-elevate-2 cursor-pointer" data-testid={`card-deal-${deal.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate">{deal.dealTitle}</p>
                        <p className="text-sm text-muted-foreground truncate">{deal.brandName}</p>
                      </div>
                      <StatusBadge status={deal.status} />
                    </div>
                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
                      <span className="text-lg font-bold text-primary">
                        {"\u20B9"}{deal.dealAmount.toLocaleString()}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {deal.startDate} - {deal.endDate}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <Card className="border-0 shadow-sm">
            <CardContent className="py-12 text-center">
              <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-muted mx-auto mb-4">
                <Briefcase className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="font-semibold mb-1">No deals yet</h3>
              <p className="text-sm text-muted-foreground">
                Deals assigned to you by influencers will appear here
              </p>
            </CardContent>
          </Card>
        )}
      </main>

      <BrandBottomNav />
    </div>
  );
}
