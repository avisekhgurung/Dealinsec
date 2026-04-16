import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams, Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ArrowLeft, Shield, AlertTriangle, PenLine, Loader2, CreditCard, CheckCircle } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { CreditAnimationOverlay } from "@/components/credit-animation-overlay";
import type { Deal } from "@shared/schema";

type Phase = "reserving" | "creating" | "done";

export default function ContractConfirmationPage() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const [agreed, setAgreed] = useState(false);
  const [billingAddress, setBillingAddress] = useState("");
  const [panNumber, setPanNumber] = useState("");
  const [overlayPhase, setOverlayPhase] = useState<Phase>("reserving");
  const [showOverlay, setShowOverlay] = useState(false);
  const [contractId, setContractId] = useState<number | null>(null);

  const credits = user?.contractCredits ?? 0;
  const hasCredits = credits >= 1;
  const needsBillingAddress = !user?.billingAddress;
  const needsPan = !user?.panNumber;

  const { data: deal, isLoading } = useQuery<Deal>({
    queryKey: ["/api/deals", params.id],
  });

  const updateProfile = useMutation({
    mutationFn: async (profileData: { billingAddress?: string; panNumber?: string }) => {
      const res = await apiRequest("PATCH", "/api/profile", profileData);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    },
  });

  const createContract = useMutation({
    mutationFn: async () => {
      if (!deal) throw new Error("Deal not found");

      // Phase 1: reserving credit (show overlay immediately)
      setOverlayPhase("reserving");
      setShowOverlay(true);

      // Save missing profile fields
      const profileUpdates: { billingAddress?: string; panNumber?: string } = {};
      if (needsBillingAddress && billingAddress.trim()) profileUpdates.billingAddress = billingAddress.trim();
      if (needsPan && panNumber.trim()) profileUpdates.panNumber = panNumber.trim();
      if (Object.keys(profileUpdates).length > 0) await updateProfile.mutateAsync(profileUpdates);

      // Brief pause so user sees the "Reserving" phase
      await new Promise(r => setTimeout(r, 900));

      // Phase 2: creating agreement
      setOverlayPhase("creating");

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

      // Phase 3: done!
      setOverlayPhase("done");
      setContractId(contract.id);
    },
    onError: async (error: any) => {
      setShowOverlay(false);
      if (error?.message?.includes("402") || error?.status === 402) {
        toast({
          title: "Insufficient Credits",
          description: "You need at least 1 agreement credit. Please purchase credits.",
          variant: "destructive",
        });
        queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      } else {
        toast({
          title: "Error",
          description: "Failed to create agreement. Please try again.",
          variant: "destructive",
        });
      }
    },
  });

  // Auto-navigate after "done" phase is shown for ~1.5s
  useEffect(() => {
    if (overlayPhase === "done" && contractId !== null) {
      const t = setTimeout(() => {
        setShowOverlay(false);
        setTimeout(() => setLocation(`/contracts/${contractId}`), 300);
      }, 1600);
      return () => clearTimeout(t);
    }
  }, [overlayPhase, contractId]);

  const canSubmit =
    agreed &&
    !createContract.isPending &&
    hasCredits &&
    (!needsBillingAddress || billingAddress.trim().length > 0) &&
    (!needsPan || panNumber.trim().length > 0);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <header className="glass-header sticky top-0 z-40">
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
    <>
      {/* Credit consumption overlay */}
      <CreditAnimationOverlay
        show={showOverlay}
        phase={overlayPhase}
        creditsAfter={Math.max(0, credits - 1)}
      />

      <div className="min-h-screen bg-background">
        <header className="glass-header sticky top-0 z-40">
          <div className="flex items-center gap-3 px-4 py-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setLocation(`/deals/${params.id}`)}
              data-testid="button-back-deal"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <h1 className="text-xl font-bold">Create Agreement</h1>

            {/* Credit pill in header */}
            <div className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800">
              <span className="text-sm font-black text-amber-500">₹</span>
              <span className="text-sm font-bold text-amber-700 dark:text-amber-300">{credits}</span>
              <span className="text-xs text-amber-600/70 dark:text-amber-400/70">
                {credits === 1 ? "credit" : "credits"}
              </span>
            </div>
          </div>
        </header>

        <main className="px-4 py-8 space-y-6 max-w-lg mx-auto animate-fade-in">

          {/* 4-step timeline */}
          <div className="flex items-center justify-between px-2">
            {/* Step 1 — done */}
            <div className="flex flex-col items-center gap-1">
              <div className="w-8 h-8 rounded-full bg-emerald-500 shadow-sm shadow-emerald-200 flex items-center justify-center">
                <CheckCircle className="w-4 h-4 text-white" />
              </div>
              <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Deal</span>
            </div>
            <div className="flex-1 h-0.5 bg-emerald-400 mx-1" />
            {/* Step 2 — done */}
            <div className="flex flex-col items-center gap-1">
              <div className="w-8 h-8 rounded-full bg-emerald-500 shadow-sm shadow-emerald-200 flex items-center justify-center">
                <CheckCircle className="w-4 h-4 text-white" />
              </div>
              <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Quote</span>
            </div>
            <div className="flex-1 h-0.5 bg-amber-300 mx-1" />
            {/* Step 3 — active */}
            <div className="flex flex-col items-center gap-1">
              <div className="w-8 h-8 rounded-full bg-amber-400 ring-2 ring-amber-300/50 shadow-sm shadow-amber-200 flex items-center justify-center">
                <span className="w-2.5 h-2.5 rounded-full bg-white" />
              </div>
              <span className="text-xs font-bold text-amber-600 dark:text-amber-400">Agreement</span>
            </div>
            <div className="flex-1 h-0.5 bg-muted mx-1" />
            {/* Step 4 — upcoming */}
            <div className="flex flex-col items-center gap-1">
              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                <span className="text-xs font-bold text-muted-foreground">4</span>
              </div>
              <span className="text-xs text-muted-foreground">Invoice</span>
            </div>
          </div>

          {/* Credit usage card */}
          <div className="relative overflow-hidden rounded-2xl border border-amber-200/60 dark:border-amber-800/40"
            style={{ background: "linear-gradient(135deg, hsl(45 100% 97%) 0%, hsl(35 100% 94%) 100%)" }}>
            <div className="dark:hidden absolute inset-0" style={{ background: "linear-gradient(135deg, hsl(45 100% 97%) 0%, hsl(35 100% 94%) 100%)" }} />
            <div className="hidden dark:block absolute inset-0" style={{ background: "linear-gradient(135deg, hsl(30 30% 10%) 0%, hsl(25 20% 8%) 100%)" }} />
            <div className="relative px-5 py-4 flex items-center gap-4">
              {/* Animated coin */}
              <div className="relative flex-shrink-0">
                <div className="absolute inset-0 rounded-full bg-amber-300/40 animate-ping" style={{ animationDuration: "2s" }} />
                <div className="relative w-12 h-12 rounded-full bg-gradient-to-br from-amber-300 via-yellow-400 to-amber-500 shadow-md shadow-amber-400/40 flex items-center justify-center border border-amber-200/60">
                  <div className="absolute top-1 left-2 w-3 h-1 rounded-full bg-white/40 rotate-[-30deg]" />
                  <span className="text-xl font-black text-amber-900">₹</span>
                </div>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-black text-amber-700 dark:text-amber-300 tabular-nums">{credits}</span>
                  <span className="text-sm text-amber-600/70 dark:text-amber-400/60">
                    {credits === 1 ? "credit available" : "credits available"}
                  </span>
                </div>
                <p className="text-xs text-amber-700/70 dark:text-amber-400/60 mt-0.5">
                  1 credit will be used to create this agreement
                </p>
              </div>

              {/* Arrow indicator */}
              <div className="flex-shrink-0 text-right">
                <div className="text-xs font-semibold text-amber-600 dark:text-amber-400">-1</div>
                <div className="text-lg font-black text-amber-700 dark:text-amber-300 tabular-nums">
                  {Math.max(0, credits - 1)}
                </div>
                <div className="text-[10px] text-amber-500/70 dark:text-amber-500/60">after</div>
              </div>
            </div>
          </div>

          <div className="text-center space-y-3">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mx-auto">
              <Shield className="w-8 h-8 text-primary" />
            </div>
            <h2 className="text-xl font-bold">Exclusive Agreement</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              You're about to create an exclusive agreement with{" "}
              <span className="font-semibold text-foreground">{deal.brandName}</span>
            </p>
          </div>

          {!hasCredits && (
            <Card className="border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-950/20">
              <CardContent className="p-4">
                <div className="flex gap-3">
                  <CreditCard className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                  <div className="space-y-2">
                    <p className="font-semibold text-red-900 dark:text-red-200">No Credits Available</p>
                    <p className="text-sm text-red-800 dark:text-red-300 leading-relaxed">
                      Purchase at least 1 agreement credit to continue.
                    </p>
                    <Link href={`/pricing?redirect=/deals/${params.id}/contract`}>
                      <Button size="sm" className="mt-1 gradient-btn text-white" data-testid="button-buy-credits">
                        <CreditCard className="w-4 h-4 mr-2" />
                        Buy Credits
                      </Button>
                    </Link>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="glass-card border-amber-200/50 dark:border-amber-900/40 bg-amber-50/30 dark:bg-amber-950/10">
            <CardContent className="p-4">
              <div className="flex gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-amber-900 dark:text-amber-200 text-sm">Important Notice</p>
                  <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed mt-0.5">
                    This is an <strong>EXCLUSIVE AGREEMENT</strong>. All brand deals during
                    this period must be registered on this platform.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card border-0">
            <CardContent className="p-5 space-y-3">
              <h3 className="font-semibold text-sm">Agreement Details</h3>
              <div className="space-y-2.5 text-sm">
                {[
                  { label: "Brand", value: deal.brandName },
                  { label: "Deal", value: deal.dealTitle },
                  { label: "Value", value: `₹${Number(deal.dealAmount).toLocaleString("en-IN")}`, bold: true },
                  {
                    label: "Period",
                    value: `${new Date(deal.startDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} – ${new Date(deal.endDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`,
                  },
                  { label: "Deliverables", value: `${deal.deliverables.length} items` },
                ].map(({ label, value, bold }) => (
                  <div key={label} className="flex justify-between gap-4">
                    <span className="text-muted-foreground">{label}</span>
                    <span className={bold ? "font-bold text-primary" : "font-medium text-right"}>{value}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {(needsBillingAddress || needsPan) && (
            <Card className="glass-card border-0">
              <CardContent className="p-5 space-y-4">
                <h3 className="font-semibold text-sm">Complete Your Profile</h3>
                <p className="text-xs text-muted-foreground">Required for the agreement document.</p>

                {needsBillingAddress && (
                  <div className="space-y-1.5">
                    <Label htmlFor="billingAddress" className="text-sm font-medium">
                      Billing Address <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="billingAddress"
                      placeholder="Enter your complete billing address"
                      value={billingAddress}
                      onChange={(e) => setBillingAddress(e.target.value)}
                      className="glass-card border-white/10"
                      data-testid="input-billing-address"
                    />
                  </div>
                )}

                {needsPan && (
                  <div className="space-y-1.5">
                    <Label htmlFor="panNumber" className="text-sm font-medium">
                      PAN Number <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="panNumber"
                      placeholder="e.g. ABCDE1234F"
                      value={panNumber}
                      onChange={(e) => setPanNumber(e.target.value.toUpperCase())}
                      maxLength={10}
                      className="glass-card border-white/10 uppercase"
                      data-testid="input-pan-number"
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <div className="flex items-start gap-3 p-4 rounded-xl bg-muted/40">
            <Checkbox
              id="agree"
              checked={agreed}
              onCheckedChange={(checked) => setAgreed(checked === true)}
              data-testid="checkbox-agree"
            />
            <label htmlFor="agree" className="text-sm leading-relaxed cursor-pointer select-none">
              I understand and agree to the exclusive usage terms. All my brand deals
              during this agreement period will be registered on this platform.
            </label>
          </div>

          <div className="space-y-2 pb-8">
            <Button
              className="w-full h-14 text-base font-semibold rounded-xl gradient-btn text-white"
              disabled={!canSubmit}
              onClick={() => createContract.mutate()}
              data-testid="button-sign-contract"
            >
              {createContract.isPending ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Creating Agreement…
                </>
              ) : (
                <>
                  <PenLine className="w-5 h-5 mr-2" />
                  Create Agreement
                </>
              )}
            </Button>

            <p className="text-center text-xs text-muted-foreground">
              1 credit will be deducted · ₹299 value · non-refundable
            </p>
          </div>
        </main>
      </div>
    </>
  );
}
