import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams, Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { PlatformIcon } from "@/components/platform-icon";
import { BottomNav } from "@/components/bottom-nav";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ArrowLeft, Calendar, IndianRupee, FileCheck, CheckCircle, CheckCircle2, Loader2, FileText, Receipt, CreditCard, Pencil, Scissors, Check, AlertTriangle } from "lucide-react";
import type { Deal, Contract, Quote, BrandInvoice } from "@shared/schema";

export default function DealDetailsPage() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const [splitPercentageStr, setSplitPercentageStr] = useState("50");
  const [completedIds, setCompletedIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(`deliverables-done-${params.id}`);
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });

  const toggleDeliverable = (id: string) => {
    setCompletedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      localStorage.setItem(`deliverables-done-${params.id}`, JSON.stringify(Array.from(next)));
      return next;
    });
  };
  const splitPercentage = Math.min(99, Math.max(1, parseInt(splitPercentageStr) || 50));
  const [showSplitInput, setShowSplitInput] = useState(false);

  const { data: deal, isLoading } = useQuery<Deal>({
    queryKey: ["/api/deals", params.id],
  });

  const { data: contracts = [] } = useQuery<Contract[]>({
    queryKey: ["/api/contracts"],
  });

  // Fetch quote for this deal without throwing on 404
  const { data: quote, isLoading: quoteLoading } = useQuery<Quote | null>({
    queryKey: ["/api/deals", params.id, "quote"],
    queryFn: async () => {
      const res = await fetch(`/api/deals/${params.id}/quote`, { credentials: "include" });
      if (res.status === 404) return null;
      if (!res.ok) return null;
      return res.json();
    },
  });

  // Fetch brand invoices specific to this deal
  const { data: dealBrandInvoices = [] } = useQuery<BrandInvoice[]>({
    queryKey: ["/api/deals", params.id, "brand-invoices"],
    queryFn: async () => {
      const res = await fetch(`/api/deals/${params.id}/brand-invoices`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
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

  const splitInvoices = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/deals/${params.id}/split-invoices`, { advancePercentage: splitPercentage });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/deals", params.id, "brand-invoices"] });
      setShowSplitInput(false);
      toast({
        title: "Split invoices created",
        description: `Advance (${splitPercentage}%) and Final (${100 - splitPercentage}%) invoices generated.`,
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create split invoices. Please try again.",
        variant: "destructive",
      });
    },
  });

  const dealId = parseInt(params.id || "0");
  const hasContract = contracts.some(c => c.dealId === dealId);
  const contract = contracts.find(c => c.dealId === dealId);
  const hasProof = !!contract?.proofFileName;
  const hasInvoice = dealBrandInvoices.length > 0;
  const hasQuote = !!quote && quote.status === "draft";
  const stepsReady = !quoteLoading;

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
          {deal.status === "Pending" && (
            <Button variant="outline" size="icon" onClick={() => setLocation(`/deals/${deal.id}/edit`)} data-testid="button-edit-deal">
              <Pencil className="w-4 h-4" />
            </Button>
          )}
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
                                ? "bg-emerald-500 text-white shadow-sm shadow-emerald-200"
                                : isActive
                                ? "bg-amber-400 text-white shadow-sm shadow-amber-200 ring-2 ring-amber-300/50"
                                : "bg-muted text-muted-foreground"
                              }`}
                          >
                            {isDone ? <CheckCircle2 className="w-3.5 h-3.5" /> : s.step}
                          </div>
                          <span className={`text-[10px] font-medium ${isDone ? "text-emerald-600" : isActive ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                            {s.label}
                          </span>
                        </div>
                        {idx < arr.length - 1 && (
                          <div className={`flex-1 h-px mx-0.5 ${s.step < currentStep ? "bg-emerald-400" : isActive && s.step === currentStep - 1 ? "bg-amber-300" : "bg-muted"}`} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 4-step action buttons — only shown once quote query resolves */}
            {stepsReady && (
              <div className="mt-3 space-y-2">
                {/* Revised quote banner */}
                {quote && quote.status === "revised" && (
                  <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                    <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      Deal was edited. Previous quote is outdated — please generate a new one.
                    </p>
                  </div>
                )}

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
                  (user?.contractCredits ?? 0) < 1 ? (
                    <Link href={`/pricing?redirect=/deals/${deal.id}/contract`}>
                      <Button
                        className="w-full h-12 font-semibold rounded-xl gradient-btn text-white"
                        data-testid="button-buy-credit-for-contract"
                      >
                        <CreditCard className="w-5 h-5 mr-2" />
                        Buy Credit to Create Agreement
                        <span className="ml-auto text-xs bg-white/20 rounded-full px-2 py-0.5">0 credits</span>
                      </Button>
                    </Link>
                  ) : (
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
                  )
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
                  <div className="space-y-2">
                    <Link href={contract ? `/contracts/${contract.id}` : "/contracts"}>
                      <Button
                        className="w-full h-12 font-semibold rounded-xl gradient-btn text-white"
                        data-testid="button-generate-invoice"
                      >
                        <Receipt className="w-5 h-5 mr-2" />
                        Generate Single Invoice
                      </Button>
                    </Link>

                    {!showSplitInput ? (
                      <Button
                        variant="outline"
                        className="w-full h-12 font-semibold rounded-xl"
                        onClick={() => setShowSplitInput(true)}
                        data-testid="button-split-invoice"
                      >
                        <Scissors className="w-5 h-5 mr-2" />
                        Split Invoice (Advance + Final)
                      </Button>
                    ) : (
                      <div className="space-y-2 p-3 rounded-xl border border-border bg-muted/50">
                        <div className="flex items-center gap-2">
                          <label className="text-sm font-medium whitespace-nowrap">Advance %</label>
                          <Input
                            type="text"
                            inputMode="numeric"
                            value={splitPercentageStr}
                            onChange={(e) => setSplitPercentageStr(e.target.value.replace(/[^0-9]/g, ""))}
                            className="w-20 h-9 text-center"
                            placeholder="50"
                            data-testid="input-split-percentage"
                          />
                          <span className="text-sm text-muted-foreground">/ {100 - splitPercentage}% Final</span>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            className="flex-1 h-10 font-semibold rounded-lg gradient-btn text-white"
                            onClick={() => splitInvoices.mutate()}
                            disabled={splitInvoices.isPending}
                            data-testid="button-confirm-split"
                          >
                            {splitInvoices.isPending ? (
                              <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Creating...
                              </>
                            ) : (
                              "Create Split Invoices"
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            className="h-10 rounded-lg"
                            onClick={() => setShowSplitInput(false)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* View existing invoices */}
                {hasInvoice && (
                  <div className="space-y-2">
                    {dealBrandInvoices.map((inv) => (
                      <Link key={inv.id} href={`/brand-invoices/${inv.id}`}>
                        <div className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted/50 transition-colors">
                          <CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                          <span className="font-medium text-sm flex-1">
                            {(inv as any).invoiceType === "advance"
                              ? "Advance Invoice"
                              : (inv as any).invoiceType === "final"
                              ? "Final Invoice"
                              : "Invoice"}
                          </span>
                          <StatusBadge status={inv.status} />
                        </div>
                      </Link>
                    ))}
                  </div>
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
            Deliverables ({completedIds.size}/{deal.deliverables.length} Completed)
            {(deal as any).deliverableMode === "any_one" && (
              <span className="ml-2 text-xs text-amber-600 dark:text-amber-400 normal-case font-normal">
                (Brand chooses one)
              </span>
            )}
          </h3>

          {deal.deliverables.length > 0 && (
            <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                style={{ width: `${(completedIds.size / deal.deliverables.length) * 100}%` }}
              />
            </div>
          )}

          <div className="space-y-3">
            {deal.deliverables.map((deliverable, index) => {
              const isCompleted = completedIds.has(deliverable.id);
              return (
                <Card key={deliverable.id} className="glass-card border-0">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <button
                        onClick={() => toggleDeliverable(deliverable.id)}
                        className={`flex items-center justify-center w-6 h-6 rounded-md border-2 transition-all mt-2 flex-shrink-0 ${
                          isCompleted
                            ? "bg-emerald-500 border-emerald-500 text-white"
                            : "border-gray-300 dark:border-zinc-600"
                        }`}
                      >
                        {isCompleted && <Check className="w-4 h-4" />}
                      </button>
                      <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-muted">
                        <PlatformIcon platform={deliverable.platform} size={20} />
                      </div>
                      <div className={`flex-1 min-w-0 transition-opacity ${isCompleted ? "opacity-60" : ""}`}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`font-medium ${isCompleted ? "line-through" : ""}`}
                            data-testid={`text-deliverable-platform-${index}`}
                          >
                            {deliverable.platform}
                          </span>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                            {deliverable.contentType}
                          </span>
                        </div>
                        <p className={`text-sm text-muted-foreground mt-1 ${isCompleted ? "line-through" : ""}`}>
                          {deliverable.quantity}x {deliverable.frequency}
                        </p>
                        {deliverable.notes && (
                          <p className={`text-sm text-muted-foreground mt-2 italic ${isCompleted ? "line-through" : ""}`}>
                            {deliverable.notes}
                          </p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      </main>

      <BottomNav />
    </div>
  );
}
