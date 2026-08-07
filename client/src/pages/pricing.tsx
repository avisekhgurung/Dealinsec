import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  ArrowLeft,
  Check,
  Loader2,
  Zap,
  ArrowRight,
  Shield,
  Lock,
  Sparkles,
  Crown,
  Rocket,
  Infinity as InfinityIcon,
} from "lucide-react";
import { hasActivePro, hasActiveDealBoost, getDealCredits, getSubscriptionType } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useLocation, Link } from "wouter";
import { BottomNav } from "@/components/bottom-nav";
import { queryClient } from "@/lib/queryClient";
import { PaymentResult } from "@/components/payment-result";
import { useRazorpayCheckout, type CheckoutPlan } from "@/hooks/use-razorpay-checkout";

const REDIRECT_KEY = "postPaymentRedirect";

export default function PricingPage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { checkout, isLoading, activePlan } = useRazorpayCheckout();
  const [paymentStatus, setPaymentStatus] = useState<"success" | "error" | null>(null);
  const [paymentErrorReason, setPaymentErrorReason] = useState<string>("");
  const [redirectAfter, setRedirectAfter] = useState<string | null>(null);
  const [purchasedPlan, setPurchasedPlan] = useState<CheckoutPlan>("pro_monthly");

  // Live pricing — driven by server env vars (PRO_MONTHLY_PRICE etc.)
  const [proMonthlyPrice, setProMonthlyPrice] = useState<number>(999);
  const [proYearlyPrice, setProYearlyPrice] = useState<number>(9999);
  const [dealBoostPrice, setDealBoostPrice] = useState<number>(99);
  useEffect(() => {
    fetch("/api/payments/config", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => {
        if (cfg?.proMonthlyPrice) setProMonthlyPrice(cfg.proMonthlyPrice);
        if (cfg?.proYearlyPrice) setProYearlyPrice(cfg.proYearlyPrice);
        if (cfg?.dealBoostPrice) setDealBoostPrice(cfg.dealBoostPrice);
      })
      .catch(() => {});
  }, []);
  const fmt = (n: number) => `₹${n.toLocaleString("en-IN")}`;

  const proActive = hasActivePro(user);
  const boostActive = hasActiveDealBoost(user);
  const subType = getSubscriptionType(user);
  const credits = getDealCredits(user);
  const proExpiryLabel = user?.planExpiresAt
    ? new Date(user.planExpiresAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
    : null;
  const boostExpiryLabel = user?.dealBoostExpiresAt
    ? new Date(user.dealBoostExpiresAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
    : null;
  // "Save 2 Months": yearly at the monthly rate would cost 12×monthly.
  const yearlySavings = Math.max(0, proMonthlyPrice * 12 - proYearlyPrice);

  // On mount: persist ?redirect= param (used to hop back into the workflow
  // after an upgrade, e.g. /deals/12/contract)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const redirectParam = params.get("redirect");
    if (redirectParam) {
      localStorage.setItem(REDIRECT_KEY, redirectParam);
    }
  }, []);

  const handlePurchase = (plan: CheckoutPlan) => {
    setPurchasedPlan(plan);
    checkout(plan, {
      onSuccess: () => {
        setPaymentStatus("success");
        toast({
          title: "Payment successful!",
          description:
            plan === "deal_boost"
              ? "Deal Boost active — unlimited deals & quotations for 1 month."
              : plan === "pro_monthly"
              ? "DealInSec Pro is active — the full workflow is unlocked for 1 month."
              : "DealInSec Pro is active — the full workflow is unlocked for 1 year.",
          variant: "success" as any,
        });
        const savedRedirect = localStorage.getItem(REDIRECT_KEY);
        if (savedRedirect) {
          setRedirectAfter(savedRedirect);
          localStorage.removeItem(REDIRECT_KEY);
        }
      },
      onPendingVerification: () => {
        toast({
          title: "Verification pending",
          description: "Payment received — your plan will activate shortly. Refresh in a moment.",
          variant: "destructive",
        });
      },
      onError: (message) => {
        setPaymentErrorReason(message);
        setPaymentStatus("error");
      },
    });
  };

  const PRO_FEATURES = [
    "Unlimited deals & quotations",
    "Unlimited signed agreements with e-signature",
    "Unlimited GST-ready invoices",
    "Payment tracking — know who owes you",
    "Payment reminders (coming soon)",
    "Custom branding (coming soon)",
    "Priority support on WhatsApp",
    "Early access to AI features",
  ];

  const successMessage =
    purchasedPlan === "deal_boost"
      ? "Deal Boost active — unlimited deals & quotations for 1 month."
      : purchasedPlan === "pro_monthly"
      ? "DealInSec Pro is active — everything unlocked for 1 month."
      : "DealInSec Pro is active — everything unlocked for 1 year.";

  return (
    <div className="min-h-screen bg-background pb-20 lg:pb-12">
      <header className="glass-header sticky top-0 z-50 px-4 py-3 flex items-center gap-3 lg:max-w-5xl lg:mx-auto lg:px-8 lg:py-5">
        <Link href="/dashboard">
          <Button variant="ghost" size="icon" data-testid="button-back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <h1 className="text-xl lg:text-2xl font-semibold flex-1">Plans &amp; Billing</h1>
        {/* Plan pill */}
        {proActive ? (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-violet-50 dark:bg-violet-950/40 border border-violet-200 dark:border-violet-800">
            <Crown className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
            <span className="text-sm font-bold text-violet-700 dark:text-violet-300">Pro</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            <span className="text-sm font-bold text-primary">{credits.total}</span>
            <span className="text-xs text-primary/70">
              {credits.total === 1 ? "credit" : "credits"}
            </span>
          </div>
        )}
      </header>

      {/* Animated full-screen payment result overlay (success / failure) */}
      <PaymentResult
        state={paymentStatus}
        credits={1}
        successMessage={successMessage}
        chipLabel={
          purchasedPlan === "deal_boost" ? "Deal Boost · 1 month" : "Pro · Unlimited workflow"
        }
        errorReason={paymentErrorReason}
        continueLabel={redirectAfter ? "Continue where you left off" : undefined}
        onContinue={redirectAfter ? () => setLocation(redirectAfter) : undefined}
        onRetry={() => {
          setPaymentStatus(null);
          handlePurchase(purchasedPlan);
        }}
        onClose={() => setPaymentStatus(null)}
      />

      <main className="p-4 max-w-lg mx-auto space-y-4 animate-fade-in lg:max-w-5xl lg:px-8 lg:py-6 lg:space-y-6">

        {/* ── Current plan strip ── */}
        {proActive ? (
          <div className="rounded-2xl border border-violet-200/60 dark:border-violet-800/40 bg-violet-50/50 dark:bg-violet-950/20 px-5 py-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center flex-shrink-0">
              <Crown className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1">
              <p className="font-bold text-sm text-violet-900 dark:text-violet-200">
                DealInSec Pro · {subType === "PRO_MONTHLY" ? "Monthly" : "Annual"}
              </p>
              {proExpiryLabel && (
                <p className="text-xs text-violet-700/70 dark:text-violet-400/70">
                  Valid until {proExpiryLabel} · renewing extends your term
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-border/60 bg-card/50 px-5 py-4">
            <div className="flex items-center justify-between mb-2">
              <p className="font-bold text-sm">
                Free plan · {credits.monthly} of 4 Deal Credits left
                {credits.purchased > 0 && (
                  <span className="text-muted-foreground font-medium"> +{credits.purchased} extra</span>
                )}
              </p>
              {boostActive && boostExpiryLabel && (
                <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                  <Rocket className="w-3 h-3" /> Boost until {boostExpiryLabel}
                </span>
              )}
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary to-emerald-500"
                style={{ width: `${(credits.monthly / 4) * 100}%` }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground mt-1.5">
              1 Deal Credit = 1 deal + its quotation · resets monthly · agreements &amp; invoices need Pro
            </p>
          </div>
        )}

        {/* ── The 3 plans ── */}
        <div className="grid lg:grid-cols-3 gap-4 lg:gap-5 items-stretch">

          {/* Free */}
          <Card className="glass-card relative overflow-hidden flex flex-col p-5 lg:p-6">
            <p className="text-[11px] uppercase tracking-[0.1em] font-bold text-muted-foreground mb-1">Free</p>
            <div className="flex items-baseline gap-1 mb-1">
              <span className="text-4xl font-black text-foreground leading-none">₹0</span>
              <span className="text-sm text-muted-foreground font-medium">/ forever</span>
            </div>
            <p className="text-xs text-muted-foreground mb-4">Start managing deals professionally</p>
            <ul className="space-y-2.5 mb-6 flex-1">
              {[
                "4 Deal Credits every month",
                "1 credit = 1 deal + its quotation",
                "Dashboard & pipeline overview",
                "Professional quotation PDFs",
              ].map((f) => (
                <li key={f} className="flex items-start gap-2.5 text-sm">
                  <div className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-500/15 flex items-center justify-center mt-px">
                    <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" strokeWidth={3} />
                  </div>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            {!proActive && (
              <div className="rounded-lg bg-muted/60 text-center py-2.5 text-sm font-semibold text-muted-foreground">
                Your current plan
              </div>
            )}
          </Card>

          {/* Pro Monthly — recommended */}
          <Card className="glass-card border-violet-400/40 dark:border-violet-500/30 relative overflow-hidden flex flex-col shadow-xl shadow-violet-500/[0.1]">
            <div className="absolute inset-0 bg-gradient-to-br from-violet-500/[0.08] via-transparent to-indigo-500/[0.06] pointer-events-none" />
            <div className="relative bg-gradient-to-r from-violet-600 to-indigo-600 text-white px-4 py-1.5 text-center">
              <span className="text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5">
                <Sparkles className="w-3 h-3" /> Recommended
              </span>
            </div>
            <div className="relative p-5 lg:p-6 flex flex-col flex-1">
              <p className="text-[11px] uppercase tracking-[0.1em] font-bold text-violet-600 dark:text-violet-400 mb-1">
                Pro · Monthly
              </p>
              <div className="flex items-baseline gap-1 mb-1">
                <span className="text-4xl font-black text-foreground leading-none">{fmt(proMonthlyPrice)}</span>
                <span className="text-sm text-muted-foreground font-medium">/ month</span>
              </div>
              <p className="text-xs text-muted-foreground mb-4">
                The complete workflow — deal to payment
              </p>
              <ul className="space-y-2.5 mb-6 flex-1">
                {PRO_FEATURES.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm">
                    <div className="flex-shrink-0 w-5 h-5 rounded-full bg-violet-500/15 flex items-center justify-center mt-px">
                      <Check className="w-3 h-3 text-violet-600 dark:text-violet-400" strokeWidth={3} />
                    </div>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Button
                className="w-full text-white h-12 text-base font-bold rounded-xl shadow-lg shadow-violet-500/30 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700"
                onClick={() => handlePurchase("pro_monthly")}
                disabled={isLoading}
                data-testid="button-buy-pro-monthly"
              >
                {isLoading && activePlan === "pro_monthly" ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin mr-2" />
                    Opening checkout…
                  </>
                ) : (
                  <>
                    <Crown className="h-5 w-5 mr-2" />
                    {proActive ? `Extend 1 month — ${fmt(proMonthlyPrice)}` : `Go Pro — ${fmt(proMonthlyPrice)}/month`}
                  </>
                )}
              </Button>
            </div>
          </Card>

          {/* Pro Annual — save 2 months */}
          <Card className="glass-card border-primary/30 relative overflow-hidden flex flex-col shadow-xl shadow-primary/[0.08]">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.07] via-transparent to-emerald-500/[0.05] pointer-events-none" />
            <div className="relative bg-gradient-to-r from-primary to-emerald-600 text-white px-4 py-1.5 text-center">
              <span className="text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5">
                <Zap className="w-3 h-3" /> Save 2 Months
              </span>
            </div>
            <div className="relative p-5 lg:p-6 flex flex-col flex-1">
              <p className="text-[11px] uppercase tracking-[0.1em] font-bold text-primary mb-1">
                Pro · Annual
              </p>
              <div className="flex items-baseline gap-1 mb-1">
                <span className="text-4xl font-black text-foreground leading-none">{fmt(proYearlyPrice)}</span>
                <span className="text-sm text-muted-foreground font-medium">/ year</span>
              </div>
              <p className="text-xs text-muted-foreground mb-4">
                ≈ {fmt(Math.round(proYearlyPrice / 12))}/month
                {yearlySavings > 0 ? ` — save ${fmt(yearlySavings)} vs monthly` : ""}
              </p>
              <ul className="space-y-2.5 mb-6 flex-1">
                {[
                  "Everything in Pro Monthly",
                  <span key="u" className="inline-flex items-center gap-1.5">
                    Unlimited workflow for a full year <InfinityIcon className="w-3.5 h-3.5 text-primary" />
                  </span>,
                  "One payment — no monthly renewals",
                  "Lock today's price for 12 months",
                ].map((f, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm">
                    <div className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-500/15 flex items-center justify-center mt-px">
                      <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" strokeWidth={3} />
                    </div>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Button
                className="gradient-btn w-full text-white h-12 text-base font-bold rounded-xl shadow-lg shadow-primary/30"
                onClick={() => handlePurchase("pro_yearly")}
                disabled={isLoading}
                data-testid="button-buy-pro-yearly"
              >
                {isLoading && activePlan === "pro_yearly" ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin mr-2" />
                    Opening checkout…
                  </>
                ) : (
                  <>
                    <Zap className="h-5 w-5 mr-2" />
                    {proActive ? `Extend 1 year — ${fmt(proYearlyPrice)}` : `Go Annual — ${fmt(proYearlyPrice)}/year`}
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </>
                )}
              </Button>
            </div>
          </Card>
        </div>

        {/* ── Deal Boost — the ₹99 bridge ── */}
        {!proActive && (
          <Card className="glass-card border-emerald-300/40 dark:border-emerald-800/40 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/[0.06] to-teal-500/[0.04] pointer-events-none" />
            <div className="relative p-4 lg:p-5 flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center flex-shrink-0 shadow-md shadow-emerald-500/30">
                <Rocket className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm lg:text-base">
                  Deal Boost — {fmt(dealBoostPrice)}
                  <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                    1 month
                  </span>
                </p>
                <p className="text-xs lg:text-sm text-muted-foreground mt-0.5">
                  Unlimited deals &amp; quotations for a month — no agreements or invoices.
                  {boostActive && boostExpiryLabel ? ` Active until ${boostExpiryLabel}; buying again extends it.` : " Stacks if you buy again."}
                </p>
              </div>
              <Button
                variant="outline"
                className="flex-shrink-0 h-11 rounded-xl font-semibold border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300"
                onClick={() => handlePurchase("deal_boost")}
                disabled={isLoading}
                data-testid="button-buy-deal-boost"
              >
                {isLoading && activePlan === "deal_boost" ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Rocket className="h-4 w-4 mr-2" />
                )}
                {boostActive ? `Extend — ${fmt(dealBoostPrice)}` : `Get Boost — ${fmt(dealBoostPrice)}`}
              </Button>
            </div>
          </Card>
        )}

        {/* ── How the free plan works ── */}
        <div className="glass-card rounded-2xl border-0 p-5 space-y-3">
          <h3 className="text-sm font-semibold">How it works</h3>
          <div className="space-y-3">
            {[
              { step: "1", title: "Create a Deal", desc: "Uses 1 Deal Credit — free plan includes 4 every month" },
              { step: "2", title: "Generate its Quotation", desc: "Included with the same credit — no extra cost" },
              { step: "3", title: "Sign the Agreement", desc: "Pro — legally-worded contract with e-signature" },
              { step: "4", title: "Invoice & track payment", desc: "Pro — GST-ready invoice + payment tracking" },
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

        {/* Trust signals row */}
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Shield className="w-3 h-3 text-emerald-500" /> 7-day refund
          </span>
          <span className="inline-flex items-center gap-1">
            <Lock className="w-3 h-3 text-emerald-500" /> One-time payment · no auto-debit
          </span>
          <span className="inline-flex items-center gap-1">
            <Check className="w-3 h-3 text-emerald-500" /> UPI · Cards · NetBanking via Razorpay
          </span>
        </div>
      </main>

      <BottomNav />
    </div>
  );
}
