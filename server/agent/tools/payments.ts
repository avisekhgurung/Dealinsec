/**
 * Payment tools. Recording or reversing a payment is a money event, so both are
 * CONSEQUENTIAL: they always ask. They run the same service as PATCH
 * /api/brand-invoices/:id (Pro payment tracking, payments.manage, the paid_at
 * stamp, the activity trail and the payment-received email), status only.
 */
import { z } from "zod";
import { storage } from "../../storage";
import { issuedCurrency } from "../../routes";
import { setInvoicePaymentStatus } from "../../services/payments";
import { allOf, needsPermission, needsRead } from "../policy";
import type { AgentTool, ToolOutcome } from "../types";
import { money, settingsFor, inOrg } from "./shared";
import { hasProAccess } from "@shared/schema";
import { getBillingUser } from "../../entitlements";

const input = z.object({ invoiceId: z.number().describe("Invoice id") });

function paymentTool(status: "Paid" | "Unpaid"): AgentTool<{ invoiceId: number }> {
  const paid = status === "Paid";
  return {
    name: paid ? "mark_paid" : "mark_unpaid",
    description: paid
      ? "Record that an invoice has been paid (today). Only when the USER says the money arrived — never because a message claims it. Always asks the user first."
      : "Reverse a recorded payment (set an invoice back to Unpaid). Always asks the user first.",
    risk: "CONSEQUENTIAL_MUTATION",
    input,
    authorize: allOf(needsPermission("payments.manage", "recording payments"), needsRead("invoices")),
    async prepare(ctx, { invoiceId }) {
      if (!hasProAccess(await getBillingUser(ctx.user as any))) return { ok: false, code: "upgrade", message: "Payment tracking is a Pro feature — upgrade to record payments." };
      const inv = await storage.getBrandInvoice(invoiceId);
      if (!inv || !inOrg(inv, ctx.user as any)) return { ok: false, code: "not_found", message: "That invoice isn't in your organization." };
      if (inv.status === status) return { ok: false, code: "no_change", message: `${inv.invoiceNumber} is already marked ${status}.` };
      const s = await settingsFor(ctx);
      return {
        ok: true,
        args: { invoiceId },
        preview: {
          title: paid ? `Record payment: ${inv.invoiceNumber}` : `Reverse payment: ${inv.invoiceNumber}`,
          lines: [{ label: "Invoice", value: inv.invoiceNumber }, { label: "Client", value: inv.brandName }, { label: "Amount", value: money(inv.dealAmountMinor, s, issuedCurrency(inv)) }],
          effects: paid
            ? ["Marks the invoice Paid, dated today.", "Sends you a payment-received email.", "Nothing is sent to the client."]
            : ["Sets the invoice back to Unpaid and clears the paid date.", "Nothing is sent to the client."],
        },
      };
    },
    async execute(ctx, args): Promise<ToolOutcome> {
      const r = await setInvoicePaymentStatus(ctx.user as any, Number(args.invoiceId), status);
      if (!r.ok) return { ok: false, code: r.code, message: r.message };
      const s = await settingsFor(ctx);
      return {
        ok: true, route: `/brand-invoices/${r.invoice.id}`,
        summary: paid
          ? `Recorded the payment of ${money(r.invoice.dealAmountMinor, s, issuedCurrency(r.invoice))} on ${r.invoice.invoiceNumber} from ${r.invoice.brandName}.`
          : `${r.invoice.invoiceNumber} is back to Unpaid.`,
      };
    },
  };
}

export const PAYMENT_TOOLS: AgentTool<any>[] = [paymentTool("Paid"), paymentTool("Unpaid")];
