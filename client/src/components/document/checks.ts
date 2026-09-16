/**
 * Pre-render document checks — cross-document consistency and data validation.
 *
 * The founder found a generated agreement whose Compensation clause said the
 * balance was "due within 30 days" while the deal-specific terms (carried over
 * from the quotation) said "within 7 days". Root cause: the Compensation
 * clause hardcoded a 50/50-in-30-days schedule for EVERY agreement, ignoring
 * the deal's own terms. The template fix (contract-pdf) now defers to the
 * deal's payment terms whenever they exist; the checks here catch what a
 * template cannot: the deal's own terms contradicting THEMSELVES, and data
 * that would render a broken document.
 *
 * Warnings are surfaced on screen (never printed) and never invent or pick a
 * value — resolving a contradiction is the user's call.
 */
import { splitMinor } from "@/lib/format";

export interface DocWarning { severity: "error" | "warning"; message: string }

const DAYS_RE = /within\s+(\d{1,3})\s*(?:calendar\s+|working\s+|business\s+)?days?/gi;
const ADV_RE = /(\d{1,2})\s*%\s*(?:advance|upfront|up-front|before)/gi;

/** Distinct "within N days" / "N% advance" figures inside the deal's terms. */
export function detectPaymentConflicts(customTerms: string | null | undefined): DocWarning[] {
  const out: DocWarning[] = [];
  const text = customTerms ?? "";
  const uniq = (re: RegExp) => {
    const seen: string[] = [];
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      if (!seen.includes(m[1])) seen.push(m[1]);
    }
    return seen;
  };
  const days = uniq(DAYS_RE);
  const advances = uniq(ADV_RE);
  if (days.length > 1) {
    out.push({
      severity: "error",
      message: `The deal's payment terms mention conflicting timelines: "within ${days.join(' days" and "within ')} days". Edit the deal terms so the documents agree before sending.`,
    });
  }
  if (advances.length > 1) {
    out.push({
      severity: "error",
      message: `The deal's payment terms mention conflicting advance percentages: ${advances.map((a) => `${a}%`).join(" and ")}. Edit the deal terms before sending.`,
    });
  }
  return out;
}

/** True when the deal's custom terms already speak about payment — the
 *  agreement's Compensation clause must then defer to them instead of
 *  asserting its own default schedule. */
export function termsMentionPayment(customTerms: string | null | undefined): boolean {
  return /advance|payment|payab|\bdue\b|instalment|installment|milestone|%/i.test(customTerms ?? "");
}

/**
 * Conservative payment-schedule derivation for the quotation: only when the
 * terms state exactly one advance percentage. The amounts are arithmetic on
 * figures the user wrote — never invented.
 *
 * The arithmetic is splitMinor() — the same rule the split-invoice route uses.
 * A whole-rupee deal splits to whole rupees exactly as every quotation already
 * issued printed it (₹12,345 at 30% is ₹3,704 / ₹8,641, never ₹3,703.50), and
 * the balance is the remainder, so the two rows always add back to the total.
 *
 * `currency` is the document's (`loc.currency`) and is REQUIRED. It was once
 * optional with an INR fallback, and the quotation called it without one: a
 * JPY deal then split on INR's factor of 100, so ¥15,000 at 33% printed an
 * advance of ¥5,000 where the invoices the server creates say ¥4,950. A
 * missing currency is now a compile error instead of a wrong client-facing
 * figure.
 */
export function deriveSchedule(
  customTerms: string | null | undefined,
  totalMinor: number,
  currency: string,
): { label: string; amountMinor: number }[] | null {
  const text = customTerms ?? "";
  const seen: number[] = [];
  let m: RegExpExecArray | null;
  ADV_RE.lastIndex = 0;
  while ((m = ADV_RE.exec(text)) !== null) {
    const n = Number(m[1]);
    if (!seen.includes(n)) seen.push(n);
  }
  if (seen.length !== 1) return null;
  const pct = seen[0];
  // A non-integer total would make splitMinor throw mid-render; the stored
  // column is an integer, so this only refuses corrupt data, quietly.
  if (!(pct > 0 && pct < 100) || !(totalMinor > 0) || !Number.isSafeInteger(totalMinor)) return null;
  const { advanceMinor, finalMinor } = splitMinor(totalMinor, pct, currency);
  return [
    { label: `Advance (${pct}%)`, amountMinor: advanceMinor },
    { label: `Balance (${100 - pct}%)`, amountMinor: finalMinor },
  ];
}

/** Generic renderability checks shared by all three documents. */
export function validateDocData(d: {
  clientName?: string | null;
  sellerName?: string | null;
  /** Minor units — the check is unit-agnostic, the name is not, so a caller
   *  cannot hand it a rupee figure without noticing. */
  amountMinor?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  dueDate?: string | null;
  invoiceDate?: string | null;
}): DocWarning[] {
  const out: DocWarning[] = [];
  if (!d.clientName?.trim()) out.push({ severity: "error", message: "Client name is missing — the document will print without a recipient." });
  if (!d.sellerName?.trim()) out.push({ severity: "warning", message: "Your name is missing from your profile — the document has no sender identity." });
  if (d.amountMinor != null && !(Number(d.amountMinor) > 0)) out.push({ severity: "error", message: "The amount is zero or invalid." });
  const t = (x?: string | null) => (x ? new Date(x).getTime() : NaN);
  if (d.startDate && d.endDate && t(d.endDate) < t(d.startDate)) {
    out.push({ severity: "error", message: "The end date is before the start date." });
  }
  if (d.invoiceDate && d.dueDate && t(d.dueDate) < t(d.invoiceDate)) {
    out.push({ severity: "error", message: "The due date is before the invoice date." });
  }
  return out;
}
