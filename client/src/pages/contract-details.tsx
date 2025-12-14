import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams, Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
import { BottomNav } from "@/components/bottom-nav";
import { BrandBottomNav } from "@/components/brand-bottom-nav";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { 
  ArrowLeft, 
  Calendar, 
  Shield, 
  Upload, 
  FileText, 
  Receipt, 
  Loader2,
  CheckCircle,
  ExternalLink
} from "lucide-react";
import type { Contract, Invoice, Deal } from "@shared/schema";

export default function ContractDetailsPage() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const isBrand = user?.role === "brand";
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const { data: contract, isLoading } = useQuery<Contract>({
    queryKey: ["/api/contracts", params.id],
  });

  const { data: invoices = [] } = useQuery<Invoice[]>({
    queryKey: ["/api/invoices"],
    enabled: !isBrand,
  });

  const { data: deal } = useQuery<Deal>({
    queryKey: ["/api/deals", contract?.dealId],
    enabled: !!contract?.dealId,
  });

  const contractId = parseInt(params.id || "0");
  const invoice = invoices.find(i => i.contractId === contractId);
  
  const backPath = isBrand ? "/brand/contracts" : "/contracts";
  const Nav = isBrand ? BrandBottomNav : BottomNav;

  const uploadProof = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("proof", file);
      
      const response = await fetch(`/api/contracts/${params.id}/proof`, {
        method: "POST",
        body: formData,
      });
      
      if (!response.ok) throw new Error("Upload failed");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contracts", params.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/contracts"] });
      toast({
        title: "Proof uploaded",
        description: "Contract proof has been uploaded successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Upload failed",
        description: "Failed to upload proof. Please try again.",
        variant: "destructive",
      });
    },
  });

  const createBrandInvoice = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/brand-invoices", {
        dealId: contract?.dealId,
        brandName: contract?.brandName,
        dealAmount: deal?.dealAmount || contract?.contractValue,
        contractId: parseInt(params.id || "0"),
      });
      return res.json();
    },
    onSuccess: (invoice) => {
      queryClient.invalidateQueries({ queryKey: ["/api/brand-invoices"] });
      toast({
        title: "Invoice created",
        description: "Brand invoice has been generated successfully.",
      });
      setLocation(`/brand-invoices/${invoice.id}`);
    },
    onError: () => {
      toast({
        title: "Failed to create invoice",
        description: "Could not generate brand invoice. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
    if (!validTypes.includes(file.type)) {
      toast({
        title: "Invalid file type",
        description: "Please upload a PDF or image file.",
        variant: "destructive",
      });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Maximum file size is 5MB.",
        variant: "destructive",
      });
      return;
    }

    setUploading(true);
    try {
      await uploadProof.mutateAsync(file);
    } finally {
      setUploading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background pb-20">
        <header className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border">
          <div className="flex items-center gap-3 px-4 py-4">
            <Button variant="ghost" size="icon" onClick={() => setLocation(backPath)}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <Skeleton className="h-6 w-32" />
          </div>
        </header>
        <main className="px-4 py-6 space-y-4">
          <Card className="border-0 shadow-md">
            <CardContent className="p-6 space-y-4">
              <Skeleton className="h-8 w-3/4" />
              <Skeleton className="h-5 w-1/2" />
            </CardContent>
          </Card>
        </main>
        <Nav />
      </div>
    );
  }

  if (!contract) {
    return (
      <div className="min-h-screen bg-background pb-20">
        <header className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border">
          <div className="flex items-center gap-3 px-4 py-4">
            <Button variant="ghost" size="icon" onClick={() => setLocation(backPath)}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <h1 className="text-xl font-bold">Contract Details</h1>
          </div>
        </header>
        <main className="px-4 py-12 text-center">
          <p className="text-muted-foreground">Contract not found</p>
          <Link href={backPath}>
            <Button variant="outline" className="mt-4">Back to Contracts</Button>
          </Link>
        </main>
        <Nav />
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
            onClick={() => setLocation(backPath)}
            data-testid="button-back-contracts"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-xl font-bold truncate flex-1">Contract Details</h1>
        </div>
      </header>

      <main className="px-4 py-6 space-y-6">
        <Card className="border-0 shadow-md">
          <CardContent className="p-6">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="flex-1 min-w-0">
                <h2 className="text-xl font-bold truncate" data-testid="text-contract-name">
                  {contract.contractName}
                </h2>
                <p className="text-muted-foreground">{contract.brandName}</p>
              </div>
              <StatusBadge status={contract.status} />
            </div>

            <div className="flex flex-wrap gap-2 mb-4">
              {contract.exclusive && (
                <Badge 
                  variant="secondary"
                  className="bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400 no-default-hover-elevate no-default-active-elevate"
                >
                  <Shield className="w-3 h-3 mr-1" />
                  Exclusive Contract
                </Badge>
              )}
            </div>

            <div className="space-y-3 py-4 border-y border-border">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  Contract Period
                </span>
                <span className="font-medium">
                  {formatDate(contract.startDate)} - {formatDate(contract.endDate)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Contract Value</span>
                <span className="font-bold text-lg text-primary">
                  ₹{contract.contractValue.toLocaleString()}
                </span>
              </div>
            </div>

            {deal && (
              <Link href={isBrand ? `/brand/deals/${deal.id}` : `/deals/${deal.id}`}>
                <div className="mt-4 p-3 rounded-lg bg-muted/50 flex items-center justify-between hover-elevate active-elevate-2 cursor-pointer">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm">View linked deal</span>
                  </div>
                  <ExternalLink className="w-4 h-4 text-muted-foreground" />
                </div>
              </Link>
            )}
          </CardContent>
        </Card>

        {!isBrand && (
          <section className="space-y-3">
            <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Contract Proof
            </h3>
            
            <Card className="border shadow-sm">
              <CardContent className="p-4">
                {contract.proofFileName ? (
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                      <CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate" data-testid="text-proof-filename">
                        {contract.proofFileName}
                      </p>
                      <p className="text-xs text-muted-foreground">Proof uploaded</p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                    >
                      Replace
                    </Button>
                  </div>
                ) : (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="w-full h-32 border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-2 text-muted-foreground hover-elevate active-elevate-2 transition-colors"
                    data-testid="button-upload-proof"
                  >
                    {uploading ? (
                      <>
                        <Loader2 className="w-6 h-6 animate-spin" />
                        <span className="text-sm">Uploading...</span>
                      </>
                    ) : (
                      <>
                        <Upload className="w-6 h-6" />
                        <span className="text-sm font-medium">Upload Contract Proof</span>
                        <span className="text-xs">PDF or Image (max 5MB)</span>
                      </>
                    )}
                  </button>
                )}
                
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp"
                  className="hidden"
                  onChange={handleFileSelect}
                />
              </CardContent>
            </Card>
          </section>
        )}

        {!isBrand && (
          <section className="space-y-3">
            <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Invoice & Payment
            </h3>
            
            {invoice ? (
              <Link href={`/billing/${invoice.id}`}>
                <Card className="border shadow-sm hover-elevate active-elevate-2 cursor-pointer">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className={`flex items-center justify-center w-10 h-10 rounded-lg ${
                          invoice.status === "Paid"
                            ? "bg-emerald-100 dark:bg-emerald-900/30"
                            : "bg-amber-100 dark:bg-amber-900/30"
                        }`}>
                          <Receipt className={`w-5 h-5 ${
                            invoice.status === "Paid"
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-amber-600 dark:text-amber-400"
                          }`} />
                        </div>
                        <div>
                          <p className="font-medium text-sm">{invoice.invoiceNumber}</p>
                          <p className="text-xs text-muted-foreground">
                            ₹{invoice.totalAmount.toLocaleString()}
                          </p>
                        </div>
                      </div>
                      <StatusBadge status={invoice.status} />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ) : (
              <Card className="border shadow-sm">
                <CardContent className="py-8 text-center">
                  <Receipt className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No invoice generated yet</p>
                </CardContent>
              </Card>
            )}
          </section>
        )}

        {!isBrand && (
          <section className="space-y-3">
            <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Invoice for Brand
            </h3>
            
            <Card className="border shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                    <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-sm">Generate Invoice for Brand</p>
                    <p className="text-xs text-muted-foreground">
                      Create a professional invoice to send to {contract.brandName}
                    </p>
                  </div>
                </div>
                <Button 
                  className="w-full"
                  onClick={() => createBrandInvoice.mutate()}
                  disabled={createBrandInvoice.isPending || !contract || !deal}
                  data-testid="button-generate-brand-invoice"
                >
                  {createBrandInvoice.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <FileText className="w-4 h-4 mr-2" />
                      Generate Invoice for Brand
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          </section>
        )}
      </main>

      <Nav />
    </div>
  );
}
