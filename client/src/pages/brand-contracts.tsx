import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { BrandBottomNav } from "@/components/brand-bottom-nav";
import { ArrowLeft, FileCheck } from "lucide-react";
import type { Contract } from "@shared/schema";

export default function BrandContractsPage() {
  const { data: contracts = [], isLoading } = useQuery<Contract[]>({
    queryKey: ["/api/brand/contracts"],
  });

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="glass-header sticky top-0 z-40">
        <div className="flex items-center gap-4 px-4 py-4">
          <Link href="/">
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <h1 className="text-xl font-bold">Your Contracts</h1>
        </div>
      </header>

      <main className="px-4 py-6 space-y-4 animate-fade-in">
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="glass-card border-0">
                <CardContent className="p-4">
                  <Skeleton className="h-5 w-3/4 mb-2" />
                  <Skeleton className="h-4 w-1/2 mb-4" />
                  <Skeleton className="h-6 w-24" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : contracts.length > 0 ? (
          <div className="space-y-3">
            {contracts.map((contract) => (
              <Card key={contract.id} className="glass-card border-0" data-testid={`card-contract-${contract.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">{contract.contractName}</p>
                      <p className="text-sm text-muted-foreground truncate">{contract.brandName}</p>
                    </div>
                    <StatusBadge status={contract.status} />
                  </div>
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/10">
                    <span className="text-lg font-bold text-primary">
                      {"\u20B9"}{contract.contractValue.toLocaleString()}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {contract.startDate} - {contract.endDate}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="glass-card border-0">
            <CardContent className="py-12 text-center">
              <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-muted mx-auto mb-4">
                <FileCheck className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="font-semibold mb-1">No contracts yet</h3>
              <p className="text-sm text-muted-foreground">
                Contracts for your deals will appear here
              </p>
            </CardContent>
          </Card>
        )}
      </main>

      <BrandBottomNav />
    </div>
  );
}
