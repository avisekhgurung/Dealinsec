import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { BottomNav } from "@/components/bottom-nav";
import { ArrowLeft, Download, FileText, Calendar, Building2, User } from "lucide-react";
import type { BrandInvoice, Deal } from "@shared/schema";

export default function BrandInvoiceDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();

  const { data: invoice, isLoading } = useQuery<BrandInvoice>({
    queryKey: ["/api/brand-invoices", id],
  });

  const { data: deal } = useQuery<Deal>({
    queryKey: ["/api/deals", invoice?.dealId],
    enabled: !!invoice?.dealId,
  });

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  };

  const handleExportPDF = () => {
    window.print();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background pb-20">
        <header className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border">
          <div className="flex items-center gap-3 px-4 py-4">
            <Skeleton className="h-9 w-9" />
            <Skeleton className="h-6 w-32" />
          </div>
        </header>
        <div className="px-4 py-6 space-y-4">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="min-h-screen bg-background pb-20">
        <header className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border">
          <div className="flex items-center gap-3 px-4 py-4">
            <Button variant="ghost" size="icon" onClick={() => setLocation("/billing")} data-testid="button-back">
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <h1 className="text-xl font-bold">Invoice Not Found</h1>
          </div>
        </header>
        <BottomNav />
      </div>
    );
  }

  return (
    <>
      <div className="min-h-screen bg-background pb-20 print:pb-0 print:min-h-0">
        <header className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border print:hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-4">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" onClick={() => setLocation("/billing")} data-testid="button-back">
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <h1 className="text-xl font-bold">Invoice</h1>
            </div>
            <Button onClick={handleExportPDF} data-testid="button-export-pdf">
              <Download className="w-4 h-4 mr-2" />
              Export PDF
            </Button>
          </div>
        </header>

        <main className="px-4 py-6 space-y-6 print:px-8 print:py-4">
          <div className="print:block hidden mb-8">
            <h1 className="text-3xl font-bold text-center">INVOICE</h1>
          </div>

          <Card className="print:shadow-none print:border-0">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-muted-foreground" />
                  <CardTitle className="text-lg">{invoice.invoiceNumber}</CardTitle>
                </div>
                <Badge variant={invoice.status === "Paid" ? "default" : "secondary"} data-testid="status-badge">
                  {invoice.status}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Invoice Date</p>
                  <p className="font-medium">{formatDate(invoice.invoiceDate)}</p>
                </div>
                {invoice.dueDate && (
                  <div>
                    <p className="text-muted-foreground">Due Date</p>
                    <p className="font-medium">{formatDate(invoice.dueDate)}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="grid md:grid-cols-2 gap-4">
            <Card className="print:shadow-none print:border">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-muted-foreground" />
                  <CardTitle className="text-sm font-medium text-muted-foreground">FROM</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <p className="font-semibold">{invoice.influencerName}</p>
                {invoice.influencerEmail && (
                  <p className="text-sm text-muted-foreground">{invoice.influencerEmail}</p>
                )}
              </CardContent>
            </Card>

            <Card className="print:shadow-none print:border">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-muted-foreground" />
                  <CardTitle className="text-sm font-medium text-muted-foreground">TO</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <p className="font-semibold">{invoice.brandName}</p>
              </CardContent>
            </Card>
          </div>

          <Card className="print:shadow-none print:border">
            <CardHeader>
              <CardTitle className="text-base">Invoice Details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="border rounded-md overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-3 font-medium">Description</th>
                      <th className="text-right p-3 font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t">
                      <td className="p-3">
                        <p className="font-medium">{deal?.dealTitle || "Brand Deal"}</p>
                        {deal && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {formatDate(deal.startDate)} - {formatDate(deal.endDate)}
                          </p>
                        )}
                      </td>
                      <td className="p-3 text-right font-semibold">
                        ₹{invoice.dealAmount.toLocaleString("en-IN")}
                      </td>
                    </tr>
                  </tbody>
                  <tfoot className="bg-muted/30">
                    <tr className="border-t-2">
                      <td className="p-3 font-bold">Total Amount</td>
                      <td className="p-3 text-right font-bold text-lg">
                        ₹{invoice.dealAmount.toLocaleString("en-IN")}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CardContent>
          </Card>

          {invoice.notes && (
            <Card className="print:shadow-none print:border">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{invoice.notes}</p>
              </CardContent>
            </Card>
          )}

          <div className="print:block hidden mt-12 pt-8 border-t text-center text-sm text-muted-foreground">
            <p>Thank you for your business!</p>
            <p className="mt-2">Generated via InfluDeal</p>
          </div>
        </main>

        <div className="print:hidden">
          <BottomNav />
        </div>
      </div>

      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .print\\:block,
          .print\\:block * {
            visibility: visible;
          }
          main, main * {
            visibility: visible;
          }
          main {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }
        }
      `}</style>
    </>
  );
}
