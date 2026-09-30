/**
 * What a payment looks like right now: Pending, Due soon, Overdue or Paid.
 *
 * Derived, never stored. An invoice's stored status stays "Unpaid" / "Paid";
 * this reads that plus the due date. "Overdue" is the same rule the dashboard's
 * Money Radar and the Copilot use (unpaid and the due date has passed), so the
 * list and the radar cannot disagree about which invoices are late.
 */
export type PaymentState = "pending" | "due_soon" | "overdue" | "paid";

/** An unpaid invoice due within this many days reads as "Due soon". */
export const DUE_SOON_DAYS = 7;

const DAY_MS = 86_400_000;

export function paymentState(
  invoice: { status?: string | null; dueDate?: string | Date | null },
  now: Date = new Date(),
): PaymentState {
  if (invoice.status === "Paid") return "paid";
  if (!invoice.dueDate) return "pending";
  const due = new Date(invoice.dueDate).getTime();
  if (!Number.isFinite(due)) return "pending";
  const ms = due - now.getTime();
  if (ms < 0) return "overdue";
  return ms <= DUE_SOON_DAYS * DAY_MS ? "due_soon" : "pending";
}

export const PAYMENT_STATE_LABEL: Record<PaymentState, string> = {
  pending: "Pending",
  due_soon: "Due soon",
  overdue: "Overdue",
  paid: "Paid",
};
