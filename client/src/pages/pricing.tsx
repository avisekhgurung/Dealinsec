import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, CreditCard, Check, Loader2, Zap, ArrowRight, Shield, Lock, Sparkles, TrendingUp, Users, Star, Crown, Infinity as InfinityIcon } from "lucide-react";
import { hasActivePro } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useLocation, Link } from "wouter";
import { BottomNav } from "@/components/bottom-nav";
import { queryClient } from "@/lib/queryClient";
import { trackEvent } from "@/lib/analytics";
import { PaymentResult } from "@/components/payment-result";

const REDIRECT_KEY = "postPaymentRedirect";
const RAZORPAY_SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";

declare global {
  interface Window {
    Razorpay?: any;
  }
}

// Lazily inject the Razorpay Checkout script once.
function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const existing = document.querySelector(`script[src="${RAZORPAY_SCRIPT}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(true));
      existing.addEventListener("error", () => resolve(false));
      return;
    }
    const script = document.createElement("script");
    script.src = RAZORPAY_SCRIPT;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export default function PricingPage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<"success" | "error" | null>(null);
  const [paymentErrorReason, setPaymentErrorReason] = useState<string>("");
  const [redirectAfter, setRedirectAfter] = useState<string | null>(null);

  // Live pricing — driven by server CREDIT_VALUE / PRO_PLAN_PRICE env vars
  const [creditPrice, setCreditPrice] = useState<number>(299);
  const [anchorPrice, setAnchorPrice] = useState<number | null>(599);
  const [proPlanPrice, setProPlanPrice] = useState<number>(2999);
  // Which product the in-flight purchase is for — drives success copy.
  const [purchaseKind, setPurchaseKind] = useState<"credit" | "pro">("credit");
  useEffect(() => {
    fetch("/api/payments/config", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => {
        if (cfg?.creditPrice) {
          setCreditPrice(cfg.creditPrice);
          setAnchorPrice(cfg.anchorPrice ?? null);
        }
        if (cfg?.proPlanPrice) setProPlanPrice(cfg.proPlanPrice);
      })
      .catch(() => {});
  }, []);
  const fmt = (n: number) => `₹${n.toLocaleString("en-IN")}`;
  const savings = anchorPrice ? anchorPrice - creditPrice : 0;

  const proActive = hasActivePro(user);
  const proExpiry = user?.planExpiresAt ? new Date(user.planExpiresAt) : null;
  const proExpiryLabel = proExpiry
    ? proExpiry.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
    : null;
  // "Pays for itself" break-even vs single credits
  const breakEven = Math.max(2, Math.ceil(proPlanPrice / Math.max(1, creditPrice)));
  const proMonthly = Math.round(proPlanPrice / 12);

  // On mount: persist ?redirect= param and detect PayU callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const redirectParam = params.get("redirect");
    if (redirectParam) {
      localStorage.setItem(REDIRECT_KEY, redirectParam);
    }

    if (params.get("success") === "true") {
      setPaymentStatus("success");
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/credits/balance"] });
      toast({ title: "Payment successful!", description: "Your credit has been added.", variant: "success" as any });
      window.history.replaceState({}, "", "/pricing");

      // Check if we should redirect back somewhere
      const savedRedirect = localStorage.getItem(REDIRECT_KEY);
      if (savedRedirect) {
        setRedirectAfter(savedRedirect);
        localStorage.removeItem(REDIRECT_KEY);
      }
    } else if (params.get("error")) {
      setPaymentStatus("error");
      toast({
        title: "Payment failed",
        description: params.get("error")?.replace(/_/g, " ") || "Please try again.",
        variant: "destructive",
      });
      window.history.replaceState({}, "", "/pricing");
    }
  }, [toast]);

  // Redirect-after-success is now handled by the PaymentResult overlay's
  // "Continue to Agreement" button (manual, no auto-navigate).

  const handlePurchase = async (kind: "credit" | "pro" = "credit") => {
    setPurchaseKind(kind);
    setIsLoading(true);
    try {
      // 1. Load Razorpay Checkout script
      const ok = await loadRazorpayScript();
      if (!ok || !window.Razorpay) {
        throw new Error("Could not load payment gateway. Check your connection and retry.");
      }

      // 2. Create order on our server
      const res = await fetch("/api/payments/razorpay/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(kind === "pro" ? { plan: "pro" } : { credits: 1 }),
        credentials: "include",
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || error.error || "Failed to initiate payment");
      }
      const order = await res.json();

      // 3. Open Razorpay Checkout (UPI QR / cards / netbanking)
      const rzp = new window.Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: order.name,
        description: order.description,
        image: "/icon-192.png",
        prefill: order.prefill,
        theme: { color: "#0E8C5A" },
        handler: async (response: any) => {
          // 4. Verify payment on our server → grants the credit
          try {
            const verifyRes = await fetch("/api/payments/razorpay/verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              }),
            });
            if (!verifyRes.ok) throw new Error("Verification failed");

            // GA4 standard ecommerce purchase event — one of the key
            // conversions. value/currency let GA compute revenue.
            trackEvent("purchase", {
              currency: "INR",
              value: kind === "pro" ? proPlanPrice : creditPrice,
              item: kind === "pro" ? "pro_annual" : "contract_credit",
            });

            setPaymentStatus("success");
            await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
            await queryClient.invalidateQueries({ queryKey: ["/api/credits/balance"] });
            toast({
              title: "Payment successful!",
              description: kind === "pro"
                ? "DealInSec Pro is active — unlimited agreements for 1 year."
                : "Your credit has been added.",
              variant: "success" as any,
            });

            const savedRedirect = localStorage.getItem(REDIRECT_KEY);
            if (savedRedirect) {
              setRedirectAfter(savedRedirect);
              localStorage.removeItem(REDIRECT_KEY);
            }
          } catch {
            toast({
              title: "Verification pending",
              description: kind === "pro"
                ? "Payment received — your Pro plan will activate shortly. Refresh in a moment."
                : "Payment received — credit will reflect shortly. Refresh in a moment.",
              variant: "destructive",
            });
          } finally {
            setIsLoading(false);
          }
        },
        modal: {
          ondismiss: () => setIsLoading(false), // user closed the checkout
        },
      });

      rzp.on("payment.failed", (resp: any) => {
        setPaymentErrorReason(resp?.error?.description || "Your payment couldn't be processed. No money was deducted — please try again.");
        setPaymentStatus("error");
        setIsLoading(false);
      });

      rzp.open();
    } catch (error: any) {
      setPaymentErrorReason(error.message || "Could not start the payment. Please try again.");
      setPaymentStatus("error");
      setIsLoading(false);
    }
  };

  const credits = user?.contractCredits ?? 0;

  return (
    <div className="min-h-screen bg-background pb-20 lg:pb-12">
      <header className="glass-header sticky top-0 z-50 px-4 py-3 flex items-center gap-3 lg:max-w-5xl lg:mx-auto lg:px-8 lg:py-5">
        <Link href="/dashboard">
          <Button variant="ghost" size="icon" data-testid="button-back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <h1 className="text-xl lg:text-2xl font-semibold flex-1">Pricing</h1>
        {/* Credit balance pill */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800">
          <span className="text-sm font-black text-amber-500">₹</span>
          <span className="text-sm font-bold text-amber-700 dark:text-amber-300">{credits}</span>
          <span className="text-xs text-amber-600/70 dark:text-amber-400/70">
            {credits === 1 ? "credit" : "credits"}
          </span>
        </div>
      </header>

      {/* Animated full-screen payment result overlay (success / failure) */}
      <PaymentResult
        state={paymentStatus}
        credits={1}
        successMessage={purchaseKind === "pro"
          ? "DealInSec Pro is active — every agreement is covered for 1 year."
          : undefined}
        chipLabel={purchaseKind === "pro" ? "Pro · Unlimited agreements" : undefined}
        errorReason={paymentErrorReason}
        continueLabel={redirectAfter ? "Continue to Agreement" : undefined}
        onContinue={redirectAfter ? () => setLocation(redirectAfter) : undefined}
        onRetry={() => {
          setPaymentStatus(null);
          handlePurchase(purchaseKind);
        }}
        onClose={() => setPaymentStatus(null)}
      />

      <main className="p-4 max-w-lg mx-auto space-y-4 animate-fade-in lg:max-w-5xl lg:px-8 lg:py-6 lg:space-y-6">

        {/* ── Balance card ── */}
        <div className="relative overflow-hidden rounded-2xl border border-amber-200/60 dark:border-amber-800/40">
          <div className="absolute inset-0 dark:hidden" style={{ background: "linear-gradient(135deg,hsl(45 100% 97%),hsl(35 100% 93%))" }} />
          <div className="absolute inset-0 hidden dark:block" style={{ background: "linear-gradient(135deg,hsl(30 30% 10%),hsl(25 20% 8%))" }} />
          <div className="relative px-5 py-4 flex items-center gap-4">
            <div className="relative shrink-0">
              <div className="absolute inset-0 rounded-full bg-amber-300/40 animate-ping" style={{ animationDuration: "2.5s" }} />
              <div className="relative w-12 h-12 rounded-full bg-gradient-to-br from-amber-300 via-yellow-400 to-amber-500 shadow-md flex items-center justify-center border border-amber-200/60">
                <div className="absolute top-1 left-2 w-3 h-1 rounded-full bg-white/40 rotate-[-30deg]" />
                <span className="text-xl font-black text-amber-900">₹</span>
              </div>
            </div>
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-black text-amber-700 dark:text-amber-300 tabular-nums">{credits}</span>
                <span className="text-sm text-amber-600/70 dark:text-amber-400/60">
                  {credits === 1 ? "credit" : "credits"} available
                </span>
              </div>
              <p className="text-xs text-amber-600/60 dark:text-amber-500/60 mt-0.5">
                1 credit = 1 professional agreement
              </p>
            </div>
          </div>
        </div>

        {/* ── DealInSec Pro — annual plan, unlimited agreements ── */}
        <Card className="glass-card border-violet-400/40 dark:border-violet-500/30 relative overflow-hidden shadow-xl shadow-violet-500/[0.1]">
          <div className="absolute inset-0 bg-gradient-to-br from-violet-500/[0.08] via-transparent to-indigo-500/[0.06] pointer-events-none" />

          {/* Best-value ribbon */}
          <div className="relative bg-gradient-to-r from-violet-600 to-indigo-600 text-white px-4 py-2 text-center">
            <div className="flex items-center justify-center gap-2 text-xs lg:text-sm font-bold uppercase tracking-wider">
              <Crown className="w-3.5 h-3.5" />
              {proActive ? "Your Plan · Active" : "Best Value · For Regular Dealmakers"}
              <Crown className="w-3.5 h-3.5" />
            </div>
          </div>

          <div className="relative p-5 lg:p-7">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <p className="text-[11px] lg:text-xs uppercase tracking-[0.1em] font-bold text-violet-600 dark:text-violet-400 mb-1">
                  DealInSec Pro
                </p>
                <h3 className="text-xl lg:text-2xl font-bold text-foreground flex items-center gap-2">
                  Unlimited agreements
                  <InfinityIcon className="w-5 h-5 text-violet-500" />
                </h3>
              </div>
              <span className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] lg:text-xs font-bold bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20">
                <Zap className="w-3 h-3" />
                1 YEAR
              </span>
            </div>

            <div className="flex items-end gap-3 mb-2">
              <div className="flex items-baseline gap-1">
                <span className="text-5xl lg:text-6xl font-black text-foreground leading-none tracking-tight">
                  {fmt(proPlanPrice)}
                </span>
                <span className="text-sm lg:text-base text-muted-foreground font-medium">/ year</span>
              </div>
            </div>

            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 text-xs font-semibold mb-5">
              <TrendingUp className="w-3.5 h-3.5" />
              Just {fmt(proMonthly)}/month — pays for itself in {breakEven} agreements
            </div>

            <ul className="space-y-2.5 mb-6">
              {[
                "Unlimited signed agreements — no credits needed",
                "Everything in the free plan, forever",
                "Your existing credits stay safe for later",
                "One payment, no auto-debit, renew when you want",
                "Priority support on WhatsApp",
              ].map((feature) => (
                <li key={feature} className="flex items-start gap-2.5 text-sm lg:text-[15px]">
                  <div className="flex-shrink-0 w-5 h-5 rounded-full bg-violet-500/15 flex items-center justify-center mt-px">
                    <Check className="w-3 h-3 text-violet-600 dark:text-violet-400" strokeWidth={3} />
                  </div>
                  <span className="text-foreground">{feature}</span>
                </li>
              ))}
            </ul>

            {proActive ? (
              <div className="space-y-3">
                <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200/60 dark:border-emerald-800/40 px-4 py-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
                    <Check className="w-5 h-5 text-emerald-600 dark:text-emerald-400" strokeWidth={3} />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-emerald-800 dark:text-emerald-300">Pro is active</p>
                    {proExpiryLabel && (
                      <p className="text-xs text-emerald-700/70 dark:text-emerald-400/70">
                        Valid until {proExpiryLabel} · renewing adds another year
                      </p>
                    )}
                  </div>
                </div>
                <Button
                  variant="outline"
                  className="w-full h-11 border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300 font-semibold"
                  onClick={() => handlePurchase("pro")}
                  disabled={isLoading}
                  data-testid="button-renew-pro"
                >
                  {isLoading && purchaseKind === "pro" ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Crown className="h-4 w-4 mr-2" />
                  )}
                  Renew for {fmt(proPlanPrice)} — extend 1 year
                </Button>
              </div>
            ) : (
              <Button
                className="w-full text-white h-12 lg:h-14 text-base lg:text-lg font-bold rounded-xl shadow-lg shadow-violet-500/30 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700"
                size="lg"
                onClick={() => handlePurchase("pro")}
                disabled={isLoading}
                data-testid="button-buy-pro"
              >
                {isLoading && purchaseKind === "pro" ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin mr-2" />
                    Opening secure checkout…
                  </>
                ) : (
                  <>
                    <Crown className="h-5 w-5 mr-2" />
                    Go Pro — {fmt(proPlanPrice)}/year
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </>
                )}
              </Button>
            )}

            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 mt-4 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Shield className="w-3 h-3 text-violet-500" /> 7-day refund
              </span>
              <span className="inline-flex items-center gap-1">
                <Lock className="w-3 h-3 text-violet-500" /> One-time payment
              </span>
              <span className="inline-flex items-center gap-1">
                <Check className="w-3 h-3 text-violet-500" /> No auto-debit
              </span>
            </div>
          </div>
        </Card>

        {/* ── Pricing hero card with anchor pricing + tactics ── */}
        <Card className="glass-card border-primary/30 relative overflow-hidden shadow-xl shadow-primary/[0.08]">
          {/* Subtle bg gradient */}
          <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.07] via-transparent to-emerald-500/[0.05] pointer-events-none" />

          {/* Top promotional bar */}
          {savings > 0 && (
            <div className="relative bg-gradient-to-r from-primary to-emerald-600 text-white px-4 py-2 text-center">
              <div className="flex items-center justify-center gap-2 text-xs lg:text-sm font-bold uppercase tracking-wider">
                <Sparkles className="w-3.5 h-3.5" />
                Launch Offer · Save {fmt(savings)} · Limited Time
                <Sparkles className="w-3.5 h-3.5" />
              </div>
            </div>
          )}

          <div className="relative p-5 lg:p-7">
            {/* Title row */}
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <p className="text-[11px] lg:text-xs uppercase tracking-[0.1em] font-bold text-primary mb-1">
                  Contract Credit
                </p>
                <h3 className="text-xl lg:text-2xl font-bold text-foreground">
                  1 signed agreement = 1 credit
                </h3>
              </div>
              {anchorPrice && (
                <span className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] lg:text-xs font-bold bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                  <Zap className="w-3 h-3" />
                  {Math.round((savings / anchorPrice) * 100)}% OFF
                </span>
              )}
            </div>

            {/* Anchor pricing — slashed old + bold new */}
            <div className="flex items-end gap-3 mb-2">
              {anchorPrice && (
                <span className="text-base lg:text-lg text-muted-foreground line-through decoration-2 decoration-rose-400/70">
                  {fmt(anchorPrice)}
                </span>
              )}
              <div className="flex items-baseline gap-1">
                <span className="text-5xl lg:text-6xl font-black text-foreground leading-none tracking-tight">
                  {fmt(creditPrice)}
                </span>
                <span className="text-sm lg:text-base text-muted-foreground font-medium">/ credit</span>
              </div>
            </div>

            {/* Savings call-out */}
            {savings > 0 && (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-xs font-semibold mb-5">
                <TrendingUp className="w-3.5 h-3.5" />
                You save {fmt(savings)} today — pay once, use anytime
              </div>
            )}

            {/* Value-justification ROI bar */}
            <div className="rounded-xl bg-muted/40 border border-border/50 p-3 lg:p-4 mb-5">
              <p className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">
                Why {fmt(creditPrice)} is practically free
              </p>
              <div className="grid grid-cols-3 gap-3 lg:gap-4 text-center">
                <div>
                  <p className="text-base lg:text-lg font-bold text-foreground">₹35K</p>
                  <p className="text-[10px] lg:text-[11px] text-muted-foreground leading-tight mt-0.5">Avg deal value</p>
                </div>
                <div className="border-x border-border/50">
                  <p className="text-base lg:text-lg font-bold text-primary">0.85%</p>
                  <p className="text-[10px] lg:text-[11px] text-muted-foreground leading-tight mt-0.5">Of your deal</p>
                </div>
                <div>
                  <p className="text-base lg:text-lg font-bold text-emerald-600 dark:text-emerald-400">10 hrs</p>
                  <p className="text-[10px] lg:text-[11px] text-muted-foreground leading-tight mt-0.5">Saved/week</p>
                </div>
              </div>
            </div>

            {/* What's included */}
            <ul className="space-y-2.5 mb-6">
              {[
                "Legally-worded agreement with e-signature",
                "GST-ready invoice auto-generated",
                "Brand-side dashboard for tracking",
                "Credits never expire",
                "Secure UPI / Card / Netbanking via Razorpay",
              ].map((feature) => (
                <li key={feature} className="flex items-start gap-2.5 text-sm lg:text-[15px]">
                  <div className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-500/15 flex items-center justify-center mt-px">
                    <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" strokeWidth={3} />
                  </div>
                  <span className="text-foreground">{feature}</span>
                </li>
              ))}
            </ul>

            {/* CTA */}
            <Button
              className="gradient-btn w-full text-white h-12 lg:h-14 text-base lg:text-lg font-bold rounded-xl shadow-lg shadow-primary/30"
              size="lg"
              onClick={() => handlePurchase("credit")}
              disabled={isLoading}
              data-testid="button-buy-credit"
            >
              {isLoading && purchaseKind === "credit" ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  Opening secure checkout…
                </>
              ) : (
                <>
                  <CreditCard className="h-5 w-5 mr-2" />
                  Get 1 Credit for {fmt(creditPrice)}
                  <ArrowRight className="h-4 w-4 ml-2" />
                </>
              )}
            </Button>

            {/* Trust signals row */}
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 mt-4 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Shield className="w-3 h-3 text-emerald-500" /> 7-day refund
              </span>
              <span className="inline-flex items-center gap-1">
                <Lock className="w-3 h-3 text-emerald-500" /> 256-bit encrypted
              </span>
              <span className="inline-flex items-center gap-1">
                <Check className="w-3 h-3 text-emerald-500" /> No subscription
              </span>
              <span className="inline-flex items-center gap-1">
                <Check className="w-3 h-3 text-emerald-500" /> UPI · Cards · NetBanking
              </span>
            </div>
          </div>
        </Card>

        {/* Free-forever card — reinforce value before credit purchase */}
        <Card className="glass-card border-emerald-500/20 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-50/60 via-transparent to-teal-50/40 dark:from-emerald-950/20 dark:to-teal-950/10 pointer-events-none" />
          <div className="relative p-5 lg:p-6">
            <div className="flex items-start justify-between gap-3 mb-3 lg:mb-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-7 h-7 lg:w-8 lg:h-8 rounded-lg bg-emerald-100 dark:bg-emerald-950/50 flex items-center justify-center">
                    <Sparkles className="w-3.5 h-3.5 lg:w-4 lg:h-4 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <p className="text-[10px] lg:text-xs uppercase tracking-[0.1em] font-bold text-emerald-700 dark:text-emerald-400">
                    Always Free
                  </p>
                </div>
                <h3 className="text-lg lg:text-xl font-bold text-foreground">
                  Everything below — ₹0 forever
                </h3>
                <p className="text-xs lg:text-sm text-muted-foreground mt-1">
                  You only pay when you lock in a signed contract.
                </p>
              </div>
              <span className="flex-shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] lg:text-xs font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                <Check className="w-3 h-3" strokeWidth={3} />
                ₹0
              </span>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 lg:gap-3">
              {[
                { label: "Create deals",         desc: "Unlimited" },
                { label: "Send quotations",     desc: "Unlimited" },
                { label: "Generate invoices",   desc: "Unlimited" },
                { label: "Track payments",      desc: "Real-time" },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-lg bg-white/60 dark:bg-card/60 border border-border/40 p-2.5 lg:p-3"
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <Check className="w-3 h-3 lg:w-3.5 lg:h-3.5 text-emerald-600 dark:text-emerald-400 flex-shrink-0" strokeWidth={3} />
                    <span className="text-xs lg:text-sm font-semibold text-foreground truncate">
                      {item.label}
                    </span>
                  </div>
                  <p className="text-[10px] lg:text-[11px] text-muted-foreground ml-[18px] lg:ml-[20px]">
                    {item.desc}
                  </p>
                </div>
              ))}
            </div>

            {/* Bonus: 3 free credits on signup */}
            <div className="mt-3 lg:mt-4 flex items-center gap-2 rounded-lg bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-800/40 px-3 py-2">
              <Sparkles className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
              <p className="text-[11px] lg:text-xs text-amber-900 dark:text-amber-200">
                <span className="font-bold">Bonus:</span> 3 free agreement credits on signup · referrals = +1 each
              </p>
            </div>
          </div>
        </Card>

        {/* Social proof bar */}
        <div className="rounded-2xl border border-border/50 bg-card/50 backdrop-blur-sm p-4 lg:p-5 flex items-center gap-3 lg:gap-4">
          <div className="flex -space-x-2 flex-shrink-0">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="w-8 h-8 lg:w-10 lg:h-10 rounded-full ring-2 ring-background flex items-center justify-center text-xs lg:text-sm font-bold text-white"
                style={{
                  background: ["linear-gradient(135deg,#10B981,#0D9488)",
                    "linear-gradient(135deg,#3B82F6,#6366F1)",
                    "linear-gradient(135deg,#F59E0B,#F97316)",
                    "linear-gradient(135deg,#EC4899,#A855F7)"][i],
                }}
              >
                {["A","P","R","M"][i]}
              </div>
            ))}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <Users className="w-3.5 h-3.5 text-primary flex-shrink-0" />
              <p className="text-sm lg:text-base font-semibold truncate">50+ creators joined this month</p>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] lg:text-xs text-muted-foreground">
              <div className="flex">
                {[1,2,3,4,5].map((s) => <Star key={s} className="w-3 h-3 fill-amber-400 text-amber-400" />)}
              </div>
              <span>4.9 · "Cut deal admin time in half" — Priya R.</span>
            </div>
          </div>
        </div>

        {/* How it works */}
        <div className="glass-card rounded-2xl border-0 p-5 space-y-3">
          <h3 className="text-sm font-semibold">How credits work</h3>
          <div className="space-y-3">
            {[
              { step: "1", title: "Create a Deal", desc: "Free — log your brand deal details" },
              { step: "2", title: "Generate a Quote", desc: "Free — send a professional quotation" },
              { step: "3", title: "Create Agreement", desc: "1 credit — legally binding contract PDF" },
              { step: "4", title: "Generate Invoice", desc: "Free — send invoice to the brand" },
            ].map(({ step, title, desc }) => (
              <div key={step} className="flex items-start gap-3">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center mt-0.5">
                  {step}
                </div>
                <div>
                  <p className="text-sm font-medium">{title}</p>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>

      <BottomNav />
    </div>
  );
}
