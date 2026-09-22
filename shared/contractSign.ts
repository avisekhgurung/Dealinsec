/**
 * Client-facing agreement signing — the redacted, frozen content a public
 * signing link may show, and the pure builder for it. Same discipline as
 * shared/quoteShare.ts: no server import, no PAN/GSTIN/bank/phone/address/
 * signature-image/internal-id ever in the snapshot. The AGREEMENT is the one
 * document where a client is asked to sign something, so what they see must
 * be exactly what the freelancer's own copy says — built from the same
 * `termsForPhase(ids, "agreement")` filter the authenticated contract PDF
 * uses, not a re-derived approximation of it.
 */
import { STANDARD_TERMS, termsForPhase, type Contract, type Deliverable, type LocaleSettings } from "./schema";
import { formatMoney } from "./money";

export interface AgreementShareSnapshot {
  v: 1;
  issuerName: string;
  clientName: string;
  contractName: string;
  startDate: string;
  endDate: string;
  amountMinor: number;
  currency: string;
  amountLabel: string;
  terms: string[];
  /** Full LocaleSettings so the client's own official document renders in
   *  the same locale/date-format/currency conventions the freelancer's does
   *  — country and currency alone aren't enough to pick a date format. */
  country: string;
  locale: string;
  timezone: string;
  /** Which numbered-clause template applies (governing-law wording, the
   *  provider/client nouns) — a taxonomy key, not private data. */
  dealType: string | null;
  exclusive: boolean;
  /** Redacted the same way a quotation's deliverables are: category,
   *  output and quantity — never the free-text `notes` field, which is
   *  arbitrary internal shorthand, not something written for a client to read. */
  deliverables: { category: string; output: string; quantity: number; frequency: string }[];
  /** Whether `terms` already covers payment, so Clause 3's schedule sentence
   *  matches the freelancer's own copy instead of always printing the
   *  generic default. */
  hasOwnPaymentTerms: boolean;
}

// Same regex as client/src/components/document/checks.ts's
// termsMentionPayment() — duplicated rather than imported because that file
// lives outside shared/ (it has a couple of client-only siblings) and this
// one-line check isn't worth restructuring that module for. Keep both in
// sync if either changes.
const mentionsPayment = (text: string | null | undefined): boolean =>
  /advance|payment|payab|\bdue\b|instalment|installment|milestone|%/i.test(text ?? "");

export function buildAgreementShareSnapshot(args: {
  issuerName: string;
  contract: Pick<Contract, "brandName" | "contractName" | "startDate" | "endDate" | "contractValueMinor">;
  dealType: string | null | undefined;
  exclusive: boolean;
  deliverables: readonly Pick<Deliverable, "contentType" | "platform" | "quantity" | "frequency">[] | null | undefined;
  dealStandardTermIds: readonly string[] | null | undefined;
  dealCustomTerms: string | null | undefined;
  settings: LocaleSettings;
}): AgreementShareSnapshot {
  const { issuerName, contract, settings } = args;
  const selectedTerms = termsForPhase(args.dealStandardTermIds ?? [], "agreement");
  const standardLabels = selectedTerms.map((t) => t.label);
  const customLines = (args.dealCustomTerms ?? "").split("\n").map((t) => t.trim()).filter(Boolean);

  return {
    v: 1,
    issuerName,
    clientName: contract.brandName,
    contractName: contract.contractName,
    startDate: contract.startDate,
    endDate: contract.endDate,
    amountMinor: contract.contractValueMinor,
    currency: settings.currency,
    amountLabel: formatMoney(contract.contractValueMinor, settings.currency, settings.locale),
    terms: [...standardLabels, ...customLines],
    country: settings.country,
    locale: settings.locale,
    timezone: settings.timezone,
    dealType: args.dealType ?? null,
    exclusive: args.exclusive,
    deliverables: (args.deliverables ?? []).map((d) => ({ category: d.platform, output: d.contentType, quantity: d.quantity ?? 1, frequency: d.frequency })),
    hasOwnPaymentTerms: mentionsPayment(args.dealCustomTerms) || selectedTerms.some((t) => t.payment),
  };
}

/* ── Document integrity ──────────────────────────────────────────────────
 * A detector, not a cryptographic seal on rendered PDF bytes: it proves the
 * signed FIELDS in the database haven't changed since the moment of signing
 * (they never should — signing is meant to be immutable), not that any PDF
 * generated from them is byte-identical to one generated earlier. Say
 * "recorded" / "matches the signed record", never "tamper-proof".
 */
import crypto from "crypto";

export interface SignedRecordForHash {
  clientSignShareSnapshot: unknown;
  clientSignerName: string | null;
  clientSignerEmail: string | null;
  clientSignatureDataUrl: string | null;
  clientSignedAt: string | Date | null;
}

/** Deterministic: same signed fields always hash the same way, so this can
 *  be recomputed on every read and compared to the stored value. */
export function computeDocumentHash(record: SignedRecordForHash): string {
  const canonical = JSON.stringify({
    snapshot: record.clientSignShareSnapshot ?? null,
    signerName: record.clientSignerName ?? null,
    signerEmail: record.clientSignerEmail ?? null,
    signatureDataUrl: record.clientSignatureDataUrl ?? null,
    signedAt: record.clientSignedAt ? new Date(record.clientSignedAt).toISOString() : null,
  });
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

/** "verified" only when a hash was stored AND it still matches the record's
 *  current fields; "unavailable" for a pre-hash row (nothing to check
 *  against — not a failure); "mismatch" if the stored fields somehow moved,
 *  which should never happen given the immutability rule elsewhere. */
export function verifyDocumentHash(
  record: SignedRecordForHash,
  storedHash: string | null,
): "verified" | "unavailable" | "mismatch" {
  if (!storedHash) return "unavailable";
  return computeDocumentHash(record) === storedHash ? "verified" : "mismatch";
}
