/**
 * Quotation, agreement and invoice tools. Each wraps the existing build/execute
 * pair (which mirrors its REST route) or the shared link service, so the agent
 * creates a document exactly the way the app does.
 *
 * Creating a quotation draft is a SAFE mutation. Everything that makes
 * something available to a client, activates a deal or uses up an invoice
 * number is CONSEQUENTIAL: it always asks, at every autonomy level.
 */
import { z } from "zod";
import { storage } from "../../storage";
import { buildAgreementDraft, buildInvoiceDraft } from "../../copilot/proposals";
import {
  buildAgreementCandidate, buildInvoiceCandidate, executeCreateAgreement, executeCreateInvoice, executeCreateQuotation,
} from "../../copilot/tools";
import { createAgreementSignLink, createQuoteShareLink } from "../../services/sharing";
import { allOf, needsLinkedRead, needsPermission } from "../policy";
import type { AgentTool, ToolOutcome } from "../types";
import { absoluteUrl, dealFor, fail, inOrg } from "./shared";

const dealId = z.object({ dealId: z.number().describe("Deal id") });
const fromExecutor = (r: { ok: boolean; message: string; route?: string }): ToolOutcome =>
  r.ok ? { ok: true, summary: r.message, route: r.route } : { ok: false, code: "rejected", message: r.message, route: r.route };

const createQuotation: AgentTool<{ dealId: number }> = {
  name: "create_quotation",
  description: "Prepare the quotation for a deal (a draft the user can review; it is not shared with anyone). Idempotent: an existing current draft is reused.",
  risk: "SAFE_MUTATION",
  input: dealId,
  authorize: allOf(needsPermission("quotations.create", "generating quotations"), needsLinkedRead()),
  async prepare(ctx, input) {
    const deal = await dealFor(ctx, input.dealId);
    if (!deal) return { ok: false, code: "not_found", message: "That deal isn't in your organization." };
    return {
      ok: true,
      args: { dealId: input.dealId },
      preview: {
        title: `Create quotation: ${deal.brandName} — ${deal.dealTitle}`,
        lines: [{ label: "Deal", value: `${deal.brandName} — ${deal.dealTitle}` }],
        effects: ["Creates a draft quotation. Nothing is sent to the client."],
      },
    };
  },
  async execute(ctx, args) { return fromExecutor(await executeCreateQuotation(Number(args.dealId), ctx.user as any)); },
};

const shareQuotation: AgentTool<{ dealId: number }> = {
  name: "share_quotation",
  description: "Create the public link for a deal's quotation, which the client can open without an account. Nothing is emailed: the user sends the link themselves. Requires the quotation to exist.",
  risk: "CONSEQUENTIAL_MUTATION",
  input: dealId,
  authorize: allOf(needsPermission("quotations.create", "sharing quotations"), needsLinkedRead()),
  async prepare(ctx, input) {
    const deal = await dealFor(ctx, input.dealId);
    if (!deal) return { ok: false, code: "not_found", message: "That deal isn't in your organization." };
    const quote = await storage.getQuoteByDealId(deal.id);
    if (!quote) return { ok: false, code: "no_quotation", message: "There's no quotation for this deal yet. Create it first." };
    const active = !!quote.shareToken && !quote.shareRevokedAt;
    return {
      ok: true,
      args: { dealId: deal.id },
      preview: {
        title: `Share the quotation: ${deal.brandName} — ${deal.dealTitle}`,
        lines: [{ label: "Quotation", value: `v${quote.version} (${quote.status})` }],
        effects: [
          "Creates a public link: anyone who has it can read this quotation and accept it.",
          "Nothing is emailed — you send the link yourself.",
          ...(active ? ["Replaces the current link: the old one stops working."] : []),
        ],
      },
    };
  },
  async execute(ctx, args): Promise<ToolOutcome> {
    const r = await createQuoteShareLink(ctx.user as any, Number(args.dealId));
    if (!r.ok) return fail("rejected", r.error);
    const url = absoluteUrl(r.url);
    return {
      ok: true, route: `/deals/${args.dealId}/quote`,
      summary: `The quotation link is ready: ${url}\nNothing was sent — share it with your client yourself.`,
      cards: [{ kind: "quotation", data: { dealId: Number(args.dealId), url, linkActive: true } }],
    };
  },
};

const createAgreement: AgentTool<{ dealId: number }> = {
  name: "create_agreement",
  description: "Create the agreement for a deal, built from the deal's own client, dates and value. This activates the deal. A Pro feature; one agreement per deal. A quotation is NOT required first.",
  risk: "CONSEQUENTIAL_MUTATION",
  input: dealId,
  authorize: allOf(needsPermission("agreements.create", "creating agreements"), needsLinkedRead()),
  async prepare(ctx, input) {
    const built = await buildAgreementCandidate({ dealId: input.dealId }, ctx.user as any);
    if (!built.ok) return { ok: false, code: "rejected", message: built.message, route: (built as any).route };
    const d = buildAgreementDraft(built.data, built.settings);
    return {
      ok: true,
      args: { dealId: input.dealId },
      preview: {
        title: `Create agreement: ${d.client}`,
        lines: [{ label: "Client", value: d.client }, { label: "Project", value: d.project }, { label: "Value", value: d.amount }, { label: "Timeline", value: d.timeline }],
        effects: ["Marks the deal Active.", "Sends you a confirmation email.", "Nothing is sent to the client."],
        draft: d,
      },
    };
  },
  async execute(ctx, args) { return fromExecutor(await executeCreateAgreement({ dealId: Number(args.dealId) }, ctx.user as any)); },
};

const createSigningLink: AgentTool<{ dealId: number }> = {
  name: "create_signing_link",
  description: "Create the public link where the client can review and sign a deal's agreement. Nothing is emailed: the user sends the link. A Pro feature; the agreement must exist and be unsigned.",
  risk: "CONSEQUENTIAL_MUTATION",
  input: dealId,
  authorize: allOf(needsPermission("agreements.create", "sending agreements for signature"), needsLinkedRead()),
  async prepare(ctx, input) {
    const deal = await dealFor(ctx, input.dealId);
    if (!deal) return { ok: false, code: "not_found", message: "That deal isn't in your organization." };
    const c = await storage.getContractByDealId(deal.id);
    if (!c || !inOrg(c, ctx.user as any)) return { ok: false, code: "no_agreement", message: "There's no agreement for this deal yet. Create it first." };
    if (c.signedByBrand) return { ok: false, code: "already_signed", message: "This agreement is already signed." };
    const active = !!c.clientShareToken && !c.clientShareRevokedAt;
    return {
      ok: true,
      args: { contractId: c.id },
      preview: {
        title: `Send for signature: ${deal.brandName} — ${deal.dealTitle}`,
        lines: [{ label: "Agreement", value: `#${c.id} (${c.status})` }],
        effects: [
          "Creates a public link: anyone who has it can read the agreement and sign it.",
          "Nothing is emailed — you send the link yourself.",
          ...(active ? ["Replaces the current link: the old one stops working."] : []),
        ],
      },
    };
  },
  async execute(ctx, args): Promise<ToolOutcome> {
    const r = await createAgreementSignLink(ctx.user as any, Number(args.contractId));
    if (!r.ok) return fail("rejected", r.error);
    const url = absoluteUrl(r.url);
    return {
      ok: true, route: `/contracts/${args.contractId}`,
      summary: `The signing link is ready: ${url}\nNothing was sent — share it with your client yourself.`,
      cards: [{ kind: "agreement", data: { id: Number(args.contractId), url, linkActive: true } }],
    };
  },
};

const createInvoiceInput = z.object({
  dealId: z.number(),
  contractId: z.number().optional(),
  invoiceType: z.enum(["full", "advance", "final"]).optional(),
  amountPercent: z.number().optional().describe("Only when the user stated a percentage (e.g. the 50% advance). Never a money amount."),
  dueDate: z.string().optional().describe("YYYY-MM-DD, only if stated"),
});

const createInvoice: AgentTool<z.infer<typeof createInvoiceInput>> = {
  name: "create_invoice",
  description: "Create an invoice for a deal. The amount is never a figure you supply: it is the whole remaining amount, or amountPercent of it when the user stated a percentage. A Pro feature. The agreement does not need to be signed first.",
  risk: "CONSEQUENTIAL_MUTATION",
  input: createInvoiceInput,
  authorize: allOf(needsPermission("invoices.create", "creating invoices"), needsLinkedRead()),
  async prepare(ctx, input) {
    const built = await buildInvoiceCandidate(input, ctx.user as any);
    if (!built.ok) return { ok: false, code: "rejected", message: built.message };
    const d = buildInvoiceDraft(built.data, built.settings);
    return {
      ok: true,
      args: input as Record<string, unknown>,
      preview: {
        title: `Create invoice: ${d.client}`,
        lines: [{ label: "Client", value: d.client }, { label: "Type", value: d.invoiceType }, { label: "Amount", value: d.amount }, ...(d.dueDate ? [{ label: "Due", value: d.dueDate }] : [])],
        effects: ["Uses the next invoice number in your series.", "Nothing is sent to the client."],
        draft: d,
      },
    };
  },
  async execute(ctx, args) { return fromExecutor(await executeCreateInvoice(args, ctx.user as any)); },
};

export const DOCUMENT_TOOLS: AgentTool<any>[] = [createQuotation, shareQuotation, createAgreement, createSigningLink, createInvoice];
