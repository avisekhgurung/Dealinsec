import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  ArrowLeft,
  Check,
  Loader2,
  Shield,
  Lock,
  Sparkles,
  Crown,
  Rocket,
  Users,
  Globe,
} from "lucide-react";
import {
  hasActivePro,
  hasActiveDealBoost,
  hasActiveTrial,
  hasLapsedTrial,
  getTrialDaysLeft,
  getSubscriptionType,
} from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useLocation, Link } from "wouter";
import { BottomNav } from "@/components/bottom-nav";
import { queryClient } from "@/lib/queryClient";
import { PaymentResult } from "@/components/payment-result";
import { useRazorpayCheckout, type CheckoutPlan } from "@/hooks/use-razorpay-checkout";
import { PLAN_PRICE_DEFAULTS, formatRupees, usePlanCheckoutAvailable } from "@/hooks/use-plan-prices";
import { OUTBOUND_ALLOWANCE_DEFAULTS } from "@shared/outbound-plans";
import { useLocale } from "@/hooks/use-locale";
import { trackEvent } from "@/lib/analytics";

const REDIRECT_KEY = "postPaymentRedirect";

/** Stands where a buy control would be when checkout isn't open for this
 *  account. Deliberately not a <Button>: a disabled button still reads as
 *  "something to buy, just not right now"; this reads as a statement. */
function CheckoutComingSoon({ testId }: { testId: string }) {
  return (
    <div
      className="w-full h-12 rounded-xl bg-muted/60 flex items-center justify-center gap-2 px-3 text-sm font-semibold text-muted-foreground text-center"
      data-testid={testId}
    >
      <Globe className="h-4 w-4 flex-shrink-0" />
      Paid plans aren't available in your country yet
    </div>
  );
}

export default function PricingPage() {
  useEffect(() => {
    trackEvent("pricing_viewed");
  }, []);
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { checkout, isLoading, activePlan } = useRazorpayCheckout();
  const [paymentStatus, setPaymentStatus] = useState<"success" | "error" | null>(null);
  const [paymentErrorReason, setPaymentErrorReason] = useState<string>("");
  const [redirectAfter, setRedirectAfter] = useState<string | null>(null);
  const [purchasedPlan, setPurchasedPlan] = useState<CheckoutPlan>("pro_monthly");

  // Live pricing — driven by server env vars (PRO_MONTHLY_PRICE etc.)
  // Defaults (₹499 Pro, ₹99 per extra seat) are shared with the other surfaces.
  const [proMonthlyPrice, setProMonthlyPrice] = useState<number>(PLAN_PRICE_DEFAULTS.proMonthlyPrice);
  const [extraSeatPrice, setExtraSeatPrice] = useState<number>(PLAN_PRICE_DEFAULTS.extraSeatPrice);
  const [seatQty, setSeatQty] = useState<number>(1);
  useEffect(() => {
    fetch("/api/payments/config", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => {
        if (cfg?.proMonthlyPrice) setProMonthlyPrice(cfg.proMonthlyPrice);
        if (cfg?.extraSeatPrice) setExtraSeatPrice(cfg.extraSeatPrice);
      })
      .catch(() => {});
  }, []);
  // Every plan order is created in rupees, so the price is quoted in rupees —
  // see formatRupees. The user's own deals follow their own currency; our
  // price is our price.
  const fmt = formatRupees;
  const { locale } = useLocale();
  // Paid checkout is India-only. Outside India the plans still show, with a
  // plain "not available yet" note where every buy control would be — never a
  // button that fails at Razorpay or quietly charges rupees. Always true for an
  // Indian account, so every `checkoutAvailable ? … : …` below renders exactly
  // what India saw before.
  const checkoutAvailable = usePlanCheckoutAvailable();

  const proActive = hasActivePro(user);
  const boostActive = hasActiveDealBoost(user);
  // Display only — a trialist still sees every buy button (that's the point
  // of the trial); what changes is the "current plan" framing. Deal Boost is
  // no longer sold; boostActive only labels a boost someone already bought.
  const trialActive = hasActiveTrial(user);
  const trialDaysLeft = getTrialDaysLeft(user);
  const trialLapsed = hasLapsedTrial(user);
  const subType = getSubscriptionType(user);
  const proExpiryLabel = user?.planExpiresAt
    ? new Date(user.planExpiresAt).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })
    : null;
  const boostExpiryLabel = user?.dealBoostExpiresAt
    ? new Date(user.dealBoostExpiresAt).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })
    : null;

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
    // No buy control renders when checkout is unavailable; this catches the
    // one path that doesn't go through a button (PaymentResult's retry).
    if (!checkoutAvailable) return;
    setPurchasedPlan(plan);
    checkout(plan, {
      onSuccess: () => {
        setPaymentStatus("success");
        toast({
          title: "Payment successful!",
          description:
            plan === "extra_seat"
              ? `${seatQty} extra seat${seatQty > 1 ? "s" : ""} added for 1 month.`
              : "DealInSec Pro is active — AI Outbound and the full workflow are unlocked for 1 month.",
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
    }, plan === "extra_seat" ? { qty: seatQty } : {});
  };

  const PRO_FEATURES = [
    `AI Outbound: ${OUTBOUND_ALLOWANCE_DEFAULTS.pro.monthlySearches} prospect searches a month, up to ${OUTBOUND_ALLOWANCE_DEFAULTS.pro.maxCompanies} companies each, in any country`,
    "Unlimited deals & quotations",
    "Unlimited agreements your client signs online",
    // In-app invoices carry the country's tax IDs but are not GST tax invoices (see shared/landing-faqs.ts), so they
    // are never described as "GST-ready".
    checkoutAvailable ? "Unlimited invoices with your PAN and GSTIN" : "Unlimited invoices",
    "Payment tracking — know who owes you",
    "Up to 5 team members",
    "One plan: no separate CRM or AI Outbound fee",
  ];

  const successMessage =
    purchasedPlan === "extra_seat"
      ? "Extra seats added — invite people from Settings."
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
        {/* Plan pill — Pro wears the brand pairing: emerald + gold crown */}
        {proActive ? (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800">
            <Crown className="w-3.5 h-3.5 text-amber-500" />
            <span className="text-sm font-bold text-emerald-700 dark:text-emerald-300">Pro</span>
          </div>
        ) : trialActive ? (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800">
            <Sparkles className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span className="text-sm font-bold text-emerald-700 dark:text-emerald-300">Pro trial</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            <span className="text-sm font-bold text-primary">Free plan</span>
          </div>
        )}
      </header>

      {/* Animated full-screen payment result overlay (success / failure) */}
      <PaymentResult
        state={paymentStatus}
        credits={1}
        successMessage={successMessage}
        chipLabel={
          purchasedPlan === "extra_seat" ? "Extra seats · 1 month"
          : "Pro · Unlimited workflow"
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
          <div className="rounded-2xl border border-emerald-200/60 dark:border-emerald-800/40 bg-emerald-50/50 dark:bg-emerald-950/20 px-5 py-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center flex-shrink-0">
              <Crown className="w-5 h-5 text-amber-300" />
            </div>
            <div className="flex-1">
              <p className="font-bold text-sm text-emerald-900 dark:text-emerald-200">
                DealInSec Pro · {subType === "PRO_MONTHLY" ? "Monthly" : "Annual"}
              </p>
              {proExpiryLabel && (
                <p className="text-xs text-emerald-700/70 dark:text-emerald-400/70">
                  {checkoutAvailable
                    ? <>Valid until {proExpiryLabel} · renewing extends your term</>
                    : <>Valid until {proExpiryLabel}</>}
                </p>
              )}
            </div>
          </div>
        ) : trialActive ? (
          <div className="rounded-2xl border border-emerald-200/60 dark:border-emerald-800/40 bg-emerald-50/50 dark:bg-emerald-950/20 px-5 py-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1">
              <p className="font-bold text-sm text-emerald-900 dark:text-emerald-200">
                Pro trial · {trialDaysLeft === 1 ? "last day" : `${trialDaysLeft} days left`}
              </p>
              <p className="text-xs text-emerald-700/70 dark:text-emerald-400/70">
                {checkoutAvailable
                  ? "Everything is unlocked. Upgrade below to keep the full workflow when your trial ends."
                  : "Everything is unlocked until your trial ends."}
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-border/60 bg-card/50 px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-bold text-sm">
                  {trialLapsed ? "Your Pro trial has ended — you're on the Free plan" : "You're on the Free plan"}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  4 deals a month with quotations · agreements, invoices &amp; payment tracking need Pro
                </p>
              </div>
              {boostActive && boostExpiryLabel && (
                <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 flex-shrink-0">
                  <Rocket className="w-3 h-3" /> Boost until {boostExpiryLabel}
                </span>
              )}
            </div>
          </div>
        )}

        {/* ── Outside India: say plainly why there is nothing to buy ── */}
        {!checkoutAvailable && (
          <div
            className="rounded-2xl border border-primary/20 bg-primary/5 px-5 py-4 flex items-start gap-3"
            data-testid="notice-international-checkout"
          >
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Globe className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1">
              <p className="font-bold text-sm">Paid plans aren't available in your country yet</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Plans can only be bought from India for now, so the prices below are in rupees and are
                what customers in India pay. Checkout for your country isn't open yet, so there is
                nothing to pay here.
                {/* Same precedence as the plan strip above. */}
                {proActive
                  ? ""
                  : trialActive
                  ? " Your Pro trial keeps everything unlocked until it ends."
                  : " The Free plan keeps working in the meantime."}
              </p>
              <p className="text-[11px] text-muted-foreground mt-1.5">
                Based in India and seeing this?{" "}
                <a href="mailto:support@dealinsec.com" className="font-semibold text-primary hover:underline">
                  Email support@dealinsec.com
                </a>
              </p>
            </div>
          </div>
        )}

        {/* ── The plans: Free and DealInSec Pro (one paid plan) ── */}
        <div className="grid md:grid-cols-2 gap-4 lg:gap-5 items-stretch max-w-4xl mx-auto w-full">

          {/* Free */}
          <Card className="glass-card relative overflow-hidden flex flex-col p-5 lg:p-6">
            <p className="text-[11px] uppercase tracking-[0.1em] font-bold text-muted-foreground mb-1">Free</p>
            <div className="flex items-baseline gap-1 mb-1">
              <span className="text-4xl font-black text-foreground leading-none">{fmt(0)}</span>
              <span className="text-sm text-muted-foreground font-medium">/ forever</span>
            </div>
            <p className="text-xs text-muted-foreground mb-4">Find your first clients and quote them properly, free</p>
            <ul className="space-y-2.5 mb-6 flex-1">
              {[
                `AI Outbound: ${OUTBOUND_ALLOWANCE_DEFAULTS.free.monthlySearches} prospect searches a month, up to ${OUTBOUND_ALLOWANCE_DEFAULTS.free.maxCompanies} companies each`,
                "Leads pipeline with follow-ups",
                "4 deals every month, each with a quotation",
                "Quotation PDFs and share links",
              ].map((f) => (
                <li key={f} className="flex items-start gap-2.5 text-sm">
                  <div className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-500/15 flex items-center justify-center mt-px">
                    <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" strokeWidth={3} />
                  </div>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            {!proActive && !trialActive && (
              <div className="rounded-lg bg-muted/60 text-center py-2.5 text-sm font-semibold text-muted-foreground">
                Your current plan
              </div>
            )}
          </Card>

          {/* Pro Monthly — recommended. Emerald + gold, the logo's own pairing */}
          <Card className="glass-card border-emerald-400/40 dark:border-emerald-500/30 relative overflow-hidden flex flex-col shadow-xl shadow-emerald-500/[0.1]">
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/[0.08] via-transparent to-teal-500/[0.06] pointer-events-none" />
            <div className="relative bg-gradient-to-r from-emerald-600 to-teal-600 text-white px-4 py-1.5 text-center">
              <span className="text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5">
                <Sparkles className="w-3 h-3 text-amber-300" /> Recommended
              </span>
            </div>
            <div className="relative p-5 lg:p-6 flex flex-col flex-1">
              <p className="text-[11px] uppercase tracking-[0.1em] font-bold text-emerald-600 dark:text-emerald-400 mb-1">
                DealInSec Pro
              </p>
              <div className="flex items-baseline gap-1 mb-1">
                <span className="text-4xl font-black text-foreground leading-none">{fmt(proMonthlyPrice)}</span>
                <span className="text-sm text-muted-foreground font-medium">/ month</span>
              </div>
              <p className="text-xs text-muted-foreground mb-4">
                Find clients, close deals and get paid. Paid monthly; it doesn&apos;t renew or charge automatically.
              </p>
              <ul className="space-y-2.5 mb-6 flex-1">
                {PRO_FEATURES.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm">
                    <div className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-500/15 flex items-center justify-center mt-px">
                      <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" strokeWidth={3} />
                    </div>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              {checkoutAvailable ? (
                <Button
                  className="w-full text-white h-12 text-base font-bold rounded-xl shadow-lg shadow-emerald-500/30 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700"
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
                      <Crown className="h-5 w-5 mr-2 text-amber-300" />
                      {proActive ? `Extend 1 month — ${fmt(proMonthlyPrice)}` : `Go Pro — ${fmt(proMonthlyPrice)}/month`}
                    </>
                  )}
                </Button>
              ) : (
                <CheckoutComingSoon testId="coming-soon-pro-monthly" />
              )}
            </div>
          </Card>

        </div>

        {/* ── Extra seats (Deal Boost is retired — no card for it) ── */}
        <Card id="seats" className="glass-card border-primary/20 relative overflow-hidden scroll-mt-24">
          <div className="relative p-4 lg:p-5 flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Users className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm lg:text-base">
                Extra seats — {fmt(extraSeatPrice)}
                <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-primary">per seat / month</span>
              </p>
              <p className="text-xs lg:text-sm text-muted-foreground mt-0.5">
                Only if someone else needs their own login — say your CA or a collaborator. Pro includes 5; extra seats renew together as one pack.
              </p>
            </div>
            {checkoutAvailable ? (
              <div className="flex items-center gap-2 flex-shrink-0">
                <select
                  value={seatQty}
                  onChange={(e) => setSeatQty(parseInt(e.target.value, 10))}
                  className="h-11 rounded-xl border border-input bg-background px-3 text-sm font-semibold"
                  data-testid="select-seat-qty"
                >
                  {[1, 2, 3, 4, 5, 8, 10].map((n) => (
                    <option key={n} value={n}>{n} seat{n > 1 ? "s" : ""}</option>
                  ))}
                </select>
                <Button
                  variant="outline"
                  className="h-11 rounded-xl font-semibold border-primary/40 text-primary"
                  onClick={() => handlePurchase("extra_seat")}
                  disabled={isLoading}
                  data-testid="button-buy-seats"
                >
                  {isLoading && activePlan === "extra_seat" ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : null}
                  Buy — {fmt(extraSeatPrice * seatQty)}
                </Button>
              </div>
            ) : (
              <div className="flex-shrink-0 sm:w-64">
                <CheckoutComingSoon testId="coming-soon-seats" />
              </div>
            )}
          </div>
        </Card>

        {/* ── How the free plan works ── */}
        <div className="glass-card rounded-2xl border-0 p-5 space-y-3">
          <h3 className="text-sm font-semibold">How it works</h3>
          <div className="space-y-3">
            {[
              { step: "1", title: "Create a Deal", desc: "Free plan covers 4 deals every month" },
              { step: "2", title: "Generate its Quotation", desc: "Included with the deal — no extra cost" },
              { step: "3", title: "Sign the Agreement", desc: "Pro — scope & terms your client or brand signs online" },
              {
                step: "4",
                title: "Invoice & track payment",
                desc: "Pro — invoice + payment tracking",
              },
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
          <p className="text-[11px] text-muted-foreground pt-1 border-t border-border/50">
            Every new account starts with a 7-day Pro trial — the full workflow, unlocked. One trial per account.
          </p>
        </div>

        {/* Trust signals row — every item describes paying, which isn't open
            outside India yet, so it only shows where checkout is. */}
        {checkoutAvailable && (
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
        )}
      </main>

      <BottomNav />
    </div>
  );
}
