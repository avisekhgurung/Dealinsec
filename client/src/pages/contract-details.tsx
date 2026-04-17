import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams, Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
import { BottomNav } from "@/components/bottom-nav";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  ArrowLeft,
  Calendar,
  Shield,
  Upload,
  FileText,
  Loader2,
  CheckCircle,
  CheckCircle2,
  ExternalLink,
  Download,
  Scissors,
  Receipt
} from "lucide-react";
import { Input } from "@/components/ui/input";
import type { Contract, Deal, BrandInvoice } from "@shared/schema";

export default function ContractDetailsPage() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [showSplitInput, setShowSplitInput] = useState(false);
  const [splitPercentageStr, setSplitPercentageStr] = useState("50");
  const splitPercentage = Math.min(99, Math.max(1, parseInt(splitPercentageStr) || 50));

  const { data: contract, isLoading } = useQuery<Contract>({
    queryKey: ["/api/contracts", params.id],
  });

  const { data: deal } = useQuery<Deal>({
    queryKey: ["/api/deals", contract?.dealId],
    enabled: !!contract?.dealId,
  });

  const { data: dealBrandInvoices = [] } = useQuery<BrandInvoice[]>({
    queryKey: ["/api/deals", contract?.dealId, "brand-invoices"],
    queryFn: async () => {
      const res = await fetch(`/api/deals/${contract?.dealId}/brand-invoices`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!contract?.dealId,
  });

  const hasInvoice = dealBrandInvoices.length > 0;
  const hasProof = !!contract?.proofFileName;

  // Timeline step: 1=Deal done, 2=Quote done, 3=Agreement active/done, 4=Invoice
  const timelineStep = hasInvoice ? 4 : hasProof ? 4 : 3;

  const backPath = "/contracts";

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
      queryClient.invalidateQueries({ queryKey: ["/api/deals", contract?.dealId, "brand-invoices"] });
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

  const splitInvoices = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/deals/${contract?.dealId}/split-invoices`, {
        advancePercentage: splitPercentage,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/brand-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/deals", contract?.dealId, "brand-invoices"] });
      toast({ title: "Invoices created", description: "Advance and final invoices generated." });
      setShowSplitInput(false);
    },
    onError: () => {
      toast({
        title: "Failed to split invoice",
        description: "Could not create split invoices. Please try again.",
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
        <header className="glass-header sticky top-0 z-40">
          <div className="flex items-center gap-3 px-4 py-4">
            <Button variant="ghost" size="icon" onClick={() => setLocation(backPath)}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <Skeleton className="h-6 w-32" />
          </div>
        </header>
        <main className="px-4 py-6 space-y-4">
          <Card className="glass-card border-0">
            <CardContent className="p-6 space-y-4">
              <Skeleton className="h-8 w-3/4" />
              <Skeleton className="h-5 w-1/2" />
            </CardContent>
          </Card>
        </main>
        <BottomNav />
      </div>
    );
  }

  if (!contract) {
    return (
      <div className="min-h-screen bg-background pb-20">
        <header className="glass-header sticky top-0 z-40">
          <div className="flex items-center gap-3 px-4 py-4">
            <Button variant="ghost" size="icon" onClick={() => setLocation(backPath)}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <h1 className="text-xl font-bold">Agreement Details</h1>
          </div>
        </header>
        <main className="px-4 py-12 text-center">
          <p className="text-muted-foreground">Agreement not found</p>
          <Link href={backPath}>
            <Button variant="outline" className="mt-4">Back to Agreements</Button>
          </Link>
        </main>
        <BottomNav />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="glass-header sticky top-0 z-40">
        <div className="flex items-center justify-between gap-3 px-4 py-4">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setLocation(backPath)}
              data-testid="button-back-contracts"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <h1 className="text-xl font-bold truncate">Agreement Details</h1>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLocation(`/contracts/${params.id}/export`)}
            data-testid="button-export-contract-pdf"
          >
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
        </div>
      </header>

      <main className="px-4 py-6 space-y-6 animate-fade-in">

        {/* 4-step workflow timeline */}
        <div className="flex items-center justify-between px-1">
          {[
            { label: "Deal",      step: 1 },
            { label: "Quote",     step: 2 },
            { label: "Agreement", step: 3 },
            { label: "Invoice",   step: 4 },
          ].map((s, idx, arr) => {
            const isDone   = s.step < timelineStep || (s.step === 3 && hasInvoice) || (s.step === 4 && hasInvoice);
            const isActive = s.step === timelineStep && !hasInvoice;
            return (
              <div key={s.step} className="flex items-center flex-1">
                <div className="flex flex-col items-center gap-0.5">
                  <div
                    className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold transition-all
                      ${isDone
                        ? "bg-emerald-500 text-white shadow-sm shadow-emerald-200 dark:shadow-emerald-900"
                        : isActive
                        ? "bg-amber-400 text-white shadow-sm shadow-amber-200 dark:shadow-amber-900 ring-2 ring-amber-300/50"
                        : "bg-muted text-muted-foreground"
                      }`}
                  >
                    {isDone ? <CheckCircle2 className="w-3.5 h-3.5" /> : s.step}
                  </div>
                  <span
                    className={`text-[10px] font-semibold whitespace-nowrap
                      ${isDone ? "text-emerald-600 dark:text-emerald-400"
                        : isActive ? "text-amber-600 dark:text-amber-400"
                        : "text-muted-foreground"}`}
                  >
                    {s.label}
                  </span>
                </div>
                {idx < arr.length - 1 && (
                  <div
                    className={`flex-1 h-0.5 mx-1 rounded-full transition-colors
                      ${s.step < timelineStep ? "bg-emerald-400" : "bg-muted"}`}
                  />
                )}
              </div>
            );
          })}
        </div>

        <Card className="glass-card border-0">
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

            <div className="space-y-3 py-4 border-y border-white/10">
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
              <Link href={`/deals/${deal.id}`}>
                <div className="mt-4 p-3 rounded-lg bg-muted/50 flex items-center justify-between hover-elevate active-elevate-2 cursor-pointer">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm">View linked deal</span>
                  </div>
                  <ExternalLink className="w-4 h-4 text-muted-foreground" />
                </div>
              </Link>
            )}

            <div className="mt-4">
              <div className={`p-4 rounded-lg flex items-center gap-3 ${
                contract.signedByBrand
                  ? "bg-emerald-50 dark:bg-emerald-900/20"
                  : "bg-amber-50 dark:bg-amber-900/20"
              }`}>
                {contract.signedByBrand ? (
                  <CheckCircle className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <Calendar className="w-6 h-6 text-amber-600 dark:text-amber-400" />
                )}
                <div className="flex-1">
                  <p className={`text-sm font-semibold ${
                    contract.signedByBrand
                      ? "text-emerald-700 dark:text-emerald-300"
                      : "text-amber-700 dark:text-amber-300"
                  }`}>
                    Brand Authorization
                  </p>
                  <p className={`text-xs ${
                    contract.signedByBrand
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-amber-600 dark:text-amber-400"
                  }`}>
                    {contract.signedByBrand && contract.signedDate
                      ? `Signed on ${formatDate(contract.signedDate)}`
                      : "Awaiting brand signature"}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Download Agreement PDF — prominent CTA ── */}
        <Card className="glass-card border-0 overflow-hidden">
          <div className="bg-gradient-to-r from-violet-600 to-indigo-600 px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-white/20 backdrop-blur-sm">
                <FileText className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-white font-bold text-base">Agreement PDF</h3>
                <p className="text-white/75 text-xs leading-snug">
                  Download &amp; send to {contract.brandName} for signing
                </p>
              </div>
            </div>
          </div>
          <CardContent className="p-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              A professional agreement document with all deal terms, deliverables, timeline, and signature blocks — ready for the brand to review and sign.
            </p>
            <Button
              className="w-full h-12 font-semibold rounded-xl gradient-btn text-white"
              onClick={() => setLocation(`/contracts/${params.id}/export`)}
              data-testid="button-download-agreement-pdf"
            >
              <Download className="w-5 h-5 mr-2" />
              View &amp; Download Agreement PDF
            </Button>
          </CardContent>
        </Card>

        <section className="space-y-3">
            <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Contract Proof
            </h3>

            <Card className="glass-card border-0">
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

        <section className="space-y-3">
            <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Invoice for Brand
            </h3>

            <Card className="glass-card border-0">
              <CardContent className="p-4">
                {!hasInvoice ? (
                  <>
                    <div className="flex items-center gap-3 mb-4">
                      <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                        <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-sm">Generate Invoice for Brand</p>
                        <p className="text-xs text-muted-foreground">
                          {contract.status !== "Signed"
                            ? "Upload signed contract proof to enable billing"
                            : `Create a professional invoice to send to ${contract.brandName}`}
                        </p>
                      </div>
                    </div>

                    {/* Single invoice */}
                    <Button
                      className="w-full gradient-btn text-white mb-2"
                      onClick={() => createBrandInvoice.mutate()}
                      disabled={createBrandInvoice.isPending || !contract || !deal || contract.status !== "Signed"}
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
                          Generate Single Invoice
                        </>
                      )}
                    </Button>

                    {/* Split invoice toggle */}
                    {!showSplitInput ? (
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => setShowSplitInput(true)}
                        disabled={contract.status !== "Signed"}
                      >
                        <Scissors className="w-4 h-4 mr-2" />
                        Split Invoice (Advance + Final)
                      </Button>
                    ) : (
                      <div className="border border-white/10 rounded-lg p-3 space-y-3">
                        <p className="text-sm font-medium">Split into Advance + Final</p>
                        <div className="flex items-center gap-3">
                          <label className="text-xs text-muted-foreground whitespace-nowrap">Advance %</label>
                          <Input
                            type="text"
                            inputMode="numeric"
                            value={splitPercentageStr}
                            onChange={(e) => setSplitPercentageStr(e.target.value.replace(/[^0-9]/g, ""))}
                            className="w-20 h-8 text-sm"
                            placeholder="50"
                          />
                          <span className="text-xs text-muted-foreground">
                            ₹{Math.round((deal?.dealAmount || 0) * splitPercentage / 100).toLocaleString()} + ₹{((deal?.dealAmount || 0) - Math.round((deal?.dealAmount || 0) * splitPercentage / 100)).toLocaleString()}
                          </span>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            className="flex-1 gradient-btn text-white"
                            onClick={() => splitInvoices.mutate()}
                            disabled={!deal || splitInvoices.isPending}
                          >
                            {splitInvoices.isPending ? (
                              <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Creating...
                              </>
                            ) : (
                              "Create Split Invoices"
                            )}
                          </Button>
                          <Button variant="outline" onClick={() => setShowSplitInput(false)} disabled={splitInvoices.isPending}>Cancel</Button>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                      <CheckCircle className="w-4 h-4" />
                      Invoice{dealBrandInvoices.length > 1 ? "s" : ""} Generated
                    </p>
                    {dealBrandInvoices.map(inv => (
                      <Link key={inv.id} href={`/brand-invoices/${inv.id}`}>
                        <div className="flex items-center justify-between p-3 rounded-xl border bg-card shadow-sm hover-elevate cursor-pointer">
                          <div className="flex items-center gap-3">
                            <div className={`flex items-center justify-center w-9 h-9 rounded-lg ${
                              (inv as any).invoiceType === "advance"
                                ? "bg-blue-100 dark:bg-blue-900/30"
                                : (inv as any).invoiceType === "final"
                                ? "bg-violet-100 dark:bg-violet-900/30"
                                : "bg-gray-100 dark:bg-gray-800/30"
                            }`}>
                              <Receipt className={`w-4 h-4 ${
                                (inv as any).invoiceType === "advance"
                                  ? "text-blue-600 dark:text-blue-400"
                                  : (inv as any).invoiceType === "final"
                                  ? "text-violet-600 dark:text-violet-400"
                                  : "text-muted-foreground"
                              }`} />
                            </div>
                            <div>
                              <span className="text-sm font-medium block">
                                {(inv as any).invoiceType === "advance" ? "Advance Invoice" : (inv as any).invoiceType === "final" ? "Final Invoice" : "Invoice"}
                              </span>
                              <span className="text-xs text-muted-foreground">₹{inv.dealAmount.toLocaleString()}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge
                              variant={inv.status === "Paid" ? "default" : "secondary"}
                              className={`text-xs ${inv.status === "Paid" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : ""}`}
                            >
                              {inv.status}
                            </Badge>
                            <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </section>
      </main>

      <BottomNav />
    </div>
  );
}
