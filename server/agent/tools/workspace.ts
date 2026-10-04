/**
 * Completing a deal, an invoice's due date and note, the workspace profile, and
 * the person's own details.
 *
 * complete_deal is consequential (a completed deal cannot be reopened in the
 * app), so it always asks. The others are ordinary changes that ask at level 0;
 * those that print on documents sent to clients (the workspace name, tax ids,
 * the billing address, the person's name) always ask. The rules live in
 * services/workspace.ts and shared/workspace.ts, not here.
 */
import { z } from "zod";
import { PRINTED_FIELDS, invoiceDetailsSchema, myDetailsSchema, workspaceProfileSchema } from "@shared/workspace";
import { applyCompleteDeal, applyInvoiceDetails, applyMyDetails, applyWorkspaceProfile, planCompleteDeal, planInvoiceDetails, planMyDetails, planWorkspaceProfile } from "../../services/workspace";
import { allOf, needsLinkedRead, needsPermission, needsRead } from "../policy";
import type { AgentTool, ToolOutcome } from "../types";
import { fail } from "./shared";

const completeInput = z.object({ dealId: z.number().describe("Deal id") });

const completeDeal: AgentTool<z.infer<typeof completeInput>> = {
  name: "complete_deal",
  description: "Mark an ACTIVE deal as completed: the work is delivered. A completed deal cannot be reopened. Only an active deal (agreement signed by the client) can be completed. Always asks the user first.",
  risk: "CONSEQUENTIAL_MUTATION",
  input: completeInput,
  authorize: allOf(needsPermission("deals.edit", "completing deals"), needsLinkedRead()),
  async prepare(ctx, { dealId }) {
    const p = await planCompleteDeal(ctx.user as any, dealId);
    if (!p.ok) return { ok: false, code: p.code, message: p.message };
    return {
      ok: true, args: { dealId },
      preview: {
        title: `Complete the deal: ${p.deal.brandName} — ${p.deal.dealTitle}`,
        lines: [{ label: "Client", value: p.deal.brandName }, { label: "Deal", value: p.deal.dealTitle }, ...(p.unpaid ? [{ label: "Unpaid invoices", value: String(p.unpaid) }] : [])],
        effects: ["Marks the deal Completed. The app has no way to reopen it.", "Nothing is sent to the client."],
      },
    };
  },
  async execute(ctx, args): Promise<ToolOutcome> {
    const r = await applyCompleteDeal(ctx.user as any, Number(args.dealId));
    if (!r.ok) return fail(r.code, r.message);
    return { ok: true, route: `/deals/${r.deal.id}`, summary: `Marked "${r.deal.dealTitle}" for ${r.deal.brandName} as completed.` };
  },
};

const updateInvoiceDetails: AgentTool<z.infer<typeof invoiceDetailsSchema>> = {
  name: "update_invoice_details",
  description: "Change an UNPAID invoice's due date or its printed note. It cannot change the amount, the number, the client or the status (use mark_paid for payment); a paid invoice is locked. Dates are YYYY-MM-DD.",
  risk: "SAFE_MUTATION",
  input: invoiceDetailsSchema,
  authorize: allOf(needsPermission("payments.manage", "editing invoices"), needsRead("invoices")),
  async prepare(ctx, args) {
    const p = await planInvoiceDetails(ctx.user as any, args);
    if (!p.ok) return { ok: false, code: p.code, message: p.message };
    return {
      ok: true, args,
      preview: { title: `Edit invoice ${p.invoice.invoiceNumber}`, lines: p.lines, effects: ["Changes the invoice in DealInSec.", "Nothing is sent to the client; a link they already have shows the new details."] },
    };
  },
  async execute(ctx, args): Promise<ToolOutcome> {
    const r = await applyInvoiceDetails(ctx.user as any, args);
    if (!r.ok) return fail(r.code, r.message);
    return { ok: true, route: `/brand-invoices/${r.invoice.id}`, summary: `Updated invoice ${r.invoice.invoiceNumber}.` };
  },
};

const updateWorkspaceProfile: AgentTool<z.infer<typeof workspaceProfileSchema>> = {
  name: "update_workspace_profile",
  description: "Change the workspace's name, industry, or work type (client_work or brand_collaboration). Not the country or currency, which are locked once there are deals. A new name always asks.",
  risk: "SAFE_MUTATION",
  input: workspaceProfileSchema,
  authorize: needsPermission("org.settings", "changing workspace settings"),
  async prepare(ctx, args) {
    const p = await planWorkspaceProfile(ctx.user as any, args);
    if (!p.ok) return { ok: false, code: p.code, message: p.message };
    return {
      ok: true, args, forceApproval: p.edit.name !== undefined,
      preview: { title: "Update the workspace", lines: p.lines, effects: ["The name prints on the quotations, agreements and invoices you make from now on; existing signed documents keep theirs."] },
    };
  },
  async execute(ctx, args): Promise<ToolOutcome> {
    const r = await applyWorkspaceProfile(ctx.user as any, args);
    if (!r.ok) return fail(r.code, r.message);
    return { ok: true, route: "/settings", summary: `Updated the workspace: ${r.changed.join(", ")}.` };
  },
};

const updateMyDetails: AgentTool<z.infer<typeof myDetailsSchema>> = {
  name: "update_my_details",
  description: "Change the user's own name, phone, tax id (PAN), GST/VAT number, or billing address. NEVER bank details, signature, seal, photo, email or password: those are only changed in Settings by the person. Changing anything that prints on documents always asks.",
  risk: "SAFE_MUTATION",
  input: myDetailsSchema,
  authorize: () => null,
  async prepare(ctx, args) {
    const p = await planMyDetails(ctx.user as any, args);
    if (!p.ok) return { ok: false, code: p.code, message: p.message };
    return {
      ok: true, args, forceApproval: p.printed,
      preview: { title: "Update your details", lines: p.lines, effects: p.printed ? [`Prints on the documents you make from now on (${PRINTED_FIELDS.join(", ")}).`] : ["Changes your own record only."] },
    };
  },
  async execute(ctx, args): Promise<ToolOutcome> {
    const r = await applyMyDetails(ctx.user as any, args);
    if (!r.ok) return fail(r.code, r.message);
    return { ok: true, route: "/settings", summary: `Updated your details: ${r.changed.join(", ")}.` };
  },
};

export const WORKSPACE_TOOLS: AgentTool<any>[] = [completeDeal, updateInvoiceDetails, updateWorkspaceProfile, updateMyDetails];
