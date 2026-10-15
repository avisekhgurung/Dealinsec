/**
 * The dashboard's invoice numbers, from the invoices DealInSec actually issues (`brand_invoices`, served by
 * GET /api/brand-invoices, already limited to the caller's organization by the server).
 *
 * "Paid" means an invoice the person recorded as paid: stored status "Paid", which the server sets together with
 * `paidAt` (services/payments.ts). DealInSec never collects money, so this is a count of invoices marked paid, not
 * of payments received through DealInSec. Issuing an invoice never counts as payment. There are no partial
 * payments: an invoice is Unpaid until it is marked Paid. Overdue and due-soon are derived by paymentState(), the
 * same rule the invoice list and Money Radar use.
 */
import { paymentState } from "./paymentState";

export interface InvoiceStatInput {
  status?: string | null;
  dueDate?: string | Date | null;
  paidAt?: string | Date | null;
}

export interface InvoiceStats {
  total: number;
  paid: number;
  /** Marked paid in the last 7 days (rolling), by when the payment was recorded. */
  paidThisWeek: number;
  unpaid: number;
  overdue: number;
  dueSoon: number;
}

const WEEK_MS = 7 * 86_400_000;

export function invoiceStats(invoices: readonly InvoiceStatInput[], now: Date = new Date()): InvoiceStats {
  const s: InvoiceStats = { total: invoices.length, paid: 0, paidThisWeek: 0, unpaid: 0, overdue: 0, dueSoon: 0 };
  const since = now.getTime() - WEEK_MS;
  for (const inv of invoices) {
    const state = paymentState(inv, now);
    if (state === "paid") {
      s.paid++;
      // An invoice paid before paidAt was recorded still counts as paid, just not as "this week".
      const at = inv.paidAt ? new Date(inv.paidAt).getTime() : NaN;
      if (Number.isFinite(at) && at >= since && at <= now.getTime()) s.paidThisWeek++;
      continue;
    }
    s.unpaid++;
    if (state === "overdue") s.overdue++;
    else if (state === "due_soon") s.dueSoon++;
  }
  return s;
}

/** The line under the "Paid invoices" number: the most useful true thing, in this order. */
export function paidInvoicesSubline(s: InvoiceStats): string {
  if (s.total === 0) return "none yet";
  if (s.overdue > 0) return `${s.overdue} overdue`;
  if (s.paidThisWeek > 0) return `${s.paidThisWeek} this week`;
  if (s.unpaid > 0) return `${s.unpaid} awaiting payment`;
  return "all paid";
}
