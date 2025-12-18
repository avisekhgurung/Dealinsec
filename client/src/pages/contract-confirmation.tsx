import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams, Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ArrowLeft, Shield, AlertTriangle, PenLine, Loader2, CreditCard } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import type { Deal } from "@shared/schema";

export default function ContractConfirmationPage() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const [agreed, setAgreed] = useState(false);

  const hasCredits = (user?.contractCredits ?? 0) >= 1;

  const { data: deal, isLoading } = useQuery<Deal>({
    queryKey: ["/api/deals", params.id],
  });

  const createContract = useMutation({
    mutationFn: async () => {
      if (!deal) throw new Error("Deal not found");
      
      const contractData = {
        contractName: `${deal.brandName} - ${deal.dealTitle}`,
        brandName: deal.brandName,
        dealId: deal.id,
        startDate: deal.startDate,
        endDate: deal.endDate,
        contractValue: deal.dealAmount,
        status: "Signed" as const,
        exclusive: true,
      };
      
      const res = await apiRequest("POST", "/api/contracts", contractData);
      return res.json();
    },
    onSuccess: (contract) => {
      queryClient.invalidateQueries({ queryKey: ["/api/contracts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({
        title: "Contract signed",
        description: "Your exclusive contract has been created.",
      });
      setLocation(`/contracts/${contract.id}`);
    },
    onError: async (error: any) => {
      if (error?.status === 402) {
        toast({
          title: "Insufficient Credits",
          description: "You need at least 1 contract credit. Please purchase credits.",
          variant: "destructive",
        });
        queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      } else {
        toast({
          title: "Error",
          description: "Failed to create contract. Please try again.",
          variant: "destructive",
        });
      }
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <header className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border">
          <div className="flex items-center gap-3 px-4 py-4">
            <Button variant="ghost" size="icon" onClick={() => setLocation(`/deals/${params.id}`)}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <Skeleton className="h-6 w-40" />
          </div>
        </header>
        <main className="px-4 py-8">
          <Skeleton className="h-64 w-full rounded-xl" />
        </main>
      </div>
    );
  }

  if (!deal) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Deal not found</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border">
        <div className="flex items-center gap-3 px-4 py-4">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => setLocation(`/deals/${params.id}`)}
            data-testid="button-back-deal"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-xl font-bold">Sign Contract</h1>
        </div>
      </header>

      <main className="px-4 py-8 space-y-6 max-w-lg mx-auto">
        <div className="text-center space-y-4">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-primary/10 mx-auto">
            <Shield className="w-10 h-10 text-primary" />
          </div>
          <h2 className="text-2xl font-bold">Exclusive Contract</h2>
          <p className="text-muted-foreground leading-relaxed">
            You're about to sign an exclusive contract with{" "}
            <span className="font-semibold text-foreground">{deal.brandName}</span>
          </p>
        </div>

        {!hasCredits && (
          <Card className="border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-950/20">
            <CardContent className="p-4">
              <div className="flex gap-3">
                <CreditCard className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                <div className="space-y-2">
                  <p className="font-semibold text-red-900 dark:text-red-200">
                    No Credits Available
                  </p>
                  <p className="text-sm text-red-800 dark:text-red-300 leading-relaxed">
                    You need at least 1 contract credit to sign this contract. 
                    Purchase credits to continue.
                  </p>
                  <Link href="/pricing">
                    <Button size="sm" className="mt-2" data-testid="button-buy-credits">
                      <CreditCard className="w-4 h-4 mr-2" />
                      Buy Credits
                    </Button>
                  </Link>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20">
          <CardContent className="p-4">
            <div className="flex gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="space-y-2">
                <p className="font-semibold text-amber-900 dark:text-amber-200">
                  Important Notice
                </p>
                <p className="text-sm text-amber-800 dark:text-amber-300 leading-relaxed">
                  This is an <strong>EXCLUSIVE CONTRACT</strong>. All brand deals during this 
                  contract period must be registered on this platform.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-md">
          <CardContent className="p-6 space-y-4">
            <h3 className="font-semibold">Contract Details</h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Brand</span>
                <span className="font-medium" data-testid="text-contract-brand">{deal.brandName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Deal</span>
                <span className="font-medium">{deal.dealTitle}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Value</span>
                <span className="font-bold text-primary">₹{deal.dealAmount.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Period</span>
                <span className="font-medium">
                  {new Date(deal.startDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} - {new Date(deal.endDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Deliverables</span>
                <span className="font-medium">{deal.deliverables.length} items</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-start gap-3 p-4 rounded-xl bg-muted/50">
          <Checkbox 
            id="agree" 
            checked={agreed}
            onCheckedChange={(checked) => setAgreed(checked === true)}
            data-testid="checkbox-agree"
          />
          <label 
            htmlFor="agree" 
            className="text-sm leading-relaxed cursor-pointer select-none"
          >
            I understand and agree to the exclusive usage terms. All my brand deals 
            during this contract period will be registered on this platform.
          </label>
        </div>

        <div className="space-y-3 pt-4">
          <Button
            className="w-full h-14 text-base font-semibold rounded-xl"
            disabled={!agreed || createContract.isPending || !hasCredits}
            onClick={() => createContract.mutate()}
            data-testid="button-sign-contract"
          >
            {createContract.isPending ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Signing...
              </>
            ) : (
              <>
                <PenLine className="w-5 h-5 mr-2" />
                Sign Contract
              </>
            )}
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            By signing, you agree to the platform terms and conditions
          </p>
        </div>
      </main>
    </div>
  );
}
