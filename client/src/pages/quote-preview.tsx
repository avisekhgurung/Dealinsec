import { useEffect } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getQueryFn, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { BottomNav } from "@/components/bottom-nav";
import { ArrowLeft, Download, ArrowRight, CheckCircle2, AlertTriangle } from "lucide-react";
import { SiInstagram, SiYoutube, SiFacebook } from "react-icons/si";
import { useToast } from "@/hooks/use-toast";
import type { Deal, User, Quote } from "@shared/schema";
import { STANDARD_TERMS } from "@shared/schema";

function slugify(s: string): string {
  return (s || "")
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function getPlatformIcon(platform: string) {
  switch (platform.toLowerCase()) {
    case "instagram":
      return <SiInstagram className="w-4 h-4 text-pink-500" />;
    case "youtube":
      return <SiYoutube className="w-4 h-4 text-red-500" />;
    case "facebook":
      return <SiFacebook className="w-4 h-4 text-blue-500" />;
    default:
      return <span className="w-4 h-4 inline-block text-center text-xs font-bold text-muted-foreground">{platform[0]}</span>;
  }
}

const STEPS = [
  { label: "Deal", step: 1 },
  { label: "Quote", step: 2 },
  { label: "Agreement", step: 3 },
  { label: "Invoice", step: 4 },
];

export default function QuotePreviewPage() {
  const params = useParams<{ id: string }>();
  const { user } = useAuth();
  const { toast } = useToast();

  const { data: deal, isLoading: dealLoading } = useQuery<Deal>({
    queryKey: ["/api/deals", params.id],
  });

  const { data: authUser } = useQuery<User>({
    queryKey: ["/api/auth/user"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  // Fetch quote for this deal without throwing on 404
  const { data: quote } = useQuery<Quote | null>({
    queryKey: ["/api/deals", params.id, "quote"],
    queryFn: async () => {
      const res = await fetch(`/api/deals/${params.id}/quote`, { credentials: "include" });
      if (res.status === 404) return null;
      if (!res.ok) return null;
      return res.json();
    },
  });

  const dealId = parseInt(params.id || "0");

  const today = new Date();
  const formattedDate = today.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const quoteNumber = `QUO-${dealId}-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;

  useEffect(() => {
    if (!deal) return;
    const previous = document.title;
    const brand = slugify(deal.brandName) || "Quote";
    document.title = `Quote_${brand}_${quoteNumber}`;
    return () => { document.title = previous; };
  }, [deal, quoteNumber]);

  const handlePrint = () => {
    window.print();
  };

  if (dealLoading) {
    return (
      <div className="min-h-screen bg-background pb-20 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!deal) {
    return (
      <div className="min-h-screen bg-background pb-20">
        <header className="glass-header sticky top-0 z-40">
          <div className="flex items-center gap-3 px-4 py-4">
            <Link href={`/deals/${params.id}`}>
              <Button variant="ghost" size="icon">
                <ArrowLeft className="w-5 h-5" />
              </Button>
            </Link>
            <h1 className="text-xl font-bold">Quote Preview</h1>
          </div>
        </header>
        <main className="px-4 py-12 text-center">
          <p className="text-muted-foreground">Deal not found</p>
          <Link href="/deals">
            <Button variant="outline" className="mt-4">Back to Deals</Button>
          </Link>
        </main>
        <BottomNav />
      </div>
    );
  }

  const influencer = authUser || user;
  const fullName = influencer
    ? `${influencer.firstName || ""} ${influencer.lastName || ""}`.trim() || "Influencer"
    : "Influencer";

  return (
    <div className="min-h-screen bg-background pb-20">
      {/* Sticky glass header */}
      <header className="glass-header sticky top-0 z-40 print:hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-4">
          <div className="flex items-center gap-3">
            <Link href={`/deals/${params.id}`}>
              <Button variant="ghost" size="icon">
                <ArrowLeft className="w-5 h-5" />
              </Button>
            </Link>
            <h1 className="text-xl font-bold">Quote Preview</h1>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handlePrint}
            className="flex items-center gap-1.5"
          >
            <Download className="w-4 h-4" />
            Download PDF
          </Button>
        </div>
      </header>

      {/* 4-Step Timeline */}
      <div className="px-4 pt-4 pb-2 print:hidden">
        <div className="flex items-center justify-between">
          {STEPS.map((s, idx) => {
            const isCompleted = s.step < 2;
            const isActive = s.step === 2;
            return (
              <div key={s.step} className="flex items-center flex-1">
                <div className="flex flex-col items-center gap-1">
                  <div
                    className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold transition-all
                      ${isCompleted
                        ? "bg-emerald-500 text-white shadow-sm shadow-emerald-200"
                        : isActive
                        ? "bg-amber-400 text-white shadow-sm shadow-amber-200 ring-2 ring-amber-300/50"
                        : "bg-muted text-muted-foreground"
                      }`}
                  >
                    {isCompleted ? (
                      <CheckCircle2 className="w-4 h-4" />
                    ) : isActive ? (
                      <span className="w-2.5 h-2.5 rounded-full bg-white" />
                    ) : (
                      s.step
                    )}
                  </div>
                  <span
                    className={`text-xs font-medium whitespace-nowrap
                      ${isCompleted ? "text-emerald-600 dark:text-emerald-400" : isActive ? "text-amber-600 dark:text-amber-400 font-semibold" : "text-muted-foreground"}`}
                  >
                    {s.label}
                  </span>
                </div>
                {idx < STEPS.length - 1 && (
                  <div className={`flex-1 h-0.5 mx-1 rounded-full ${s.step < 2 ? "bg-emerald-400" : s.step === 2 ? "bg-amber-300" : "bg-muted"}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {quote?.status === "revised" && (
        <div className="px-4 pt-2 print:hidden">
          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">This quote has been revised</p>
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">The deal details were updated. Go back to the deal page to generate a new quote.</p>
            </div>
          </div>
        </div>
      )}

      <main className="px-4 py-4 space-y-6 animate-fade-in">
        {/* Professional Quote Document */}
        <div className="glass-card rounded-2xl overflow-hidden border border-white/10 print:shadow-none print:border print:border-gray-200">
          {/* Document header */}
          <div className="bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-6 text-white print:bg-emerald-700">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-3xl font-extrabold tracking-wider mb-1">
                  QUOTATION{quote?.version && quote.version > 1 ? ` (Revised - v${quote.version})` : ""}
                </h2>
                <p className="text-emerald-100 font-mono text-sm">{quoteNumber}</p>
              </div>
              <div className="text-right text-sm">
                <p className="text-emerald-100">Date: <span className="text-white font-medium">{formattedDate}</span></p>
                <p className="mt-1 bg-white/20 rounded-full px-3 py-0.5 text-xs font-medium">
                  Valid for 30 days
                </p>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-6">
            {/* FROM / TO section */}
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">FROM</p>
                <p className="font-bold text-base">{fullName}</p>
                {influencer?.email && (
                  <p className="text-sm text-muted-foreground">{influencer.email}</p>
                )}
                {influencer?.phone && (
                  <p className="text-sm text-muted-foreground">{influencer.phone}</p>
                )}
                {influencer?.panNumber && (
                  <p className="text-sm text-muted-foreground">PAN: {influencer.panNumber}</p>
                )}
              </div>
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">TO</p>
                <p className="font-bold text-base">{deal.brandName}</p>
              </div>
            </div>

            <hr className="border-white/10" />

            {/* Deliverables table */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                {deal.deliverableMode === "any_one" ? "Deliverable Options (choose one)" : "Deliverables"}
              </p>
              {deal.deliverableMode === "any_one" && (
                <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-2 text-sm text-amber-800 dark:text-amber-300 mb-3">
                  The brand may choose <strong>one</strong> of the following deliverables.
                </div>
              )}
              <div className="overflow-x-auto rounded-xl border border-white/10">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wide">
                      <th className="text-left px-4 py-3 font-medium">Platform</th>
                      <th className="text-left px-4 py-3 font-medium">Content Type</th>
                      <th className="text-center px-4 py-3 font-medium">Qty</th>
                      <th className="text-left px-4 py-3 font-medium">Frequency</th>
                      <th className="text-left px-4 py-3 font-medium">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deal.deliverables.map((d, idx) => (
                      <tr
                        key={d.id}
                        className={`border-t border-white/10 ${idx % 2 === 0 ? "" : "bg-white/5"}`}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {getPlatformIcon(d.platform)}
                            <span className="font-medium">{d.platform}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{d.contentType}</td>
                        <td className="px-4 py-3 text-center font-bold">{d.quantity}</td>
                        <td className="px-4 py-3 text-muted-foreground">{d.frequency}</td>
                        <td className="px-4 py-3 text-muted-foreground italic text-xs">
                          {d.notes || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <hr className="border-white/10" />

            {/* Amount section */}
            <div className="flex items-center justify-between bg-gradient-to-r from-emerald-500/10 to-teal-500/10 rounded-xl px-5 py-4 border border-emerald-400/20">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Total Deal Value</p>
                <p className="text-3xl font-extrabold text-primary mt-0.5">
                  ₹{deal.dealAmount.toLocaleString()}
                </p>
              </div>
              <div className="text-right text-xs text-muted-foreground">
                <p>Subject to applicable taxes</p>
                <p className="mt-1">INR (Indian Rupees)</p>
              </div>
            </div>

            <hr className="border-white/10" />

            {/* Terms & Conditions */}
            {(() => {
              const selectedIds = ((deal as any).standardTermIds as string[] | null) ?? STANDARD_TERMS.map((t) => t.id);
              const selectedTerms = STANDARD_TERMS.filter((t) => selectedIds.includes(t.id));
              const customTerms = (deal as any).customTerms as string | null;
              const customLines = (customTerms ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
              if (selectedTerms.length === 0 && customLines.length === 0) return null;
              return (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                    Terms &amp; Conditions
                  </p>
                  <ul className="space-y-2 text-sm text-muted-foreground list-none">
                    {selectedTerms.map((t) => (
                      <li key={t.id} className="flex items-start gap-2">
                        <span className="mt-1 flex-shrink-0 w-1.5 h-1.5 rounded-full bg-primary/60" />
                        <span>{t.label}</span>
                      </li>
                    ))}
                    {customLines.map((line, i) => (
                      <li key={`custom-${i}`} className="flex items-start gap-2">
                        <span className="mt-1 flex-shrink-0 w-1.5 h-1.5 rounded-full bg-amber-500/80" />
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })()}

            {/* Footer */}
            <div className="pt-2 text-center text-xs text-muted-foreground border-t border-white/10">
              Generated via <span className="font-semibold text-primary">Dealinsec</span> — Turn collaborations into professional deals
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-3 pb-2 print:hidden">
          <Button
            variant="outline"
            className="flex-1 h-12 rounded-xl font-semibold"
            onClick={handlePrint}
          >
            <Download className="w-4 h-4 mr-2" />
            Download PDF
          </Button>
          <Link href={`/deals/${params.id}/contract`} className="flex-1">
            <Button className="w-full h-12 rounded-xl font-semibold gradient-btn text-white">
              Proceed to Agreement
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </Link>
        </div>
      </main>

      <BottomNav />

      <style>{`
        @media print {
          @page { margin: 1.2cm; size: A4; }

          body { background: #ffffff !important; margin: 0; }

          /* Hide everything except the document card */
          header, nav, footer { display: none !important; }

          body > div, .min-h-screen { padding-bottom: 0 !important; }

          /* The action buttons + bottom nav are hidden via print:hidden Tailwind class */

          /* Force gradient header to print */
          .bg-gradient-to-r { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

          .glass-card {
            background: #ffffff !important;
            border: 1px solid #e5e7eb !important;
            box-shadow: none !important;
          }
        }
      `}</style>
    </div>
  );
}
