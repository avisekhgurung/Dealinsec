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
