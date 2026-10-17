import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams, Link } from "wouter";
import { ProtectionFindings, type Finding } from "@/components/protection-findings";
import { WorkflowStepper } from "@/components/workflow-stepper";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { AnimatedStatusBadge } from "@/components/animated-status-badge";
import { DetailSkeleton, DetailUnavailable } from "@/components/document/detail-states";
import { PlatformIcon } from "@/components/platform-icon";
import { dealTypeMeta } from "@shared/dealTypeTaxonomy";
import { engagementLabel, engagementModelMeta, serviceLabel } from "@shared/engagement";
import { engagementDetailRows } from "@/components/deals/engagement-fields";
import { DealEmailActivity } from "@/components/deals/email-activity";
import { BottomNav } from "@/components/bottom-nav";
import { useAuth } from "@/hooks/useAuth";
import { useMoney } from "@/hooks/use-locale";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { trackEvent } from "@/lib/analytics";
import { fadeUp, stagger, useCalmMotion } from "@/lib/motion";
import { ArrowLeft, Calendar, FileCheck, CheckCircle, Loader2, FileText, Receipt, Pencil, Scissors, Check, AlertTriangle, ChevronRight, Crown, Briefcase, ScrollText, ListChecks, Copy, Zap, Sparkles } from "lucide-react";
import { hasProAccess, STANDARD_TERMS } from "@shared/schema";
import { memberCan } from "@shared/permissions";
import { isAgreementSigned } from "@shared/agreement-lifecycle";
import { httpErrorKind } from "@shared/http-error-kind";
import { WORKFLOW_STEPS, workflowPosition } from "@shared/deal-view";
import type { Deal, Contract, Quote, BrandInvoice } from "@shared/schema";
import { useUpgradeModal } from "@/components/upgrade-modal";
import { parseApiError, isUpgradeError } from "@/lib/api-error";

export default function DealDetailsPage() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const fmt = useMoney();
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

  const { data: deal, isLoading, isError, error, refetch, isFetching } = useQuery<Deal>({
    queryKey: ["/api/deals", params.id],
  });
  // The entrance plays once, and only when the page had to wait for the deal:
  // a cached one is simply there, and a refetch never replays it.
  const calm = useCalmMotion();
  const [enter] = useState(() => isLoading && !calm);

  const { data: contracts = [], isLoading: contractsLoading, isError: contractsError } = useQuery<Contract[]>({
    queryKey: ["/api/contracts"],
  });

  // Fetch quote for this deal without throwing on 404
  const { data: quote, isLoading: quoteLoading } = useQuery<Quote | null>({
    queryKey: ["/api/deals", params.id, "quote"],
    queryFn: async () => {
      const res = await fetch(`/api/deals/${params.id}/quote`, { credentials: "include", headers: { "X-DealInSec-Money": "minor" } });
      if (res.status === 404) return null;
      if (!res.ok) return null;
      return res.json();
    },
  });

  // Fetch brand invoices specific to this deal
  const { data: dealBrandInvoices = [], isLoading: invoicesLoading } = useQuery<BrandInvoice[]>({
    queryKey: ["/api/deals", params.id, "brand-invoices"],
    queryFn: async () => {
      const res = await fetch(`/api/deals/${params.id}/brand-invoices`, { credentials: "include", headers: { "X-DealInSec-Money": "minor" } });
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
      trackEvent("quotation_created");
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
      // The suggested next step reads the deal's status: a completed deal has none.
      queryClient.invalidateQueries({ queryKey: [`/api/copilot/deal-intel/${params.id}`] });
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
  // Signed online by the client OR by an owner-attested uploaded copy (or an older
  // row stored as Signed) — the same rule the server uses to allow invoicing.
  // An uploaded proof file alone was the old test, which missed online signatures.
  const isSigned = isAgreementSigned(contract);
  const hasInvoice = dealBrandInvoices.length > 0;
  const hasQuote = !!quote && quote.status === "draft";
  const stepsReady = !quoteLoading;

  // Where the deal is: Deal → Quotation → Agreement → Invoice → Paid, from its
  // own documents (shared/deal-view.ts — the board and the list use the same
  // rule). Unknown until all three have loaded; then the stepper marks nothing
  // rather than a guess. The quotation and invoice reads stay as they were
  // (a failed read shows as none) — only a failed agreements list is unknown.
  const docsReady = !quoteLoading && !contractsLoading && !invoicesLoading && !contractsError;
  const position = deal && docsReady
    ? workflowPosition({
        dealAmountMinor: deal.dealAmountMinor,
        quote: quote ?? null,
        agreement: contract ?? null,
        invoices: dealBrandInvoices.map((i) => ({ status: i.status, dueDate: i.dueDate, amountMinor: Number(i.dealAmountMinor || 0) })),
      })
    : null;
  const unpaidInvoice = dealBrandInvoices.find((i) => i.status !== "Paid");

  const backPath = "/deals";

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(fmt.locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const header = (actions?: React.ReactNode) => (
    <header className="glass-header sticky top-0 z-40">
      <div className="flex items-center gap-3 px-4 py-4 lg:max-w-[1600px] lg:mx-auto lg:px-8 lg:py-3.5">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setLocation(backPath)}
          aria-label="Back to deals"
          data-testid="button-back-deals"
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <h1 className="text-xl lg:text-lg font-bold lg:font-semibold truncate flex-1">Deal Details</h1>
        {actions}
      </div>
    </header>
  );

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background pb-20">
        {header()}
        <main className="px-4 py-6 lg:max-w-[1600px] lg:mx-auto lg:px-8 lg:py-8">
          <DetailSkeleton what="deal" stepper={false} mainBlocks={2} railBlocks={2} />
        </main>
        <BottomNav />
      </div>
    );
  }

  if (!deal) {
    return (
      <div className="min-h-screen bg-background pb-20">
        {header()}
        <main className="px-4 py-6 lg:max-w-3xl lg:mx-auto lg:px-8 lg:py-8">
          <DetailUnavailable
            // No error and no row is the server saying "nothing here".
            kind={isError ? httpErrorKind(error) : "not_found"}
            what="deal"
            backHref={backPath}
            backLabel="Back to Deals"
            onRetry={() => refetch()}
            retrying={isFetching}
          />
        </main>
        <BottomNav />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      {header(
        deal.status === "Pending" && (
          <Button variant="outline" size="icon" aria-label="Edit deal" onClick={() => setLocation(`/deals/${deal.id}/edit`)} data-testid="button-edit-deal">
            <Pencil className="w-4 h-4" />
          </Button>
        ),
      )}

      <motion.main
        variants={stagger}
        initial={enter ? "hidden" : false}
        animate="visible"
        className="px-4 py-6 space-y-6 lg:max-w-[1600px] lg:mx-auto lg:px-8 lg:py-8"
      >
        {/* ── Who, what, where it stands, what it's worth — and the suggested next step ── */}
        <motion.div variants={fadeUp}>
        <Card className="glass-card border-0">
          <CardContent className="p-5 lg:p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-muted-foreground truncate" data-testid="text-brand-name">
                    {deal.brandName}
                  </p>
                  {(deal as any).dealType && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium border border-primary/20" data-testid="text-deal-type">
                      {(dealTypeMeta as any)[(deal as any).dealType]?.emoji ?? "·"} {(deal as any).dealType}
                    </span>
                  )}
                </div>
                <h2 className="text-xl lg:text-2xl font-bold tracking-tight mt-0.5 break-words" data-testid="text-deal-title">
                  {deal.dealTitle}
                </h2>
              </div>
              <div className="flex flex-col items-end gap-1.5 shrink-0">
                <AnimatedStatusBadge status={deal.status} />
                <p className="text-xl lg:text-2xl font-bold tabular-nums" data-testid="text-deal-amount">
                  <span className="sr-only">{engagementModelMeta(deal.engagementModel)?.valueLabel ?? "Deal value"}: </span>{fmt.money(deal.dealAmountMinor)}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
              {([
                { label: "Duration", icon: Calendar, value: `${formatDate(deal.startDate)} – ${formatDate(deal.endDate)}` },
                deal.engagementModel
                  ? { label: "Engagement", icon: Briefcase, value: [engagementLabel(deal.engagementModel, deal.engagementTerms), serviceLabel(deal.serviceCategory)].filter(Boolean).join(" · ") }
                  : { label: "Deal Type", icon: Briefcase, value: `${(dealTypeMeta as any)[(deal as any).dealType]?.emoji ?? "·"} ${(deal as any).dealType || "Custom"}${deal.serviceCategory ? ` · ${serviceLabel(deal.serviceCategory)}` : ""}` },
                { label: "Deliverables", icon: ListChecks, value: `${deal.deliverables.length} item${deal.deliverables.length !== 1 ? "s" : ""} · ${(deal as any).deliverableMode === "any_one" ? "any one" : "all required"}` },
              ] as const).map((f) => (
                <div key={f.label} className="rounded-xl border border-border/60 bg-card/40 px-3.5 py-3 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="text-xs text-muted-foreground">{f.label}</p>
                    <f.icon className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </div>
                  <p className="font-semibold text-sm leading-snug">{f.value}</p>
                </div>
              ))}
            </div>

            <NextStepSuggestion dealId={deal.id} selfPath={`/deals/${deal.id}`} />
          </CardContent>
        </Card>
        </motion.div>

        <div className="space-y-6 lg:space-y-0 lg:grid lg:grid-cols-3 lg:gap-6 xl:gap-8 lg:items-start">
        <motion.div variants={fadeUp} className="lg:col-span-2 space-y-6">
        {/* ── Workflow: where the deal is, and the step you can take from here ── */}
        <Card className="glass-card border-0">
          <CardContent className="p-5 lg:p-6">
            <div className="flex items-center justify-between gap-3 mb-4">
              <h3 className="font-semibold">Workflow</h3>
              {position && <span className="text-xs font-medium text-muted-foreground" data-testid="text-workflow-position">{position.label}</span>}
            </div>
            {/* Shares WorkflowStepper with the agreement page */}
            <WorkflowStepper
              size="large"
              currentStep={position?.step ?? 0}
              steps={[
                { label: WORKFLOW_STEPS[0].label, step: 1, href: null },
                { label: WORKFLOW_STEPS[1].label, step: 2, href: quote ? `/deals/${deal.id}/quote` : null },
                { label: WORKFLOW_STEPS[2].label, step: 3, href: contract ? `/contracts/${contract.id}` : null },
                {
                  label: WORKFLOW_STEPS[3].label,
                  step: 4,
                  // Was pointing back at this very page. Send them to the
                  // invoice itself, or to the composer when one can be raised.
                  href: dealBrandInvoices.length
                    ? `/brand-invoices/${dealBrandInvoices[0].id}`
                    : contract && isAgreementSigned(contract) && canInvoice
                    ? `/brand-invoices/new?contractId=${contract.id}&mode=full`
                    : null,
                },
                {
                  label: WORKFLOW_STEPS[4].label,
                  step: 5,
                  // Payment is recorded on the invoice: the first one still unpaid, else the first one.
                  href: unpaidInvoice ? `/brand-invoices/${unpaidInvoice.id}` : dealBrandInvoices.length ? `/brand-invoices/${dealBrandInvoices[0].id}` : null,
                },
              ]}
            />

            <div className="mt-5">
            {/* 4-step action buttons — only shown once quote query resolves */}
            {stepsReady && (
              <div className="space-y-2">
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
                {hasContract && !isSigned && (
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
                          Get it signed
                        </Button>
                      </Link>
                    )}
                  </div>
                )}

                {/* Step 3 → 4: Generate Invoice for Brand (Pro feature) */}
                {hasContract && isSigned && !hasInvoice && canInvoice && !hasProAccess(user) && (
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
                {hasContract && isSigned && !hasInvoice && canInvoice && hasProAccess(user) && (
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
            </div>
          </CardContent>
        </Card>

        {/* ── Email: the lead and conversation this deal came from (only for a deal won from a lead) ── */}
        <DealEmailActivity dealId={deal.id} locale={fmt.locale} />

        {/* ── Financial Summary + Deal Information (real data only) ── */}
        <div className="grid sm:grid-cols-2 gap-6">
          <Card className="glass-card border-0">
            <CardContent className="p-5">
              {(() => {
                // Every total here is MINOR units: integers add exactly, and
                // the percentage below stays a true ratio at any scale.
                const totalInvoicedMinor = dealBrandInvoices.reduce((sum, i) => sum + Number(i.dealAmountMinor || 0), 0);
                const paidMinor = dealBrandInvoices.filter((i) => i.status === "Paid").reduce((sum, i) => sum + Number(i.dealAmountMinor || 0), 0);
                const now = Date.now();
                const overdueMinor = dealBrandInvoices
                  .filter((i) => i.status !== "Paid" && i.dueDate && new Date(i.dueDate as any).getTime() < now)
                  .reduce((sum, i) => sum + Number(i.dealAmountMinor || 0), 0);
                const pendingMinor = totalInvoicedMinor - paidMinor - overdueMinor;
                const pct = deal.dealAmountMinor > 0 ? Math.min(100, Math.round((totalInvoicedMinor / deal.dealAmountMinor) * 100)) : 0;
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
                            <p className="font-bold text-lg tabular-nums">{fmt.money(deal.dealAmountMinor)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Total Invoiced</p>
                            <p className="font-bold text-lg tabular-nums">{fmt.money(totalInvoicedMinor)}</p>
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
                            { label: "Paid", value: paidMinor, dot: "bg-emerald-500", cls: "text-emerald-600 dark:text-emerald-400" },
                            { label: "Pending", value: pendingMinor, dot: "bg-amber-500", cls: "text-amber-600 dark:text-amber-400" },
                            { label: "Overdue", value: overdueMinor, dot: "bg-rose-500", cls: "text-rose-600 dark:text-rose-400" },
                          ] as const).map((t) => (
                            <div key={t.label} className="rounded-lg border border-border/60 p-2.5 min-w-0">
                              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                <span className={`w-1.5 h-1.5 rounded-full ${t.dot}`} /> {t.label}
                              </p>
                              <p className={`font-bold text-sm tabular-nums mt-0.5 truncate ${t.cls}`}>{fmt.money(t.value)}</p>
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
                {deal.engagementModel && (
                  <div className="flex items-center justify-between gap-3" data-testid="row-engagement-model">
                    <dt className="text-muted-foreground">Engagement</dt>
                    <dd className="font-medium text-right">{engagementLabel(deal.engagementModel, deal.engagementTerms)}</dd>
                  </div>
                )}
                {deal.serviceCategory && (
                  <div className="flex items-center justify-between gap-3" data-testid="row-service-category">
                    <dt className="text-muted-foreground">Service</dt>
                    <dd className="font-medium text-right">{serviceLabel(deal.serviceCategory)}</dd>
                  </div>
                )}
                {engagementDetailRows(deal.engagementModel, deal.engagementTerms, fmt.money).map((r, i) => (
                  <div key={`${r.label}-${i}`} className="flex items-start justify-between gap-3">
                    <dt className="text-muted-foreground shrink-0">{r.label}</dt>
                    <dd className="font-medium text-right break-words min-w-0">{r.value}</dd>
                  </div>
                ))}
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Start Date</dt>
                  <dd className="font-medium">{formatDate(deal.startDate)}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">{engagementModelMeta(deal.engagementModel)?.kind === "recurring" ? "End of first term" : "End Date"}</dt>
                  <dd className="font-medium">{formatDate(deal.endDate)}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Status</dt>
                  <dd><AnimatedStatusBadge status={deal.status} size="compact" /></dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </div>

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
        </motion.div>

        <motion.div variants={fadeUp} className="lg:col-span-1 space-y-6">
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

        <DealIntelCards dealId={deal.id} existingTerms={(deal as any).customTerms ?? ""} />
        </motion.div>
        </div>
      </motion.main>

      <BottomNav />
    </div>
  );
}


// ─── Deal intelligence ───────────────────────────────────────────────────────
// Health score + next best action from the deterministic server engine
// (server/copilot/insights.ts) — every point traces to a visible signal.
interface DealIntel {
  health: { score: number; grade: string; signals: { label: string; state: "good" | "warn" | "bad"; detail: string }[] };
  nextAction: { action: string; route: string; urgency: "red" | "yellow" | "green" } | null;
  protection?: {
    flags: { id: string; severity: "risk" | "gap"; level: Finding["level"]; title: string; detail: string; why: string; ask: string; suggestedTerm?: string }[];
    passes: string[];
    risks: number;
    gaps: number;
  };
  dealStatus?: string;
}

/** One cached read shared by the header's suggestion and the rail's cards. */
function useDealIntel(dealId: number) {
  return useQuery<DealIntel>({ queryKey: [`/api/copilot/deal-intel/${dealId}`], staleTime: 30_000 });
}

/**
 * The header's suggested next step: the server's deterministic next best
 * action, worded as what it is — a suggestion. Nothing shows while it loads
 * (beyond a placeholder line), when it fails, or when there is nothing to do.
 * "Mark the deal completed" points at this very page, so it gets no link: the
 * Mark as Completed button in the workflow card is that action.
 */
function NextStepSuggestion({ dealId, selfPath }: { dealId: number; selfPath: string }) {
  const { data, isLoading } = useDealIntel(dealId);
  if (isLoading) {
    return (
      <div className="mt-4 pt-4 border-t border-border/60 space-y-1.5" aria-hidden="true">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }
  const next = data?.nextAction;
  if (!next) return null;
  const dot = next.urgency === "red" ? "bg-rose-500" : next.urgency === "yellow" ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="mt-4 pt-4 border-t border-border/60 flex flex-col gap-3 sm:flex-row sm:items-center" data-testid="next-step-suggestion">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
          Suggested next step
        </p>
        <p className="mt-1 flex items-start gap-2 text-sm font-semibold">
          <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
          <span>{next.action}</span>
        </p>
        <p className="mt-0.5 pl-3.5 text-xs text-muted-foreground">A suggestion from this deal's records. You decide.</p>
      </div>
      {next.route !== selfPath && (
        <Link href={next.route} className="shrink-0">
          <Button size="sm" className="h-9 w-full sm:w-auto font-semibold gradient-btn text-white" data-testid="button-next-step">
            Open <ChevronRight className="w-4 h-4 ml-1" aria-hidden="true" />
          </Button>
        </Link>
      )}
    </div>
  );
}

/** The rail: Deal health and the Protection Check. */
function DealIntelCards({ dealId, existingTerms }: { dealId: number; existingTerms: string }) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [suggested, setSuggested] = useState<string | null>(null);
  const { data } = useDealIntel(dealId);

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
      // The deal's own query is ["/api/deals", id] — a prefix covers it, the
      // list, and the quotation (editing terms marks a draft quote revised).
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      queryClient.invalidateQueries({ queryKey: [`/api/copilot/deal-intel/${dealId}`] });
    },
    onError: () => toast({ title: "Couldn't update the terms", description: "Only pending deals can be edited.", variant: "destructive" }),
  });

  // Viewed once per deal when the check has loaded: how many findings, never which text.
  const viewedFor = useRef<number | null>(null);
  useEffect(() => {
    const p = data?.protection;
    if (!p || viewedFor.current === dealId) return;
    viewedFor.current = dealId;
    trackEvent("protection_check_viewed", {
      flags: p.flags.length,
      important: p.flags.filter((f) => f.level === "important").length,
      surface: "deal_page",
    });
  }, [data?.protection, dealId]);

  if (!data) return null;
  const { health, nextAction, protection } = data;
  const canEdit = data.dealStatus === "Pending";
  const scoreCls = health.score >= 80 ? "text-emerald-600 dark:text-emerald-400" : health.score >= 55 ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400";
  const ringCls = health.score >= 80 ? "border-emerald-500/50" : health.score >= 55 ? "border-amber-500/50" : "border-rose-500/50";
  return (
    <>
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

      {protection && (() => {
        const findings: Finding[] = protection.flags.map((f) => ({
          id: f.id, level: f.level, title: f.title, why: f.why, ask: f.ask, suggestedTerm: f.suggestedTerm,
        }));
        const hasImportant = findings.some((f) => f.level === "important");
        const hasAttention = findings.some((f) => f.level === "attention");
        return (
          <Card className={`glass-card border ${hasImportant ? "border-rose-300/50 dark:border-rose-900/50" : hasAttention ? "border-amber-300/50 dark:border-amber-900/50" : "border-emerald-300/50 dark:border-emerald-800/50"}`}>
            <CardContent className="p-4">
              <ProtectionFindings
                findings={findings}
                passes={protection.passes}
                // "Fix these" opens the existing suggest → review → add flow, so
                // nothing is written to the deal without being read first.
                onFix={suggested === null && protection.gaps > 0 ? () => { trackEvent("protection_issue_opened", { action: "fix", surface: "deal_page" }); suggest.mutate(); } : undefined}
                fixing={suggest.isPending}
                onContinue={nextAction ? () => setLocation(nextAction.route) : undefined}
              />
              {suggested !== null && (
                <div className="mt-3 rounded-lg border border-border/60 bg-muted/40 p-2.5">
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
            </CardContent>
          </Card>
        );
      })()}
    </>
  );
}
