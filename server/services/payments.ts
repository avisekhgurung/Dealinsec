/**
 * Recording and reversing an invoice payment.
 *
 * The side effects of a status change — the paid_at stamp, the activity line
 * and the "payment received" email — used to live inline in the PATCH handler.
 * They are here now so the handler and the agent's mark_paid / mark_unpaid tools
 * produce exactly the same trail. The handler keeps all of its own validation.
 */
import { formatMoney } from "@shared/money";
import { hasProAccess, type BrandInvoice, type User } from "@shared/schema";
import { memberCan } from "@shared/permissions";
import { storage } from "../storage";
import { getBillingUser, logOrgActivity } from "../entitlements";
import { paymentReceivedEmail, sendEmail } from "../emails";
import { documentLocaleFor } from "../routes";

/** What paid_at must become for a status change: a date when payment is
 *  recorded, null when it is reversed, undefined when it is left alone. */
export function paidAtFor(before: string | null | undefined, next: string | undefined): Date | null | undefined {
  if (before !== "Paid" && next === "Paid") return new Date();
  if (before === "Paid" && next === "Unpaid") return null;
  return undefined;
}

/** The activity trail and the payment-received email, after the row changed. */
export async function afterInvoiceStatusChange(
  user: User,
  before: BrandInvoice,
  updated: BrandInvoice | undefined,
  nextStatus: string | undefined,
): Promise<void> {
  const recordedPayment = before.status !== "Paid" && nextStatus === "Paid" && updated;
  // Resolved only when a payment is recorded: the activity line and the email
  // are the only places this prints money. The activity detail is stored text,
  // so for INR it must stay byte-for-byte the "₹65,000" the feed has always
  // held — formatMoney guarantees exactly that.
  const paidLocale = recordedPayment ? await documentLocaleFor(user, updated) : null;

  if (recordedPayment && paidLocale) {
    logOrgActivity(user, "recorded payment for", "invoice", before.id,
      `${formatMoney(updated.dealAmountMinor || 0, paidLocale.currency, paidLocale.locale)} from ${before.brandName}`);
  }

  // Reversing a payment is a money event too — it must leave the same trail as
  // recording one, so "who marked this unpaid and when" is answerable.
  if (before.status === "Paid" && nextStatus === "Unpaid" && updated) {
    logOrgActivity(user, "reversed the payment on", "invoice", before.id, `${updated.invoiceNumber} — back to Unpaid`);
  }

  // "Payment received" email — only when transitioning Unpaid -> Paid.
  if (recordedPayment && paidLocale) {
    const owner = await storage.getUser(user.id);
    if (owner?.email) {
      const { subject, html } = paymentReceivedEmail({
        firstName: owner.firstName || undefined,
        brandName: updated.brandName,
        amountMinor: updated.dealAmountMinor,
        invoiceNumber: updated.invoiceNumber,
        locale: paidLocale,
      });
      void sendEmail({ to: owner.email, subject, html });
    }
  }
}

const inOrg = (r: { organizationId?: string | null; userId?: string | null } | null | undefined, user: { id: string; organizationId?: string | null }) =>
  !!r && (r.organizationId ? r.organizationId === user.organizationId : r.userId === user.id);

/** Record or reverse a payment through the same gates as PATCH
 *  /api/brand-invoices/:id (Pro payment tracking, payments.manage, same org),
 *  for the agent. Status only: no other field of the invoice is touched. */
export async function setInvoicePaymentStatus(
  user: User,
  invoiceId: number,
  status: "Paid" | "Unpaid",
): Promise<{ ok: true; invoice: BrandInvoice } | { ok: false; code: string; message: string }> {
  if (!memberCan(user, "payments.manage")) return { ok: false, code: "forbidden", message: "Your role doesn't allow recording payments. Ask your organization owner." };
  if (!hasProAccess(await getBillingUser(user))) return { ok: false, code: "upgrade", message: "Payment tracking is a Pro feature — upgrade to record payments." };
  const invoice = await storage.getBrandInvoice(invoiceId);
  if (!invoice || !inOrg(invoice, user)) return { ok: false, code: "not_found", message: "That invoice isn't in your organization." };
  if (invoice.status === status) {
    return { ok: false, code: "no_change", message: `${invoice.invoiceNumber} is already marked ${status}.` };
  }
  const paidAt = paidAtFor(invoice.status, status);
  const updated = await storage.updateBrandInvoice(invoice.id, { status, ...(paidAt !== undefined ? { paidAt } : {}) } as any);
  if (!updated) return { ok: false, code: "failed", message: "Couldn't update the invoice." };
  await afterInvoiceStatusChange(user, invoice, updated, status);
  return { ok: true, invoice: updated };
}
