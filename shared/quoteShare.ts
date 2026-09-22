/**
 * Client-facing quotation sharing — the redacted, frozen content a public
 * link may show, with NO authentication and NO server import (pure, so it is
 * unit-testable and cannot accidentally reach for a private field).
 *
 * WHAT NEVER GOES IN HERE: PAN, GSTIN or any tax id, bank account/IFSC/routing
 * details, phone number, billing address, signature image, company seal,
 * internal database ids (userId, organizationId, deal id) or any other
 * client's data. This is a quotation, not the invoice — the invoice is where
 * bank and tax fields belong, and it is never public.
 */
import { STANDARD_TERMS, type Deal, type Deliverable, type LocaleSettings } from "./schema";
import { formatMoney, formatDate } from "./money";

export interface QuoteShareSnapshot {
  v: 1;
  issuerName: string;
  clientName: string;
  dealTitle: string;
  dealType: string;
  deliverables: { label: string; quantity: number }[];
  startDate: string;
  endDate: string;
  amountMinor: number;
  currency: string;
  amountLabel: string;
  terms: string[];
  quoteNumber: string;
  version: number;
  /** The date printed as "valid until" — computed once, at share time, so it
   *  never silently moves as real time passes on an old link. */
  validUntil: string;
}

const deliverableLabel = (d: Deliverable) => `${d.contentType || d.platform}${d.notes ? ` — ${d.notes}` : ""}`;

/** Deterministic, side-effect-free. `issuerName` is already resolved by the
 *  caller (firstName+lastName, or business name once that field exists) so
 *  this module never needs a User row. */
export function buildQuoteShareSnapshot(args: {
  issuerName: string;
  deal: Pick<Deal, "brandName" | "dealTitle" | "dealType" | "deliverables" | "startDate" | "endDate" | "dealAmountMinor" | "standardTermIds" | "customTerms">;
  quoteId: number;
  version: number;
  settings: LocaleSettings;
  now?: Date;
}): QuoteShareSnapshot {
  const { issuerName, deal, quoteId, version, settings } = args;
  const now = args.now ?? new Date();
  const validUntil = new Date(now.getTime() + 30 * 86_400_000);

  const standardLabels = STANDARD_TERMS.filter((t) => (deal.standardTermIds as string[] | null)?.includes(t.id) && t.phases.includes("quotation")).map((t) => t.label);
  const customLines = (deal.customTerms ?? "").split("\n").map((t) => t.trim()).filter(Boolean);

  return {
    v: 1,
    issuerName,
    clientName: deal.brandName,
    dealTitle: deal.dealTitle,
    dealType: deal.dealType,
    deliverables: ((deal.deliverables as Deliverable[] | null) ?? []).map((d) => ({ label: deliverableLabel(d), quantity: d.quantity ?? 1 })),
    startDate: deal.startDate,
    endDate: deal.endDate,
    amountMinor: deal.dealAmountMinor,
    currency: settings.currency,
    amountLabel: formatMoney(deal.dealAmountMinor, settings.currency, settings.locale),
    terms: [...standardLabels, ...customLines],
    quoteNumber: `QUO-${String(quoteId).padStart(4, "0")}`,
    version,
    validUntil: formatDate(validUntil, settings.locale, { day: "numeric", month: "long", year: "numeric" }),
  };
}
