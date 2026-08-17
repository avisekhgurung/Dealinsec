import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams, Link } from "wouter";
import { WorkflowStepper } from "@/components/workflow-stepper";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { PlatformIcon } from "@/components/platform-icon";
import { dealTypeMeta } from "@shared/dealTypeTaxonomy";
import { BottomNav } from "@/components/bottom-nav";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { trackEvent } from "@/lib/analytics";
import { ArrowLeft, Calendar, IndianRupee, FileCheck, CheckCircle, CheckCircle2, Loader2, FileText, Receipt, CreditCard, Pencil, Scissors, Check, AlertTriangle, ChevronRight, Crown, Briefcase, ScrollText, ListChecks, Copy, Zap, ShieldAlert, ShieldCheck, Sparkles } from "lucide-react";
import { hasProAccess, STANDARD_TERMS } from "@shared/schema";
import { memberCan } from "@shared/permissions";
import type { Deal, Contract, Quote, BrandInvoice } from "@shared/schema";
import { useUpgradeModal } from "@/components/upgrade-modal";
import { parseApiError, isUpgradeError } from "@/lib/api-error";

export default function DealDetailsPage() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  // Role capabilities — the server enforces these too; hiding the button
  // just stops a member walking into a guaranteed 403.
  const canQuote = memberCan(user as any, "quotations.create");
  const canAgree = memberCan(user as any, "agreements.create");
  const canInvoice = memberCan(user as any, "invoices.create");
  const { toast } = useToast();
  const { openUpgradeModal } = useUpgradeModal();
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
      trackEvent("generate_quote");
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
    onError: (err) => {
      const parsed = parseApiError(err);
      if (isUpgradeError(parsed)) {
        openUpgradeModal({ feature: "invoices" });
        return;
      }
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
          <div className="flex items-center gap-3 px-4 py-4 lg:max-w-[1600px] lg:mx-auto lg:px-8 lg:py-3.5">
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
          <div className="flex items-center gap-3 px-4 py-4 lg:max-w-[1600px] lg:mx-auto lg:px-8 lg:py-3.5">
            <Button variant="ghost" size="icon" onClick={() => setLocation(backPath)}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <h1 className="text-xl lg:text-lg font-bold lg:font-semibold">Deal Details</h1>
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
        <div className="flex items-center gap-3 px-4 py-4 lg:max-w-[1600px] lg:mx-auto lg:px-8 lg:py-3.5">
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

      <main className="px-4 py-6 animate-fade-in lg:max-w-[1600px] lg:mx-auto lg:px-8 lg:py-8">
        {/* Everything captured at creation is visible here: overview +
            workflow on the left, deliverables + the exact T&Cs on the right. */}
        <div className="space-y-6 lg:space-y-0 lg:grid lg:grid-cols-5 xl:grid-cols-3 lg:gap-6 xl:gap-8 lg:items-start">
        <div className="lg:col-span-3 xl:col-span-2 space-y-6">
        <Card className="glass-card border-0">
          <CardContent className="p-6">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="flex-1 min-w-0">
                <h2 className="text-xl font-bold truncate" data-testid="text-deal-title">
                  {deal.dealTitle}
                </h2>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <p className="text-muted-foreground" data-testid="text-brand-name">
                    {deal.brandName}
                  </p>
                  {(deal as any).dealType && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium border border-primary/20" data-testid="text-deal-type">
                      {(dealTypeMeta as any)[(deal as any).dealType]?.emoji ?? "·"} {(deal as any).dealType}
                    </span>
                  )}
                </div>
              </div>
              <StatusBadge status={deal.status} />
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 py-4">
              {([
                { label: "Deal Value", icon: IndianRupee, iconCls: "text-primary", value: `₹${deal.dealAmount.toLocaleString("en-IN")}`, big: true, testid: "text-deal-amount" },
                { label: "Duration", icon: Calendar, iconCls: "text-muted-foreground", value: `${formatDate(deal.startDate)} – ${formatDate(deal.endDate)}` },
                { label: "Deal Type", icon: Briefcase, iconCls: "text-muted-foreground", value: `${(dealTypeMeta as any)[(deal as any).dealType]?.emoji ?? "·"} ${(deal as any).dealType || "Custom"}` },
                { label: "Deliverables", icon: ListChecks, iconCls: "text-muted-foreground", value: `${deal.deliverables.length} item${deal.deliverables.length !== 1 ? "s" : ""} · ${(deal as any).deliverableMode === "any_one" ? "any one" : "all required"}` },
              ] as const).map((f) => (
                <div key={f.label} className="rounded-xl border border-border/60 bg-card/40 p-3.5 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <p className="text-xs text-muted-foreground">{f.label}</p>
                    <f.icon className={`w-4 h-4 shrink-0 ${f.iconCls}`} />
                  </div>
                  <p className={(f as any).big ? "font-bold text-xl tabular-nums" : "font-semibold text-sm leading-snug"} data-testid={(f as any).testid}>
                    {f.value}
                  </p>
                </div>
              ))}
            </div>

            {/* Mini step indicator — shares WorkflowStepper with the agreement page */}
            <div className="mt-4 mb-2">
              <WorkflowStepper
                currentStep={currentStep}
                steps={[
                  { label: "Deal", step: 1, href: null },
                  { label: "Quote", step: 2, href: quote ? `/deals/${deal.id}/quote` : null },
                  { label: "Agreement", step: 3, href: contract ? `/contracts/${contract.id}` : null },
                  {
                    label: "Invoice",
                    step: 4,
                    // Was pointing back at this very page. Send them to the
                    // invoice itself, or to the composer when one can be raised.
                    href: dealBrandInvoices.length
                      ? `/brand-invoices/${dealBrandInvoices[0].id}`
                      : contract && contract.status === "Signed" && canInvoice
                      ? `/brand-invoices/new?contractId=${contract.id}&mode=full`
                      : null,
                  },
                ]}
              />
            </div>

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
                {!hasQuote && canQuote && (
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

                {/* Step 2 → 3: Create Agreement (Pro feature) */}
                {hasQuote && !hasContract && canAgree && (
                  hasProAccess(user) ? (
                    <Link href={`/deals/${deal.id}/contract`}>
                      <Button
                        className="w-full h-12 font-semibold rounded-xl gradient-btn text-white"
                        data-testid="button-create-contract"
                      >
                        <FileCheck className="w-5 h-5 mr-2" />
                        Create Agreement
                        <span className="ml-auto text-xs bg-white/20 rounded-full px-2 py-0.5">Pro</span>
                      </Button>
                    </Link>
                  ) : (
                    <Button
                      className="w-full h-12 font-semibold rounded-xl gradient-btn text-white"
                      onClick={() => openUpgradeModal({ feature: "agreements" })}
                      data-testid="button-create-contract-upgrade"
                    >
                      <FileCheck className="w-5 h-5 mr-2" />
                      Create Agreement
                      <span className="ml-auto flex items-center gap-1 text-xs bg-white/20 rounded-full px-2 py-0.5">
                        <Crown className="w-3 h-3" /> Pro
                      </span>
                    </Button>
                  )
                )}

                {/* Step 3: Agreement created — tappable to open it, plus upload-proof action */}
                {hasContract && !hasProof && (
                  <div className="flex items-center gap-2">
                    {contract ? (
                      <Link href={`/contracts/${contract.id}`} className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 flex-1 rounded-lg -m-1 p-1 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 transition-colors cursor-pointer" data-testid="link-view-agreement">
                        <CheckCircle className="w-5 h-5 flex-shrink-0" />
                        <span className="font-medium text-sm flex-1">Agreement Created</span>
                        <ChevronRight className="w-4 h-4 flex-shrink-0 opacity-70" />
                      </Link>
                    ) : (
                      <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 flex-1">
                        <CheckCircle className="w-5 h-5 flex-shrink-0" />
                        <span className="font-medium text-sm">Agreement Created</span>
                      </div>
                    )}
                    {contract && (
                      <Link href={`/contracts/${contract.id}`}>
                        <Button variant="outline" size="sm" className="rounded-lg text-xs font-medium">
                          Upload Proof
                        </Button>
                      </Link>
                    )}
                  </div>
                )}

                {/* Step 3 → 4: Generate Invoice for Brand (Pro feature) */}
                {hasContract && hasProof && !hasInvoice && canInvoice && !hasProAccess(user) && (
                  <div className="space-y-2">
                    <Button
                      className="w-full h-12 font-semibold rounded-xl gradient-btn text-white"
                      onClick={() => openUpgradeModal({ feature: "invoices" })}
                      data-testid="button-generate-invoice-upgrade"
                    >
                      <Receipt className="w-5 h-5 mr-2" />
                      Generate Invoice
                      <span className="ml-auto flex items-center gap-1 text-xs bg-white/20 rounded-full px-2 py-0.5">
                        <Crown className="w-3 h-3" /> Pro
                      </span>
                    </Button>
                  </div>
                )}
                {hasContract && hasProof && !hasInvoice && canInvoice && hasProAccess(user) && (
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

        {/* ── Deal Information + Financial Summary (mockup parity, real data only) ── */}
        <div className="grid sm:grid-cols-2 gap-6">
          <Card className="glass-card border-0">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold">Deal Information</h3>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(`DL-${deal.id}`).then(
                      () => toast({ title: "Deal ID copied" }),
                      () => {},
                    );
                  }}
                  className="inline-flex items-center gap-1.5 text-[11px] font-mono font-semibold text-muted-foreground hover:text-foreground px-2 py-1 rounded-md border border-border/60 transition-colors"
                  data-testid="copy-deal-id"
                >
                  #DL-{deal.id} <Copy className="w-3 h-3" />
                </button>
              </div>
              <dl className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Client</dt>
                  <dd className="font-medium truncate">{deal.brandName}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Category</dt>
                  <dd>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium border border-primary/20">
                      {(deal as any).dealType || "Custom"}
                    </span>
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Start Date</dt>
                  <dd className="font-medium">{formatDate(deal.startDate)}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">End Date</dt>
                  <dd className="font-medium">{formatDate(deal.endDate)}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Status</dt>
                  <dd><StatusBadge status={deal.status} size="compact" /></dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card className="glass-card border-0">
            <CardContent className="p-5">
              {(() => {
                const totalInvoiced = dealBrandInvoices.reduce((sum, i) => sum + Number(i.dealAmount || 0), 0);
                const paid = dealBrandInvoices.filter((i) => i.status === "Paid").reduce((sum, i) => sum + Number(i.dealAmount || 0), 0);
                const now = Date.now();
                const overdue = dealBrandInvoices
                  .filter((i) => i.status !== "Paid" && i.dueDate && new Date(i.dueDate as any).getTime() < now)
                  .reduce((sum, i) => sum + Number(i.dealAmount || 0), 0);
                const pending = totalInvoiced - paid - overdue;
                const pct = deal.dealAmount > 0 ? Math.min(100, Math.round((totalInvoiced / deal.dealAmount) * 100)) : 0;
                const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
                return (
                  <>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="font-semibold">Financial Summary</h3>
                      {dealBrandInvoices.length > 0 && (
                        <Link href="/invoices" className="text-xs font-semibold text-primary hover:underline inline-flex items-center gap-1">
                          View Invoices <ChevronRight className="w-3 h-3" />
                        </Link>
                      )}
                    </div>
                    {dealBrandInvoices.length === 0 ? (
                      <div className="py-6 text-center">
                        <Receipt className="w-7 h-7 mx-auto text-muted-foreground/40 mb-2" />
                        <p className="text-sm text-muted-foreground">No invoices raised yet.</p>
                        <p className="text-xs text-muted-foreground/80 mt-0.5">Invoices appear here once the agreement is signed.</p>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-end justify-between gap-3 mb-2">
                          <div>
                            <p className="text-xs text-muted-foreground">Deal Value</p>
                            <p className="font-bold text-lg tabular-nums">{inr(deal.dealAmount)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Total Invoiced</p>
                            <p className="font-bold text-lg tabular-nums">{inr(totalInvoiced)}</p>
                          </div>
                          <span className="text-xs font-bold px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 tabular-nums">
                            {pct}%
                          </span>
                        </div>
                        <div className="w-full h-2 rounded-full bg-muted overflow-hidden mb-4">
                          <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-500" style={{ width: `${pct}%` }} />
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          {([
                            { label: "Paid", value: paid, dot: "bg-emerald-500", cls: "text-emerald-600 dark:text-emerald-400" },
                            { label: "Pending", value: pending, dot: "bg-amber-500", cls: "text-amber-600 dark:text-amber-400" },
                            { label: "Overdue", value: overdue, dot: "bg-rose-500", cls: "text-rose-600 dark:text-rose-400" },
                          ] as const).map((t) => (
                            <div key={t.label} className="rounded-lg border border-border/60 p-2.5 min-w-0">
                              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                <span className={`w-1.5 h-1.5 rounded-full ${t.dot}`} /> {t.label}
                              </p>
                              <p className={`font-bold text-sm tabular-nums mt-0.5 truncate ${t.cls}`}>{inr(t.value)}</p>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </>
                );
              })()}
            </CardContent>
          </Card>
        </div>
        </div>

        <div className="lg:col-span-2 xl:col-span-1 space-y-6">
        <DealIntelCards dealId={deal.id} existingTerms={(deal as any).customTerms ?? ""} />
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

        {/* ── Terms & Conditions — exactly what was selected at creation ── */}
        {(() => {
          const termIds = (((deal as any).standardTermIds as string[] | null) ?? []);
          const standardTerms = STANDARD_TERMS.filter((t) => termIds.includes(t.id));
          const customTerms = ((((deal as any).customTerms as string | null) ?? ""))
            .split("\n").map((l) => l.trim()).filter(Boolean);
          if (!standardTerms.length && !customTerms.length) return null;
          return (
            <section className="space-y-3">
              <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                <ScrollText className="w-3.5 h-3.5" />
                Terms &amp; Conditions
                <span className="normal-case font-normal text-xs text-muted-foreground/80">
                  ({standardTerms.length + customTerms.length} — applied to quotation &amp; agreement)
                </span>
              </h3>
              <Card className="glass-card border-0">
                <CardContent className="p-4 lg:p-5">
                  <ul className="space-y-2.5">
                    {standardTerms.map((t) => (
                      <li key={t.id} className="flex items-start gap-2.5 text-sm">
                        <span className="flex items-center justify-center w-4.5 h-4.5 w-[18px] h-[18px] rounded-full bg-emerald-500/15 shrink-0 mt-0.5">
                          <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" strokeWidth={3} />
                        </span>
                        <span className="text-muted-foreground leading-relaxed">{t.label}</span>
                      </li>
                    ))}
                    {customTerms.map((t, i) => (
                      <li key={`c-${i}`} className="flex items-start gap-2.5 text-sm">
                        <span className="flex items-center justify-center w-[18px] h-[18px] rounded-full bg-amber-500/15 shrink-0 mt-0.5">
                          <Pencil className="w-2.5 h-2.5 text-amber-600 dark:text-amber-400" />
                        </span>
                        <span className="text-muted-foreground leading-relaxed">
                          {t} <span className="text-[10px] uppercase tracking-wide text-amber-600/80 dark:text-amber-400/80 font-semibold ml-1">custom</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </section>
          );
        })()}

        {/* ── Quick Actions — contextual, only what's actually available ── */}
        <section className="space-y-3">
          <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-2">
            <Zap className="w-3.5 h-3.5" />
            Quick Actions
          </h3>
          <Card className="glass-card border-0">
            <CardContent className="p-3 grid grid-cols-2 gap-2">
              {deal.status === "Pending" && (
                <Link href={`/deals/${deal.id}/edit`} className="col-span-1">
                  <Button variant="outline" className="w-full h-10 justify-start font-semibold text-sm" data-testid="qa-edit-deal">
                    <Pencil className="w-4 h-4 mr-2 text-muted-foreground" /> Edit Deal
                  </Button>
                </Link>
              )}
              {quote && (
                <Link href={`/deals/${deal.id}/quote`} className="col-span-1">
                  <Button variant="outline" className="w-full h-10 justify-start font-semibold text-sm" data-testid="qa-view-quote">
                    <FileText className="w-4 h-4 mr-2 text-muted-foreground" /> Quotation
                  </Button>
                </Link>
              )}
              {contract && (
                <Link href={`/contracts/${contract.id}`} className="col-span-1">
                  <Button variant="outline" className="w-full h-10 justify-start font-semibold text-sm" data-testid="qa-view-agreement">
                    <FileCheck className="w-4 h-4 mr-2 text-muted-foreground" /> Agreement
                  </Button>
                </Link>
              )}
              {dealBrandInvoices.length > 0 && (
                <Link href={dealBrandInvoices.length === 1 ? `/brand-invoices/${dealBrandInvoices[0].id}` : "/invoices"} className="col-span-1">
                  <Button variant="outline" className="w-full h-10 justify-start font-semibold text-sm" data-testid="qa-view-invoices">
                    <Receipt className="w-4 h-4 mr-2 text-muted-foreground" /> Invoice{dealBrandInvoices.length > 1 ? "s" : ""}
                  </Button>
                </Link>
              )}
            </CardContent>
          </Card>
        </section>
        </div>
        </div>
      </main>

      <BottomNav />
    </div>
  );
}


// ─── Deal intelligence rail cards ────────────────────────────────────────────
// Health score + next best action from the deterministic server engine
// (server/copilot/insights.ts) — every point traces to a visible signal.
function DealIntelCards({ dealId, existingTerms }: { dealId: number; existingTerms: string }) {
  const { toast } = useToast();
  const [suggested, setSuggested] = useState<string | null>(null);
  const { data } = useQuery<{
    health: { score: number; grade: string; signals: { label: string; state: "good" | "warn" | "bad"; detail: string }[] };
    nextAction: { action: string; route: string; urgency: "red" | "yellow" | "green" } | null;
    protection?: { flags: { id: string; severity: "risk" | "gap"; title: string; detail: string }[]; risks: number; gaps: number };
    dealStatus?: string;
  }>({ queryKey: [`/api/copilot/deal-intel/${dealId}`], staleTime: 30_000 });

  const suggest = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/copilot/risk-suggest", { dealId });
      return res.json();
    },
    onSuccess: (d: any) => setSuggested(d.termsBlock || d.note || ""),
    onError: () => toast({ title: "Couldn't get suggestions right now", variant: "destructive" }),
  });

  const addTerms = useMutation({
    mutationFn: async () => {
      const merged = existingTerms ? `${existingTerms}\n${suggested}` : suggested;
      const res = await apiRequest("PATCH", `/api/deals/${dealId}`, { customTerms: merged });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Protections added to the deal's terms" });
      setSuggested(null);
      queryClient.invalidateQueries({ queryKey: [`/api/deals/${dealId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/copilot/deal-intel/${dealId}`] });
    },
    onError: () => toast({ title: "Couldn't update the terms", description: "Only pending deals can be edited.", variant: "destructive" }),
  });

  if (!data) return null;
  const { health, nextAction, protection } = data;
  const canEdit = data.dealStatus === "Pending";
  const scoreCls = health.score >= 80 ? "text-emerald-600 dark:text-emerald-400" : health.score >= 55 ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400";
  const ringCls = health.score >= 80 ? "border-emerald-500/50" : health.score >= 55 ? "border-amber-500/50" : "border-rose-500/50";
  return (
    <>
      {nextAction && (
        <Card className={`glass-card border ${nextAction.urgency === "red" ? "border-rose-300/50 dark:border-rose-900/50" : nextAction.urgency === "yellow" ? "border-amber-300/50 dark:border-amber-900/50" : "border-emerald-300/50 dark:border-emerald-800/50"}`}>
          <CardContent className="p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Next best action</p>
            <p className="text-sm font-semibold mb-2.5">{nextAction.action}</p>
            <Link href={nextAction.route}>
              <Button size="sm" className="h-8 text-xs font-bold gradient-btn text-white w-full">
                Do it now <ChevronRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}
      <Card className="glass-card border-0">
        <CardContent className="p-4">
          <div className="flex items-center gap-3.5 mb-3">
            <div className={`w-14 h-14 rounded-full border-[3px] ${ringCls} flex flex-col items-center justify-center shrink-0`}>
              <span className={`text-lg font-black leading-none tabular-nums ${scoreCls}`}>{health.score}</span>
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Deal health</p>
              <p className={`text-sm font-bold ${scoreCls}`}>{health.grade}</p>
            </div>
          </div>
          <ul className="space-y-1.5">
            {health.signals.map((sig) => (
              <li key={sig.label} className="flex items-start gap-2 text-xs">
                <span className={`mt-0.5 shrink-0 ${sig.state === "good" ? "text-emerald-500" : sig.state === "warn" ? "text-amber-500" : "text-rose-500"}`}>
                  {sig.state === "good" ? <Check className="w-3.5 h-3.5" strokeWidth={3} /> : <AlertTriangle className="w-3.5 h-3.5" />}
                </span>
                <span className="min-w-0">
                  <b className="font-semibold">{sig.label}:</b>{" "}
                  <span className="text-muted-foreground">{sig.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {protection && (
        <Card className={`glass-card border ${protection.risks ? "border-rose-300/50 dark:border-rose-900/50" : protection.gaps ? "border-amber-300/50 dark:border-amber-900/50" : "border-emerald-300/50 dark:border-emerald-800/50"}`}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              {protection.flags.length ? (
                <ShieldAlert className={`w-4 h-4 ${protection.risks ? "text-rose-500" : "text-amber-500"}`} />
              ) : (
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
              )}
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Protection check</p>
            </div>
            {protection.flags.length === 0 ? (
              <p className="text-xs text-muted-foreground">The core protections are in place — advance, timelines, revision limits and exclusions are all covered in the terms.</p>
            ) : (
              <>
                <p className="text-xs font-semibold mb-2">
                  {protection.risks ? `${protection.risks} risky term${protection.risks > 1 ? "s" : ""}` : ""}
                  {protection.risks && protection.gaps ? " · " : ""}
                  {protection.gaps ? `${protection.gaps} protection${protection.gaps > 1 ? "s" : ""} missing` : ""}
                </p>
                <ul className="space-y-1.5 mb-3">
                  {protection.flags.map((f) => (
                    <li key={f.id} className="flex items-start gap-2 text-xs">
                      <AlertTriangle className={`mt-0.5 w-3.5 h-3.5 shrink-0 ${f.severity === "risk" ? "text-rose-500" : "text-amber-500"}`} />
                      <span className="min-w-0">
                        <b className="font-semibold">{f.title}:</b>{" "}
                        <span className="text-muted-foreground">{f.detail}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                {suggested === null ? (
                  protection.gaps > 0 && (
                    <Button size="sm" variant="outline" className="h-8 text-xs font-bold w-full" disabled={suggest.isPending} onClick={() => suggest.mutate()}>
                      {suggest.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1.5" />}
                      Suggest the missing terms
                    </Button>
                  )
                ) : (
                  <div className="rounded-lg border border-border/60 bg-muted/40 p-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Suggested terms — review before using</p>
                    <p className="text-xs whitespace-pre-line mb-2.5">{suggested}</p>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="h-7 text-[11px] font-bold flex-1" onClick={() => { navigator.clipboard.writeText(suggested); toast({ title: "Copied" }); }}>
                        <Copy className="w-3 h-3 mr-1" /> Copy
                      </Button>
                      {canEdit && (
                        <Button size="sm" className="h-7 text-[11px] font-bold flex-1 gradient-btn text-white" disabled={addTerms.isPending} onClick={() => addTerms.mutate()}>
                          {addTerms.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Check className="w-3 h-3 mr-1" strokeWidth={3} />}
                          Add to deal terms
                        </Button>
                      )}
                    </div>
                    {!canEdit && <p className="text-[10px] text-muted-foreground mt-1.5">This deal is past editing — carry these into your next quotation revision.</p>}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}
