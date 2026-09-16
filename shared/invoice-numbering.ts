/**
 * Invoice numbering — the SHAPE of an issued number, for every country.
 *
 * An issued number is printed on a document the client holds, quoted back in
 * their payment reference and filed by their accountant. It can never be
 * renumbered, so the shape has to be right once. Everything that decides the
 * shape lives here; server/storage.ts only owns the atomic increment.
 *
 * Three series, because "the financial year" is not one thing:
 *
 *  • indian_fy      INV-2627-0001   restarts every 1 April. Every invoice this
 *                                   product has ever issued is in this series.
 *  • calendar_year  INV-2026-0001   restarts every 1 January.
 *  • continuous     INV-000123      never restarts.
 *
 * PRODUCT DECISION: India numbers by its financial year; everywhere else
 * numbers by CALENDAR year (a UK freelancer's first invoice is INV-2026-0001).
 * The year segment is the calendar year the number was minted in, read in the
 * org's own zone — it names when the invoice was raised, not a tax period, so
 * it asserts nothing about a tax year that starts elsewhere (the UK's 6 April,
 * Australia's 1 July). Restarting per year is a series in the sense EU
 * Directive 2006/112/EC Art. 226(2) ("based on one or more series") and UK VAT
 * Notice 700 §16 describe, because the full number stays unique. `continuous`
 * remains a valid mode for an organization that has already issued in it, or
 * that chooses it explicitly once that becomes a column.
 *
 * WHAT IS NEVER ALLOWED TO HAPPEN: an organization's established series
 * changing shape as a side effect of someone editing the country in Settings.
 * See resolveInvoiceSeries().
 */
import { financialYearCode, getLocaleSettings, type LocaleFields } from "./schema";
import { COUNTRY_CODES } from "./region";

export const INVOICE_SERIES_MODES = ["indian_fy", "calendar_year", "continuous"] as const;
export type InvoiceSeriesMode = (typeof INVOICE_SERIES_MODES)[number];

/** Where a new organization's series starts, by country. A data row per
 *  country — India is here because an Indian CA expects the number to restart
 *  each April, not because the code knows about India. Every other country the
 *  region picker offers (shared/region.ts) is a calendar-year row, the UK
 *  first among them; SERIES_FALLBACK below covers a code outside that list
 *  (hand-edited data) with the same answer, so no org outside India can land
 *  on a shape the product did not choose for it. */
const SERIES_BY_COUNTRY: Readonly<Record<string, InvoiceSeriesMode>> = {
  ...Object.fromEntries(COUNTRY_CODES.map((code) => [code, "calendar_year" as const])),
  GB: "calendar_year",
  IN: "indian_fy",
};

const SERIES_FALLBACK: InvoiceSeriesMode = "calendar_year";

export const DEFAULT_INVOICE_PREFIX = "INV";

/** Where a new organization's series starts, from its country alone. */
export function defaultInvoiceSeriesMode(country?: string | null): InvoiceSeriesMode {
  const code = getLocaleSettings({ country }).country;
  return SERIES_BY_COUNTRY[code] ?? SERIES_FALLBACK;
}

function isSeriesMode(value: unknown): value is InvoiceSeriesMode {
  return typeof value === "string" && (INVOICE_SERIES_MODES as readonly string[]).includes(value);
}

/* ── Counter keys ──────────────────────────────────────────────────────────
 * invoice_counters is keyed (organization_id, fy varchar(9)). The Indian key
 * stays the BARE code ("2627") because that is what every existing counter
 * row holds — namespacing it would restart every Indian org at 0001 and print
 * a second INV-2627-0001 into books that already have one. The new series are
 * prefixed so no key of one series can ever equal a key of another.
 */
const INDIAN_FY_KEY = /^\d{4}$/;
const CALENDAR_KEY = /^CY(\d{4})$/;
const CONTINUOUS_KEY = "ALL";

/** Which series an existing counter row belongs to, or null for a key this
 *  code did not write. */
export function seriesModeOfCounterKey(key: string): InvoiceSeriesMode | null {
  if (INDIAN_FY_KEY.test(key)) return "indian_fy";
  if (CALENDAR_KEY.test(key)) return "calendar_year";
  if (key === CONTINUOUS_KEY) return "continuous";
  return null;
}

/* ── Resolving an organization's series ────────────────────────────────── */

/** The org fields numbering reads. `invoiceSeriesMode` / `invoiceNumberPrefix`
 *  are not columns yet; they are typed here so that the day they are added to
 *  `organizations`, an explicit choice is honoured with no change to this file. */
export type InvoiceSeriesOrg = LocaleFields & {
  invoiceSeriesMode?: string | null;
  invoiceNumberPrefix?: string | null;
};

export interface InvoiceSeries {
  mode: InvoiceSeriesMode;
  prefix: string;
  /** IANA zone the period is read in — the ORG's, never the server's. */
  timezone: string;
}

/**
 * The series an organization's NEXT invoice is numbered in.
 *
 * Precedence, most binding first:
 *  1. An explicit mode stored on the organization.
 *  2. The series the organization has ALREADY ISSUED IN, read from its counter
 *     rows. This is the pin: every organization that predates this file has
 *     indian_fy counters, so INV-2627-0042 is followed by INV-2627-0043 even
 *     if the owner later sets their country to GB. That is not a guess about
 *     the data — the counter row is the record of which series was used.
 *  3. The country default, for an organization that has never issued one.
 *
 * When the counters show more than one series (only possible after an explicit
 * mode was switched and later removed), the country default wins if it is
 * among them, otherwise the first in INVOICE_SERIES_MODES — deterministic, and
 * always a series whose sequence already exists rather than a fresh one.
 */
export function resolveInvoiceSeries(
  org: InvoiceSeriesOrg | null | undefined,
  counterKeys: readonly string[] = [],
): InvoiceSeries {
  const settings = getLocaleSettings(org);
  const prefix = sanitizePrefix(org?.invoiceNumberPrefix);

  if (isSeriesMode(org?.invoiceSeriesMode)) {
    return { mode: org!.invoiceSeriesMode as InvoiceSeriesMode, prefix, timezone: settings.timezone };
  }

  const byCountry = defaultInvoiceSeriesMode(settings.country);
  const used = new Set(counterKeys.map(seriesModeOfCounterKey).filter(isSeriesMode));
  const mode =
    used.size === 0 || used.has(byCountry)
      ? byCountry
      : INVOICE_SERIES_MODES.find((m) => used.has(m))!;

  return { mode, prefix, timezone: settings.timezone };
}

/** Letters and digits only, at most 10. The hyphens are ours: they are what
 *  keep "INV-2627-0001" and "INV-000001" structurally distinct, so a prefix
 *  that could smuggle one in ("INV-2627") could forge a collision. */
function sanitizePrefix(raw?: string | null): string {
  return (raw ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 10) || DEFAULT_INVOICE_PREFIX;
}

/* ── The period and the date, read on ONE clock: the org's zone ────────── */

function calendarDayInZone(now: Date, timezone: string): { year: number; monthIndex: number; day: number } {
  const read = (timeZone: string) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" })
      .formatToParts(now);
    const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    return { year: part("year"), monthIndex: part("month") - 1, day: part("day") };
  };
  try {
    return read(timezone);
  } catch {
    // A hand-edited zone must not block an invoice. UTC is what the server
    // clock gave every invoice before the zone was passed explicitly.
    return read("UTC");
  }
}

/**
 * Today's calendar date in `timezone`, as the YYYY-MM-DD a `date` column holds.
 *
 * THE DEFAULT INVOICE DATE, on the client and the server alike. It reads the
 * same zone, through the same function, as invoiceSeriesPeriod() — so the
 * printed date and the period in the number can never disagree. They did when
 * the number moved to the org's zone but the date stayed on UTC
 * (`new Date().toISOString()`): between 00:00 and 05:30 IST on 1 April a new
 * Indian invoice was dated 31 March yet numbered INV-2627-…, a mismatch an
 * accountant flags.
 */
export function isoDateInZone(timezone: string, now: Date = new Date()): string {
  const { year, monthIndex, day } = calendarDayInZone(now, timezone);
  return `${String(year).padStart(4, "0")}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** A YYYY-MM-DD date moved by whole calendar days — for "due in 30 days".
 *  Pure calendar arithmetic in UTC, so no zone or daylight-saving shift can
 *  turn 30 days into 29. An unparseable date is returned unchanged. */
export function addDaysToIsoDate(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (isNaN(d.getTime())) return isoDate;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface InvoiceSeriesPeriod {
  /** The invoice_counters.fy value this invoice increments. */
  counterKey: string;
  /** The period segment printed in the number, or null for a continuous series. */
  label: string | null;
}

/**
 * Which counter `now` falls in, for this series.
 *
 * Read in the ORG's timezone, not the server's. The server runs in UTC, so a
 * freelancer in Mumbai invoicing at 00:30 IST on 1 April was still in the
 * previous financial year (it is 19:00 on 31 March in UTC), and one in
 * California invoicing at 18:00 on 31 December would land in next year.
 *
 * The one visible change for Indian organizations, and it is a pair: before
 * this file, BOTH the FY code and the default invoice date came from UTC, so
 * an invoice raised between 00:00 and 05:30 IST on 1 April was dated 31 March
 * and numbered INV-2526-… — consistent, but a day behind Indian time. Now both
 * come from the org's zone (Asia/Kolkata for every Indian org): dated 1 April
 * and numbered INV-2627-…. Moving only the number would have split them, so
 * the default date moved with it (isoDateInZone, used by the invoice composer
 * and both server create routes). A date the user types is theirs and is not
 * re-derived. Only numbers minted after this ships are affected: an issued
 * number is a stored string, and nothing ever re-derives it from this function
 * (see wouldRenumberIssuedInvoice).
 *
 * Call this ONLY when minting a new number. It answers "which period is it
 * now?", which is never the question for an invoice that already has one.
 */
export function invoiceSeriesPeriod(series: InvoiceSeries, now: Date = new Date()): InvoiceSeriesPeriod {
  if (series.mode === "continuous") return { counterKey: CONTINUOUS_KEY, label: null };

  const { year, monthIndex } = calendarDayInZone(now, series.timezone);
  if (series.mode === "calendar_year") {
    return { counterKey: `CY${year}`, label: String(year) };
  }
  // The org-local year and month rebuilt as a mid-month LOCAL date, so the
  // one existing definition of the Indian financial year (which reads local
  // time) sees exactly the org's calendar month whatever zone the server is in.
  const fy = financialYearCode(new Date(year, monthIndex, 15));
  return { counterKey: fy, label: fy };
}

/**
 * The printed number. Indian FY numbers keep the exact shape every existing
 * invoice has (four-digit pad), so the series reads unbroken across this change.
 * padStart never truncates: the 10,000th invoice is INV-2627-10000, still unique.
 *
 * Printed numbers of different series cannot coincide for any year this code
 * will run in: continuous has one fewer segment, and a calendar year equals an
 * FY code ("YY" + "YY+1") only in 2021 and next in 2122. The per-org unique
 * constraint on brand_invoices is the backstop either way — a collision is a
 * refused insert, never a duplicate number.
 */
export function formatInvoiceNumber(series: InvoiceSeries, period: InvoiceSeriesPeriod, sequence: number): string {
  if (period.label === null) {
    return `${series.prefix}-${String(sequence).padStart(6, "0")}`;
  }
  return `${series.prefix}-${period.label}-${String(sequence).padStart(4, "0")}`;
}

/* ── An issued number is final ─────────────────────────────────────────────
 * A number is minted exactly once, by storage.generateOrgInvoiceNumber() when
 * the invoice row is inserted, and is a stored string from then on. It is
 * never recomputed: not when the invoice date is edited, not when the org's
 * country, time zone or series changes, and not when the period rules above
 * are corrected (as the IST financial-year fix was). A client has it on paper,
 * in a payment reference and in their accountant's books.
 *
 * The invoice update route keeps it out of its allowlist; these make that
 * guarantee explicit instead of an accident of what the allowlist happens to
 * list, so a later edit that adds a field cannot quietly start renumbering.
 */

/** The row field an issued number lives in. */
export const ISSUED_INVOICE_NUMBER_FIELD = "invoiceNumber" as const;

/** True when `updates` would give an issued invoice a different number. The
 *  same number sent back (a client echoing the row) is not a change. */
export function wouldRenumberIssuedInvoice(
  issuedNumber: string,
  updates: Readonly<Record<string, unknown>> | null | undefined,
): boolean {
  const requested = updates?.[ISSUED_INVOICE_NUMBER_FIELD];
  return requested !== undefined && requested !== issuedNumber;
}

/** A copy of an invoice update with the number removed, whatever the caller
 *  built — the last step before an update reaches the database. */
export function withoutInvoiceNumber<T extends object>(updates: T): Omit<T, typeof ISSUED_INVOICE_NUMBER_FIELD> {
  const { [ISSUED_INVOICE_NUMBER_FIELD]: _issued, ...rest } = updates as T & { invoiceNumber?: unknown };
  return rest;
}
