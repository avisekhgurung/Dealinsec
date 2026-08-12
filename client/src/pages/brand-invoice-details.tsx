import { useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BottomNav } from "@/components/bottom-nav";
import { useAuth } from "@/hooks/useAuth";
import { useIssuer } from "@/hooks/useIssuer";
import { memberCan } from "@shared/permissions";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/confirm-dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ArrowLeft, Download, CheckCircle, Loader2, BellRing, Crown, Undo2 } from "lucide-react";
import { InvoiceAttachments } from "@/components/invoice-attachments";
import type { BrandInvoice, Deal, InvoiceLineItem } from "@shared/schema";
import { useUpgradeModal } from "@/components/upgrade-modal";
import { PagedDocument, type DocBlock } from "@/components/document/paged";
import {
  DocHeader, docFooter, SectionTitle, TwoParties, Party, KV, tableBlocks, TotalBlock,
  SignatureCell, DocWarnings, inr, docDate,
} from "@/components/document/primitives";
import { validateDocData } from "@/components/document/checks";
import { recordNo } from "@shared/schema";
import { parseApiError, isUpgradeError } from "@/lib/api-error";

function slugify(s: string): string {
  return (s || "")
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

export default function BrandInvoiceDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const issuer = useIssuer();
  const canRecordPayment = memberCan(user as any, "payments.manage");

  const { data: invoice, isLoading } = useQuery<BrandInvoice>({
    queryKey: ["/api/brand-invoices", id],
  });

  const { data: deal } = useQuery<Deal>({
    queryKey: ["/api/deals", invoice?.dealId],
    enabled: !!invoice?.dealId,
  });

  const { toast } = useToast();
  const confirm = useConfirm();
  const { openUpgradeModal } = useUpgradeModal();

  /** Reverse an accidental "Mark as Paid". The API has always allowed the
   *  status to go back; the screen simply never offered a way, so a mistap
   *  was a dead end. Confirmed because it moves money figures, and audited
   *  server-side alongside the original payment. */
  const markUnpaid = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/brand-invoices/${id}`, { status: "Unpaid" });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/brand-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/brand-invoices", id] });
      toast({
        title: "Payment reversed",
        description: "The invoice is Unpaid again and back in your outstanding total.",
      });
    },
    onError: (err) => {
      if (isUpgradeError(parseApiError(err))) {
        openUpgradeModal({ feature: "payment_tracking" });
        return;
      }
      toast({ title: "Could not reverse the payment", variant: "destructive" });
    },
  });

  const markPaid = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/brand-invoices/${id}`, { status: "Paid" });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/brand-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/brand-invoices", id] });
      toast({ title: "Invoice marked as paid" });
    },
    onError: (err) => {
      if (isUpgradeError(parseApiError(err))) {
        openUpgradeModal({ feature: "payment_tracking" });
        return;
      }
      toast({ title: "Failed to update", variant: "destructive" });
    },
  });

  const fmt = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });

  const fmtShort = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

  useEffect(() => {
    if (!invoice) return;
    const previous = document.title;
    const brand = slugify(invoice.brandName) || "Invoice";
    const typeSuffix =
      invoice.invoiceType === "advance" ? "_Advance" :
      invoice.invoiceType === "final" ? "_Final" : "";
    document.title = `Invoice_${brand}${typeSuffix}_${invoice.invoiceNumber}`;
    return () => { document.title = previous; };
  }, [invoice]);

  /* ── Loading ────────────────────────────────────── */
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background pb-20">
        <header className="glass-header sticky top-0 z-40 print:hidden">
          <div className="flex items-center gap-3 px-4 py-4 lg:max-w-6xl lg:mx-auto lg:px-8 lg:py-3.5">
            <Skeleton className="h-9 w-9" />
            <Skeleton className="h-6 w-32" />
          </div>
        </header>
        <div className="px-4 py-6 space-y-4">
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  /* ── Not found ──────────────────────────────────── */
  if (!invoice) {
    return (
      <div className="min-h-screen bg-background pb-20">
        <header className="glass-header sticky top-0 z-40 print:hidden">
          <div className="flex items-center gap-3 px-4 py-4 lg:max-w-6xl lg:mx-auto lg:px-8 lg:py-3.5">
            <Button variant="ghost" size="icon" onClick={() => setLocation("/invoices")}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <h1 className="text-xl lg:text-lg font-bold lg:font-semibold">Invoice Not Found</h1>
          </div>
        </header>
        <BottomNav />
      </div>
    );
  }

  /* ── Amount ───────────────────────────── */
  const totalAmount = invoice.dealAmount;
  const lineItems: InvoiceLineItem[] = Array.isArray(invoice.lineItems) ? invoice.lineItems : [];

  // Supplier details come from the ORG's issuer, never the viewer — see useIssuer.
  const influencerName = issuer.name || invoice.influencerName || "—";
  const influencerEmail = issuer.email || invoice.influencerEmail || "";
  const influencerPhone = issuer.phone;
  const influencerPan = issuer.panNumber;
  const influencerGst = issuer.gstNumber;
  const influencerAddress = issuer.billingAddress;
  const signatureUrl = issuer.digitalSignature;
  const sealUrl = issuer.companySeal;
  const bankAccountHolder = issuer.accountHolderName;
  const bankAccountNumber = issuer.accountNumber;
  const bankIfsc = issuer.ifscCode;
  const bankName = issuer.bankName;
  const hasBankDetails = bankAccountHolder || bankAccountNumber || bankIfsc || bankName;

  /* ── Document blocks — one A4 page whenever the content fits ─────────── */
  const invoiceRows: { description: string; hsnSac?: string; period?: string; qty: number; rate: number; amount: number }[] =
    lineItems.length > 0
      ? lineItems.map((li) => ({
          description: li.description, hsnSac: li.hsnSac,
          qty: li.quantity, rate: li.rate, amount: li.amount,
        }))
      : [{
          // Invoices raised before the composer derive their single line from
          // the deal — appearance unchanged for documents clients already hold.
          description: deal?.dealTitle || "Professional services",
          period: deal ? `${fmtShort(deal.startDate)} – ${fmtShort(deal.endDate)}` : undefined,
          qty: 1, rate: totalAmount, amount: totalAmount,
        }];

  const docWarnings = validateDocData({
    clientName: invoice.brandName,
    sellerName: influencerName === "—" ? "" : influencerName,
    amount: totalAmount,
    invoiceDate: invoice.invoiceDate,
    dueDate: invoice.dueDate,
  });

  const docBlocks: DocBlock[] = [
    {
      key: "head",
      keepWithNext: true,
      node: (
        <DocHeader
          brand={influencerName !== "—" ? influencerName : undefined}
          docType="Invoice"
          docNo={invoice.invoiceNumber}
          status={invoice.status}
          meta={[
            { label: "Invoice date", value: docDate(invoice.invoiceDate) },
            ...(invoice.status === "Paid" && (invoice as any).paidAt
              ? [{ label: "Paid on", value: docDate((invoice as any).paidAt) }]
              : [{ label: "Due", value: invoice.dueDate ? docDate(invoice.dueDate) : "On receipt" }]),
            ...(invoice.invoiceType && invoice.invoiceType !== "full"
              ? [{ label: "Type", value: invoice.invoiceType === "advance" ? "Advance" : "Final" }]
              : []),
          ]}
        />
      ),
    },
    {
      key: "parties",
      node: (
        <TwoParties
          left={
            <Party
              heading="From"
              name={influencerName}
              lines={[
                influencerAddress,
                influencerEmail,
                influencerPhone,
                influencerPan && `PAN: ${influencerPan}`,
                influencerGst && `GSTIN: ${influencerGst}`,
              ]}
            />
          }
          right={
            <Party
              heading="Bill to"
              name={invoice.brandName}
              lines={[
                deal?.dealTitle && `Re: ${deal.dealTitle}`,
                invoice.contractId ? `Agreement: ${recordNo("agreement", invoice.contractId)}` : null,
                invoice.dealId ? `Deal: ${recordNo("deal", invoice.dealId)}` : null,
              ]}
            />
          }
        />
      ),
    },
    ...tableBlocks({
      keyPrefix: "items",
      cols: [
        { label: "#", width: "8mm", align: "center" },
        { label: "Description" },
        { label: "Qty", width: "12mm", align: "center" },
        { label: "Rate", width: "24mm", align: "right" },
        { label: "Amount", width: "26mm", align: "right" },
      ],
      rows: invoiceRows,
      renderCell: (r, ci, ri) =>
        ci === 0 ? <span className="doc-muted-t doc-num">{ri + 1}</span>
        : ci === 1 ? (
            <div>
              <div style={{ fontWeight: 600 }}>{r.description}</div>
              {(r.hsnSac || r.period) && (
                <div className="doc-small doc-muted-t">
                  {[r.hsnSac && `HSN/SAC ${r.hsnSac}`, r.period].filter(Boolean).join(" · ")}
                </div>
              )}
            </div>
          )
        : ci === 2 ? <span className="doc-num">{r.qty}</span>
        : ci === 3 ? inr(r.rate)
        : <span style={{ fontWeight: 600 }}>{inr(r.amount)}</span>,
    }),
    {
      key: "total",
      node: (
        <TotalBlock
          label="Total amount due"
          amount={totalAmount}
          note="Contract value — no GST computation. Not a tax invoice under Rule 46 of the CGST Rules, 2017."
          ledger={invoiceRows.length > 1 ? [{ label: "Subtotal", value: inr(totalAmount) }] : []}
        />
      ),
    },
    ...(hasBankDetails
      ? [{
          key: "bank",
          node: (
            <div className="doc-panel">
              <div className="doc-label" style={{ marginBottom: "2mm" }}>Payment details</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "4mm" }}>
                {bankAccountHolder && <KV label="Account holder" strong>{bankAccountHolder}</KV>}
                {bankAccountNumber && <KV label="Account number" strong><span className="doc-mono" style={{ fontSize: "9pt" }}>{bankAccountNumber}</span></KV>}
                {bankIfsc && <KV label="IFSC" strong><span className="doc-mono" style={{ fontSize: "9pt" }}>{bankIfsc}</span></KV>}
                {bankName && <KV label="Bank" strong>{bankName}</KV>}
              </div>
            </div>
          ),
        } satisfies DocBlock]
      : []),
    {
      // Terms bottom-left, signatory bottom-right — the classic invoice
      // closing row. One combined block, so it can never split across pages
      // and the one-page target survives a full itemised invoice.
      key: "closing-row",
      keepWithNext: true,
      node: (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 62mm", gap: "8mm", alignItems: "start" }}>
          <div>
            <div className="doc-label" style={{ marginBottom: "1.5mm" }}>Payment terms</div>
            <ul className="doc-small doc-muted-t" style={{ margin: 0, paddingLeft: "5mm", listStyleType: "disc", display: "grid", gap: "1mm" }}>
              <li>{invoice.dueDate ? <>Payment due by <strong>{docDate(invoice.dueDate)}</strong></> : "Payment due within 30 days of invoice date"}</li>
              <li>Please quote invoice number <strong>{invoice.invoiceNumber}</strong> with your payment</li>
              <li>All amounts are in Indian Rupees (₹ / INR)</li>
            </ul>
            {invoice.notes && (
              <p className="doc-small doc-muted-t" style={{ marginTop: "2mm", whiteSpace: "pre-wrap" }}>
                <strong>Notes:</strong> {invoice.notes}
              </p>
            )}
          </div>
          <SignatureCell
            heading="Authorised signatory"
            name={influencerName}
            date={docDate(invoice.invoiceDate)}
            signatureUrl={signatureUrl || null}
            sealUrl={sealUrl || null}
            note="Valid without signature"
          />
        </div>
      ),
    },
    {
      key: "legal",
      node: (
        <p className="doc-small" style={{ textAlign: "center", color: "var(--doc-faint)" }}>
          Computer-generated invoice — valid without signature.
        </p>
      ),
    },
  ];

  return (
    <>
      <div className="min-h-screen bg-background pb-20 print:pb-0 print:bg-white print:min-h-0">

        {/* ── App header (hidden in print) ──────────── */}
        <header className="glass-header sticky top-0 z-40 print:hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-4">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" onClick={() => setLocation("/invoices")}>
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <h1 className="text-xl lg:text-lg font-bold lg:font-semibold">Invoice</h1>
            </div>
            <Button onClick={() => window.print()} className="gradient-btn text-white">
              <Download className="w-4 h-4 mr-2" />
              Export PDF
            </Button>
          </div>
        </header>

        {/* ─────────────────── INVOICE DOCUMENT ─────────────────── */}
        {/* ─────────────────── INVOICE DOCUMENT ─────────────────── */}
        <main className="px-4 py-6 max-w-2xl lg:max-w-4xl mx-auto animate-fade-in">
          <DocWarnings warnings={docWarnings} />
          <PagedDocument blocks={docBlocks} footer={docFooter(invoice.invoiceNumber)} />


          {/* ── Tax documents (GST / TDS / receipts) ─ hidden in print ── */}
          <div className="mt-6">
            <InvoiceAttachments invoiceId={invoice.id} />
          </div>
        </main>

        {/* Mark as Paid / Paid status */}
        <div className="px-4 pb-6 print:hidden space-y-2 max-w-2xl lg:max-w-4xl mx-auto">
          {invoice.status === "Unpaid" && !canRecordPayment ? (
            <p className="text-center text-xs text-muted-foreground py-3">
              Your role can view this invoice but not record payments.
            </p>
          ) : invoice.status === "Unpaid" ? (
            <Button
              className="w-full h-12 font-semibold rounded-xl gradient-btn text-white"
              onClick={() => markPaid.mutate()}
              disabled={markPaid.isPending}
            >
              {markPaid.isPending ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Updating...
                </>
              ) : (
                <>
                  <CheckCircle className="w-5 h-5 mr-2" />
                  Mark as Paid
                </>
              )}
            </Button>
          ) : (
            <div className="rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/30">
              <div className="flex items-center justify-center gap-2 py-3">
                <CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                <span className="font-semibold text-emerald-700 dark:text-emerald-300">Payment Received</span>
              </div>
              {canRecordPayment && (
                <div className="px-3 pb-3 text-center">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700/70 dark:text-emerald-300/70 hover:text-emerald-800 dark:hover:text-emerald-200 hover:underline transition-colors disabled:opacity-50"
                    disabled={markUnpaid.isPending}
                    data-testid="button-mark-unpaid"
                    onClick={async () => {
                      const ok = await confirm({
                        title: "Mark this invoice unpaid?",
                        description: (
                          <>
                            {invoice.invoiceNumber} goes back to Unpaid and its
                            ₹{Number(invoice.dealAmount || 0).toLocaleString("en-IN")} returns to your
                            outstanding total. Use this if you marked it paid by mistake — the change is
                            recorded in your activity log either way.
                          </>
                        ),
                        confirmText: "Yes, mark unpaid",
                        cancelText: "Keep it paid",
                      });
                      if (ok) markUnpaid.mutate();
                    }}
                  >
                    {markUnpaid.isPending ? (
                      <><Loader2 className="w-3 h-3 animate-spin" /> Reversing…</>
                    ) : (
                      <><Undo2 className="w-3 h-3" /> Marked paid by mistake? Undo</>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Payment reminders — Pro feature, gated now, shipping soon */}
          {invoice.status === "Unpaid" && (
            <button
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-dashed border-violet-300/60 dark:border-violet-800/50 text-left opacity-80 hover:opacity-100 transition-opacity"
              onClick={() => openUpgradeModal({ feature: "payment_tracking" })}
              data-testid="button-payment-reminder"
            >
              <BellRing className="w-4 h-4 text-violet-500 flex-shrink-0" />
              <span className="flex-1 text-sm font-medium text-muted-foreground">
                Send Payment Reminder
              </span>
              <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-violet-600 dark:text-violet-400">
                <Crown className="w-3 h-3" /> Pro · Coming soon
              </span>
            </button>
          )}
        </div>

        <div className="print:hidden">
          <BottomNav />
        </div>
      </div>

    </>
  );
}
