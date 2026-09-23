/**
 * The official agreement document — the client's own view of it, built from
 * the SAME primitives and the SAME clause text (shared/agreementClauses.ts)
 * as the freelancer's authenticated copy (client/src/pages/contract-pdf.tsx).
 * The only real difference is Party A's block: no address, no tax id, no
 * bank details, no signature image — the redacted snapshot never carried
 * those (see shared/contractSign.ts's header), so this component structurally
 * cannot render them even by mistake. Party B shows the signature the client
 * actually drew or typed, since that is their own signature being shown back
 * to them on their own confirmation, not private data being exposed.
 */
import { useMemo } from "react";
import { DEFAULT_LOCALE_SETTINGS, type LocaleSettings } from "@shared/schema";
import { getAgreementCopy, getDeliverableLabels } from "@shared/dealTypeTaxonomy";
import { buildAgreementClauses, executionRecordDisclosure } from "@shared/agreementClauses";
import { PagedDocument, type DocBlock } from "./paged";
import {
  DocHeader, docFooter, SectionTitle, TwoParties, Party, KV, tableBlocks,
  SignatureCell, docMoney, docDate, Clause, renderClauseBody,
} from "./primitives";

export interface PublicAgreementSnapshot {
  issuerName: string;
  clientName: string;
  contractName: string;
  startDate: string;
  endDate: string;
  amountMinor: number;
  currency: string;
  terms: string[];
  country: string;
  locale: string;
  timezone: string;
  dealType: string | null;
  exclusive: boolean;
  deliverables: { category: string; output: string; quantity: number; frequency: string }[];
  hasOwnPaymentTerms: boolean;
}

export function PublicAgreementDoc({
  snapshot,
  signerName,
  signerEmail,
  signatureDataUrl,
  signedAt,
}: {
  snapshot: PublicAgreementSnapshot;
  signerName: string;
  signerEmail: string | null;
  /** The client's own drawn/typed signature, as captured at signing. */
  signatureDataUrl: string | null;
  signedAt: string;
}) {
  // A signing link created before this document (and its extra snapshot
  // fields) shipped has a frozen, older-shaped snapshot in the database —
  // that link is still live and must keep working, so default rather than
  // crash on whatever it doesn't carry.
  const s: PublicAgreementSnapshot = {
    ...snapshot,
    terms: snapshot.terms ?? [],
    country: snapshot.country ?? DEFAULT_LOCALE_SETTINGS.country,
    locale: snapshot.locale ?? DEFAULT_LOCALE_SETTINGS.locale,
    timezone: snapshot.timezone ?? DEFAULT_LOCALE_SETTINGS.timezone,
    dealType: snapshot.dealType ?? null,
    exclusive: snapshot.exclusive ?? false,
    deliverables: snapshot.deliverables ?? [],
    hasOwnPaymentTerms: snapshot.hasOwnPaymentTerms ?? false,
  };
  const loc: LocaleSettings = useMemo(
    () => ({ country: s.country, currency: s.currency as LocaleSettings["currency"], locale: s.locale, timezone: s.timezone }),
    [s.country, s.currency, s.locale, s.timezone],
  );
  const copy = getAgreementCopy(s.dealType);
  const dLabels = getDeliverableLabels(s.dealType);

  const blocks = useMemo((): DocBlock[] => {
    const out: DocBlock[] = [];

    out.push({
      key: "header",
      node: (
        <DocHeader
          docType={copy.title}
          docNo=""
          status="Signed"
          formal
          meta={[
            { label: "Effective", value: docDate(s.startDate, loc) },
            { label: "Ends", value: docDate(s.endDate, loc) },
            ...(s.exclusive ? [{ label: "Type", value: "Exclusive" }] : []),
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
            left={<Party heading={`Party A — ${copy.providerRole}`} name={s.issuerName} />}
            right={<Party heading={`Party B — ${copy.clientRole}`} name={s.clientName} lines={[s.contractName]} />}
          />
        </div>
      ),
    });

    out.push({
      key: "details",
      node: (
        <div className="doc-panel-subtle" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "4mm" }}>
          <KV label="Effective date" strong>{docDate(s.startDate, loc)}</KV>
          <KV label="End date" strong>{docDate(s.endDate, loc)}</KV>
          <KV label="Agreement value" strong>
            <span style={{ color: "var(--doc-brand)", fontWeight: 700 }}>{docMoney(s.amountMinor, loc)}</span>
          </KV>
          <KV label="Type" strong>{s.exclusive ? "Exclusive" : "Non-exclusive"}</KV>
        </div>
      ),
    });

    if (s.deliverables.length) {
      out.push({ key: "deliv-title", keepWithNext: true, node: <SectionTitle>Deliverables</SectionTitle> });
      out.push(
        ...tableBlocks({
          keyPrefix: "deliv",
          chunk: 6,
          cols: [
            { label: "#", width: "8mm", align: "center" },
            { label: dLabels.category, width: "35mm" },
            { label: dLabels.type },
            { label: "Qty", width: "14mm", align: "center" },
            { label: "Frequency", width: "26mm" },
          ],
          rows: s.deliverables,
          renderCell: (d, ci, ri) =>
            ci === 0 ? <span className="doc-muted-t doc-num">{ri + 1}</span>
            : ci === 1 ? <span style={{ fontWeight: 600 }}>{d.category}</span>
            : ci === 2 ? d.output
            : ci === 3 ? <span style={{ fontWeight: 600 }}>{d.quantity}</span>
            : d.frequency,
        }),
      );
    }

    out.push({ key: "tc-title", keepWithNext: true, node: <SectionTitle>Terms &amp; conditions</SectionTitle> });
    const clauses = buildAgreementClauses({
      dealType: s.dealType,
      country: s.country,
      exclusive: s.exclusive,
      dealTitle: s.contractName,
      amountLabel: docMoney(s.amountMinor, loc),
      amountWordsLabel: docMoney(s.amountMinor, loc),
      startDateLabel: docDate(s.startDate, loc),
      endDateLabel: docDate(s.endDate, loc),
      hasOwnPaymentTerms: s.hasOwnPaymentTerms,
    });
    for (const clause of clauses) {
      out.push({ key: `c${clause.n}`, node: <Clause n={clause.n} title={clause.title}>{renderClauseBody(clause.body)}</Clause> });
    }

    if (s.terms.length) {
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
      for (let i = 0; i < s.terms.length; i += CHUNK) {
        out.push({
          key: `c7-${i}`,
          node: (
            <div style={{ paddingLeft: "8mm", display: "grid", gap: "1.5mm" }}>
              {s.terms.slice(i, i + CHUNK).map((line, j) => (
                <div key={j} className="doc-body doc-muted-t" style={{ display: "flex", gap: "2mm" }}>
                  <span className="doc-num" style={{ color: "var(--doc-brand)", fontWeight: 700, flex: "none" }}>7.{i + j + 1}</span>
                  <span>{line}</span>
                </div>
              ))}
            </div>
          ),
        });
      }
    }

    out.push({
      key: "signatures",
      keepWithNext: true,
      node: (
        <div>
          <SectionTitle>Execution</SectionTitle>
          <div className="doc-sig-grid">
            {/* No image here on purpose — the redacted snapshot never carries
                the freelancer's signature file (see shared/contractSign.ts),
                so their side of the execution block is a printed name, the
                same way any unsigned counterpart renders elsewhere. */}
            <SignatureCell heading={`Party A — ${copy.providerRole}`} name={s.issuerName} note="On file with DealInSec" />
            <SignatureCell
              heading={`Party B — ${copy.clientRole}`}
              name={signerName}
              date={docDate(signedAt, loc)}
              signatureUrl={signatureDataUrl}
            />
          </div>
        </div>
      ),
    });

    out.push({
      key: "exec-record",
      node: (
        <div className="doc-panel-subtle">
          <div className="doc-label" style={{ marginBottom: "2mm" }}>Execution record</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "4mm" }}>
            <KV label="Prepared by" strong>{s.issuerName}</KV>
            <KV label="Effective from" strong>{docDate(s.startDate, loc)}</KV>
            <KV label="Status" strong>Signed · {docDate(signedAt, loc)}</KV>
            {signerEmail && <KV label="Signer email" strong>{signerEmail}</KV>}
          </div>
          <p className="doc-small doc-muted-t" style={{ marginTop: "2.5mm" }}>
            This agreement was accepted electronically. Party B&apos;s signature above is the image or
            typed mark captured at the moment of signing, with an audit record of who signed, when and
            from where. {executionRecordDisclosure(s.country)}
          </p>
        </div>
      ),
    });

    return out;
  }, [s, copy, dLabels, loc, signerName, signerEmail, signatureDataUrl, signedAt]);

  return <PagedDocument blocks={blocks} locale={loc} footer={docFooter(s.contractName, "Signed agreement")} />;
}
