/**
 * Quotation document — built on the DealInSec document system.
 *
 * The printable artifact is a PagedDocument of explicit A4 sheets: exact
 * "Page X of Y", no orphan headings, intentional composition instead of the
 * old accidental bottom whitespace. Identity: the shared brand band (the
 * quotation keeps the green that was already its strength), PREPARED BY /
 * PREPARED FOR, a deliverables table that flows cleanly past one page,
 * a prominent total, a payment schedule derived ONLY when the deal's terms
 * state exactly one advance percentage, and numbered terms.
 *
 * The quotation number is stable (QT-xxxx from the quote row) rather than the
 * old date-derived string that changed every day the page was opened.
 */
import { useEffect, useMemo } from "react";
import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useIssuer } from "@/hooks/useIssuer";
import { Button } from "@/components/ui/button";
import { BottomNav } from "@/components/bottom-nav";
import { ArrowLeft, Download, ArrowRight, CheckCircle2, AlertTriangle } from "lucide-react";
import type { Deal, Quote } from "@shared/schema";
import { STANDARD_TERMS, termsForPhase, recordNo } from "@shared/schema";
import { getDeliverableLabels } from "@shared/dealTypeTaxonomy";
import { PagedDocument, type DocBlock } from "@/components/document/paged";
import {
  DocHeader, docFooter, SectionTitle, TwoParties, Party, tableBlocks, TotalBlock,
  DocWarnings, inr, docDate,
} from "@/components/document/primitives";
import {
  detectPaymentConflicts, deriveSchedule, validateDocData,
} from "@/components/document/checks";

function slugify(s: string): string {
  return (s || "").normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");
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
  const issuer = useIssuer();

  const { data: deal, isLoading: dealLoading } = useQuery<Deal>({
    queryKey: ["/api/deals", params.id],
  });
  const dLabels = getDeliverableLabels(deal?.dealType);

  const { data: quote } = useQuery<Quote | null>({
    queryKey: ["/api/deals", params.id, "quote"],
    queryFn: async () => {
      const res = await fetch(`/api/deals/${params.id}/quote`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
  });

  const dealId = parseInt(params.id || "0");
  // Stable identity from the quote row; legacy date-based fallback only when
  // no quote row exists yet.
  const quoteNumber = quote
    ? recordNo("quotation", quote.id)
    : `QT-D${dealId}`;
  const issuedOn = quote?.createdAt ? new Date(quote.createdAt) : new Date();
  const validUntil = new Date(issuedOn.getTime() + 30 * 86400000);

  useEffect(() => {
    if (!deal) return;
    const previous = document.title;
    document.title = `Quote_${slugify(deal.brandName) || "Quote"}_${quoteNumber}`;
    return () => { document.title = previous; };
  }, [deal, quoteNumber]);

  const fullName = issuer.name || `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim() || "—";

  /* ── Document blocks ─────────────────────────────────────────────────── */
  const blocks = useMemo<DocBlock[]>(() => {
    if (!deal) return [];
    const out: DocBlock[] = [];

    out.push({
      key: "head",
      keepWithNext: true,
      node: (
        <DocHeader
          docType="Quotation"
          docNo={quoteNumber}
          status={quote?.status === "revised" ? "Revised" : undefined}
          meta={[
            { label: "Date", value: docDate(issuedOn) },
            { label: "Valid until", value: docDate(validUntil) },
            ...(quote && quote.version > 1 ? [{ label: "Version", value: `v${quote.version}` }] : []),
          ]}
        />
      ),
    });

    out.push({
      key: "parties",
      node: (
        <TwoParties
          left={
            <Party
              heading="Prepared by"
              name={fullName}
              lines={[issuer.email, issuer.phone, issuer.panNumber && `PAN: ${issuer.panNumber}`, issuer.gstNumber && `GSTIN: ${issuer.gstNumber}`]}
            />
          }
          right={
            <Party
              heading="Prepared for"
              name={deal.brandName}
              lines={[deal.dealTitle, `Engagement: ${docDate(deal.startDate)} – ${docDate(deal.endDate)}`]}
            />
          }
        />
      ),
    });

    out.push({
      key: "deliv-title",
      keepWithNext: true,
      node: (
        <div>
          <SectionTitle>
            {deal.deliverableMode === "any_one" ? "Deliverable options — client selects one" : "Deliverables & services"}
          </SectionTitle>
          {deal.deliverableMode === "any_one" && (
            <p className="doc-small doc-muted-t">The client may choose one of the following options.</p>
          )}
        </div>
      ),
    });

    out.push(
      ...tableBlocks({
        keyPrefix: "deliv",
        cols: [
          { label: "#", width: "8mm", align: "center" },
          { label: dLabels.category, width: "30mm" },
          { label: dLabels.type },
          { label: "Qty", width: "12mm", align: "center" },
          { label: "Frequency", width: "22mm" },
          { label: "Notes", width: "48mm" },
        ],
        rows: deal.deliverables ?? [],
        renderCell: (d: any, ci, ri) =>
          ci === 0 ? <span className="doc-muted-t doc-num">{ri + 1}</span>
          : ci === 1 ? <span style={{ fontWeight: 600 }}>{d.platform}</span>
          : ci === 2 ? d.contentType
          : ci === 3 ? <span style={{ fontWeight: 600 }}>{d.quantity}</span>
          : ci === 4 ? d.frequency
          : <span className="doc-small doc-muted-t">{d.notes || "—"}</span>,
      }),
    );

    const schedule = deriveSchedule((deal as any).customTerms, deal.dealAmount);
    out.push({
      key: "total",
      node: (
        <TotalBlock
          label="Total deal value"
          amount={deal.dealAmount}
          note="Subject to applicable taxes · INR"
        />
      ),
    });

    if (schedule) {
      out.push({
        key: "schedule",
        node: (
          <div>
            <SectionTitle>Payment schedule</SectionTitle>
            <table className="doc-table">
              <tbody>
                {schedule.map((s) => (
                  <tr key={s.label}>
                    <td>{s.label}</td>
                    <td className="doc-td-r doc-num" style={{ fontWeight: 600, width: "40mm" }}>{inr(s.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="doc-small doc-muted-t" style={{ marginTop: "1.5mm" }}>
              As per the payment terms below.
            </p>
          </div>
        ),
      });
    }

    // Terms — numbered, chunked so long lists flow without orphaning the title.
    const selectedIds = ((deal as any).standardTermIds as string[] | null) ?? STANDARD_TERMS.map((t) => t.id);
    const terms: string[] = [
      ...termsForPhase(selectedIds, "quotation").map((t) => t.label),
      ...((deal as any).customTerms ?? "").split("\n").map((l: string) => l.trim()).filter(Boolean),
    ];
    if (terms.length) {
      out.push({
        key: "terms-title",
        keepWithNext: true,
        node: <SectionTitle>Terms &amp; conditions</SectionTitle>,
      });
      const CHUNK = 6;
      for (let i = 0; i < terms.length; i += CHUNK) {
        out.push({
          key: `terms-${i}`,
          node: (
            <ol className="doc-body" style={{ margin: 0, paddingLeft: "6mm", listStyleType: "decimal", display: "grid", gap: "1.6mm" }} start={i + 1}>
              {terms.slice(i, i + CHUNK).map((t, j) => (
                <li key={j} className="doc-muted-t" style={{ paddingLeft: "1mm" }}>{t}</li>
              ))}
            </ol>
          ),
        });
      }
    }

    out.push({
      key: "closing",
      node: (
        <p className="doc-small doc-muted-t" style={{ textAlign: "center" }}>
          This quotation is an offer, not an invoice. Prices are in Indian Rupees and valid until {docDate(validUntil)}.
        </p>
      ),
    });

    return out;
  }, [deal, quote, issuer, fullName, quoteNumber]);

  /* ── Screen states ───────────────────────────────────────────────────── */
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
        <main className="px-4 py-12 text-center">
          <p className="text-muted-foreground">Deal not found</p>
          <Link href="/deals"><Button variant="outline" className="mt-4">Back to Deals</Button></Link>
        </main>
        <BottomNav />
      </div>
    );
  }

  const warnings = [
    ...validateDocData({
      clientName: deal.brandName,
      sellerName: fullName === "—" ? "" : fullName,
      amount: deal.dealAmount,
      startDate: deal.startDate,
      endDate: deal.endDate,
    }),
    ...detectPaymentConflicts((deal as any).customTerms),
  ];

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="glass-header sticky top-0 z-40 print:hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-4">
          <div className="flex items-center gap-3">
            <Link href={`/deals/${params.id}`}>
              <Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button>
            </Link>
            <h1 className="text-xl lg:text-lg font-bold lg:font-semibold">Quote Preview</h1>
          </div>
          <Button variant="outline" size="sm" onClick={() => window.print()} className="flex items-center gap-1.5">
            <Download className="w-4 h-4" /> Download PDF
          </Button>
        </div>
      </header>

      {/* 4-step timeline (screen only) */}
      <div className="px-4 pt-4 pb-2 print:hidden">
        <div className="flex items-center justify-between">
          {STEPS.map((s, idx) => {
            const isCompleted = s.step < 2;
            const isActive = s.step === 2;
            return (
              <div key={s.step} className="flex items-center flex-1">
                <div className="flex flex-col items-center gap-1">
                  <div className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold transition-all ${
                    isCompleted ? "bg-emerald-500 text-white" : isActive ? "bg-amber-400 text-white ring-2 ring-amber-300/50" : "bg-muted text-muted-foreground"}`}>
                    {isCompleted ? <CheckCircle2 className="w-4 h-4" /> : isActive ? <span className="w-2.5 h-2.5 rounded-full bg-white" /> : s.step}
                  </div>
                  <span className={`text-xs font-medium whitespace-nowrap ${
                    isCompleted ? "text-emerald-600 dark:text-emerald-400" : isActive ? "text-amber-600 dark:text-amber-400 font-semibold" : "text-muted-foreground"}`}>
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

      <main className="px-4 py-4 animate-fade-in lg:max-w-4xl lg:mx-auto lg:px-8 lg:py-6">
        <DocWarnings warnings={warnings} />

        <PagedDocument
          blocks={blocks}
          footer={docFooter(quoteNumber, `Deal ${recordNo("deal", deal.id)}`)}
        />

        <div className="flex gap-3 pt-4 pb-2 print:hidden">
          <Button variant="outline" className="flex-1 h-12 rounded-xl font-semibold" onClick={() => window.print()}>
            <Download className="w-4 h-4 mr-2" /> Download PDF
          </Button>
          <Link href={`/deals/${params.id}/contract`} className="flex-1">
            <Button className="w-full h-12 rounded-xl font-semibold gradient-btn text-white">
              Proceed to Agreement <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </Link>
        </div>
      </main>

      <BottomNav />
    </div>
  );
}
