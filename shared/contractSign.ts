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
import { STANDARD_TERMS, termsForPhase, type Contract, type LocaleSettings } from "./schema";
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
}

export function buildAgreementShareSnapshot(args: {
  issuerName: string;
  contract: Pick<Contract, "brandName" | "contractName" | "startDate" | "endDate" | "contractValueMinor">;
  dealStandardTermIds: readonly string[] | null | undefined;
  dealCustomTerms: string | null | undefined;
  settings: LocaleSettings;
}): AgreementShareSnapshot {
  const { issuerName, contract, settings } = args;
  const standardLabels = termsForPhase(args.dealStandardTermIds ?? [], "agreement").map((t) => t.label);
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
