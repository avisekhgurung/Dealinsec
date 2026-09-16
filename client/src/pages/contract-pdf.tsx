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
import { STANDARD_TERMS, termsForPhase, recordNo } from "@shared/schema";
import { getAgreementCopy, getDeliverableLabels } from "@shared/dealTypeTaxonomy";
import { PagedDocument, type DocBlock } from "@/components/document/paged";
import {
  DocHeader, docFooter, SectionTitle, TwoParties, Party, KV, tableBlocks,
  SignatureCell, DocWarnings, docMoney, docDate,
} from "@/components/document/primitives";
import { currencyProseName, documentLocaleSettings, formatAmount } from "@/lib/format";
import { useMoney } from "@/hooks/use-locale";
import { DocLocalePending } from "@/components/document/locale-pending";
import { countryName } from "@shared/region";
import {
  detectPaymentConflicts, termsMentionPayment, validateDocData,
} from "@/components/document/checks";

function slugify(s: string): string {
  return (s || "").normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");
}

/**
 * The country the agreement was ISSUED under — Party A's, the freelancer's.
 *
 * The issuer snapshot freezes it at creation (buildIssuerSnapshot in
 * server/routes.ts), so an agreement made as an Indian freelancer keeps its
 * Indian governing-law clause even if the organisation moves country later. A
 * row without a snapshot falls back to the org's CURRENT country; every row
 * issued so far belongs to an Indian org, so it resolves to India and prints
 * exactly what it always has.
 */
function issuedCountry(contract: object | undefined, fallback: string): string {
  const raw = (contract as { issuerSnapshot?: { country?: unknown } } | undefined)?.issuerSnapshot?.country;
  return typeof raw === "string" && /^[A-Za-z]{2}$/.test(raw.trim()) ? raw.trim().toUpperCase() : fallback;
}

/** EU member states (ISO-3166 alpha-2), for the "VAT number" label. Same list
 *  as shared/invoice-tax.ts, so an agreement and an invoice from one freelancer
 *  name the same registration the same way. */
const EU_COUNTRIES = "AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE".split(" ");

/**
 * What a non-Indian freelancer's tax registration is called on the agreement.
 * It is the one number stored in the profile's `gstNumber` slot outside India
 * — the slot shared/invoice-tax.ts already prints a UK VAT number from — and it
 * is optional, because most freelancers outside India have no registration to
 * show. Kept in step with contract-confirmation.tsx and profile.tsx, which ask
 * for the same field under the same label.
 */
const TAX_ID_LABELS: Readonly<Record<string, string>> = {
  GB: "VAT number",
  ...Object.fromEntries(EU_COUNTRIES.map((c) => [c, "VAT number"])),
  US: "EIN / Tax ID",
  AU: "ABN",
  CA: "GST/HST number",
};
const taxIdLabel = (country: string): string => TAX_ID_LABELS[country] ?? "Tax registration number";

/**
 * A country as English legal prose names it, for "the laws of …".
 *
 * CLDR's display names are UI labels — "Bosnia & Herzegovina", "St. Lucia",
 * "Hong Kong SAR China" — and carry no article, which would print "the laws of
 * United Kingdom". Countries CLDR has renamed within recent browser versions
 * (Türkiye, Czechia, Eswatini, North Macedonia) are pinned too: the name inside
 * a signed agreement must not change with the reader's browser. Every other
 * country's CLDR name already is its plain English name.
 */
const LEGAL_COUNTRY_NAMES: Readonly<Record<string, string>> = {
  AE: "the United Arab Emirates",
  AG: "Antigua and Barbuda",
  AX: "the Åland Islands",
  BA: "Bosnia and Herzegovina",
  BL: "Saint Barthélemy",
  BQ: "the Caribbean Netherlands",
  BS: "the Bahamas",
  CC: "the Cocos (Keeling) Islands",
  CD: "the Democratic Republic of the Congo",
  CF: "the Central African Republic",
  CG: "the Republic of the Congo",
  CI: "Côte d’Ivoire",
  CK: "the Cook Islands",
  CV: "Cabo Verde",
  CZ: "the Czech Republic",
  DO: "the Dominican Republic",
  FK: "the Falkland Islands",
  FM: "the Federated States of Micronesia",
  FO: "the Faroe Islands",
  // England & Wales, Scotland and Northern Ireland are separate legal systems;
  // "the laws of the United Kingdom" names no jurisdiction at all.
  GB: "England and Wales",
  GM: "the Gambia",
  HK: "Hong Kong",
  IM: "the Isle of Man",
  KM: "the Comoros",
  KN: "Saint Kitts and Nevis",
  KP: "North Korea",
  KR: "the Republic of Korea",
  KY: "the Cayman Islands",
  LC: "Saint Lucia",
  MF: "Saint Martin",
  MH: "the Marshall Islands",
  MK: "North Macedonia",
  MM: "Myanmar",
  MO: "Macao",
  MP: "the Northern Mariana Islands",
  MV: "the Maldives",
  NL: "the Netherlands",
  PH: "the Philippines",
  PM: "Saint Pierre and Miquelon",
  PN: "the Pitcairn Islands",
  PS: "the Palestinian Territories",
  SB: "Solomon Islands",
  SH: "Saint Helena",
  SJ: "Svalbard and Jan Mayen",
  ST: "São Tomé and Príncipe",
  SZ: "Eswatini",
  TC: "the Turks and Caicos Islands",
  TL: "Timor-Leste",
  TR: "Türkiye",
  TT: "Trinidad and Tobago",
  US: "the United States",
  VA: "Vatican City",
  VC: "Saint Vincent and the Grenadines",
  VG: "the British Virgin Islands",
  VI: "the United States Virgin Islands",
  WF: "Wallis and Futuna",
};
const legalCountryName = (code: string): string => LEGAL_COUNTRY_NAMES[code] ?? countryName(code);

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
  // The ORG's locale, not the viewer's — an agreement must print the same
  // currency for every teammate who opens it.
  const fmt = useMoney();
  const backPath = `/contracts/${id}`;

  const { data: contract, isLoading } = useQuery<Contract>({
    queryKey: ["/api/contracts", id],
  });
  // The currency is the one STAMPED on the agreement when it was issued, not
  // the org's current setting, so a signed agreement re-renders in the
  // currency it was signed in by construction rather than only because the
  // region locks. Every existing row was backfilled 'INR', which is what its
  // org uses, so nothing issued so far changes.
  // Memoised: `loc` is a dependency of the paginated blocks below, and a fresh
  // object every render would re-paginate the document on every render.
  const issuedCurrency = contract?.currency;
  const loc = useMemo(
    () => documentLocaleSettings(fmt.settings, null, { currency: issuedCurrency }),
    [fmt.settings, issuedCurrency],
  );

  // The issuer frozen onto the agreement when it was created, once rows carry
  // a snapshot; until then (and for every agreement issued so far) the live
  // profile, which is exactly what this page has always printed.
  const issuer = useIssuer(contract);
  // India prints the clauses every existing agreement was signed with, byte
  // for byte. Anywhere else gets wording that cites no Indian statute.
  const country = issuedCountry(contract, loc.country);
  const isIndia = country === "IN";

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
      const res = await fetch(`/api/deals/${contract?.dealId}/quote`, { credentials: "include", headers: { "X-DealInSec-Money": "minor" } });
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
    // Phase filter: quotation-only terms (e.g. "valid for 30 days") make no
    // sense on an executed agreement and are dropped here.
    const selectedTerms = termsForPhase(selectedIds, "agreement");
    const customLines = (customTerms ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
    // Clause 3 defers to Section 7 when EITHER the custom terms or any
    // selected standard payment term defines the payment structure —
    // otherwise the default schedule could contradict Section 7 (the
    // 30-days-vs-7-days bug via balance_7d).
    const hasOwnPaymentTerms =
      termsMentionPayment(customTerms) || selectedTerms.some((t) => t.payment);
    const out: DocBlock[] = [];

    out.push({
      key: "head",
      keepWithNext: true,
      node: (
        <DocHeader
          formal
          brand={signerLabel !== "—" ? signerLabel : undefined}
          docType={copy.title}
          docNo={agreementNo}
          status={c.status === "Signed" ? "Signed" : "Pending"}
          meta={[
            { label: "Effective", value: docDate(c.startDate, loc) },
            { label: "Ends", value: docDate(c.endDate, loc) },
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
                lines={isIndia ? [
                  issuer.billingAddress,
                  issuer.panNumber && `PAN: ${issuer.panNumber}`,
                  issuer.gstNumber && `GSTIN: ${issuer.gstNumber}`,
                  issuer.email,
                  issuer.phone,
                ] : [
                  issuer.billingAddress,
                  // A PAN means nothing outside India, so it never prints here,
                  // even if one is left on a profile from before a move.
                  issuer.gstNumber && `${taxIdLabel(country)}: ${issuer.gstNumber}`,
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
          <KV label="Effective date" strong>{docDate(c.startDate, loc)}</KV>
          <KV label="End date" strong>{docDate(c.endDate, loc)}</KV>
          <KV label="Agreement value" strong>
            <span style={{ color: "var(--doc-brand)", fontWeight: 700 }}>{docMoney(c.contractValueMinor, loc)}</span>
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
          <strong>{docDate(c.startDate, loc)}</strong> through <strong>{docDate(c.endDate, loc)}</strong>.
        </Clause>
      ),
    });
    out.push({
      key: "c3",
      node: (
        <Clause n={3} title={`Compensation (${docMoney(c.contractValueMinor, loc)})`}>
          In consideration for the services rendered, the {copy.clientNoun} shall pay the {copy.providerNoun} a
          total fee of <strong>{docMoney(c.contractValueMinor, loc)}</strong> ({currencyProseName(loc.currency)}{" "}
          {formatAmount(c.contractValueMinor, loc.currency, loc.locale)} only).{" "}
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
      node: isIndia ? (
        <Clause n={6} title="Governing Law (Indian Contract Act 1872)">
          This Agreement shall be governed by and construed in accordance with the laws of India,
          including the Indian Contract Act, 1872. Any disputes shall first be attempted to be resolved
          through good-faith negotiation for 30 days, failing which disputes shall be submitted to
          binding arbitration under the Arbitration and Conciliation Act, 1996. The courts of India
          shall have exclusive jurisdiction for any legal proceedings.
        </Clause>
      ) : (
        // Deliberately names no statute and no arbitration scheme: we have not
        // verified which apply in each country, and a wrong citation in a
        // contract is worse than none. The creation screen tells the user this
        // wording is a general template (contract-confirmation.tsx).
        <Clause n={6} title="Governing Law">
          This Agreement shall be governed by and construed in accordance with the laws of{" "}
          {legalCountryName(country)}. Any disputes shall first be attempted to be resolved through
          good-faith negotiation for 30 days, failing which the courts of {legalCountryName(country)}
          {" "}shall have exclusive jurisdiction for any legal proceedings.
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
              {(c as any).estampDate && <KV label="Dated" strong>{docDate((c as any).estampDate, loc)}</KV>}
              {(c as any).estampAmountMinor != null && <KV label="Duty paid" strong>{docMoney((c as any).estampAmountMinor, loc)}</KV>}
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
              date={c.signedDate ? docDate(c.signedDate, loc) : docDate(c.startDate, loc)}
              signatureUrl={signatureSrc}
              sealUrl={sealSrc}
            />
            <SignatureCell
              heading={`Party B — ${copy.clientRole}`}
              name={c.brandName}
              date={c.signedByBrand && c.signedDate ? docDate(c.signedDate, loc) : null}
              signatureUrl={null}
              note={c.signedByBrand ? "Accepted electronically — signed copy on record" : undefined}
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
            <KV label="Effective from" strong>{docDate(c.startDate, loc)}</KV>
            <KV label="Status" strong>{c.status}{c.signedDate ? ` · ${docDate(c.signedDate, loc)}` : ""}</KV>
          </div>
          {isIndia ? (
            <p className="doc-small doc-muted-t">
              This agreement was prepared and accepted electronically. The signature shown for Party A is the
              image on file for the named signatory, captured when this document was created. This is an
              electronic acceptance with an audit record — it is not a Digital Signature Certificate issued
              under the Information Technology Act, 2000, and no certifying-authority verification is claimed.
              Parties may additionally execute a physically signed counterpart. Stamp duty and registration,
              where applicable, are the responsibility of the parties — DealInSec does not pay, issue or
              verify them.
            </p>
          ) : (
            // The same disclosure without India's IT Act: it says what this
            // acceptance is not, in terms that hold in any country.
            <p className="doc-small doc-muted-t">
              This agreement was prepared and accepted electronically. The signature shown for Party A is the
              image on file for the named signatory, captured when this document was created. This is an
              electronic acceptance with an audit record — it is not a certificate-based digital signature,
              and no certifying-authority verification is claimed.
              Parties may additionally execute a physically signed counterpart. Stamp duty and registration,
              where applicable, are the responsibility of the parties — DealInSec does not pay, issue or
              verify them.
            </p>
          )}
        </div>
      ),
    });

    out.push({
      key: "closing",
      node: (
        <p className="doc-small" style={{ textAlign: "center", color: "var(--doc-faint)" }}>
          {isIndia
            ? "Electronic acceptance with audit record · Indian Contract Act, 1872"
            : "Electronic acceptance with audit record"}
        </p>
      ),
    });

    return out;
  }, [contract, deal, refQuote, issuer, copy, dLabels, agreementNo, signatureSrc, sealSrc, signerLabel, loc, country, isIndia]);

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
  // Until the org's settings load, `loc` falls back to the viewer's own row:
  // an invitee of a UK org would see — and could print — the Indian clauses.
  if (!fmt.ready) {
    return <DocLocalePending failed={fmt.failed} onRetry={fmt.retry} />;
  }

  const warnings = [
    ...validateDocData({
      clientName: contract.brandName,
      sellerName: signerLabel === "—" ? "" : signerLabel,
      amountMinor: contract.contractValueMinor,
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
          locale={loc}
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
