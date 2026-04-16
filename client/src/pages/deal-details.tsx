import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams, Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { PlatformIcon } from "@/components/platform-icon";
import { BottomNav } from "@/components/bottom-nav";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ArrowLeft, Calendar, IndianRupee, FileCheck, CheckCircle, CheckCircle2, Loader2, FileText, Receipt } from "lucide-react";
import type { Deal, Contract, Quote, BrandInvoice } from "@shared/schema";

export default function DealDetailsPage() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();

  const { data: deal, isLoading } = useQuery<Deal>({
    queryKey: ["/api/deals", params.id],
  });

  const { data: contracts = [] } = useQuery<Contract[]>({
    queryKey: ["/api/contracts"],
  });

  // Fetch quote for this deal without throwing on 404
  const { data: quote } = useQuery<Quote | null>({
    queryKey: ["/api/deals", params.id, "quote"],
    queryFn: async () => {
      const res = await fetch(`/api/deals/${params.id}/quote`, { credentials: "include" });
      if (res.status === 404) return null;
      if (!res.ok) return null;
      return res.json();
    },
  });

  // Fetch brand invoices to check if one exists for this deal
  const { data: brandInvoices = [] } = useQuery<BrandInvoice[]>({
    queryKey: ["/api/brand-invoices"],
  });

  const generateQuote = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/deals/${params.id}/quote`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/deals", params.id, "quote"] });
      setLocation(`/deals/${params.id}/quote`);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to generate quote. Please try again.",
        variant: "destructive",
      });
    },
  });

  const completeDeal = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/deals/${params.id}/complete`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/deals", params.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      toast({
        title: "Deal completed",
        description: "The deal has been marked as completed.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to complete deal. Please try again.",
        variant: "destructive",
      });
    },
  });

  const dealId = parseInt(params.id || "0");
  const hasContract = contracts.some(c => c.dealId === dealId);
  const contract = contracts.find(c => c.dealId === dealId);
  const hasProof = !!contract?.proofFileName;
  const brandInvoice = brandInvoices.find(inv => inv.dealId === dealId);
  const hasInvoice = !!brandInvoice;
  const hasQuote = !!quote;

  // Determine current step (1=Deal, 2=Quote, 3=Agreement, 4=Invoice)
  const currentStep = hasInvoice ? 4 : hasContract ? (hasProof ? 4 : 3) : hasQuote ? 3 : 2;

  const backPath = "/deals";

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
        <header className="glass-header sticky top-0 z-40">
          <div className="flex items-center gap-3 px-4 py-4">
            <Button variant="ghost" size="icon" onClick={() => setLocation(backPath)}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <Skeleton className="h-6 w-32" />
          </div>
        </header>
        <main className="px-4 py-6 space-y-4">
          <Card className="glass-card border-0">
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
        <BottomNav />
      </div>
    );
  }

  if (!deal) {
    return (
      <div className="min-h-screen bg-background pb-20">
        <header className="glass-header sticky top-0 z-40">
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
        <BottomNav />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="glass-header sticky top-0 z-40">
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

      <main className="px-4 py-6 space-y-6 animate-fade-in">
        <Card className="glass-card border-0">
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

            <div className="grid grid-cols-2 gap-4 py-4 border-y border-white/10">
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

            {/* Mini step indicator */}
            {(
              <div className="mt-4 mb-2">
                <div className="flex items-center justify-between">
                  {[
                    { label: "Deal", step: 1 },
                    { label: "Quote", step: 2 },
                    { label: "Agreement", step: 3 },
                    { label: "Invoice", step: 4 },
                  ].map((s, idx, arr) => {
                    const isDone = s.step < currentStep;
                    const isActive = s.step === currentStep;
                    return (
                      <div key={s.step} className="flex items-center flex-1">
                        <div className="flex flex-col items-center gap-0.5">
                          <div
                            className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold transition-all
                              ${isDone
                                ? "bg-emerald-500 text-white"
                                : isActive
                                ? "bg-gradient-to-br from-violet-500 to-purple-600 text-white"
                                : "bg-muted text-muted-foreground"
                              }`}
                          >
                            {isDone ? <CheckCircle2 className="w-3.5 h-3.5" /> : s.step}
                          </div>
                          <span className={`text-[10px] font-medium ${isDone ? "text-emerald-500" : isActive ? "text-primary" : "text-muted-foreground"}`}>
                            {s.label}
                          </span>
                        </div>
                        {idx < arr.length - 1 && (
                          <div className={`flex-1 h-px mx-0.5 ${s.step < currentStep ? "bg-emerald-400" : "bg-muted"}`} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 4-step action buttons */}
            {(
              <div className="mt-3 space-y-2">
                {/* Step 1 → 2: Generate Quote */}
                {!hasQuote && (
                  <Button
                    className="w-full h-12 font-semibold rounded-xl gradient-btn text-white"
                    onClick={() => generateQuote.mutate()}
                    disabled={generateQuote.isPending}
                    data-testid="button-generate-quote"
                  >
                    {generateQuote.isPending ? (
                      <>
                        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                        Generating Quote...
                      </>
                    ) : (
                      <>
                        <FileText className="w-5 h-5 mr-2" />
                        Generate Quote
                      </>
                    )}
                  </Button>
                )}

                {/* Step 2 → 3: Create Agreement */}
                {hasQuote && !hasContract && (
                  <Link href={`/deals/${deal.id}/contract`}>
                    <Button
                      className="w-full h-12 font-semibold rounded-xl gradient-btn text-white"
                      data-testid="button-create-contract"
                    >
                      <FileCheck className="w-5 h-5 mr-2" />
                      Create Agreement
                      <span className="ml-auto text-xs bg-white/20 rounded-full px-2 py-0.5">1 credit</span>
                    </Button>
                  </Link>
                )}

                {/* Step 3: Agreement created, prompt to upload proof */}
                {hasContract && !hasProof && (
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 flex-1">
                      <CheckCircle className="w-5 h-5 flex-shrink-0" />
                      <span className="font-medium text-sm">Agreement Created</span>
                    </div>
                    {contract && (
                      <Link href={`/contracts/${contract.id}`}>
                        <Button variant="outline" size="sm" className="rounded-lg text-xs font-medium">
                          Upload Proof
                        </Button>
                      </Link>
                    )}
                  </div>
                )}

                {/* Step 3 → 4: Generate Invoice for Brand */}
                {hasContract && hasProof && !hasInvoice && (
                  <Link href={contract ? `/contracts/${contract.id}` : "/contracts"}>
                    <Button
                      className="w-full h-12 font-semibold rounded-xl gradient-btn text-white"
                      data-testid="button-generate-invoice"
                    >
                      <Receipt className="w-5 h-5 mr-2" />
                      Generate Invoice
                    </Button>
                  </Link>
                )}

                {/* View existing invoice */}
                {hasInvoice && brandInvoice && (
                  <Link href={`/brand-invoices/${brandInvoice.id}`}>
                    <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                      <CheckCircle className="w-5 h-5" />
                      <span className="font-medium text-sm">Invoice Generated</span>
                    </div>
                  </Link>
                )}
              </div>
            )}

            {/* Mark as Completed (Active deals) */}
            {deal.status === "Active" && (
              <div className="mt-3">
                <Button
                  className="w-full h-12 font-semibold rounded-xl gradient-btn text-white"
                  onClick={() => completeDeal.mutate()}
                  disabled={completeDeal.isPending}
                  data-testid="button-complete-deal"
                >
                  {completeDeal.isPending ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      Completing...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-5 h-5 mr-2" />
                      Mark as Completed
                    </>
                  )}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <section className="space-y-3">
          <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Deliverables ({deal.deliverables.length})
          </h3>

          <div className="space-y-3">
            {deal.deliverables.map((deliverable, index) => (
              <Card key={deliverable.id} className="glass-card border-0">
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

      <BottomNav />
    </div>
  );
}
