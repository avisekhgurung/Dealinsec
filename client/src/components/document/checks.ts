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
 */
export function deriveSchedule(
  customTerms: string | null | undefined,
  total: number,
): { label: string; amount: number }[] | null {
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
  if (!(pct > 0 && pct < 100) || !(total > 0)) return null;
  const advance = Math.round((total * pct) / 100);
  return [
    { label: `Advance (${pct}%)`, amount: advance },
    { label: `Balance (${100 - pct}%)`, amount: total - advance },
  ];
}

/** Generic renderability checks shared by all three documents. */
export function validateDocData(d: {
  clientName?: string | null;
  sellerName?: string | null;
  amount?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  dueDate?: string | null;
  invoiceDate?: string | null;
}): DocWarning[] {
  const out: DocWarning[] = [];
  if (!d.clientName?.trim()) out.push({ severity: "error", message: "Client name is missing — the document will print without a recipient." });
  if (!d.sellerName?.trim()) out.push({ severity: "warning", message: "Your name is missing from your profile — the document has no sender identity." });
  if (d.amount != null && !(Number(d.amount) > 0)) out.push({ severity: "error", message: "The amount is zero or invalid." });
  const t = (x?: string | null) => (x ? new Date(x).getTime() : NaN);
  if (d.startDate && d.endDate && t(d.endDate) < t(d.startDate)) {
    out.push({ severity: "error", message: "The end date is before the start date." });
  }
  if (d.invoiceDate && d.dueDate && t(d.dueDate) < t(d.invoiceDate)) {
    out.push({ severity: "error", message: "The due date is before the invoice date." });
  }
  return out;
}
