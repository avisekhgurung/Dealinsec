/**
 * Read tools. The first group wraps the Copilot's existing reads (runTool); the
 * second reads one record in detail. All of them respect the member's
 * module-read access (readAccess.ts), and a linked record is shown only when
 * the member may read that module.
 */
import { z } from "zod";
import { canReadModule } from "@shared/permissions";
import { PAYMENT_STATE_LABEL, paymentState, type PaymentState } from "@shared/paymentState";
import { readDenial } from "../../copilot/readAccess";
import { draftChaserMessage } from "../../copilot/chaser";
import { runTool } from "../../copilot/tools";
import { storage } from "../../storage";
import { issuedCurrency } from "../../routes";
import { allOf, needsLinkedRead, needsRead } from "../policy";
import type { AgentTool, ToolContext, ToolOutcome } from "../types";
import { dateLabel, dealFor, fail, inOrg, money, settingsFor } from "./shared";

const dealId = z.object({ dealId: z.number().describe("Deal id") });

/** A Copilot read tool, exposed as an agent tool with the shared read-access rule. */
function copilotRead<I extends z.ZodTypeAny>(name: string, description: string, input: I): AgentTool<z.infer<I>> {
  return {
    name, description, input, risk: "READ_ONLY", activity: "searching",
    authorize: (user) => readDenial(name, user),
    run: async (ctx, args): Promise<ToolOutcome> => ({
      ok: true,
      summary: await runTool(name, args, ctx.user as any, await settingsFor(ctx)),
    }),
  };
}

const COPILOT_READS: AgentTool<any>[] = [
  copilotRead("get_workflow_status", "Live journey for one deal: which stages (deal→quotation→agreement→invoice→payment) are complete and the next recommended action with its route.", dealId),
  copilotRead("search_deals", "Search the organization's deals by free text (client/title), optional status and optional minimum amount (whole currency units, e.g. 50000 — never cents or paise). Returns id, title, client, amount, status and route.",
    z.object({ query: z.string().optional(), status: z.enum(["Pending", "Active", "Completed"]).optional(), minAmount: z.number().optional() })),
  copilotRead("search_quotations", "List/search the organization's quotations by client or deal title.", z.object({ query: z.string().optional() })),
  copilotRead("search_agreements", "List/search the organization's agreements by client or name, optional status. Results include the dealId.",
    z.object({ query: z.string().optional(), status: z.string().optional() })),
  copilotRead("search_invoices", "List/search invoices. Filters: query (client), status (Paid|Unpaid), overdueOnly (due date passed and unpaid).",
    z.object({ query: z.string().optional(), status: z.enum(["Paid", "Unpaid"]).optional(), overdueOnly: z.boolean().optional() })),
  copilotRead("get_pending_work", "The user's pending work across the org: pending deals, unpaid/overdue invoices, agreements awaiting signed proof.", z.object({})),
  copilotRead("get_account_status", "The caller's plan (free / trial / Pro), role, organization name and seat usage.", z.object({})),
  copilotRead("get_money_radar", "The org's collectible money now: overdue invoices, due this week, and signed agreements not yet invoiced.", z.object({})),
  copilotRead("get_deal_health", "One deal's explainable health score with the signals behind it and its recommended next action.", dealId),
  copilotRead("get_recent_activity", "Recent organization activity (who did what). Requires the activity.view permission.", z.object({})),
];

// ── one record in detail ───────────────────────────────────────────────────

const getDeal: AgentTool<{ dealId: number }> = {
  name: "get_deal",
  description: "Everything about ONE deal: client, project, amount, status, dates, deliverables, terms, and where it stands in the workflow (quotation, agreement, invoices, payment).",
  risk: "READ_ONLY", activity: "searching", input: dealId,
  authorize: needsLinkedRead(),
  async run(ctx, { dealId }): Promise<ToolOutcome> {
    const deal = await dealFor(ctx, dealId);
    if (!deal) return fail("not_found", "That deal isn't in your organization.");
    const s = await settingsFor(ctx);
    const u = ctx.user as any;
    const [quote, contract, invoices] = await Promise.all([
      canReadModule(u, "quotations") ? storage.getQuoteByDealId(dealId) : undefined,
      canReadModule(u, "agreements") ? storage.getContractByDealId(dealId) : undefined,
      canReadModule(u, "invoices") ? storage.getBrandInvoicesByDealIdForOrg(dealId, u.organizationId, u.id) : [],
    ]);
    const deliverables = ((deal.deliverables as any[]) ?? []).map((d) => `${d.quantity > 1 ? `${d.quantity} × ` : ""}${d.contentType}${d.platform && d.platform !== "Service" ? ` (${d.platform})` : ""}`);
    const lines = [
      `Deal #${deal.id} "${deal.dealTitle}" · client ${deal.brandName} · ${deal.dealType} · ${money(deal.dealAmountMinor, s)} · ${deal.status}`,
      `Dates: ${deal.startDate} to ${deal.endDate}`,
      `Deliverables: ${deliverables.join(", ") || "none listed"}`,
      `Terms: ${deal.customTerms?.trim() ? deal.customTerms.trim().slice(0, 600) : "none written"}`,
      deal.brandTerms ? `Brand terms: ${JSON.stringify(deal.brandTerms)}` : "",
      quote ? `Quotation: v${quote.version}, ${quote.status}${quote.shareToken && !quote.shareRevokedAt ? ", link shared" : ""}${quote.acceptedAt ? ", accepted by the client" : ""}` : canReadModule(u, "quotations") ? "Quotation: none yet" : "",
      contract ? `Agreement #${contract.id}: ${contract.status}${contract.signedByBrand ? ", signed by the client" : ", not yet signed by the client"}` : canReadModule(u, "agreements") ? "Agreement: none yet" : "",
      canReadModule(u, "invoices") ? `Invoices: ${invoices.length ? invoices.map((i) => `${i.invoiceNumber} ${money(i.dealAmountMinor, s, issuedCurrency(i))} ${PAYMENT_STATE_LABEL[paymentState(i)]}`).join("; ") : "none yet"}` : "",
      `route:/deals/${deal.id}`,
    ].filter(Boolean);
    return {
      ok: true, summary: lines.join("\n"), route: `/deals/${deal.id}`,
      cards: [{ kind: "deal", data: { id: deal.id, route: `/deals/${deal.id}`, client: deal.brandName, project: deal.dealTitle, type: deal.dealType, amount: money(deal.dealAmountMinor, s), status: deal.status, timeline: `${deal.startDate} to ${deal.endDate}`, deliverables } }],
    };
  },
};

const getQuotation: AgentTool<{ dealId: number }> = {
  name: "get_quotation",
  description: "The quotation for a deal: its version and status, and whether a share link is active and whether the client accepted it.",
  risk: "READ_ONLY", activity: "searching", input: dealId,
  authorize: allOf(needsRead("quotations"), needsLinkedRead()),
  async run(ctx, { dealId }): Promise<ToolOutcome> {
    const deal = await dealFor(ctx, dealId);
    if (!deal) return fail("not_found", "That deal isn't in your organization.");
    const quote = await storage.getQuoteByDealId(dealId);
    if (!quote) return { ok: true, summary: `No quotation exists for "${deal.dealTitle}" yet.`, route: `/deals/${dealId}/quote` };
    const linkActive = !!quote.shareToken && !quote.shareRevokedAt;
    const data = { dealId, version: quote.version, status: quote.status, linkActive, sharedAt: dateLabel(quote.sharedAt), acceptedAt: dateLabel(quote.acceptedAt), route: `/deals/${dealId}/quote` };
    return {
      ok: true, route: data.route, cards: [{ kind: "quotation", data }],
      summary: `Quotation v${quote.version} (${quote.status}) for "${deal.dealTitle}". Share link: ${linkActive ? `active since ${data.sharedAt}` : "not shared"}. ${quote.acceptedAt ? `The client accepted it on ${data.acceptedAt}.` : "Not accepted yet."}`,
    };
  },
};

const getAgreement: AgentTool<{ dealId: number }> = {
  name: "get_agreement",
  description: "The agreement for a deal: its status, value, whether you and the client have signed, and whether a signing link is active.",
  risk: "READ_ONLY", activity: "searching", input: dealId,
  authorize: allOf(needsRead("agreements"), needsLinkedRead()),
  async run(ctx, { dealId }): Promise<ToolOutcome> {
    const deal = await dealFor(ctx, dealId);
    if (!deal) return fail("not_found", "That deal isn't in your organization.");
    const c = await storage.getContractByDealId(dealId);
    if (!c) return { ok: true, summary: `No agreement exists for "${deal.dealTitle}" yet.` };
    const s = await settingsFor(ctx);
    const linkActive = !!c.clientShareToken && !c.clientShareRevokedAt;
    const data = { id: c.id, dealId, status: c.status, value: money(c.contractValueMinor, s, issuedCurrency(c)), signedByYou: !!c.signedByInfluencer, signedByClient: !!c.signedByBrand, linkActive, route: `/contracts/${c.id}` };
    return {
      ok: true, route: data.route, cards: [{ kind: "agreement", data }],
      summary: `Agreement #${c.id} for "${deal.dealTitle}" · ${data.value} · ${c.status}. Signed by you: ${data.signedByYou ? "yes" : "no"}. Signed by the client: ${data.signedByClient ? "yes" : "no"}. Signing link: ${linkActive ? "active" : "none"}.`,
    };
  },
};

const invoiceLine = (i: any, s: any) =>
  `${i.invoiceNumber} · ${i.brandName} · ${money(i.dealAmountMinor, s, issuedCurrency(i))} · ${i.invoiceType} · ${PAYMENT_STATE_LABEL[paymentState(i)]}${i.dueDate ? ` · due ${dateLabel(i.dueDate)}` : ""}${i.paidAt ? ` · paid ${dateLabel(i.paidAt)}` : ""} · id:${i.id}`;

const getInvoice: AgentTool<{ invoiceId?: number; dealId?: number }> = {
  name: "get_invoice",
  description: "One invoice (by invoiceId) or all the invoices on a deal (by dealId): number, amount, type, payment state (Pending / Due soon / Overdue / Paid), due and paid dates.",
  risk: "READ_ONLY", activity: "searching",
  input: z.object({ invoiceId: z.number().optional(), dealId: z.number().optional() }),
  authorize: needsRead("invoices"),
  async run(ctx, input): Promise<ToolOutcome> {
    const u = ctx.user as any;
    const s = await settingsFor(ctx);
    let rows: any[] = [];
    if (input.invoiceId != null) {
      const inv = await storage.getBrandInvoice(input.invoiceId);
      if (!inv || !inOrg(inv, u)) return fail("not_found", "That invoice isn't in your organization.");
      rows = [inv];
    } else if (input.dealId != null) {
      if (!(await dealFor(ctx, input.dealId))) return fail("not_found", "That deal isn't in your organization.");
      rows = await storage.getBrandInvoicesByDealIdForOrg(input.dealId, u.organizationId, u.id);
    } else {
      return fail("invalid_arguments", "I need an invoice id or a deal id.");
    }
    if (!rows.length) return { ok: true, summary: "No invoices found." };
    return {
      ok: true, route: rows.length === 1 ? `/brand-invoices/${rows[0].id}` : undefined,
      cards: [{ kind: "invoice", data: { invoices: rows.slice(0, 8).map((i) => ({ id: i.id, number: i.invoiceNumber, client: i.brandName, amount: money(i.dealAmountMinor, s, issuedCurrency(i)), state: paymentState(i), dueDate: dateLabel(i.dueDate), paidAt: dateLabel(i.paidAt), route: `/brand-invoices/${i.id}` })) } }],
      summary: rows.slice(0, 8).map((i) => invoiceLine(i, s)).join("\n"),
    };
  },
};

const getPaymentStatus: AgentTool<{ dealId?: number }> = {
  name: "get_payment_status",
  description: "Where the money stands: how many invoices are Pending, Due soon, Overdue or Paid, with totals, for one deal (dealId) or the whole organization. Lists what is unpaid, overdue first.",
  risk: "READ_ONLY", activity: "searching",
  input: z.object({ dealId: z.number().optional().describe("Omit for the whole organization") }),
  authorize: needsRead("invoices"),
  async run(ctx, { dealId }): Promise<ToolOutcome> {
    const u = ctx.user as any;
    const s = await settingsFor(ctx);
    let rows;
    if (dealId != null) {
      if (!(await dealFor(ctx, dealId))) return fail("not_found", "That deal isn't in your organization.");
      rows = await storage.getBrandInvoicesByDealIdForOrg(dealId, u.organizationId, u.id);
    } else {
      rows = await storage.getBrandInvoicesByOrg(u.organizationId, u.id);
    }
    if (!rows.length) return { ok: true, summary: "There are no invoices yet, so no payments are outstanding." };
    const tally: Record<PaymentState, { n: number; minor: number }> = { overdue: { n: 0, minor: 0 }, due_soon: { n: 0, minor: 0 }, pending: { n: 0, minor: 0 }, paid: { n: 0, minor: 0 } };
    for (const i of rows) { const st = paymentState(i); tally[st].n++; tally[st].minor += i.dealAmountMinor || 0; }
    const order: PaymentState[] = ["overdue", "due_soon", "pending", "paid"];
    const rank = (i: any) => order.indexOf(paymentState(i));
    const unpaid = rows.filter((i) => i.status !== "Paid").sort((a, b) => rank(a) - rank(b));
    const summary = [
      order.filter((k) => tally[k].n).map((k) => `${PAYMENT_STATE_LABEL[k]}: ${tally[k].n} (${money(tally[k].minor, s)})`).join(" · "),
      ...unpaid.slice(0, 8).map((i) => invoiceLine(i, s)),
    ].join("\n");
    return {
      ok: true, summary,
      cards: [{ kind: "payment", data: { scope: dealId != null ? "deal" : "organization", tally: order.filter((k) => tally[k].n).map((k) => ({ state: k, label: PAYMENT_STATE_LABEL[k], count: tally[k].n, amount: money(tally[k].minor, s) })), unpaid: unpaid.slice(0, 8).map((i) => ({ id: i.id, number: i.invoiceNumber, client: i.brandName, amount: money(i.dealAmountMinor, s, issuedCurrency(i)), state: paymentState(i), dueDate: dateLabel(i.dueDate), route: `/brand-invoices/${i.id}` })) } }],
    };
  },
};

const draftPaymentFollowup: AgentTool<{ invoiceId: number; tone?: string }> = {
  name: "draft_payment_followup",
  description: "Draft a follow-up message for an unpaid invoice. It only WRITES the draft for the user to copy; nothing is sent to anyone.",
  risk: "READ_ONLY", activity: "searching",
  input: z.object({ invoiceId: z.number(), tone: z.string().optional().describe("Professional, Friendly, Firm … (optional)") }),
  authorize: needsRead("invoices"),
  async run(ctx: ToolContext, { invoiceId, tone }): Promise<ToolOutcome> {
    const inv = await storage.getBrandInvoice(invoiceId);
    if (!inv || !inOrg(inv, ctx.user as any)) return fail("not_found", "That invoice isn't in your organization.");
    if (inv.status === "Paid") return fail("already_paid", `${inv.invoiceNumber} is already paid, so there is nothing to chase.`);
    const d = await draftChaserMessage(ctx.user as any, inv, tone);
    return {
      ok: true, route: `/brand-invoices/${inv.id}`,
      cards: [{ kind: "payment", data: { followUp: true, invoiceNumber: d.invoiceNumber, tone: d.tone, tones: d.tones, draft: d.message, invoiceId: inv.id } }],
      summary: `A ${d.tone} follow-up for ${d.invoiceNumber} is drafted (shown to the user to copy; NOT sent):\n${d.message}`,
    };
  },
};

export const READ_TOOLS: AgentTool<any>[] = [...COPILOT_READS, getDeal, getQuotation, getAgreement, getInvoice, getPaymentStatus, draftPaymentFollowup];
