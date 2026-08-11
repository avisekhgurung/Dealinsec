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
import { memberCan } from "@shared/permissions";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/confirm-dialog";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useUpgradeModal } from "@/components/upgrade-modal";
import { parseApiError, isUpgradeError } from "@/lib/api-error";
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
  Receipt,
  Trash2,
  Pencil,
  IndianRupee,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Landmark } from "lucide-react";
import type { Contract, Deal, BrandInvoice } from "@shared/schema";
import { recordNo } from "@shared/schema";

export default function ContractDetailsPage() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const canInvoice = memberCan(user as any, "invoices.create");
  const canAgree = memberCan(user as any, "agreements.create");
  const confirm = useConfirm();
  const { openUpgradeModal } = useUpgradeModal();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  // Invoice amount, split and bank-details capture all moved to the invoice
  // composer (/brand-invoices/new). This page only links to it now.

  // Inline edit of existing invoice amount (post-creation correction only)
  const [editingInvoiceId, setEditingInvoiceId] = useState<number | null>(null);
  const [editAmount, setEditAmount] = useState("");

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

  const deleteBrandInvoice = useMutation({
    mutationFn: async (invoiceId: number) => {
      const res = await fetch(`/api/brand-invoices/${invoiceId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        // Standard "STATUS: json" shape so parseApiError can route gate errors.
        const text = await res.text().catch(() => "");
        throw new Error(`${res.status}: ${text}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/brand-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/deals", contract?.dealId, "brand-invoices"] });
      toast({ title: "Invoice deleted" });
    },
    onError: (err: any) => {
      const parsed = parseApiError(err);
      if (isUpgradeError(parsed)) {
        openUpgradeModal({ feature: "invoices" });
        return;
      }
      toast({
        title: "Failed to delete invoice",
        description: parsed.error || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const updateInvoiceAmount = useMutation({
    mutationFn: async ({ invoiceId, amount }: { invoiceId: number; amount: number }) => {
      const res = await apiRequest("PATCH", `/api/brand-invoices/${invoiceId}`, { dealAmount: amount });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/brand-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/deals", contract?.dealId, "brand-invoices"] });
      toast({ title: "Invoice amount updated" });
      setEditingInvoiceId(null);
      setEditAmount("");
    },
    onError: (err: any) => {
      const parsed = parseApiError(err);
      if (isUpgradeError(parsed)) {
        openUpgradeModal({ feature: "payment_tracking" });
        return;
      }
      toast({
        title: "Failed to update amount",
        description: parsed.error || "Please try again.",
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
          <div className="flex items-center gap-3 px-4 py-4 lg:max-w-[1600px] lg:mx-auto lg:px-8 lg:py-3.5">
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
          <div className="flex items-center gap-3 px-4 py-4 lg:max-w-[1600px] lg:mx-auto lg:px-8 lg:py-3.5">
            <Button variant="ghost" size="icon" onClick={() => setLocation(backPath)}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <h1 className="text-xl lg:text-lg font-bold lg:font-semibold">Agreement Details</h1>
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

      <main className="px-4 py-6 space-y-6 animate-fade-in lg:max-w-[1600px] lg:mx-auto lg:px-8 lg:py-8 lg:space-y-8">

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

        <div className="lg:grid lg:grid-cols-3 lg:gap-6 lg:items-start">
        <div className="lg:col-span-2 space-y-6">
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
                  className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 no-default-hover-elevate no-default-active-elevate"
                >
                  <Shield className="w-3 h-3 mr-1" />
                  Exclusive Contract
                </Badge>
              )}
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 py-4">
              <div className="rounded-xl border border-border/60 bg-card/40 p-3.5">
                <p className="text-xs text-muted-foreground mb-1.5">Contract Value</p>
                <p className="font-bold text-xl text-primary tabular-nums">₹{contract.contractValue.toLocaleString("en-IN")}</p>
              </div>
              <div className="rounded-xl border border-border/60 bg-card/40 p-3.5">
                <p className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> Contract Period</p>
                <p className="font-semibold text-sm leading-snug">{formatDate(contract.startDate)} – {formatDate(contract.endDate)}</p>
              </div>
              <div className="rounded-xl border border-border/60 bg-card/40 p-3.5 col-span-2 lg:col-span-1">
                <p className="text-xs text-muted-foreground mb-1.5">{contract.signedByBrand ? "Signed On" : "Created For"}</p>
                <p className="font-semibold text-sm leading-snug flex items-center gap-1.5">
                  {contract.signedByBrand && contract.signedDate
                    ? <><CheckCircle className="w-4 h-4 text-emerald-500" /> {formatDate(contract.signedDate)}</>
                    : deal
                      ? <Link href={`/deals/${deal.id}`} className="text-primary hover:underline inline-flex items-center gap-1">DL-{deal.id} <ExternalLink className="w-3.5 h-3.5" /></Link>
                      : "—"}
                </p>
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

            {/* Execution record — mirrors the printable document so the team
                sees who is bound and what the signature means WITHOUT having to
                open the export. Wording per ESIGN_RECOMMENDATION.md: this is
                electronic acceptance, never a Digital Signature Certificate. */}
            <div className="mt-4 pt-4 border-t border-border">
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Execution record
                </p>
                <span className="font-mono text-[11px] font-semibold text-muted-foreground">
                  {recordNo("agreement", contract.id)}
                </span>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs mb-3">
                <div>
                  <dt className="text-muted-foreground">Signed by</dt>
                  <dd className="font-semibold">{contract.signerName || "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Signature on document</dt>
                  <dd className="font-semibold">
                    {contract.signatureUrl ? "Captured at creation" : "Not captured"}
                  </dd>
                </div>
              </dl>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Accepted electronically with an audit record. This is not a Digital Signature
                Certificate issued under the Information Technology Act, 2000, and no
                certifying-authority verification is claimed. Parties may also execute a signed
                paper counterpart.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* ── Download Agreement PDF — prominent CTA ── */}
        <Card className="glass-card border-0 overflow-hidden">
          <div className="bg-gradient-to-r from-emerald-600 to-teal-600 px-5 py-4">
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
            {/* Live preview — same-origin full-bleed export route; printing
                only happens from the full view's own button. */}
            <div className="rounded-xl border border-border/60 overflow-hidden bg-white">
              <iframe
                src={`/contracts/${params.id}/export`}
                title="Agreement preview"
                className="w-full h-[380px] lg:h-[440px]"
                loading="lazy"
              />
            </div>
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

{/* Contract proof moved to the Files & Proof rail card */}

        <section className="space-y-3">
            <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Invoice for Brand
            </h3>

            {/* Existing invoices — always visible when present */}
            {hasInvoice && (
              <Card className="glass-card border-0">
                <CardContent className="p-4 space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                    {dealBrandInvoices.length} invoice{dealBrandInvoices.length > 1 ? "s" : ""} on file
                  </p>
                  {dealBrandInvoices.map(inv => {
                    const isEditing = editingInvoiceId === inv.id;
                    const typeLabel = (inv as any).invoiceType === "advance" ? "Advance Invoice" : (inv as any).invoiceType === "final" ? "Final Invoice" : "Invoice";
                    return (
                      <div key={inv.id} className="p-3 rounded-xl border bg-card shadow-sm space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <Link href={`/brand-invoices/${inv.id}`} className="flex items-center gap-3 flex-1 min-w-0 hover-elevate rounded-lg -m-1 p-1 cursor-pointer">
                            <div className={`flex items-center justify-center w-9 h-9 rounded-lg flex-shrink-0 ${
                              (inv as any).invoiceType === "advance"
                                ? "bg-blue-100 dark:bg-blue-900/30"
                                : (inv as any).invoiceType === "final"
                                ? "bg-teal-100 dark:bg-teal-900/30"
                                : "bg-gray-100 dark:bg-gray-800/30"
                            }`}>
                              <Receipt className={`w-4 h-4 ${
                                (inv as any).invoiceType === "advance"
                                  ? "text-blue-600 dark:text-blue-400"
                                  : (inv as any).invoiceType === "final"
                                  ? "text-teal-600 dark:text-teal-400"
                                  : "text-muted-foreground"
                              }`} />
                            </div>
                            <div className="min-w-0">
                              <span className="text-sm font-medium block truncate">{typeLabel}</span>
                              <span className="text-xs text-muted-foreground">₹{inv.dealAmount.toLocaleString()} · {inv.invoiceNumber}</span>
                            </div>
                          </Link>
                          <div className="flex items-center gap-1 ml-2">
                            <Badge
                              variant={inv.status === "Paid" ? "default" : "secondary"}
                              className={`text-xs ${inv.status === "Paid" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : ""}`}
                            >
                              {inv.status}
                            </Badge>
                            {inv.status !== "Paid" && !isEditing && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-muted-foreground hover:text-primary"
                                  onClick={() => {
                                    setEditingInvoiceId(inv.id);
                                    setEditAmount(String(inv.dealAmount));
                                  }}
                                  data-testid={`button-edit-invoice-${inv.id}`}
                                  aria-label="Edit amount"
                                  title="Edit amount"
                                >
                                  <Pencil className="w-4 h-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-muted-foreground hover:text-rose-600"
                                  onClick={async () => {
                                    const ok = await confirm({
                                      title: "Delete this invoice?",
                                      description: `Invoice ${inv.invoiceNumber} for ₹${inv.dealAmount.toLocaleString("en-IN")} will be permanently deleted. This cannot be undone.`,
                                      confirmText: "Delete invoice",
                                      destructive: true,
                                    });
                                    if (ok) deleteBrandInvoice.mutate(inv.id);
                                  }}
                                  disabled={deleteBrandInvoice.isPending}
                                  data-testid={`button-delete-invoice-${inv.id}`}
                                  aria-label="Delete invoice"
                                  title="Delete"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </>
                            )}
                          </div>
                        </div>

                        {isEditing && (
                          <div className="flex items-center gap-2 pt-2 border-t border-border/60">
                            <div className="relative flex-1">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">₹</span>
                              <Input
                                type="text"
                                inputMode="numeric"
                                value={editAmount}
                                onChange={(e) => setEditAmount(e.target.value.replace(/\D/g, ""))}
                                className="pl-7 h-9"
                                autoFocus
                                data-testid={`input-edit-invoice-${inv.id}`}
                              />
                            </div>
                            <Button
                              size="sm"
                              className="gradient-btn text-white h-9"
                              onClick={() => {
                                const n = parseInt(editAmount, 10);
                                if (!Number.isFinite(n) || n < 1) {
                                  toast({ title: "Invalid amount", description: "Enter a positive number.", variant: "destructive" });
                                  return;
                                }
                                updateInvoiceAmount.mutate({ invoiceId: inv.id, amount: n });
                              }}
                              disabled={updateInvoiceAmount.isPending}
                              data-testid={`button-save-invoice-${inv.id}`}
                            >
                              {updateInvoiceAmount.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-9"
                              onClick={() => {
                                setEditingInvoiceId(null);
                                setEditAmount("");
                              }}
                              disabled={updateInvoiceAmount.isPending}
                            >
                              Cancel
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}

            {/* Generate new — while the contract is signed AND the
                member's role includes invoice creation. */}
            {canInvoice && (
            <Card className="glass-card border-0">
              <CardContent className="p-4">
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                    <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-sm">{hasInvoice ? "Generate another invoice" : "Generate Invoice for Brand"}</p>
                    <p className="text-xs text-muted-foreground">
                      {contract.status !== "Signed"
                        ? "Upload signed contract proof to enable billing"
                        : hasInvoice
                        ? "Invoice amounts or terms changed? Create a new one anytime."
                        : `Create a professional invoice to send to ${contract.brandName}`}
                    </p>
                  </div>
                </div>

                {/* Creation itself lives in the invoice composer
                    (/brand-invoices/new). This card stays as the shortcut from
                    the agreement — it just stops being the implementation, so
                    dates, itemised lines and notes have a real home. */}
                <div className="mb-3 flex items-center justify-between rounded-lg border border-input/60 bg-muted/30 px-3 py-2.5">
                  <span className="text-xs text-muted-foreground">Agreement value</span>
                  <span className="text-sm font-semibold text-foreground">
                    ₹{Number(contract.contractValue).toLocaleString("en-IN")}
                  </span>
                </div>
                <Button
                  className="w-full gradient-btn text-white mb-2"
                  onClick={() => setLocation(`/brand-invoices/new?contractId=${contract.id}&mode=full`)}
                  disabled={contract.status !== "Signed"}
                  data-testid="button-generate-brand-invoice"
                >
                  <FileText className="w-4 h-4 mr-2" />
                  {hasInvoice ? "Raise another invoice" : "Raise invoice"}
                </Button>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setLocation(`/brand-invoices/new?contractId=${contract.id}&mode=split`)}
                    disabled={contract.status !== "Signed"}
                    data-testid="button-split-invoice"
                  >
                    <Scissors className="w-4 h-4 mr-2" />
                    Advance + final
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setLocation(`/brand-invoices/new?contractId=${contract.id}&mode=custom`)}
                    disabled={contract.status !== "Signed"}
                    data-testid="button-show-custom-invoice"
                  >
                    <IndianRupee className="w-4 h-4 mr-2" />
                    Custom amount
                  </Button>
                </div>
              </CardContent>
            </Card>
            )}
          </section>
        </div>

        {/* ── Right rail: summary · files & proof · activity ── */}
        <div className="lg:col-span-1 space-y-6 mt-6 lg:mt-0">
          <Card className="glass-card border-0">
            <CardContent className="p-5">
              <h3 className="font-semibold mb-4 pb-2 border-b-2 border-emerald-500/60 inline-block">Agreement Summary</h3>
              <dl className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Status</dt>
                  <dd><StatusBadge status={contract.status} size="compact" /></dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Contract Value</dt>
                  <dd className="font-bold tabular-nums">₹{contract.contractValue.toLocaleString("en-IN")}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Contract Period</dt>
                  <dd className="font-medium text-right">{formatDate(contract.startDate)} – {formatDate(contract.endDate)}</dd>
                </div>
                {contract.signedDate && (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">Signed On</dt>
                    <dd className="font-medium">{formatDate(contract.signedDate)}</dd>
                  </div>
                )}
                {deal && (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted-foreground">Deal Type</dt>
                      <dd className="font-medium">{(deal as any).dealType || "Custom"}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted-foreground">Deliverables</dt>
                      <dd className="font-medium">{deal.deliverables.length} item{deal.deliverables.length !== 1 ? "s" : ""}</dd>
                    </div>
                  </>
                )}
              </dl>
            </CardContent>
          </Card>

          <section className="space-y-3">
            <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Files &amp; Proof
            </h3>

            <Card className="glass-card border-0">
              <CardContent className="p-4 space-y-3">
                {contract.proofFileName ? (
                  <>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                        <CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate" data-testid="text-proof-filename">
                          {contract.proofFileName}
                        </p>
                        <p className="text-xs text-muted-foreground">Signed proof on file</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        className="flex-1 gradient-btn text-white"
                        onClick={() => { window.location.href = `/api/contracts/${params.id}/proof`; }}
                        data-testid="button-download-proof"
                      >
                        <Download className="w-4 h-4 mr-2" />
                        Download
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                        data-testid="button-replace-proof"
                      >
                        {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Replace"}
                      </Button>
                    </div>
                  </>
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
                        <span className="text-sm font-medium">Upload Files &amp; Proof</span>
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

          <ActivityRail contractId={contract.id} />
        </div>
        </div>
      </main>


      <BottomNav />
    </div>
  );
}


// ─── Activity timeline rail ──────────────────────────────────────────────────
// Agreement-scoped slice of the org activity log. Hidden entirely for members
// whose role lacks activity.view (the query 403s and we render nothing).
function ActivityRail({ contractId }: { contractId: number }) {
  const { data: activity = [], isError } = useQuery<{
    id: number; userName: string | null; action: string; entityType: string;
    entityId: string | null; createdAt: string;
  }[]>({ queryKey: ["/api/org/activity"], retry: false });
  const rows = activity
    .filter((a) => a.entityType === "agreement" && a.entityId === String(contractId))
    .slice(0, 5);
  if (isError || !rows.length) return null;
  return (
    <Card className="glass-card border-0">
      <CardContent className="p-5">
        <h3 className="font-semibold mb-4">Activity Timeline</h3>
        <ol className="space-y-3.5">
          {rows.map((a) => (
            <li key={a.id} className="flex items-start gap-2.5 text-sm">
              <span className="mt-1.5 w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="leading-snug">
                  Agreement {a.action}
                  <span className="text-muted-foreground"> by {a.userName ?? "someone"}</span>
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {new Date(a.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                </p>
              </div>
            </li>
          ))}
        </ol>
        <Link href="/settings" className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
          View full activity <ExternalLink className="w-3 h-3" />
        </Link>
      </CardContent>
    </Card>
  );
}
