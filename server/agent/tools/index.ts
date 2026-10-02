/**
 * The agent's tool registry. Imports the database-backed Copilot tools, so
 * tests of the loop use fake tools instead and never import this file.
 *
 * Nothing here contains business logic. A read tool wraps an existing Copilot
 * read (runTool); a mutation tool wraps an existing build/execute pair that
 * mirrors a REST route, so the agent creates a deal exactly the way the form
 * does: same permission, same validation, same credit spend, same activity log.
 *
 * Every tool declares its risk class and its authorization, and the loop's
 * policy decides run-versus-approve from those — the model decides nothing
 * about that.
 */
import { z } from "zod";
import { hasActiveDealBoost, hasProAccess } from "@shared/schema";
import { getBillingUser } from "../../entitlements";
import { storage } from "../../storage";
import { readDenial } from "../../copilot/readAccess";
import { copilotSettings } from "../../copilot/workflow";
import { buildDealDraft } from "../../copilot/proposals";
import { buildDealCandidate, executeCreateDeal, executeCreateQuotation, inOrg, runTool } from "../../copilot/tools";
import { allOf, needsLinkedRead, needsPermission } from "../policy";
import type { AgentTool, ToolContext, ToolOutcome } from "../types";

const dealId = z.object({ dealId: z.number().describe("Deal id") });

/** The turn's locale, read once per tool context. */
const settingsCache = new WeakMap<object, ReturnType<typeof copilotSettings>>();
const settingsFor = (ctx: ToolContext) => {
  let p = settingsCache.get(ctx);
  if (!p) { p = copilotSettings(ctx.user as any); settingsCache.set(ctx, p); }
  return p;
};

/** A Copilot read tool, exposed as an agent tool with the shared read-access rule. */
function readTool<I extends z.ZodTypeAny>(name: string, description: string, input: I): AgentTool<z.infer<I>> {
  return {
    name, description, input, risk: "READ_ONLY", activity: "searching",
    authorize: (user) => readDenial(name, user),
    run: async (ctx, args): Promise<ToolOutcome> => ({
      ok: true,
      summary: await runTool(name, args, ctx.user as any, await settingsFor(ctx)),
    }),
  };
}

const READ_TOOLS: AgentTool<any>[] = [
  readTool("get_workflow_status", "Live journey for one deal: which stages (deal→quotation→agreement→invoice→payment) are complete and the next recommended action with its route.", dealId),
  readTool("search_deals", "Search the organization's deals by free text (client/title), optional status and optional minimum amount (whole currency units, e.g. 50000 — never cents or paise). Returns id, title, client, amount, status and route.",
    z.object({ query: z.string().optional(), status: z.enum(["Pending", "Active", "Completed"]).optional(), minAmount: z.number().optional() })),
  readTool("search_quotations", "List/search the organization's quotations by client or deal title.", z.object({ query: z.string().optional() })),
  readTool("search_agreements", "List/search the organization's agreements by client or name, optional status. Results include the dealId.",
    z.object({ query: z.string().optional(), status: z.string().optional() })),
  readTool("search_invoices", "List/search invoices. Filters: query (client), status (Paid|Unpaid), overdueOnly (due date passed and unpaid). This is also how to see payment status.",
    z.object({ query: z.string().optional(), status: z.enum(["Paid", "Unpaid"]).optional(), overdueOnly: z.boolean().optional() })),
  readTool("get_pending_work", "The user's pending work across the org: pending deals, unpaid/overdue invoices, agreements awaiting signed proof.", z.object({})),
  readTool("get_account_status", "The caller's plan (free / trial / Pro), role, organization name and seat usage.", z.object({})),
  readTool("get_money_radar", "The org's collectible money now: overdue invoices, due this week, and signed agreements not yet invoiced.", z.object({})),
  readTool("get_deal_health", "One deal's explainable health score with the signals behind it and its recommended next action.", dealId),
  readTool("run_protection_check", "Run the Protection Check on one deal (or every active deal if dealId is omitted): risky wording and missing protections.",
    z.object({ dealId: z.number().optional().describe("Deal id; omit to check every active deal") })),
  readTool("get_recent_activity", "Recent organization activity (who did what). Requires the activity.view permission.", z.object({})),
];

// ── create_deal ────────────────────────────────────────────────────────────

const createDealInput = z.object({
  brandName: z.string().describe("The client's or brand's name, as stated"),
  dealTitle: z.string().optional(),
  dealType: z.string().optional(),
  dealAmount: z.coerce.number().describe("Total amount as a plain number in whole currency units, only if stated"),
  startDate: z.string().optional().describe("YYYY-MM-DD, only if stated"),
  endDate: z.string().optional().describe("YYYY-MM-DD, only if stated"),
  deliverables: z.array(z.object({
    platform: z.string().optional(), contentType: z.string().optional(),
    quantity: z.number().optional(), frequency: z.string().optional(), notes: z.string().optional(),
  })).optional(),
  customTerms: z.string().optional().describe("Only terms the message states, one per line"),
  brandTerms: z.record(z.string()).optional().describe("Brand deals only: campaign, usageRights, usageDuration, exclusivity, approval — only what is stated"),
});

const createDeal: AgentTool<z.infer<typeof createDealInput>> = {
  name: "create_deal",
  description: "Prepare a new deal from details the user stated or pasted. Never invent a value: omit what isn't stated. The user sees the draft with its Protection Check before anything is created.",
  risk: "SAFE_MUTATION",
  input: createDealInput,
  authorize: needsPermission("deals.create", "creating deals"),
  async prepare(ctx, input) {
    const built = await buildDealCandidate(input, ctx.user as any);
    if (!built.ok) return { ok: false, code: "invalid_deal", message: built.message };
    const draft = buildDealDraft(built.data as any, built.amountMajor, built.settings, ctx.userText);
    // A free-plan deal spends one of the month's credits. The user hasn't
    // agreed to that just by having the agent at level 1, so it always asks.
    const billing = await getBillingUser(ctx.user as any);
    const spendsCredit = !hasProAccess(billing) && !hasActiveDealBoost(billing);
    return {
      ok: true,
      args: input as Record<string, unknown>,
      forceApproval: spendsCredit,
      preview: {
        title: `Create deal: ${draft.client} — ${draft.project}`,
        lines: [
          { label: "Client", value: draft.client },
          { label: "Project", value: draft.project },
          { label: "Amount", value: draft.amount },
          { label: "Timeline", value: draft.timeline },
          ...(draft.warnings.length ? [{ label: "Check", value: draft.warnings.join(" ") }] : []),
        ],
        effects: spendsCredit ? ["Uses 1 of your Deal Credits for this month."] : [],
        draft,
      },
    };
  },
  async execute(ctx, args): Promise<ToolOutcome> {
    const r = await executeCreateDeal(args, ctx.user as any);
    return r.ok ? { ok: true, summary: r.message, route: r.route } : { ok: false, code: "rejected", message: r.message };
  },
};

// ── create_quotation ───────────────────────────────────────────────────────

const createQuotation: AgentTool<{ dealId: number }> = {
  name: "create_quotation",
  description: "Prepare the quotation for a deal (a draft the user can review; it is not shared with anyone). Idempotent: an existing current draft is reused.",
  risk: "SAFE_MUTATION",
  input: dealId,
  authorize: allOf(needsPermission("quotations.create", "generating quotations"), needsLinkedRead()),
  async prepare(ctx, input) {
    const deal = await storage.getDeal(input.dealId);
    if (!deal || !inOrg(deal, ctx.user as any)) return { ok: false, code: "not_found", message: "That deal isn't in your organization." };
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
  async execute(ctx, args): Promise<ToolOutcome> {
    const r = await executeCreateQuotation(Number(args.dealId), ctx.user as any);
    return r.ok ? { ok: true, summary: r.message, route: r.route } : { ok: false, code: "rejected", message: r.message };
  },
};

/** Phase 1 registry. Phase 2 adds the remaining deal tools. */
export const AGENT_TOOLS: readonly AgentTool<any>[] = [...READ_TOOLS, createDeal, createQuotation];
