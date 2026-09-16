/**
 * The invoice tax block — its SHAPE for every country, and never a rate.
 *
 * Before this file the invoice was GST-shaped for everyone: it printed PAN and
 * GSTIN under "From" and cited Rule 46 of India's CGST Rules to a client in
 * London. The honest posture was right — an in-app invoice carries no tax
 * computation it cannot stand behind — and stays the default everywhere. The
 * hardcoded statute and the Indian identifiers were the bug.
 *
 * Two separate things live here, and neither contains a tax rate:
 *
 *  1. InvoiceTaxProfile — per-country PRESENTATION: which registration numbers
 *     print under "From" and under what label, whether lines carry an HSN/SAC
 *     code, and the disclaimer. A country is a data row; one we have not
 *     verified gets the generic profile, never a guess.
 *
 *  2. InvoiceTaxLine — the one data structure for tax on an invoice, whatever
 *     the country: `{ label, rateMilliPercent, baseMinor, amountMinor }`. India
 *     is two or three of these (CGST + SGST, or IGST), a UK VAT invoice is one,
 *     a US state is one or two. The ISSUER types the label and the rate. This
 *     product does not know anyone's tax rate and must not pretend to — rates
 *     change (Washington pulled IT and design services into sales tax in
 *     October 2025) and a wrong one printed on an invoice is the user's
 *     liability, not ours.
 */
import { z } from "zod";
import { amountMinorSchema, getLocaleSettings } from "./schema";

/* ── 1. Per-country presentation ───────────────────────────────────────── */

/** The issuer identity fields a registration can print from. */
export interface IssuerTaxIdentity {
  panNumber?: string | null;
  gstNumber?: string | null;
}

export interface TaxRegistrationField {
  /** Printed before the value: "GSTIN", "VAT number". */
  label: string;
  /** Which stored field holds it. `gstNumber` is the one slot for an INDIRECT
   *  tax registration in any country — a GSTIN in India, a VAT number in the
   *  UK — until the issuer identity becomes a generic tax-ID list. That has to
   *  wait for issuer snapshotting (see useIssuer), so the mapping lives here,
   *  in one line per country, rather than in every screen that prints it. */
  field: keyof IssuerTaxIdentity;
}

export interface InvoiceTaxProfile {
  /** Printed under "From", in this order, each only when the issuer has one.
   *  Empty means print none — which is a rule in its own right for the US,
   *  where the TIN goes privately on a Form W-9 and never on the invoice face. */
  registrations: readonly TaxRegistrationField[];
  /** Whether lines carry India's HSN/SAC classification code. Where false the
   *  composer hides the field; a code already stored on a line still prints,
   *  because what was entered in that field is an HSN/SAC code wherever the
   *  organization is today. */
  hsnSac: boolean;
  /** Placeholder for a tax line's name. A hint, not a default — nothing is
   *  pre-filled, because a pre-filled "VAT" is a nudge to charge it. */
  taxLabelHint: string;
  /** Under the total on an invoice with no tax lines. */
  noTaxNote: string;
  /** The same statement, as a full sentence, beneath the composer's preview. */
  noTaxExplainer: string;
  /** Under the total on an invoice with tax lines. States whose figures they
   *  are, because the arithmetic is ours but the rate and its applicability
   *  are the issuer's. */
  taxNote: string;
}

const GENERIC: InvoiceTaxProfile = {
  // Generically labelled and user-entered: a registration the issuer typed
  // prints as they typed it, under a label that asserts nothing about which
  // tax it is for.
  registrations: [{ label: "Tax registration no.", field: "gstNumber" }],
  hsnSac: false,
  taxLabelHint: "Tax",
  noTaxNote: "Contract value — no tax added.",
  noTaxExplainer: "Amounts are the agreed contract value and no tax has been added to them.",
  taxNote: "Tax rates and amounts as entered by the issuer.",
};

// India's strings are the ones every invoice issued so far printed, verbatim.
// The Rule 46 sentence stays even when tax lines are added: a user-entered GST
// line does not make this a tax invoice under the CGST Rules, and a document
// that looks like one must say so.
const INDIA: InvoiceTaxProfile = {
  registrations: [
    { label: "PAN", field: "panNumber" },
    { label: "GSTIN", field: "gstNumber" },
  ],
  hsnSac: true,
  taxLabelHint: "e.g. IGST",
  noTaxNote: "Contract value — no GST computation. Not a tax invoice under Rule 46 of the CGST Rules, 2017.",
  noTaxExplainer:
    "Amounts are the agreed contract value and carry no GST computation — this is not a tax invoice " +
    "under Rule 46 of the CGST Rules, 2017.",
  taxNote: "Tax as entered by the issuer. Not a tax invoice under Rule 46 of the CGST Rules, 2017.",
};

const VAT: InvoiceTaxProfile = {
  ...GENERIC,
  registrations: [{ label: "VAT number", field: "gstNumber" }],
  taxLabelHint: "VAT",
};

// EU member states (ISO-3166 alpha-2; Greece is GR here, EL only in VAT IDs).
const EU = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
] as const;

const PROFILES: Readonly<Record<string, InvoiceTaxProfile>> = {
  IN: INDIA,
  GB: VAT,
  ...Object.fromEntries(EU.map((c) => [c, VAT])),
  US: { ...GENERIC, registrations: [], taxLabelHint: "Sales tax" },
};

/** How an invoice issued from `country` presents tax. Unknown → generic. */
export function invoiceTaxProfile(country?: string | null): InvoiceTaxProfile {
  return PROFILES[getLocaleSettings({ country }).country] ?? GENERIC;
}

export interface TaxRegistration {
  field: keyof IssuerTaxIdentity;
  label: string;
  value: string;
}

/** The issuer's registrations this profile prints, skipping empty ones. Values
 *  are printed exactly as stored — not trimmed — so an issued Indian invoice
 *  reads character-for-character as it did. */
export function taxRegistrations(profile: InvoiceTaxProfile, identity: IssuerTaxIdentity): TaxRegistration[] {
  return profile.registrations.flatMap((r) => {
    const value = identity[r.field];
    return value ? [{ field: r.field, label: r.label, value }] : [];
  });
}

export const formatTaxRegistration = (r: TaxRegistration): string => `${r.label}: ${r.value}`;

/**
 * What the bank routing code is called, by the issuing country. The profile
 * has one `ifscCode` slot for it in every country; this is the one table that
 * names it, so the profile form that asks for it and the invoice that prints
 * it cannot disagree (a UK freelancer typed a "Sort code" and their invoice
 * said "IFSC"). India keeps "IFSC", as every issued invoice printed it. A
 * country without a row gets a label that asserts no particular scheme.
 */
const BANK_ROUTING_LABELS: Readonly<Record<string, string>> = {
  IN: "IFSC",
  GB: "Sort code",
  US: "Routing number",
  AU: "BSB",
  CA: "Transit / institution number",
  ...Object.fromEntries(EU.map((c) => [c, "IBAN / BIC"])),
};

export function bankRoutingLabel(country?: string | null): string {
  return BANK_ROUTING_LABELS[getLocaleSettings({ country }).country] ?? "Bank code";
}

/* ── 2. Tax lines ──────────────────────────────────────────────────────── */

/** One row of the tax block: a named rate applied to a base.
 *
 *  Stored as a SNAPSHOT of what the client was sent — `amountMinor` included,
 *  not recomputed on render. If the rounding rule below ever changes, invoices
 *  already issued must keep the figures printed on them. */
export interface InvoiceTaxLine {
  /** As the issuer typed it: "VAT", "CGST", "Sales tax". */
  label: string;
  /** Thousandths of a percent: 20% is 20000, 8.875% is 8875. An integer
   *  because combined US rates run to three decimals and a float rate is how
   *  20% becomes 19.999999%. The unit is in the name for the same reason
   *  money is `*Minor`. */
  rateMilliPercent: number;
  /** The taxable amount, MINOR units. Carried per line rather than assumed to
   *  be the subtotal, so an invoice with an exempt line is expressible
   *  without changing this shape. */
  baseMinor: number;
  /** Tax charged, MINOR units. */
  amountMinor: number;
}

export interface TaxRate {
  label: string;
  rateMilliPercent: number;
}

const MILLI_PERCENT_PER_WHOLE = 100_000;
export const MAX_TAX_RATE_MILLI_PERCENT = MILLI_PERCENT_PER_WHOLE; // 100%
export const MAX_TAX_LINES = 5;

/**
 * `base × rate`, rounded half-up to a whole minor unit, in exact integer
 * arithmetic.
 *
 * BigInt because the product does not fit a double: MAX_AMOUNT_MINOR (1e11) at
 * 100% is 1e16, past 2^53, where Math.round would be rounding an already
 * rounded number. Half-up per tax line is this product's convention, stated
 * rather than implied — it is not a claim about any jurisdiction's rule, and
 * the stored snapshot is what the client sees either way.
 */
export function taxAmountMinor(baseMinor: number, rateMilliPercent: number): number {
  if (!Number.isSafeInteger(baseMinor) || baseMinor < 0 || !Number.isSafeInteger(rateMilliPercent) || rateMilliPercent < 0) {
    throw new RangeError(`taxAmountMinor: base ${baseMinor} and rate ${rateMilliPercent} must be non-negative integers`);
  }
  const whole = BigInt(MILLI_PERCENT_PER_WHOLE);
  const two = BigInt(2);
  return Number((BigInt(baseMinor) * BigInt(rateMilliPercent) * two + whole) / (whole * two));
}

/** Each rate applied to the same base. Rates never compound on each other. */
export function computeTaxLines(baseMinor: number, rates: readonly TaxRate[]): InvoiceTaxLine[] {
  return rates.map((r) => ({
    label: r.label.trim(),
    rateMilliPercent: r.rateMilliPercent,
    baseMinor,
    amountMinor: taxAmountMinor(baseMinor, r.rateMilliPercent),
  }));
}

export const invoiceTaxTotalMinor = (lines: readonly InvoiceTaxLine[]): number =>
  lines.reduce((sum, l) => sum + l.amountMinor, 0);

/**
 * What a request must satisfy to WRITE tax lines. The refinement recomputes
 * every amount, so a client cannot print "VAT (20%)" beside a figure that is
 * not 20% of its base. Reads use readInvoiceTaxLines instead, which trusts the
 * stored snapshot.
 */
export const invoiceTaxLineSchema = z
  .object({
    label: z.string().trim().min(1, "Name the tax").max(40),
    rateMilliPercent: z.number().int().min(0).max(MAX_TAX_RATE_MILLI_PERCENT),
    baseMinor: amountMinorSchema,
    amountMinor: amountMinorSchema,
  })
  .refine((l) => l.amountMinor === taxAmountMinor(l.baseMinor, l.rateMilliPercent), {
    message: "Tax amount does not match its rate and base",
  });

export const invoiceTaxLinesSchema = z
  .array(invoiceTaxLineSchema)
  .max(MAX_TAX_LINES)
  .superRefine((lines, ctx) => {
    const seen = new Set<string>();
    lines.forEach((l, i) => {
      const key = `${l.label.toLowerCase()}|${l.rateMilliPercent}`;
      if (seen.has(key)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i], message: "The same tax is listed twice" });
      }
      seen.add(key);
    });
  });

/**
 * The tax lines stored on an invoice, or [] — which is every invoice issued
 * before tax lines existed, so they render exactly as they always have.
 *
 * Takes `unknown` on purpose: `brand_invoices` has no tax column yet, and when
 * one lands nothing here or in the document changes. A malformed row is
 * skipped rather than thrown on — the headline total prints from the stored
 * invoice amount, not from these, so a bad row cannot change what is owed.
 */
export function readInvoiceTaxLines(invoice: unknown): InvoiceTaxLine[] {
  const raw = (invoice as { taxLines?: unknown } | null | undefined)?.taxLines;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (l): l is InvoiceTaxLine =>
      !!l &&
      typeof l.label === "string" &&
      Number.isSafeInteger(l.rateMilliPercent) &&
      Number.isSafeInteger(l.baseMinor) &&
      Number.isSafeInteger(l.amountMinor),
  );
}

/**
 * Tax lines are OFF until they can be stored.
 *
 * The composer's tax rows, the zod schema and the document rendering are all
 * built; persistence is not. `brand_invoices` needs a `tax_lines` jsonb column
 * and POST /api/brand-invoices has to validate with invoiceTaxLinesSchema,
 * accept `dealAmountMinor` as subtotal + tax, and check the agreement ceiling
 * against the SUBTOTAL (an agreement's value is the fee; tax is owed to a
 * government, not billed against the agreement). Until all three land, a tax
 * line typed into the composer would be dropped on save — or worse, a
 * zero-amount one would vanish silently — and the client would receive a
 * document nobody can reconstruct. So the rows stay hidden.
 */
export const INVOICE_TAX_LINES_ENABLED: boolean = false;

/* ── Rates as a human types and reads them ─────────────────────────────── */

const RATE_INPUT = /^\s*(\d{1,3})(?:\.(\d{0,3}))?\s*%?\s*$/;

/** "20" → 20000, "8.875" → 8875, "0.5%" → 500. Parsed as digits, never through
 *  a float. Null for anything that is not 0–100 with at most three decimals. */
export function parseTaxRatePercent(raw: string): number | null {
  const m = RATE_INPUT.exec(raw);
  if (!m) return null;
  const value = Number(m[1]) * 1000 + Number((m[2] ?? "").padEnd(3, "0"));
  return value <= MAX_TAX_RATE_MILLI_PERCENT ? value : null;
}

/** Keystrokes → what a rate field may hold: digits and one point, at most
 *  three places. Stops at the keyboard what parseTaxRatePercent would refuse. */
export function cleanTaxRateInput(raw: string): string {
  const [whole, ...fraction] = raw.replace(/[^\d.]/g, "").split(".");
  const intPart = whole.slice(0, 3);
  return fraction.length === 0 ? intPart : `${intPart}.${fraction.join("").slice(0, 3)}`;
}

const RATE_FORMATS = new Map<string, Intl.NumberFormat>();

/** 8875 → "8.875%" in en-US, "19 %" for 19000 in de-DE — the locale decides
 *  the separator and the space, the same rule as money. */
export function formatTaxRate(rateMilliPercent: number, locale: string): string {
  let f = RATE_FORMATS.get(locale);
  if (!f) {
    try {
      f = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 3 });
    } catch {
      // A hand-edited locale must not blank the tax block.
      f = new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 3 });
    }
    RATE_FORMATS.set(locale, f);
  }
  return f.format(rateMilliPercent / MILLI_PERCENT_PER_WHOLE);
}

/** "VAT (20%)", "CGST (9%)" — the ledger row label. */
export const taxLineLabel = (line: Pick<InvoiceTaxLine, "label" | "rateMilliPercent">, locale: string): string =>
  `${line.label} (${formatTaxRate(line.rateMilliPercent, locale)})`;
