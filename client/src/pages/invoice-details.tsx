import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams, Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/status-badge";
import { BottomNav } from "@/components/bottom-nav";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { 
  ArrowLeft, 
  Sparkles, 
  Calendar, 
  CreditCard,
  CheckCircle,
  Loader2,
  FileText
} from "lucide-react";
import type { Invoice, Deal } from "@shared/schema";

export default function InvoiceDetailsPage() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: invoice, isLoading } = useQuery<Invoice>({
    queryKey: ["/api/invoices", params.id],
  });

  const { data: deal } = useQuery<Deal>({
    queryKey: ["/api/deals", invoice?.dealId],
    enabled: !!invoice?.dealId,
  });

  const processPayment = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/invoices/${params.id}/pay`, {});
      return res.json();
    },
    onSuccess: (data: { url: string }) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: () => {
      toast({
        title: "Payment failed",
        description: "Unable to start payment. Please try again.",
        variant: "destructive",
      });
    },
  });

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background pb-20">
        <header className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border">
          <div className="flex items-center gap-3 px-4 py-4">
            <Button variant="ghost" size="icon" onClick={() => setLocation("/billing")}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <Skeleton className="h-6 w-32" />
          </div>
        </header>
        <main className="px-4 py-6 space-y-4">
          <Card className="border-0 shadow-md">
            <CardContent className="p-6 space-y-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-12 w-full" />
            </CardContent>
          </Card>
        </main>
        <BottomNav />
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="min-h-screen bg-background pb-20">
        <header className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border">
          <div className="flex items-center gap-3 px-4 py-4">
            <Button variant="ghost" size="icon" onClick={() => setLocation("/billing")}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <h1 className="text-xl font-bold">Invoice Details</h1>
          </div>
        </header>
        <main className="px-4 py-12 text-center">
          <p className="text-muted-foreground">Invoice not found</p>
          <Link href="/billing">
            <Button variant="outline" className="mt-4">Back to Billing</Button>
          </Link>
        </main>
        <BottomNav />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border">
        <div className="flex items-center gap-3 px-4 py-4">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => setLocation("/billing")}
            data-testid="button-back-billing"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-xl font-bold truncate flex-1">Invoice</h1>
          <StatusBadge status={invoice.status} />
        </div>
      </header>

      <main className="px-4 py-6 space-y-6">
        <Card className="border-0 shadow-md overflow-hidden">
          <div className="bg-primary/5 dark:bg-primary/10 px-6 py-4 border-b border-border">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
                  <Sparkles className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="font-bold">InfluDeal</p>
                  <p className="text-xs text-muted-foreground">Platform Invoice</p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-mono text-sm font-semibold" data-testid="text-invoice-number">
                  {invoice.invoiceNumber}
                </p>
                <p className="text-xs text-muted-foreground flex items-center gap-1 justify-end">
                  <Calendar className="w-3 h-3" />
                  {formatDate(invoice.invoiceDate)}
                </p>
              </div>
            </div>
          </div>

          <CardContent className="p-6 space-y-6">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                  Influencer
                </p>
                <p className="font-semibold" data-testid="text-influencer-name">
                  {invoice.influencerName}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                  Brand
                </p>
                <p className="font-semibold" data-testid="text-brand-name">
                  {invoice.brandName}
                </p>
              </div>
            </div>

            {deal && (
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="text-xs font-medium text-muted-foreground mb-1">Deal</p>
                <p className="font-medium text-sm">{deal.dealTitle}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {deal.deliverables.length} deliverable{deal.deliverables.length !== 1 ? "s" : ""} included
                </p>
              </div>
            )}

            <Separator />

            <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Charges
              </p>
              
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Contract Creation Fee</span>
                  <span className="font-medium">₹{invoice.contractFee.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Platform Service Fee</span>
                  <span className="font-medium">₹{invoice.platformFee.toLocaleString()}</span>
                </div>
              </div>

              <Separator />

              <div className="flex justify-between items-center">
                <span className="font-semibold">Total Amount</span>
                <span className="text-2xl font-bold text-primary" data-testid="text-total-amount">
                  ₹{invoice.totalAmount.toLocaleString()}
                </span>
              </div>
            </div>

            <div className="pt-2 text-center">
              <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                <FileText className="w-3 h-3" />
                Invoice generated via InfluDeal Platform
              </p>
            </div>
          </CardContent>
        </Card>

        {invoice.status === "Unpaid" ? (
          <Button
            className="w-full h-14 text-base font-semibold rounded-xl"
            onClick={() => processPayment.mutate()}
            disabled={processPayment.isPending}
            data-testid="button-pay-now"
          >
            {processPayment.isPending ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <CreditCard className="w-5 h-5 mr-2" />
                Proceed to Payment
              </>
            )}
          </Button>
        ) : (
          <Card className="border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20">
            <CardContent className="p-4 flex items-center gap-3">
              <CheckCircle className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
              <div>
                <p className="font-semibold text-emerald-900 dark:text-emerald-200">
                  Payment Complete
                </p>
                <p className="text-sm text-emerald-700 dark:text-emerald-300">
                  This invoice has been paid successfully
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        <p className="text-center text-xs text-muted-foreground">
          No subscription fees. Pay only per contract.
        </p>
      </main>

      <BottomNav />
    </div>
  );
}
