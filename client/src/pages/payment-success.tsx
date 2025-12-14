import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BottomNav } from "@/components/bottom-nav";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { CheckCircle, Loader2, XCircle } from "lucide-react";

export default function PaymentSuccessPage() {
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");

  const urlParams = new URLSearchParams(window.location.search);
  const invoiceId = urlParams.get("invoice_id");
  const sessionId = urlParams.get("session_id");
  const [hasConfirmed, setHasConfirmed] = useState(false);

  const confirmPayment = useMutation({
    mutationFn: async () => {
      if (!invoiceId || !sessionId) {
        throw new Error("Missing required parameters");
      }
      const res = await apiRequest("POST", `/api/invoices/${invoiceId}/confirm-payment`, {
        session_id: sessionId,
      });
      return res.json();
    },
    onSuccess: () => {
      setStatus("success");
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices", invoiceId] });
      queryClient.invalidateQueries({ queryKey: ["/api/contracts"] });
    },
    onError: () => {
      setStatus("error");
    },
  });

  useEffect(() => {
    if (hasConfirmed) return;
    
    if (!invoiceId || !sessionId) {
      setStatus("error");
      return;
    }
    
    setHasConfirmed(true);
    confirmPayment.mutate();
  }, [invoiceId, sessionId, hasConfirmed]);

  return (
    <div className="min-h-screen bg-background pb-20">
      <main className="px-4 py-12 flex flex-col items-center justify-center min-h-[70vh]">
        {status === "loading" && (
          <Card className="w-full max-w-md">
            <CardContent className="p-8 text-center space-y-4">
              <Loader2 className="w-12 h-12 mx-auto animate-spin text-primary" />
              <h1 className="text-xl font-bold">Confirming Payment</h1>
              <p className="text-muted-foreground">
                Please wait while we verify your payment...
              </p>
            </CardContent>
          </Card>
        )}

        {status === "success" && (
          <Card className="w-full max-w-md border-emerald-200 dark:border-emerald-800">
            <CardContent className="p-8 text-center space-y-4">
              <div className="w-16 h-16 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                <CheckCircle className="w-10 h-10 text-emerald-600 dark:text-emerald-400" />
              </div>
              <h1 className="text-2xl font-bold text-emerald-900 dark:text-emerald-200">
                Payment Successful
              </h1>
              <p className="text-muted-foreground">
                Your invoice has been paid and your contract is now active.
              </p>
              <div className="pt-4 space-y-2">
                <Button 
                  className="w-full" 
                  onClick={() => setLocation("/billing")}
                  data-testid="button-view-billing"
                >
                  View Billing
                </Button>
                <Button 
                  variant="outline" 
                  className="w-full" 
                  onClick={() => setLocation("/contracts")}
                  data-testid="button-view-contracts"
                >
                  View Contracts
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {status === "error" && (
          <Card className="w-full max-w-md border-destructive/50">
            <CardContent className="p-8 text-center space-y-4">
              <div className="w-16 h-16 mx-auto rounded-full bg-destructive/10 flex items-center justify-center">
                <XCircle className="w-10 h-10 text-destructive" />
              </div>
              <h1 className="text-2xl font-bold">Payment Verification Failed</h1>
              <p className="text-muted-foreground">
                We couldn't verify your payment. If you were charged, please contact support.
              </p>
              <div className="pt-4">
                <Button 
                  className="w-full" 
                  onClick={() => setLocation("/billing")}
                  data-testid="button-back-billing"
                >
                  Back to Billing
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </main>
      <BottomNav />
    </div>
  );
}
