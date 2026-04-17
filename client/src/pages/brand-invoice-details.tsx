import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BottomNav } from "@/components/bottom-nav";
import { useAuth } from "@/hooks/useAuth";
import { ArrowLeft, Download } from "lucide-react";
import type { BrandInvoice, Deal } from "@shared/schema";

export default function BrandInvoiceDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { user } = useAuth();

  const { data: invoice, isLoading } = useQuery<BrandInvoice>({
    queryKey: ["/api/brand-invoices", id],
  });

  const { data: deal } = useQuery<Deal>({
    queryKey: ["/api/deals", invoice?.dealId],
    enabled: !!invoice?.dealId,
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

  /* ── Loading ────────────────────────────────────── */
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background pb-20">
        <header className="glass-header sticky top-0 z-40 print:hidden">
          <div className="flex items-center gap-3 px-4 py-4">
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
          <div className="flex items-center gap-3 px-4 py-4">
            <Button variant="ghost" size="icon" onClick={() => setLocation("/invoices")}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <h1 className="text-xl font-bold">Invoice Not Found</h1>
          </div>
        </header>
        <BottomNav />
      </div>
    );
  }

  /* ── Amount breakdown ───────────────────────────── */
  const totalAmount = invoice.dealAmount;
  const gstRate = 0.18;
  const baseAmount = Math.round(totalAmount / (1 + gstRate));
  const gstAmount = totalAmount - baseAmount;

  const influencerName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    invoice.influencerName ||
    "—";
  const influencerEmail = user?.email || invoice.influencerEmail || "";
  const influencerPhone = user?.phone || "";
  const influencerPan = user?.panNumber || "";
  const influencerAddress = user?.billingAddress || "";
  const signatureUrl = user?.digitalSignature || "";

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
              <h1 className="text-xl font-bold">Invoice</h1>
            </div>
            <Button onClick={() => window.print()} className="gradient-btn text-white">
              <Download className="w-4 h-4 mr-2" />
              Export PDF
            </Button>
          </div>
        </header>

        {/* ─────────────────── INVOICE DOCUMENT ─────────────────── */}
        <main className="invoice-doc px-4 py-6 max-w-2xl mx-auto animate-fade-in print:max-w-none print:px-0 print:py-0 print:mx-0">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-md border border-gray-100 dark:border-zinc-800 overflow-hidden print:rounded-none print:shadow-none print:border-0">

            {/* ── Top colour band + INVOICE title ────── */}
            <div
              className="px-6 py-5 text-white"
              style={{ background: "linear-gradient(135deg, #7c3aed 0%, #6366f1 100%)" }}
            >
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <h1 className="text-2xl font-extrabold tracking-wide">INVOICE</h1>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-sm text-white/80 font-medium">{invoice.invoiceNumber}</p>
                    {invoice.invoiceType === "advance" && (
                      <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-amber-500/30 text-amber-100 border border-amber-300/40">
                        Advance Payment
                      </span>
                    )}
                    {invoice.invoiceType === "final" && (
                      <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-emerald-500/30 text-emerald-100 border border-emerald-300/40">
                        Final Payment
                      </span>
                    )}
                  </div>
                  {(invoice.invoiceType === "advance" || invoice.invoiceType === "final") && (invoice as any).splitPercentage && (
                    <p className="text-[10px] text-white/60 mt-0.5">
                      {(invoice as any).splitPercentage}% of total deal value
                    </p>
                  )}
                </div>
                <div className="text-right text-sm">
                  <span
                    className={`inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide ${
                      invoice.status === "Paid"
                        ? "bg-emerald-500/30 text-emerald-100 border border-emerald-300/40"
                        : "bg-amber-500/30 text-amber-100 border border-amber-300/40"
                    }`}
                  >
                    {invoice.status}
                  </span>
                </div>
              </div>
            </div>

            {/* ── Dates row ──────────────────────────── */}
            <div className="px-6 py-3 bg-gray-50 dark:bg-zinc-800/60 flex flex-wrap gap-6 text-xs border-b border-gray-100 dark:border-zinc-700">
              <div>
                <span className="text-gray-400 uppercase tracking-wider font-semibold">Invoice Date</span>
                <p className="text-gray-800 dark:text-gray-200 font-semibold mt-0.5">{fmt(invoice.invoiceDate)}</p>
              </div>
              {invoice.dueDate && (
                <div>
                  <span className="text-gray-400 uppercase tracking-wider font-semibold">Due Date</span>
                  <p className="text-gray-800 dark:text-gray-200 font-semibold mt-0.5">{fmt(invoice.dueDate)}</p>
                </div>
              )}
            </div>

            {/* ── FROM / TO two-column ────────────────── */}
            <div className="px-6 py-5 grid grid-cols-1 sm:grid-cols-2 gap-6 border-b border-gray-100 dark:border-zinc-700">
              {/* FROM */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-violet-500 mb-2">From</p>
                <p className="text-sm font-bold text-gray-900 dark:text-gray-100">{influencerName}</p>
                {influencerEmail && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{influencerEmail}</p>
                )}
                {influencerPhone && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{influencerPhone}</p>
                )}
                {influencerPan && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    <span className="font-semibold text-gray-600 dark:text-gray-300">PAN:</span> {influencerPan}
                  </p>
                )}
                {influencerAddress && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed whitespace-pre-line">
                    {influencerAddress}
                  </p>
                )}
              </div>

              {/* TO */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-500 mb-2">Bill To</p>
                <p className="text-sm font-bold text-gray-900 dark:text-gray-100">{invoice.brandName}</p>
                {deal && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    Re: {deal.dealTitle}
                  </p>
                )}
              </div>
            </div>

            {/* ── Line items table ────────────────────── */}
            <div className="px-6 py-5">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-gray-200 dark:border-zinc-700">
                    <th className="text-left pb-2 font-semibold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">#</th>
                    <th className="text-left pb-2 font-semibold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">Description</th>
                    <th className="text-center pb-2 font-semibold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">Period</th>
                    <th className="text-right pb-2 font-semibold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Main service line */}
                  <tr className="border-b border-gray-100 dark:border-zinc-800">
                    <td className="py-3 text-gray-600 dark:text-gray-300">1</td>
                    <td className="py-3">
                      <p className="font-medium text-gray-900 dark:text-gray-100">
                        {deal?.dealTitle || "Influencer Marketing Services"}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        Content creation & brand promotion
                      </p>
                      {deal?.deliverables && deal.deliverables.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {deal.deliverables.map((d: any, i: number) => (
                            <span
                              key={i}
                              className="inline-block text-[10px] px-1.5 py-0.5 rounded bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 font-medium"
                            >
                              {d.platform} · {d.contentType} ×{d.quantity}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="py-3 text-center text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {deal
                        ? `${fmtShort(deal.startDate)} – ${fmtShort(deal.endDate)}`
                        : "—"}
                    </td>
                    <td className="py-3 text-right font-semibold text-gray-900 dark:text-gray-100 whitespace-nowrap">
                      ₹{baseAmount.toLocaleString("en-IN")}
                    </td>
                  </tr>
                </tbody>

                {/* ── Totals ───────────────────────── */}
                <tfoot>
                  <tr>
                    <td colSpan={3} className="pt-4 pr-4 text-right text-xs text-gray-500 dark:text-gray-400">
                      Subtotal
                    </td>
                    <td className="pt-4 text-right text-sm font-medium text-gray-700 dark:text-gray-300">
                      ₹{baseAmount.toLocaleString("en-IN")}
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={3} className="pt-1 pr-4 text-right text-xs text-gray-500 dark:text-gray-400">
                      GST (18%)
                    </td>
                    <td className="pt-1 text-right text-sm font-medium text-gray-700 dark:text-gray-300">
                      ₹{gstAmount.toLocaleString("en-IN")}
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={3} className="pt-3 pr-4 text-right font-bold text-gray-900 dark:text-gray-100 border-t-2 border-gray-200 dark:border-zinc-700">
                      Total Amount
                    </td>
                    <td className="pt-3 text-right border-t-2 border-gray-200 dark:border-zinc-700">
                      <span className="text-lg font-extrabold text-violet-600 dark:text-violet-400">
                        ₹{totalAmount.toLocaleString("en-IN")}
                      </span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* ── Notes ───────────────────────────────── */}
            {invoice.notes && (
              <div className="px-6 py-4 border-t border-gray-100 dark:border-zinc-700">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Notes</p>
                <p className="text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap leading-relaxed">
                  {invoice.notes}
                </p>
              </div>
            )}

            {/* ── Bank / Payment terms ────────────────── */}
            <div className="px-6 py-4 bg-gray-50 dark:bg-zinc-800/40 border-t border-gray-100 dark:border-zinc-700">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Payment Terms</p>
              <ul className="text-xs text-gray-600 dark:text-gray-400 space-y-1 list-disc list-inside">
                <li>Payment due within 30 days of invoice date</li>
                <li>Please reference invoice number <strong>{invoice.invoiceNumber}</strong> with payment</li>
                <li>All amounts are in Indian Rupees (₹ / INR)</li>
              </ul>
            </div>

            {/* ── Signature block ─────────────────────── */}
            <div className="px-6 py-6 border-t border-gray-100 dark:border-zinc-700">
              <div className="flex flex-col sm:flex-row justify-between gap-8">
                {/* Authorised signatory */}
                <div className="flex-1">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">
                    Authorised Signatory
                  </p>
                  {signatureUrl ? (
                    <div className="mb-1">
                      <img
                        src={signatureUrl}
                        alt="Digital Signature"
                        className="h-10 w-auto object-contain"
                      />
                    </div>
                  ) : (
                    <>
                      <div className="h-16 w-48 border-b-2 border-gray-300 dark:border-zinc-600 mb-2" />
                      <p className="text-sm font-bold text-gray-900 dark:text-gray-100">{influencerName}</p>
                    </>
                  )}
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    Date: {fmt(invoice.invoiceDate)}
                  </p>
                </div>

              </div>
            </div>

            {/* ── Footer ──────────────────────────────── */}
            <div className="px-6 py-3 bg-gray-50 dark:bg-zinc-800/40 border-t border-gray-100 dark:border-zinc-700 text-center">
              <p className="text-[10px] text-gray-400">
                This is a computer-generated invoice. Generated via InfluDeal.
              </p>
            </div>
          </div>
        </main>

        <div className="print:hidden">
          <BottomNav />
        </div>
      </div>

      {/* ── Print styles ─────────────────────────────── */}
      <style>{`
        @media print {
          @page { margin: 0.8cm; size: A4; }

          * { print-color-adjust: exact; -webkit-print-color-adjust: exact; }

          body { background: #ffffff !important; margin: 0; }

          /* Hide all app chrome */
          header, nav, footer,
          [data-testid], .glass-header,
          .print\\:hidden { display: none !important; }

          body > div,
          .min-h-screen { padding-bottom: 0 !important; min-height: 0 !important; background: white !important; }

          /* Invoice doc fills page */
          .invoice-doc {
            padding: 0 !important;
            margin: 0 !important;
            max-width: 100% !important;
          }

          .invoice-doc > div {
            border-radius: 0 !important;
            box-shadow: none !important;
            border: none !important;
          }

          /* Force gradient header in print */
          .invoice-doc > div > div:first-child {
            background: linear-gradient(135deg, #7c3aed 0%, #6366f1 100%) !important;
          }

          /* Force bg colours */
          .bg-gray-50 { background-color: #f9fafb !important; }
          .bg-violet-50 { background-color: #f5f3ff !important; }

          img {
            max-width: 100% !important;
            max-height: 80px !important;
            object-fit: contain !important;
          }

          .invoice-doc img {
            display: block !important;
            visibility: visible !important;
          }
        }
      `}</style>
    </>
  );
}
