import { useQuery } from "@tanstack/react-query";
import { useLocation, useParams, Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { PlatformIcon } from "@/components/platform-icon";
import { BottomNav } from "@/components/bottom-nav";
import { BrandBottomNav } from "@/components/brand-bottom-nav";
import { useAuth } from "@/hooks/useAuth";
import { ArrowLeft, Calendar, IndianRupee, FileCheck, CheckCircle } from "lucide-react";
import type { Deal, Contract } from "@shared/schema";

export default function DealDetailsPage() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const isBrand = user?.role === "brand";

  const { data: deal, isLoading } = useQuery<Deal>({
    queryKey: ["/api/deals", params.id],
  });

  const { data: contracts = [] } = useQuery<Contract[]>({
    queryKey: isBrand ? ["/api/brand/contracts"] : ["/api/contracts"],
  });

  const dealId = parseInt(params.id || "0");
  const hasContract = contracts.some(c => c.dealId === dealId);
  
  const backPath = isBrand ? "/brand/deals" : "/deals";
  const Nav = isBrand ? BrandBottomNav : BottomNav;

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background pb-20">
        <header className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border">
          <div className="flex items-center gap-3 px-4 py-4">
            <Button variant="ghost" size="icon" onClick={() => setLocation(backPath)}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <Skeleton className="h-6 w-32" />
          </div>
        </header>
        <main className="px-4 py-6 space-y-4">
          <Card className="border-0 shadow-md">
            <CardContent className="p-6 space-y-4">
              <Skeleton className="h-8 w-3/4" />
              <Skeleton className="h-5 w-1/2" />
              <div className="flex gap-4 pt-4">
                <Skeleton className="h-10 w-24" />
                <Skeleton className="h-10 w-24" />
              </div>
            </CardContent>
          </Card>
        </main>
        <Nav />
      </div>
    );
  }

  if (!deal) {
    return (
      <div className="min-h-screen bg-background pb-20">
        <header className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border">
          <div className="flex items-center gap-3 px-4 py-4">
            <Button variant="ghost" size="icon" onClick={() => setLocation(backPath)}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <h1 className="text-xl font-bold">Deal Details</h1>
          </div>
        </header>
        <main className="px-4 py-12 text-center">
          <p className="text-muted-foreground">Deal not found</p>
          <Link href={backPath}>
            <Button variant="outline" className="mt-4">
              Back to Deals
            </Button>
          </Link>
        </main>
        <Nav />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border">
        <div className="flex items-center gap-3 px-4 py-4">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => setLocation(backPath)}
            data-testid="button-back-deals"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-xl font-bold truncate flex-1">Deal Details</h1>
        </div>
      </header>

      <main className="px-4 py-6 space-y-6">
        <Card className="border-0 shadow-md">
          <CardContent className="p-6">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="flex-1 min-w-0">
                <h2 className="text-xl font-bold truncate" data-testid="text-deal-title">
                  {deal.dealTitle}
                </h2>
                <p className="text-muted-foreground" data-testid="text-brand-name">
                  {deal.brandName}
                </p>
              </div>
              <StatusBadge status={deal.status} />
            </div>

            <div className="grid grid-cols-2 gap-4 py-4 border-y border-border">
              <div className="flex items-center gap-2">
                <IndianRupee className="w-5 h-5 text-primary" />
                <div>
                  <p className="text-xs text-muted-foreground">Deal Value</p>
                  <p className="font-bold text-lg" data-testid="text-deal-amount">
                    ₹{deal.dealAmount.toLocaleString()}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Duration</p>
                  <p className="font-medium text-sm">
                    {formatDate(deal.startDate)} - {formatDate(deal.endDate)}
                  </p>
                </div>
              </div>
            </div>

            {hasContract ? (
              <div className="mt-4 flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                <CheckCircle className="w-5 h-5" />
                <span className="font-medium text-sm">Contract Created</span>
              </div>
            ) : (
              !isBrand && deal.status === "Pending" && (
                <div className="mt-4">
                  <Link href={`/deals/${deal.id}/contract`}>
                    <Button 
                      className="w-full h-12 font-semibold rounded-xl"
                      data-testid="button-create-contract"
                    >
                      <FileCheck className="w-5 h-5 mr-2" />
                      Accept Deal & Create Contract
                    </Button>
                  </Link>
                </div>
              )
            )}
          </CardContent>
        </Card>

        <section className="space-y-3">
          <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Deliverables ({deal.deliverables.length})
          </h3>
          
          <div className="space-y-3">
            {deal.deliverables.map((deliverable, index) => (
              <Card key={deliverable.id} className="border shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-muted">
                      <PlatformIcon platform={deliverable.platform} size={20} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium" data-testid={`text-deliverable-platform-${index}`}>
                          {deliverable.platform}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                          {deliverable.contentType}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        {deliverable.quantity}x {deliverable.frequency}
                      </p>
                      {deliverable.notes && (
                        <p className="text-sm text-muted-foreground mt-2 italic">
                          {deliverable.notes}
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      </main>

      <Nav />
    </div>
  );
}
