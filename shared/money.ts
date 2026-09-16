/**
 * The app's ONE money and date formatter — client, server and documents.
 *
 * Before this file there were ten of them — `inr()` in the document
 * primitives, another in brand-invoice-new, another in the Copilot, another in
 * pick-parent-dialog, another in server/emails.ts — each one some variant of
 * `₹${Math.round(n).toLocaleString("en-IN")}`. That is fine while every user is
 * in India and every amount is a whole rupee. It is ten separate bugs the day a
 * user is not.
 *
 * It lives in shared/ rather than client/src/lib because the SERVER formats
 * money too: the transactional emails and the Copilot's tool replies are read
 * by the same person who reads the invoice, and the receipt they forward to
 * their accountant has to match the invoice it is a receipt for. A client-only
 * formatter guarantees a second copy on the server.
 *
 * Everything here takes MINOR units (paise, cents, yen — see the money
 * primitives in shared/schema.ts) and an explicit currency and locale. There is
 * no module-level default and no ambient "current user": a formatter that can
 * read the locale from a global is a formatter that will print ₹ on a dollar
 * invoice the one time the global is stale. The locale is data, and it travels
 * with the thing being formatted.
 *
 * INDIAN OUTPUT IS BIT-IDENTICAL TO WHAT SHIPPED. Asserted against the old
 * expression across the range: ₹0, ₹1, ₹999, ₹65,000, ₹12,34,567,
 * ₹10,00,00,000 — same grouping, same glyph, no space, no trailing decimals.
 */
import {
  DEFAULT_LOCALE_SETTINGS,
  getCurrency,
  resolveLocaleSettings,
  type CurrencyCode,
  type LocaleFields,
  type LocaleSettings,
} from "./schema";

/* ── Money ─────────────────────────────────────────────────────────────── */

export interface MoneyOptions {
  /**
   * `"auto"` (default) prints the fraction only when there is one: ₹65,000 and
   * $1,250.50, never ₹65,000.00. This is not an aesthetic choice — every
   * agreement and invoice ever issued by this product shows whole rupees with
   * no decimal point, and those documents must re-render exactly as their
   * signatories saw them. The rule is uniform across currencies (India is not
   * special-cased), and JPY never shows a fraction because its exponent is 0.
   *
   * `"exact"` always prints the currency's full precision — for a tax or
   * ledger column where the decimal points must line up.
   */
  decimals?: "auto" | "exact";
  /** `"code"` prints "INR 65,000" — for contexts where the glyph alone is
   *  ambiguous and there is no room for a separate currency label. */
  display?: "symbol" | "code";
}

const MONEY_CACHE = new Map<string, Intl.NumberFormat>();
const DATE_CACHE = new Map<string, Intl.DateTimeFormat>();

/** A locale string we know `Intl` accepts.
 *
 *  `locale` is a user-editable column, so a hand-edited "en_IN" or an empty
 *  string can reach us; `Intl` throws RangeError on those. A document that
 *  renders with the wrong grouping is recoverable, one that throws mid-print
 *  is not — so we fall back the way getCurrency() does, for the same reason.
 *  The currency glyph is unaffected by this fallback. */
const VALID_LOCALES = new Map<string, string>();
function safeLocale(locale?: string | null): string {
  const raw = locale?.trim() || DEFAULT_LOCALE_SETTINGS.locale;
  const cached = VALID_LOCALES.get(raw);
  if (cached) return cached;
  let resolved: string = DEFAULT_LOCALE_SETTINGS.locale;
  try {
    resolved = Intl.getCanonicalLocales(raw)[0] ?? DEFAULT_LOCALE_SETTINGS.locale;
  } catch {
    // Keep the default.
  }
  VALID_LOCALES.set(raw, resolved);
  return resolved;
}

/** Minor units as a number we can render.
 *
 *  Display is deliberately forgiving where storage is strict: `toMinor()`
 *  throws on a non-finite input because writing one is a free deal, but
 *  refusing to *render* one would blank an entire invoice over a single null.
 *  Zero is what this has always shown, so zero is what it still shows. */
function displayMinor(value: number | string | null | undefined): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? n : 0;
}

function moneyFormat(locale: string, currency: string, digits: number, display: "symbol" | "code") {
  const key = `${locale}|${currency}|${digits}|${display}`;
  let f = MONEY_CACHE.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      // Intl's default. It disambiguates when locale and currency disagree —
      // an en-US reader sees "A$1,250" for AUD and "CA$1,250" for CAD, which
      // on a cross-border invoice is the difference between two real amounts.
      // "narrowSymbol" would flatten both to "$". INR in en-IN is "₹" either
      // way, so this costs India nothing.
      currencyDisplay: display,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    MONEY_CACHE.set(key, f);
  }
  return f;
}

function fractionDigits(minor: number, exponent: number, decimals: "auto" | "exact"): number {
  if (decimals === "exact") return exponent;
  return minor % 10 ** exponent === 0 ? 0 : exponent;
}

/**
 * Minor units → the string a human reads. The one money formatter.
 *
 * `formatMoney(125050, "USD", "en-US")` → "$1,250.50"
 * `formatMoney(6500000, "INR", "en-IN")` → "₹65,000"
 * `formatMoney(1250, "JPY", "ja-JP")` → "￥1,250" — NOT ￥12.50.
 */
export function formatMoney(
  minorUnits: number | string | null | undefined,
  currency: string,
  locale: string,
  opts: MoneyOptions = {},
): string {
  const meta = getCurrency(currency);
  const minor = displayMinor(minorUnits);
  const digits = fractionDigits(minor, meta.exponent, opts.decimals ?? "auto");
  return moneyFormat(safeLocale(locale), meta.code, digits, opts.display ?? "symbol")
    .format(minor / 10 ** meta.exponent);
}

/**
 * The number alone, with no currency glyph — for a column whose header
 * already names the currency, and for the "(Indian Rupees 65,000 only)" style
 * of amount-in-figures inside a sentence.
 *
 * It is formatMoney()'s own output with the currency taken out, NOT a separate
 * plain-number formatter. CLDR gives some locales different separators for
 * money and for plain numbers: en-DE formats €1,250 but the bare number as
 * "1.250", so an agreement read "€1,250 (Euros 1.250 only)" — the same figure
 * written two ways in one clause, the second of which a reader can take for
 * 1.25. Built from the same parts, the two can never disagree. In en-IN both
 * shapes were already identical, so "65,000" is unchanged.
 */
export function formatAmount(
  minorUnits: number | string | null | undefined,
  currency: string,
  locale: string,
  opts: Pick<MoneyOptions, "decimals"> = {},
): string {
  const meta = getCurrency(currency);
  const minor = displayMinor(minorUnits);
  const digits = fractionDigits(minor, meta.exponent, opts.decimals ?? "auto");
  return moneyFormat(safeLocale(locale), meta.code, digits, "symbol")
    .formatToParts(minor / 10 ** meta.exponent)
    // Drop the glyph and the bare spacing that separated it from the number
    // ("1.250 €", "CHF 1'250"); keep everything else, including a minus sign.
    .filter((p) => p.type !== "currency" && !(p.type === "literal" && /^\s+$/.test(p.value)))
    .map((p) => p.value)
    .join("");
}

/** The glyph, for input adornments and other tight spaces ONLY. Never build a
 *  formatted amount out of this — the locale decides which side the symbol
 *  goes on and whether there is a space (de-DE puts the euro last).
 *
 *  Read out of the SAME Intl formatter formatMoney() uses, never from
 *  `CURRENCIES[code].symbol`. That table and Intl disagree — AED is "د.إ" in
 *  the table but "AED 1,250" from Intl; AUD is "A$" in the table but "$" for an
 *  en-AU reader — and a "Rate (A$)" label above a "$1,250" amount is two
 *  currencies on one screen. Taking the glyph from the call that formats the
 *  number means a label and an amount cannot disagree. INR in en-IN is "₹"
 *  either way, so nothing Indian moves. */
export function currencySymbol(currency: string, locale: string): string {
  const meta = getCurrency(currency);
  return (
    moneyFormat(safeLocale(locale), meta.code, 0, "symbol")
      .formatToParts(0)
      .find((p) => p.type === "currency")?.value ?? meta.code
  );
}

/**
 * A currency's plural name as a proper noun, for the English prose inside a
 * document: "Prices are in Indian Rupees", "(US Dollars 1,250.50 only)".
 *
 * A FIXED TABLE, deliberately not Intl. These words sit inside signed
 * agreements and issued invoices, and a legal document must read the same to
 * everyone who opens it. Intl's currency names come from the VIEWER's browser
 * (its ICU build and CLDR version), so the same agreement could say "Indian
 * rupees" on one laptop and "Indian Rupees" on another — and under en-DE, EUR
 * came back as the bare glyph, printing "€1,250 (€ 1,250 only)". A table
 * keyed by ISO code is the same bytes on every machine, forever.
 *
 * The document text around it is English, so every name is English.
 * `satisfies Record<CurrencyCode, string>` makes adding a row to CURRENCIES
 * without naming it here a compile error rather than a blank in a contract.
 */
const CURRENCY_PROSE_NAMES = {
  INR: "Indian Rupees",
  USD: "US Dollars",
  GBP: "Pounds Sterling",
  EUR: "Euros",
  AUD: "Australian Dollars",
  CAD: "Canadian Dollars",
  NZD: "New Zealand Dollars",
  SGD: "Singapore Dollars",
  AED: "UAE Dirhams",
  CHF: "Swiss Francs",
  // "Rand" is its own plural in English usage, as "Yen" is.
  ZAR: "South African Rand",
  JPY: "Japanese Yen",
  PKR: "Pakistani Rupees",
  BDT: "Bangladeshi Taka",
  NPR: "Nepalese Rupees",
  LKR: "Sri Lankan Rupees",
  PHP: "Philippine Pesos",
  IDR: "Indonesian Rupiah",
  VND: "Vietnamese Dong",
  THB: "Thai Baht",
  MYR: "Malaysian Ringgit",
  HKD: "Hong Kong Dollars",
  CNY: "Chinese Yuan",
  KRW: "South Korean Won",
  TWD: "New Taiwan Dollars",
  SAR: "Saudi Riyals",
  QAR: "Qatari Riyals",
  KWD: "Kuwaiti Dinars",
  BHD: "Bahraini Dinars",
  OMR: "Omani Rials",
  ILS: "Israeli New Shekels",
  TRY: "Turkish Lira",
  EGP: "Egyptian Pounds",
  NGN: "Nigerian Naira",
  KES: "Kenyan Shillings",
  GHS: "Ghanaian Cedis",
  MAD: "Moroccan Dirhams",
  BRL: "Brazilian Reais",
  MXN: "Mexican Pesos",
  COP: "Colombian Pesos",
  CLP: "Chilean Pesos",
  ARS: "Argentine Pesos",
  PEN: "Peruvian Soles",
  PLN: "Polish Złoty",
  SEK: "Swedish Kronor",
  NOK: "Norwegian Kroner",
  DKK: "Danish Kroner",
  CZK: "Czech Koruny",
  HUF: "Hungarian Forints",
  RON: "Romanian Lei",
} as const satisfies Record<CurrencyCode, string>;

/** "Indian Rupees", "US Dollars". An unknown code resolves the way
 *  getCurrency() does (to INR), so the name always agrees with the glyph
 *  formatMoney() printed beside it.
 *
 *  `_locale` is accepted and IGNORED on purpose: callers written against the
 *  earlier Intl-derived version pass one, and the whole point of this function
 *  is that the viewer's locale no longer changes the words. */
export function currencyProseName(currency: string, _locale?: string): string {
  return CURRENCY_PROSE_NAMES[getCurrency(currency).code as CurrencyCode];
}

/**
 * Split an amount into an advance and a final part — THE rule, shared by the
 * quotation's payment schedule, the split-invoice preview and the server route
 * that creates the two invoices, so what a user is shown is what gets issued.
 *
 * Rule, exactly:
 *   factor = 10 ** exponent of `currency` (100 for INR/USD, 1 for JPY)
 *   if totalMinor is a whole number of major units (totalMinor % factor === 0):
 *     advanceMinor = Math.round((totalMinor / factor) * advancePct / 100) * factor
 *   else:
 *     advanceMinor = Math.round(totalMinor * advancePct / 100)
 *   finalMinor = totalMinor - advanceMinor
 *
 * WHY the whole-unit branch: before minor units, both the quotation and the
 * server split whole rupees with `Math.round(total * pct / 100)`, so ₹12,345
 * at 30% printed ₹3,704 / ₹8,641 and ₹65,001 at 50% issued ₹32,501 + ₹32,500.
 * Those documents exist, and rounding the same deal to the paisa now would
 * reprint them as ₹3,703.50 / ₹8,641.50. The branch reproduces the old
 * arithmetic operation for operation (major × pct, then ÷ 100, then round —
 * `Math.round` rounds .5 up), so every whole-unit amount splits byte-for-byte
 * as it always has. Only an amount that already carries a fraction splits to
 * the minor unit. JPY's factor is 1, so both branches agree there.
 *
 * The final part is the exact remainder, so the two always sum to the total.
 * Throws rather than guessing on input no caller should produce — a split of
 * a non-integer or of 150% is a bug upstream, not an amount to round.
 */
export function splitMinor(
  totalMinor: number,
  advancePct: number,
  currency: string,
): { advanceMinor: number; finalMinor: number } {
  if (!Number.isSafeInteger(totalMinor) || totalMinor < 0) {
    throw new RangeError(`splitMinor: ${totalMinor} is not a non-negative integer amount of minor units`);
  }
  if (!Number.isFinite(advancePct) || advancePct < 0 || advancePct > 100) {
    throw new RangeError(`splitMinor: ${advancePct} is not a percentage between 0 and 100`);
  }
  const factor = 10 ** getCurrency(currency).exponent;
  const advanceMinor =
    totalMinor % factor === 0
      ? Math.round(((totalMinor / factor) * advancePct) / 100) * factor
      : Math.round((totalMinor * advancePct) / 100);
  return { advanceMinor, finalMinor: totalMinor - advanceMinor };
}

/**
 * Minor units → the plain major-unit string an `<input>` holds: "65000",
 * "1250.50". No grouping separators, because a grouped string is not a valid
 * number input value and round-trips back through `toMinor()` as NaN.
 */
export function moneyInputValue(
  minorUnits: number | string | null | undefined,
  currency: string,
): string {
  const { exponent } = getCurrency(currency);
  const minor = displayMinor(minorUnits);
  const major = minor / 10 ** exponent;
  return minor % 10 ** exponent === 0 ? String(major) : major.toFixed(exponent);
}

/* ── Dates ─────────────────────────────────────────────────────────────── */

/** A `date` column: no time, no zone, just a calendar day. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export interface DateOptions {
  /**
   * IANA zone used for TIMESTAMPS only (a signature time, a paid_at). Defaults
   * to India, which is what every existing row resolves to, so Indian output
   * does not move. In-app screens should pass the viewer's own `timezone` from
   * useLocale(); documents pass the ORG's.
   *
   * Date-only values ignore this by design — see below.
   */
  timezone?: string;
  day?: "2-digit" | "numeric";
  month?: "short" | "long" | "numeric" | "2-digit";
  /** `false` drops the year — "31 Mar", for in-app lists where the year is
   *  implied by context. A document always prints it. */
  year?: "numeric" | false;
}

/**
 * An ISO date or timestamp → the string a document prints. "—" for missing or
 * unparseable input, exactly as before.
 *
 * THE OFF-BY-ONE THIS FIXES: `new Date("2026-09-12")` is midnight *UTC*, and
 * `toLocaleDateString()` then renders it in the *browser's* zone. In Asia/
 * Kolkata (UTC+5:30) that is still 12 September, which is why this has never
 * been a bug. In Los Angeles it is 11 September — the invoice date on a
 * client-facing document, wrong by a day, on every date-only field. So a
 * date-only string is formatted in UTC: the calendar day stored is the
 * calendar day printed, everywhere, forever. Real timestamps keep a zone,
 * because for them the instant is the fact.
 */
export function formatDate(
  value: string | Date | null | undefined,
  locale: string,
  opts: DateOptions = {},
): string {
  if (value === null || value === undefined || value === "") return "—";
  const dateOnly = typeof value === "string" && DATE_ONLY.test(value.trim());
  const dt = value instanceof Date ? value : new Date(value);
  if (isNaN(dt.getTime())) return "—";

  const loc = safeLocale(locale);
  const day = opts.day ?? "2-digit";
  const month = opts.month ?? "short";
  const year = opts.year === false ? undefined : opts.year ?? "numeric";
  const zone = dateOnly ? "UTC" : opts.timezone?.trim() || DEFAULT_LOCALE_SETTINGS.timezone;
  const key = `${loc}|${day}|${month}|${year}|${zone}`;
  let f = DATE_CACHE.get(key);
  if (!f) {
    const fields: Intl.DateTimeFormatOptions = { day, month, year, timeZone: zone };
    try {
      f = new Intl.DateTimeFormat(loc, fields);
    } catch {
      // An unknown zone is user-edited data, same class of problem as a bad
      // locale: render in UTC rather than lose the document.
      f = new Intl.DateTimeFormat(loc, { ...fields, timeZone: "UTC" });
    }
    DATE_CACHE.set(key, f);
  }
  return f.format(dt);
}

/* ── Bound formatters ──────────────────────────────────────────────────── */

/**
 * The formatters for one locale, bound once. Pass this down; do not pass the
 * raw settings and re-derive at each call site — that is how the copies came
 * back last time.
 */
export interface Formatters {
  settings: LocaleSettings;
  currency: CurrencyCode;
  /** Glyph, for input adornments only — from the same Intl call as `money()`,
   *  so a "Rate (…)" label always matches the amounts under it. */
  symbol: string;
  /** "Indian Rupees", "US Dollars" — for prose, never next to a figure that
   *  `money()` already labels. Deterministic; see currencyProseName. */
  currencyName: string;
  money(minorUnits: number | string | null | undefined, opts?: MoneyOptions): string;
  amount(minorUnits: number | string | null | undefined, opts?: Pick<MoneyOptions, "decimals">): string;
  date(value: string | Date | null | undefined, opts?: Omit<DateOptions, "timezone">): string;
}

export function makeFormatters(settings: LocaleSettings): Formatters {
  return {
    settings,
    currency: settings.currency,
    symbol: currencySymbol(settings.currency, settings.locale),
    currencyName: currencyProseName(settings.currency),
    money: (minorUnits, opts) => formatMoney(minorUnits, settings.currency, settings.locale, opts),
    amount: (minorUnits, opts) => formatAmount(minorUnits, settings.currency, settings.locale, opts),
    date: (value, opts) => formatDate(value, settings.locale, { ...opts, timezone: settings.timezone }),
  };
}

/**
 * The locale a DOCUMENT prints in.
 *
 * The organization wins over the member (see resolveLocaleSettings) because a
 * quotation, agreement or invoice belongs to the org, not to whoever opened
 * it — a teammate in Berlin must not print euros on a Mumbai agency's invoice.
 *
 * `issued` is the currency SNAPSHOTTED onto the contract or invoice when it
 * was issued, and it outranks everything: a document already in a client's
 * hands must re-render in the currency it was signed in, no matter what the
 * org switched to afterwards. Pass the contract or brand_invoices row (their
 * `currency` column); pass nothing only for a document with no stamped row
 * yet, such as a quotation, which prints in the org's current currency.
 */
export function documentLocaleSettings(
  org?: LocaleFields | null,
  user?: LocaleFields | null,
  issued?: { currency?: string | null } | null,
): LocaleSettings {
  const base = resolveLocaleSettings(org, user);
  if (!issued?.currency) return base;
  return { ...base, currency: getCurrency(issued.currency).code as CurrencyCode };
}
