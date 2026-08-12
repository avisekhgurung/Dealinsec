/**
 * Agreement document — built on the DealInSec document system.
 *
 * The most formal of the three documents: white header with the green rule,
 * numbered clauses, two-column execution block, and the execution record that
 * states honestly what our electronic acceptance is and is not. Pagination is
 * explicit (PagedDocument): a clause heading can never orphan at a page
 * bottom, the signature grid and execution record are atomic, and every sheet
 * carries "Page X of Y" with the agreement reference.
 *
 * The payment-contradiction fix lives in Clause 3: when the deal's own terms
 * mention payment (they carry over from the quotation into Section 7), the
 * Compensation clause DEFERS to them instead of asserting the old hardcoded
 * "50% advance / 50% within 30 days" schedule that could contradict Section 7
 * on the same document. The default schedule only prints when the deal has no
 * payment terms of its own.
 *
 * Legal meaning is otherwise unchanged: same clauses, same disclosures, same
 * execution-record wording (see ESIGN_RECOMMENDATION.md).
 */
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useIssuer } from "@/hooks/useIssuer";
import { ArrowLeft, Printer } from "lucide-react";
import type { Contract, Deal, Quote } from "@shared/schema";
import { STANDARD_TERMS, recordNo } from "@shared/schema";
import { getAgreementCopy, getDeliverableLabels } from "@shared/dealTypeTaxonomy";
import { PagedDocument, type DocBlock } from "@/components/document/paged";
import {
  DocHeader, docFooter, SectionTitle, TwoParties, Party, KV, tableBlocks,
  SignatureCell, DocWarnings, inr, docDate,
} from "@/components/document/primitives";
import {
  detectPaymentConflicts, termsMentionPayment, validateDocData,
} from "@/components/document/checks";

function slugify(s: string): string {
  return (s || "").normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");
}

function Clause({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "2.5mm", marginBottom: "1.5mm" }}>
        <span className="doc-clause-no">{n}</span>
        <span className="doc-h3">{title}</span>
      </div>
      <div className="doc-body doc-muted-t" style={{ paddingLeft: "8mm" }}>{children}</div>
    </div>
  );
}

export default function ContractPdfPage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const issuer = useIssuer();
  const backPath = `/contracts/${id}`;

  const { data: contract, isLoading } = useQuery<Contract>({
    queryKey: ["/api/contracts", id],
  });

  const { data: deal } = useQuery<Deal>({
    queryKey: ["/api/deals", contract?.dealId],
    enabled: !!contract?.dealId,
  });

  // Cross-reference: the quotation this agreement grew from. 404/permission
  // misses degrade to "no reference line" — never an error.
  const { data: refQuote } = useQuery<Quote | null>({
    queryKey: ["/api/deals", contract?.dealId, "quote"],
    enabled: !!contract?.dealId,
    queryFn: async () => {
      const res = await fetch(`/api/deals/${contract?.dealId}/quote`, { credentials: "include" });
      return res.ok ? res.json() : null;
    },
  });

  // Authenticity: signature/seal captured at creation, never the viewer's.
  const signatureSrc = (contract?.signatureUrl as string | null) ?? issuer.digitalSignature ?? null;
  const sealSrc = ((contract as any)?.sealUrl as string | null) ?? issuer.companySeal ?? null;
  const signerLabel = contract?.signerName || issuer.name || "—";

  const copy = getAgreementCopy(deal?.dealType);
  const dLabels = getDeliverableLabels(deal?.dealType);
  const agreementNo = contract ? recordNo("agreement", contract.id) : "";

  useEffect(() => {
    if (!contract) return;
    const previous = document.title;
    document.title = `Agreement_${slugify(contract.brandName) || "Agreement"}_${agreementNo}`;
    return () => { document.title = previous; };
  }, [contract, agreementNo]);

  /* ── Document blocks ─────────────────────────────────────────────────── */
  const blocks = useMemo<DocBlock[]>(() => {
    if (!contract) return [];
    const c = contract;
    const customTerms = (deal as any)?.customTerms as string | null;
    const selectedIds = ((deal as any)?.standardTermIds as string[] | null) ?? [];
    const selectedTerms = STANDARD_TERMS.filter((t) => selectedIds.includes(t.id));
    const customLines = (customTerms ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
    const hasOwnPaymentTerms = termsMentionPayment(customTerms);
    const out: DocBlock[] = [];

    out.push({
      key: "head",
      keepWithNext: true,
      node: (
        <DocHeader
          formal
          docType={copy.title}
          docNo={agreementNo}
          status={c.status === "Signed" ? "Signed" : "Pending"}
          meta={[
            { label: "Effective", value: docDate(c.startDate) },
            { label: "Ends", value: docDate(c.endDate) },
            ...(c.exclusive ? [{ label: "Type", value: "Exclusive" }] : []),
            ...(refQuote ? [{ label: "Based on", value: recordNo("quotation", refQuote.id) }] : []),
          ]}
        />
      ),
    });

    out.push({
      key: "parties",
      node: (
        <div>
          <SectionTitle>Parties to this agreement</SectionTitle>
          <TwoParties
            left={
              <Party
                heading={`Party A — ${copy.providerRole}`}
                name={signerLabel}
                lines={[
                  issuer.billingAddress,
                  issuer.panNumber && `PAN: ${issuer.panNumber}`,
                  issuer.gstNumber && `GSTIN: ${issuer.gstNumber}`,
                  issuer.email,
                  issuer.phone,
                ]}
              />
            }
            right={
              <Party
                heading={`Party B — ${copy.clientRole}`}
                name={c.brandName}
                lines={[deal?.dealTitle || c.contractName]}
              />
            }
          />
        </div>
      ),
    });

    out.push({
      key: "details",
      node: (
        <div className="doc-panel-subtle" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "4mm" }}>
          <KV label="Effective date" strong>{docDate(c.startDate)}</KV>
          <KV label="End date" strong>{docDate(c.endDate)}</KV>
          <KV label="Agreement value" strong>
            <span style={{ color: "var(--doc-brand)", fontWeight: 700 }}>{inr(c.contractValue)}</span>
          </KV>
          <KV label="Type" strong>{c.exclusive ? "Exclusive" : "Non-exclusive"}</KV>
        </div>
      ),
    });

    if (deal?.deliverables?.length) {
      out.push({
        key: "deliv-title",
        keepWithNext: true,
        node: (
          <div>
            <SectionTitle>
              {deal.deliverableMode === "any_one" ? "Deliverable options — client selects one" : "Deliverables"}
            </SectionTitle>
            {deal.deliverableMode === "any_one" && (
              <p className="doc-small doc-muted-t">The {copy.clientNoun} shall select one of the following options.</p>
            )}
          </div>
        ),
      });
      out.push(
        ...tableBlocks({
          keyPrefix: "deliv",
          chunk: 5,
          cols: [
            { label: "#", width: "8mm", align: "center" },
            { label: dLabels.category, width: "30mm" },
            { label: dLabels.type },
            { label: "Qty", width: "12mm", align: "center" },
            { label: "Frequency", width: "22mm" },
            { label: "Notes", width: "44mm" },
          ],
          rows: deal.deliverables,
          renderCell: (d: any, ci, ri) =>
            ci === 0 ? <span className="doc-muted-t doc-num">{ri + 1}</span>
            : ci === 1 ? <span style={{ fontWeight: 600 }}>{d.platform}</span>
            : ci === 2 ? d.contentType
            : ci === 3 ? <span style={{ fontWeight: 600 }}>{d.quantity}</span>
            : ci === 4 ? d.frequency
            : <span className="doc-small doc-muted-t">{d.notes || "—"}</span>,
        }),
      );
    }

    /* ── Numbered clauses — heading glued to clause 1, each clause atomic ── */
    out.push({
      key: "tc-title",
      keepWithNext: true,
      node: <SectionTitle>Terms &amp; conditions</SectionTitle>,
    });
    out.push({
      key: "c1",
      node: (
        <Clause n={1} title="Scope of Work">
          The {copy.providerNoun} agrees to provide {copy.serviceDescription} for the {copy.clientNoun}
          {" "}as described in the Deliverables section above, in connection with the engagement titled
          {" "}"{deal?.dealTitle || c.contractName}". {copy.complianceNote}
        </Clause>
      ),
    });
    out.push({
      key: "c2",
      node: (
        <Clause n={2} title="Deliverables & Timeline">
          All deliverables shall be submitted for {copy.clientNoun} approval at least 48 hours before the
          scheduled delivery or publication date. The {copy.clientNoun} shall provide approval or revision
          requests within 24 hours of receipt. The {copy.providerNoun} shall incorporate up to two (2) rounds
          of revisions at no additional charge. This Agreement is effective from{" "}
          <strong>{docDate(c.startDate)}</strong> through <strong>{docDate(c.endDate)}</strong>.
        </Clause>
      ),
    });
    out.push({
      key: "c3",
      node: (
        <Clause n={3} title={`Compensation (${inr(c.contractValue)})`}>
          In consideration for the services rendered, the {copy.clientNoun} shall pay the {copy.providerNoun} a
          total fee of <strong>{inr(c.contractValue)}</strong> (Indian Rupees{" "}
          {Number(c.contractValue).toLocaleString("en-IN")} only).{" "}
          {hasOwnPaymentTerms ? (
            <>Payment shall follow the schedule agreed between the parties as set out in the Deal-Specific
            Terms (Section 7) of this Agreement.</>
          ) : (
            <>Payment shall be structured as: 50% advance upon execution and 50% within 30 days of final
            deliverable approval.</>
          )}{" "}
          Late payments attract interest at 1.5% per month.
        </Clause>
      ),
    });
    out.push({
      key: "c4",
      node: <Clause n={4} title={copy.rightsHeading}>{copy.rightsText}</Clause>,
    });
    out.push({
      key: "c5",
      node: (
        <Clause n={5} title="Exclusivity Terms">
          {c.exclusive ? copy.exclusiveText : copy.nonExclusiveText}
        </Clause>
      ),
    });
    out.push({
      key: "c6",
      node: (
        <Clause n={6} title="Governing Law (Indian Contract Act 1872)">
          This Agreement shall be governed by and construed in accordance with the laws of India,
          including the Indian Contract Act, 1872. Any disputes shall first be attempted to be resolved
          through good-faith negotiation for 30 days, failing which disputes shall be submitted to
          binding arbitration under the Arbitration and Conciliation Act, 1996. The courts of India
          shall have exclusive jurisdiction for any legal proceedings.
        </Clause>
      ),
    });

    if (selectedTerms.length || customLines.length) {
      const items = [
        ...selectedTerms.map((t) => t.label),
        ...customLines,
      ];
      out.push({
        key: "c7-head",
        keepWithNext: true,
        node: (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "2.5mm", marginBottom: "1mm" }}>
              <span className="doc-clause-no">7</span>
              <span className="doc-h3">Deal-Specific Terms</span>
            </div>
            <p className="doc-small doc-muted-t" style={{ paddingLeft: "8mm" }}>
              The following terms were agreed in the quotation and carry over to this Agreement:
            </p>
          </div>
        ),
      });
      const CHUNK = 5;
      for (let i = 0; i < items.length; i += CHUNK) {
        out.push({
          key: `c7-${i}`,
          node: (
            <div style={{ paddingLeft: "8mm", display: "grid", gap: "1.5mm" }}>
              {items.slice(i, i + CHUNK).map((line, j) => (
                <div key={j} className="doc-body doc-muted-t" style={{ display: "flex", gap: "2mm" }}>
                  <span className="doc-num" style={{ color: "var(--doc-brand)", fontWeight: 700, flex: "none" }}>
                    7.{i + j + 1}
                  </span>
                  <span>{line}</span>
                </div>
              ))}
            </div>
          ),
        });
      }
    }

    /* ── Stamp duty (only when a certificate is recorded) ── */
    if ((c as any).estampCertificateNo) {
      out.push({
        key: "estamp",
        node: (
          <div className="doc-panel">
            <div className="doc-label" style={{ marginBottom: "2mm" }}>Stamp duty</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "4mm" }}>
              <KV label="Certificate no." strong><span className="doc-mono" style={{ fontSize: "8.5pt" }}>{(c as any).estampCertificateNo}</span></KV>
              {(c as any).estampDate && <KV label="Dated" strong>{docDate((c as any).estampDate)}</KV>}
              {(c as any).estampAmount != null && <KV label="Duty paid" strong>{inr((c as any).estampAmount)}</KV>}
              {(c as any).estampAuthority && <KV label="Issued by" strong>{(c as any).estampAuthority}</KV>}
            </div>
          </div>
        ),
      });
    }

    /* ── Signatures — atomic block, both parties side by side ── */
    out.push({
      key: "signatures",
      keepWithNext: true,
      node: (
        <div>
          <SectionTitle>Execution</SectionTitle>
          <div className="doc-sig-grid">
            <SignatureCell
              heading={`Party A — ${copy.providerRole}`}
              name={signerLabel}
              date={c.signedDate ? docDate(c.signedDate) : docDate(c.startDate)}
              signatureUrl={signatureSrc}
              sealUrl={sealSrc}
            />
            <SignatureCell
              heading={`Party B — ${copy.clientRole}`}
              name={c.brandName}
              date={c.signedByBrand && c.signedDate ? docDate(c.signedDate) : null}
              signatureUrl={null}
              awaitingText={c.signedByBrand ? "Accepted electronically — signed copy on record" : "Awaiting signature"}
            />
          </div>
        </div>
      ),
    });

    /* ── Execution record — the honest disclosure, atomic ── */
    out.push({
      key: "exec-record",
      node: (
        <div className="doc-panel-subtle">
          <div className="doc-label" style={{ marginBottom: "2mm" }}>Execution record</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "4mm", marginBottom: "2.5mm" }}>
            <KV label="Document ref" strong><span className="doc-mono" style={{ fontSize: "8.5pt" }}>{agreementNo}</span></KV>
            <KV label="Prepared by" strong>{signerLabel}</KV>
            <KV label="Effective from" strong>{docDate(c.startDate)}</KV>
            <KV label="Status" strong>{c.status}{c.signedDate ? ` · ${docDate(c.signedDate)}` : ""}</KV>
          </div>
          <p className="doc-small doc-muted-t">
            This agreement was prepared and accepted electronically. The signature shown for Party A is the
            image on file for the named signatory, captured when this document was created. This is an
            electronic acceptance with an audit record — it is not a Digital Signature Certificate issued
            under the Information Technology Act, 2000, and no certifying-authority verification is claimed.
            Parties may additionally execute a physically signed counterpart. Stamp duty and registration,
            where applicable, are the responsibility of the parties — DealInSec does not pay, issue or
            verify them.
          </p>
        </div>
      ),
    });

    out.push({
      key: "closing",
      node: (
        <p className="doc-small" style={{ textAlign: "center", color: "var(--doc-faint)" }}>
          Generated via DealInSec · Electronic acceptance with audit record · Indian Contract Act, 1872
        </p>
      ),
    });

    return out;
  }, [contract, deal, refQuote, issuer, copy, dLabels, agreementNo, signatureSrc, sealSrc, signerLabel]);

  /* ── Screen states ───────────────────────────────────────────────────── */
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background pb-20">
        <div className="px-4 py-6 space-y-4 max-w-4xl mx-auto">
          <Skeleton className="h-10 w-56" />
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      </div>
    );
  }
  if (!contract) {
    return (
      <div className="min-h-screen bg-background pb-20">
        <header className="glass-header sticky top-0 z-40">
          <div className="flex items-center gap-3 px-4 py-4">
            <Button variant="ghost" size="icon" onClick={() => setLocation("/contracts")} data-testid="button-back">
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <h1 className="text-xl lg:text-lg font-bold lg:font-semibold">Agreement Not Found</h1>
          </div>
        </header>
      </div>
    );
  }

  const warnings = [
    ...validateDocData({
      clientName: contract.brandName,
      sellerName: signerLabel === "—" ? "" : signerLabel,
      amount: contract.contractValue,
      startDate: contract.startDate,
      endDate: contract.endDate,
    }),
    ...detectPaymentConflicts((deal as any)?.customTerms),
  ];

  return (
    <div className="min-h-screen bg-background pb-20 print:pb-0">
      <header className="glass-header sticky top-0 z-40 print:hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => setLocation(backPath)} data-testid="button-back">
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <h1 className="text-xl lg:text-lg font-bold lg:font-semibold">Agreement Document</h1>
          </div>
          <Button onClick={() => window.print()} className="gradient-btn text-white" data-testid="button-export-pdf">
            <Printer className="w-4 h-4 mr-2" />
            Print / Save PDF
          </Button>
        </div>
      </header>

      <main className="px-4 py-6 max-w-4xl mx-auto animate-fade-in">
        <DocWarnings warnings={warnings} />

        <PagedDocument
          blocks={blocks}
          footer={docFooter(agreementNo, contract.contractName)}
        />

        <div className="flex gap-3 print:hidden mt-4">
          <Button variant="outline" className="flex-1 h-12 rounded-xl" onClick={() => setLocation(backPath)} data-testid="button-back-bottom">
            <ArrowLeft className="w-4 h-4 mr-2" /> Back
          </Button>
          <Button className="flex-1 h-12 rounded-xl gradient-btn text-white" onClick={() => window.print()} data-testid="button-print-bottom">
            <Printer className="w-4 h-4 mr-2" /> Print / Save PDF
          </Button>
        </div>
      </main>
    </div>
  );
}
