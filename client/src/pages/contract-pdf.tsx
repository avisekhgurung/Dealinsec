import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { ArrowLeft, Download, FileText, Calendar, Building2, User, Shield, CheckCircle } from "lucide-react";
import type { Contract, Deal } from "@shared/schema";

export default function ContractPdfPage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const isBrand = user?.role === "brand";
  const backPath = isBrand ? `/brand/contracts/${id}` : `/contracts/${id}`;
  const contractsPath = isBrand ? "/brand/contracts" : "/contracts";

  const { data: contract, isLoading } = useQuery<Contract>({
    queryKey: ["/api/contracts", id],
  });

  const { data: deal } = useQuery<Deal>({
    queryKey: ["/api/deals", contract?.dealId],
    enabled: !!contract?.dealId,
  });

  const { data: influencer } = useQuery<{ id: string; firstName: string; lastName: string; role: string }>({
    queryKey: ["/api/users", deal?.userId, "public"],
    enabled: !!deal?.userId,
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

  if (!contract) {
    return (
      <div className="min-h-screen bg-background pb-20">
        <header className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border">
          <div className="flex items-center gap-3 px-4 py-4">
            <Button variant="ghost" size="icon" onClick={() => setLocation(contractsPath)} data-testid="button-back">
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <h1 className="text-xl font-bold">Contract Not Found</h1>
          </div>
        </header>
      </div>
    );
  }

  return (
    <>
      <div className="min-h-screen bg-background pb-20 print:pb-0 print:min-h-0">
        <header className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border print:hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-4">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" onClick={() => setLocation(backPath)} data-testid="button-back">
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <h1 className="text-xl font-bold">Contract</h1>
            </div>
            <Button onClick={handleExportPDF} data-testid="button-export-pdf">
              <Download className="w-4 h-4 mr-2" />
              Export PDF
            </Button>
          </div>
        </header>

        <main className="px-4 py-6 space-y-6 print:px-8 print:py-4">
          <div className="print:block hidden mb-8">
            <h1 className="text-3xl font-bold text-center">CONTRACT AGREEMENT</h1>
          </div>

          <Card className="print:shadow-none print:border-0">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-muted-foreground" />
                  <CardTitle className="text-lg" data-testid="text-contract-name">{contract.contractName}</CardTitle>
                </div>
                <Badge variant={contract.status === "Active" ? "default" : "secondary"} data-testid="status-badge">
                  {contract.status}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Start Date</p>
                  <p className="font-medium">{formatDate(contract.startDate)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">End Date</p>
                  <p className="font-medium">{formatDate(contract.endDate)}</p>
                </div>
              </div>
              {contract.exclusive && (
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-violet-600" />
                  <span className="text-sm font-medium text-violet-700 dark:text-violet-400">Exclusive Contract</span>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid md:grid-cols-2 gap-4">
            <Card className="print:shadow-none print:border">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-muted-foreground" />
                  <CardTitle className="text-sm font-medium text-muted-foreground">INFLUENCER</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <p className="font-semibold" data-testid="text-influencer-name">
                  {influencer ? `${influencer.firstName} ${influencer.lastName}` : (isBrand ? "Content Creator" : `${user?.firstName} ${user?.lastName}`)}
                </p>
                <p className="text-sm text-muted-foreground">Content Creator</p>
              </CardContent>
            </Card>

            <Card className="print:shadow-none print:border">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-muted-foreground" />
                  <CardTitle className="text-sm font-medium text-muted-foreground">BRAND</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <p className="font-semibold" data-testid="text-brand-name">{contract.brandName}</p>
                <p className="text-sm text-muted-foreground">Client</p>
              </CardContent>
            </Card>
          </div>

          <Card className="print:shadow-none print:border">
            <CardHeader>
              <CardTitle className="text-base">Contract Details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="border rounded-md overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-3 font-medium">Description</th>
                      <th className="text-right p-3 font-medium">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t">
                      <td className="p-3">
                        <p className="font-medium">{deal?.dealTitle || contract.contractName}</p>
                      </td>
                      <td className="p-3 text-right font-semibold" data-testid="text-contract-value">
                        ₹{contract.contractValue.toLocaleString("en-IN")}
                      </td>
                    </tr>
                    {deal && deal.deliverables && deal.deliverables.map((deliverable, index) => (
                      <tr className="border-t" key={deliverable.id || index}>
                        <td className="p-3">
                          <p className="text-muted-foreground text-xs">Deliverable {index + 1}</p>
                          <p className="text-sm">{deliverable.platform} - {deliverable.quantity} {deliverable.contentType}(s) - {deliverable.frequency}</p>
                        </td>
                        <td className="p-3"></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-muted/30">
                    <tr className="border-t-2">
                      <td className="p-3 font-bold">Total Contract Value</td>
                      <td className="p-3 text-right font-bold text-lg">
                        ₹{contract.contractValue.toLocaleString("en-IN")}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card className="print:shadow-none print:border">
            <CardHeader>
              <CardTitle className="text-base">Signatures</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-6">
                By signing below, both parties agree to the terms and conditions outlined in this contract.
              </p>
              <div className="grid md:grid-cols-2 gap-8">
                <div className="space-y-4">
                  <p className="font-medium">Influencer</p>
                  <div className="border-b border-foreground pt-16 pb-1">
                    <p className="text-xs text-muted-foreground">Signature</p>
                  </div>
                  <div className="border-b border-foreground pt-8 pb-1">
                    <p className="text-xs text-muted-foreground">Name: {influencer ? `${influencer.firstName} ${influencer.lastName}` : `${user?.firstName} ${user?.lastName}`}</p>
                  </div>
                  <div className="border-b border-foreground pt-8 pb-1">
                    <p className="text-xs text-muted-foreground">Date</p>
                  </div>
                </div>
                <div className="space-y-4">
                  <p className="font-medium">Brand Representative</p>
                  <div className="border-b border-foreground pt-16 pb-1">
                    <p className="text-xs text-muted-foreground">Signature</p>
                  </div>
                  <div className="border-b border-foreground pt-8 pb-1">
                    <p className="text-xs text-muted-foreground">Name</p>
                  </div>
                  <div className="border-b border-foreground pt-8 pb-1">
                    <p className="text-xs text-muted-foreground">Date</p>
                  </div>
                  <div className="border-dashed border-2 border-muted-foreground p-4 mt-4 text-center">
                    <p className="text-xs text-muted-foreground">Company Stamp</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="print:block hidden mt-12 pt-8 border-t text-center text-sm text-muted-foreground">
            <p>This document serves as a legal agreement between the parties mentioned above.</p>
            <p className="mt-2">Generated via InfluDeal</p>
          </div>
        </main>
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
