import { useState, useEffect, useRef } from "react";
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
import { ArrowLeft, Shield, AlertTriangle, PenLine, Loader2, CreditCard, CheckCircle, Upload, FileText, Plus, Trash2, Crown } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { CreditAnimationOverlay } from "@/components/credit-animation-overlay";
import { trackEvent } from "@/lib/analytics";
import { STANDARD_TERMS, hasActivePro } from "@shared/schema";
import type { Deal, Contract } from "@shared/schema";
import { useUpgradeModal } from "@/components/upgrade-modal";
import { parseApiError, isUpgradeError } from "@/lib/api-error";

type Phase = "reserving" | "creating" | "done";

export default function ContractConfirmationPage() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const { openUpgradeModal } = useUpgradeModal();
  const [agreed, setAgreed] = useState(false);
  const [billingAddress, setBillingAddress] = useState("");
  const [panNumber, setPanNumber] = useState("");
  const [signaturePreview, setSignaturePreview] = useState<string | null>(null);
  const [signatureFile, setSignatureFile] = useState<File | null>(null);
  const signatureInputRef = useRef<HTMLInputElement>(null);
  const [overlayPhase, setOverlayPhase] = useState<Phase>("reserving");
  const [showOverlay, setShowOverlay] = useState(false);
  const [contractId, setContractId] = useState<number | null>(null);

  // Terms & Conditions — seeded from the deal, editable before the agreement is
  // created. Saved back to the deal so they carry into the agreement PDF.
  const [standardTermIds, setStandardTermIds] = useState<string[]>([]);
  const [customTermsList, setCustomTermsList] = useState<string[]>([""]);
  const [termsInitialized, setTermsInitialized] = useState(false);

  // Agreements are a Pro feature in the subscription-first model. This page's
  // entry point (deal-details) is already gated; this is defense-in-depth.
  const proActive = hasActivePro(user);
  const needsBillingAddress = !user?.billingAddress;
  const needsPan = !user?.panNumber;
  const needsSignature = !user?.digitalSignature;

  const { data: deal, isLoading } = useQuery<Deal>({
    queryKey: ["/api/deals", params.id],
  });

  // One deal → one agreement. If this deal already has a contract, we block
  // creating another (and never charge a second credit).
  const { data: contracts = [] } = useQuery<Contract[]>({
    queryKey: ["/api/contracts"],
  });
  const existingContract = contracts.find((c) => c.dealId === Number(params.id));

  // Seed the terms editor from the deal once it loads (standard terms default
  // to all selected, matching the deal-creation behaviour).
  useEffect(() => {
    if (!deal || termsInitialized) return;
    const ids = ((deal as any).standardTermIds as string[] | null) ?? STANDARD_TERMS.map((t) => t.id);
    setStandardTermIds(ids);
    const raw = ((deal as any).customTerms as string | null) ?? "";
    const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
    setCustomTermsList(lines.length ? lines : [""]);
    setTermsInitialized(true);
  }, [deal, termsInitialized]);

  const updateProfile = useMutation({
    mutationFn: async (profileData: { billingAddress?: string; panNumber?: string; digitalSignature?: string }) => {
      const res = await apiRequest("PATCH", "/api/profile", profileData);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    },
  });

  const handleSignatureSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid file", description: "Upload an image (PNG/JPG).", variant: "destructive" });
      return;
    }
    setSignatureFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setSignaturePreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const createContract = useMutation({
    mutationFn: async () => {
      if (!deal) throw new Error("Deal not found");

      // Phase 1: reserving credit (show overlay immediately)
      setOverlayPhase("reserving");
      setShowOverlay(true);

      // Upload signature if provided
      let digitalSignaturePath: string | undefined;
      if (needsSignature && signatureFile) {
        const formData = new FormData();
        formData.append("signature", signatureFile);
        const uploadRes = await fetch("/api/profile/signature", {
          method: "POST",
          body: formData,
          credentials: "include",
        });
        if (!uploadRes.ok) throw new Error("Failed to upload signature");
        const uploadData = await uploadRes.json();
        digitalSignaturePath = uploadData.path;
      }

      // Save missing profile fields
      const profileUpdates: { billingAddress?: string; panNumber?: string; digitalSignature?: string } = {};
      if (needsBillingAddress && billingAddress.trim()) profileUpdates.billingAddress = billingAddress.trim();
      if (needsPan && panNumber.trim()) profileUpdates.panNumber = panNumber.trim();
      if (digitalSignaturePath) profileUpdates.digitalSignature = digitalSignaturePath;
      if (Object.keys(profileUpdates).length > 0) await updateProfile.mutateAsync(profileUpdates);

      // Persist the (possibly edited) terms onto the deal so they carry into
      // the agreement PDF — the deal is the single source of truth for terms.
      // Non-fatal: a terms-save hiccup must never block the agreement itself.
      try {
        const customTerms = customTermsList.map((t) => t.trim()).filter(Boolean).join("\n");
        await apiRequest("PATCH", `/api/deals/${deal.id}`, {
          standardTermIds,
          customTerms,
        });
      } catch (err) {
        console.warn("Failed to save agreement terms to deal (continuing):", err);
      }

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
      // Key conversion event: an agreement was signed (a core Pro action).
      trackEvent("sign_agreement", {
        contract_value: contract?.contractValue,
      });
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
      const parsed = parseApiError(error);
      if (isUpgradeError(parsed)) {
        openUpgradeModal({ feature: "agreements" });
        queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      } else if (error?.message?.includes("409")) {
        // Deal already has an agreement (e.g. created in another tab). No credit
        // was charged — send the user to the existing agreement.
        toast({
          title: "Agreement already exists",
          description: "This deal already has an agreement, so no new one was created.",
        });
        queryClient.invalidateQueries({ queryKey: ["/api/contracts"] });
        setLocation(`/deals/${params.id}`);
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
    proActive &&
    (!needsBillingAddress || billingAddress.trim().length > 0) &&
    (!needsPan || panNumber.trim().length > 0) &&
    (!needsSignature || !!signatureFile);

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

  // This deal already has an agreement — block creating a duplicate (and a
  // second credit charge). Point the user to the existing one instead.
  if (existingContract) {
    return (
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
            <h1 className="text-xl lg:text-lg font-bold lg:font-semibold">Create Agreement</h1>
          </div>
        </header>
        <main className="px-4 py-8 max-w-lg mx-auto animate-fade-in">
          <Card className="glass-card border-0">
            <CardContent className="p-6 text-center space-y-4">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-100 dark:bg-emerald-900/30 mx-auto">
                <CheckCircle className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold">Agreement already created</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  This deal already has an agreement — a deal can have only one.
                </p>
              </div>
              <div className="flex flex-col gap-2 pt-2">
                <Button
                  className="w-full h-12 rounded-xl gradient-btn text-white"
                  onClick={() => setLocation(`/contracts/${existingContract.id}`)}
                  data-testid="button-view-existing-agreement"
                >
                  View Agreement
                </Button>
                <Button
                  variant="outline"
                  className="w-full h-12 rounded-xl"
                  onClick={() => setLocation(`/deals/${params.id}`)}
                >
                  Back to Deal
                </Button>
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <>
      {/* Credit consumption overlay — Pro users spend nothing */}
      <CreditAnimationOverlay
        show={showOverlay}
        phase={overlayPhase}
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
            <h1 className="text-xl lg:text-lg font-bold lg:font-semibold">Create Agreement</h1>

            {/* Pro pill in header — agreements are a Pro feature */}
            <div className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-violet-50 dark:bg-violet-950/40 border border-violet-200 dark:border-violet-800">
              <Crown className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
              <span className="text-sm font-bold text-violet-700 dark:text-violet-300">Pro</span>
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

          {/* Pro coverage card — agreements are included in the subscription */}
          {proActive && (
            <div className="relative overflow-hidden rounded-2xl border border-violet-200/60 dark:border-violet-800/40">
              <div className="dark:hidden absolute inset-0" style={{ background: "linear-gradient(135deg, hsl(255 100% 98%) 0%, hsl(245 90% 95%) 100%)" }} />
              <div className="hidden dark:block absolute inset-0" style={{ background: "linear-gradient(135deg, hsl(255 25% 12%) 0%, hsl(245 20% 9%) 100%)" }} />
              <div className="relative px-5 py-4 flex items-center gap-4">
                <div className="relative flex-shrink-0">
                  <div className="absolute inset-0 rounded-full bg-violet-300/40 animate-ping" style={{ animationDuration: "2s" }} />
                  <div className="relative w-12 h-12 rounded-full bg-gradient-to-br from-violet-400 via-violet-500 to-indigo-600 shadow-md shadow-violet-400/40 flex items-center justify-center border border-violet-300/60">
                    <Crown className="w-6 h-6 text-white" />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-base font-bold text-violet-800 dark:text-violet-300">
                    Included in DealInSec Pro
                  </p>
                  <p className="text-xs text-violet-700/70 dark:text-violet-400/60 mt-0.5">
                    Unlimited agreements on your plan
                  </p>
                </div>
                <div className="flex-shrink-0 text-right">
                  <div className="text-xs font-semibold text-violet-600 dark:text-violet-400">cost</div>
                  <div className="text-lg font-black text-violet-700 dark:text-violet-300">₹0</div>
                </div>
              </div>
            </div>
          )}

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

          {!proActive && (
            <Card className="border-violet-200 dark:border-violet-900/50 bg-violet-50/50 dark:bg-violet-950/20">
              <CardContent className="p-4">
                <div className="flex gap-3">
                  <Crown className="w-5 h-5 text-violet-600 dark:text-violet-400 flex-shrink-0 mt-0.5" />
                  <div className="space-y-2">
                    <p className="font-semibold text-violet-900 dark:text-violet-200">Agreements are a Pro feature</p>
                    <p className="text-sm text-violet-800 dark:text-violet-300 leading-relaxed">
                      Upgrade to DealInSec Pro to create unlimited signed agreements, invoices and payment tracking.
                    </p>
                    <Button
                      size="sm"
                      className="mt-1 text-white bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700"
                      onClick={() => openUpgradeModal({ feature: "agreements" })}
                      data-testid="button-upgrade-pro"
                    >
                      <Crown className="w-4 h-4 mr-2" />
                      Upgrade to Pro
                    </Button>
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

          {(needsBillingAddress || needsPan || needsSignature) && (
            <Card className="glass-card border-0">
              <CardContent className="p-5 space-y-4">
                <h3 className="font-semibold text-sm">Complete Your Profile</h3>
                <p className="text-xs text-muted-foreground">Required for the agreement document — saved to your profile so we won't ask again.</p>

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

                {needsSignature && (
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium">
                      Digital Signature <span className="text-red-500">*</span>
                    </Label>
                    <div className="border-2 border-dashed border-border rounded-lg p-3">
                      {signaturePreview ? (
                        <div className="space-y-2">
                          <div className="rounded bg-white flex items-center justify-center p-2">
                            <img src={signaturePreview} alt="Signature preview" className="max-h-16 object-contain" />
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="w-full"
                            onClick={() => {
                              setSignaturePreview(null);
                              setSignatureFile(null);
                              if (signatureInputRef.current) signatureInputRef.current.value = "";
                            }}
                          >
                            Replace
                          </Button>
                        </div>
                      ) : (
                        <div className="text-center space-y-1.5 py-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => signatureInputRef.current?.click()}
                            data-testid="button-upload-signature"
                          >
                            <Upload className="w-3.5 h-3.5 mr-2" />
                            Upload signature
                          </Button>
                          <p className="text-[11px] text-muted-foreground">PNG or JPG — appears on the agreement PDF</p>
                          <input
                            ref={signatureInputRef}
                            type="file"
                            accept="image/*"
                            onChange={handleSignatureSelect}
                            className="hidden"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* ── Terms & Conditions — editable before creating the agreement ── */}
          <Card className="glass-card border-0">
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-primary" />
                <h3 className="font-semibold text-sm">Terms &amp; Conditions</h3>
              </div>
              <p className="text-xs text-muted-foreground -mt-2">
                These appear on the agreement PDF. Adjust the standard terms or add your own below.
              </p>

              <div className="space-y-2.5">
                {STANDARD_TERMS.map((t) => {
                  const checked = standardTermIds.includes(t.id);
                  return (
                    <label
                      key={t.id}
                      htmlFor={`cterm-${t.id}`}
                      className="flex items-start gap-3 p-3 rounded-lg border border-border/60 bg-background/60 hover:border-primary/40 transition-colors cursor-pointer"
                    >
                      <Checkbox
                        id={`cterm-${t.id}`}
                        checked={checked}
                        onCheckedChange={(next) => {
                          setStandardTermIds((cur) =>
                            next ? Array.from(new Set([...cur, t.id])) : cur.filter((id) => id !== t.id),
                          );
                        }}
                        className="mt-0.5"
                        data-testid={`checkbox-agreement-term-${t.id}`}
                      />
                      <span className="text-sm leading-relaxed">{t.label}</span>
                    </label>
                  );
                })}
              </div>

              <div className="space-y-3 pt-2 border-t border-border/60">
                <div>
                  <Label className="text-xs font-semibold">Your own terms (optional)</Label>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Add clauses specific to this agreement — exclusivity, usage rights, posting schedule, revisions, etc.
                  </p>
                </div>

                <div className="space-y-2">
                  {customTermsList.map((term, i) => (
                    <div key={i} className="flex gap-2 items-start">
                      <span className="flex-shrink-0 w-6 h-9 flex items-center justify-center text-xs font-semibold text-muted-foreground tabular-nums">
                        {i + 1}.
                      </span>
                      <div className="flex-1">
                        <Input
                          value={term}
                          onChange={(e) =>
                            setCustomTermsList((cur) => cur.map((t, j) => (j === i ? e.target.value : t)))
                          }
                          placeholder={i === 0 ? "e.g. Content must be posted by 5pm IST" : "Add another clause"}
                          className="h-9"
                          data-testid={`input-agreement-custom-term-${i}`}
                        />
                      </div>
                      {customTermsList.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 flex-shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => setCustomTermsList((cur) => cur.filter((_, j) => j !== i))}
                          aria-label={`Remove term ${i + 1}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full h-9 border-dashed"
                  onClick={() => setCustomTermsList((cur) => [...cur, ""])}
                  data-testid="button-add-agreement-custom-term"
                >
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Add another term
                </Button>
              </div>
            </CardContent>
          </Card>

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
              {proActive
                ? "Included in your Pro plan · unlimited agreements"
                : "Requires DealInSec Pro"}
            </p>
          </div>
        </main>
      </div>
    </>
  );
}
