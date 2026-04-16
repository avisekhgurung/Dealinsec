import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, CreditCard, Check, Loader2, CheckCircle, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useLocation, Link } from "wouter";
import { BottomNav } from "@/components/bottom-nav";
import { queryClient } from "@/lib/queryClient";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function PricingPage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<"success" | "error" | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("success") === "true") {
      setPaymentStatus("success");
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/credits/balance"] });
      toast({ title: "Payment successful!", description: "Your credits have been added." });
      window.history.replaceState({}, "", "/pricing");
    } else if (params.get("error")) {
      setPaymentStatus("error");
      toast({
        title: "Payment failed",
        description: params.get("error")?.replace(/_/g, " ") || "Please try again.",
        variant: "destructive"
      });
      window.history.replaceState({}, "", "/pricing");
    }
  }, [toast]);

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

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="glass-header sticky top-0 z-50 px-4 py-3 flex items-center gap-3">
        <Link href="/">
          <Button variant="ghost" size="icon" data-testid="button-back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <h1 className="text-xl font-semibold">Pricing</h1>
      </header>

      <main className="p-4 max-w-lg mx-auto animate-fade-in">
        {paymentStatus === "success" && (
          <Alert className="mb-4 border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950">
            <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
            <AlertTitle className="text-green-800 dark:text-green-200">Payment Successful</AlertTitle>
            <AlertDescription className="text-green-700 dark:text-green-300">
              Your credit has been added to your account.
            </AlertDescription>
          </Alert>
        )}

        {paymentStatus === "error" && (
          <Alert className="mb-4" variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertTitle>Payment Failed</AlertTitle>
            <AlertDescription>
              There was an issue processing your payment. Please try again.
            </AlertDescription>
          </Alert>
        )}

        <Card className="glass-card border-0 mb-6">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-lg">Your Balance</CardTitle>
          </CardHeader>
          <CardContent className="text-center">
            <div className="text-4xl font-bold" data-testid="text-current-credits">
              {user?.contractCredits ?? 0}
            </div>
            <p className="text-muted-foreground">Contract Credits</p>
          </CardContent>
        </Card>

        <Card className="glass-card border-primary/30 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/5 pointer-events-none" />
          <CardHeader className="text-center relative">
            <CardTitle className="text-2xl">Contract Credit</CardTitle>
            <CardDescription>Create professional contracts with brands</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 relative">
            <div className="text-center">
              <span className="text-4xl font-bold">₹299</span>
              <span className="text-muted-foreground"> / credit</span>
            </div>
            <ul className="space-y-2">
              <li className="flex items-center gap-2 text-sm">
                <Check className="h-4 w-4 text-primary" />
                Create 1 professional contract
              </li>
              <li className="flex items-center gap-2 text-sm">
                <Check className="h-4 w-4 text-primary" />
                Auto-populate your profile details
              </li>
              <li className="flex items-center gap-2 text-sm">
                <Check className="h-4 w-4 text-primary" />
                Digital signature included
              </li>
              <li className="flex items-center gap-2 text-sm">
                <Check className="h-4 w-4 text-primary" />
                Generate invoices automatically
              </li>
            </ul>
          </CardContent>
          <CardFooter className="relative">
            <Button
              className="gradient-btn w-full text-white shadow-[0_0_20px_rgba(var(--primary-rgb,99,102,241),0.3)] hover:shadow-[0_0_30px_rgba(var(--primary-rgb,99,102,241),0.5)] transition-shadow"
              size="lg"
              onClick={handlePurchase}
              disabled={isLoading}
              data-testid="button-buy-credit"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <CreditCard className="h-4 w-4 mr-2" />
                  Buy 1 Contract Credit
                </>
              )}
            </Button>
          </CardFooter>
        </Card>

        <p className="text-xs text-center text-muted-foreground mt-6">
          Secure payment powered by PayU. Credits never expire.
        </p>
      </main>

      <BottomNav />
    </div>
  );
}
