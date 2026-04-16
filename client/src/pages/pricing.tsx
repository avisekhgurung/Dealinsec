import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, CreditCard, Check, Loader2, CheckCircle, XCircle, Zap, ArrowRight } from "lucide-react";
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
    <div className="min-h-screen bg-background pb-20">
      <header className="glass-header sticky top-0 z-50 px-4 py-3 flex items-center gap-3">
        <Link href="/">
          <Button variant="ghost" size="icon" data-testid="button-back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <h1 className="text-xl font-semibold flex-1">Buy Credits</h1>
        {/* Credit balance pill */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800">
          <span className="text-sm font-black text-amber-500">₹</span>
          <span className="text-sm font-bold text-amber-700 dark:text-amber-300">{credits}</span>
          <span className="text-xs text-amber-600/70 dark:text-amber-400/70">
            {credits === 1 ? "credit" : "credits"}
          </span>
        </div>
      </header>

      <main className="p-4 max-w-lg mx-auto space-y-4 animate-fade-in">

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

        {/* ── Buy credit card ── */}
        <Card className="glass-card border-primary/20 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-violet-500/5 pointer-events-none" />

          {/* Popular badge */}
          <div className="absolute top-4 right-4">
            <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-primary/10 text-primary border border-primary/20">
              <Zap className="w-3 h-3" />
              Most Popular
            </span>
          </div>

          <CardHeader className="relative pb-2 pt-6">
            <CardTitle className="text-lg">Agreement Credit</CardTitle>
            <div className="flex items-baseline gap-1 mt-2">
              <span className="text-4xl font-black">₹299</span>
              <span className="text-muted-foreground text-sm">/ credit</span>
            </div>
          </CardHeader>

          <CardContent className="relative space-y-3 pb-4">
            {[
              "Create 1 exclusive agreement with a brand",
              "Professional PDF with your digital signature",
              "Auto-generate invoice for brand billing",
              "Credits never expire",
              "Secure payment via PayU",
            ].map((feature, i) => (
              <div key={i} className="flex items-center gap-2.5 text-sm">
                <div className="flex-shrink-0 w-4 h-4 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
                  <Check className="w-2.5 h-2.5 text-emerald-600 dark:text-emerald-400" />
                </div>
                {feature}
              </div>
            ))}
          </CardContent>

          <CardFooter className="relative flex-col gap-2 pt-0">
            <Button
              className="gradient-btn w-full text-white h-13 text-base font-semibold rounded-xl shadow-lg"
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
                  Buy 1 Credit — ₹299
                </>
              )}
            </Button>
            <p className="text-xs text-center text-muted-foreground">
              Secured by PayU · No subscription · Pay once, use anytime
            </p>
          </CardFooter>
        </Card>

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
