import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, CreditCard, Check, Loader2, CheckCircle, XCircle, Zap, ArrowRight, Shield, Lock, Sparkles, TrendingUp, Users, Star } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useLocation, Link } from "wouter";
import { BottomNav } from "@/components/bottom-nav";
import { queryClient } from "@/lib/queryClient";

const REDIRECT_KEY = "postPaymentRedirect";

export default function PricingPage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<"success" | "error" | null>(null);
  const [redirectAfter, setRedirectAfter] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(3);

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

  // Countdown timer for redirect after success
  useEffect(() => {
    if (!redirectAfter) return;
    setCountdown(3);
    const interval = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) {
          clearInterval(interval);
          setLocation(redirectAfter);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [redirectAfter]);

  const handlePurchase = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/payments/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credits: 1 }),
        credentials: "include",
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to initiate payment");
      }

      const data = await res.json();

      if (data.redirectUrl) {
        window.location.href = data.redirectUrl;
      } else if (data.formHtml) {
        const container = document.createElement("div");
        container.innerHTML = data.formHtml;
        document.body.appendChild(container);
        const form = container.querySelector("form");
        if (form) form.submit();
      }
    } catch (error: any) {
      toast({
        title: "Payment Failed",
        description: error.message || "Could not process payment",
        variant: "destructive",
      });
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

      <main className="p-4 max-w-lg mx-auto space-y-4 animate-fade-in lg:max-w-5xl lg:px-8 lg:py-6 lg:space-y-6">

        {/* ── Success banner with redirect countdown ── */}
        {paymentStatus === "success" && (
          <div className="rounded-2xl overflow-hidden border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30">
            <div className="p-4 flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-emerald-900 dark:text-emerald-100">Payment Successful!</p>
                <p className="text-sm text-emerald-700 dark:text-emerald-300 mt-0.5">
                  1 credit has been added to your account.
                </p>
                {redirectAfter && (
                  <div className="mt-3 flex items-center gap-2">
                    <div className="flex-1 h-1.5 rounded-full bg-emerald-200 dark:bg-emerald-800 overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-full transition-all"
                        style={{ width: `${((3 - countdown) / 3) * 100}%`, transitionDuration: "1000ms" }}
                      />
                    </div>
                    <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300 shrink-0">
                      Returning in {countdown}s…
                    </span>
                  </div>
                )}
              </div>
            </div>
            {redirectAfter && (
              <div className="px-4 pb-4">
                <Button
                  className="w-full gradient-btn text-white rounded-xl h-11"
                  onClick={() => setLocation(redirectAfter)}
                >
                  Continue to Agreement
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            )}
          </div>
        )}

        {/* ── Error banner ── */}
        {paymentStatus === "error" && (
          <div className="rounded-2xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-4 flex items-start gap-3">
            <XCircle className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-red-900 dark:text-red-100">Payment Failed</p>
              <p className="text-sm text-red-700 dark:text-red-300 mt-0.5">
                There was an issue processing your payment. Please try again.
              </p>
            </div>
          </div>
        )}

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

        {/* ── Pricing hero card with anchor pricing + tactics ── */}
        <Card className="glass-card border-primary/30 relative overflow-hidden shadow-xl shadow-primary/[0.08]">
          {/* Subtle bg gradient */}
          <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.07] via-transparent to-emerald-500/[0.05] pointer-events-none" />

          {/* Top promotional bar */}
          <div className="relative bg-gradient-to-r from-primary to-emerald-600 text-white px-4 py-2 text-center">
            <div className="flex items-center justify-center gap-2 text-xs lg:text-sm font-bold uppercase tracking-wider">
              <Sparkles className="w-3.5 h-3.5" />
              Launch Offer · Save ₹300 · Limited Time
              <Sparkles className="w-3.5 h-3.5" />
            </div>
          </div>

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
              <span className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] lg:text-xs font-bold bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                <Zap className="w-3 h-3" />
                50% OFF
              </span>
            </div>

            {/* Anchor pricing — slashed old + bold new */}
            <div className="flex items-end gap-3 mb-2">
              <span className="text-base lg:text-lg text-muted-foreground line-through decoration-2 decoration-rose-400/70">
                ₹599
              </span>
              <div className="flex items-baseline gap-1">
                <span className="text-5xl lg:text-6xl font-black text-foreground leading-none tracking-tight">
                  ₹299
                </span>
                <span className="text-sm lg:text-base text-muted-foreground font-medium">/ credit</span>
              </div>
            </div>

            {/* Savings call-out */}
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-xs font-semibold mb-5">
              <TrendingUp className="w-3.5 h-3.5" />
              You save ₹300 today — pay once, use anytime
            </div>

            {/* Value-justification ROI bar */}
            <div className="rounded-xl bg-muted/40 border border-border/50 p-3 lg:p-4 mb-5">
              <p className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">
                Why ₹299 is practically free
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
                "Secure UPI / Card / Netbanking via PayU",
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
              onClick={handlePurchase}
              disabled={isLoading}
              data-testid="button-buy-credit"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  Redirecting to PayU…
                </>
              ) : (
                <>
                  <CreditCard className="h-5 w-5 mr-2" />
                  Get 1 Credit for ₹299
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
