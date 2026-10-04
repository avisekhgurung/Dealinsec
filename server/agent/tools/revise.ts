/**
 * Revising a quotation and revising an agreement.
 *
 * revise_quotation edits the PENDING deal a quotation is rendered from and
 * regenerates it, in one step. It asks (SAFE_MUTATION), and a price change always
 * asks even at autonomy 1.
 *
 * revise_agreement changes an agreement the CLIENT HAS NOT SIGNED. The issuer's
 * signature is on it, so this is consequential: it always asks, by voice only on
 * an explicit "confirm", and the rules (no client signature, only the signer,
 * signing link revoked) are enforced in the service, not here.
 */
import { z } from "zod";
import { dealEditSchema } from "@shared/revisions";
import { agreementEditSchema, applyAgreementRevision, applyQuotationRevision, planAgreementRevision, planQuotationRevision } from "../../services/revisions";
import { allOf, needsLinkedRead, needsPermission } from "../policy";
import type { AgentTool, ToolOutcome } from "../types";
import { fail } from "./shared";

const reviseQuotationInput = z.object({ dealId: z.number().describe("Deal id") }).merge(dealEditSchema);
const reviseAgreementInput = z.object({ dealId: z.number().describe("Deal id (an agreement belongs to one deal)") }).merge(agreementEditSchema);

const reviseQuotation: AgentTool<z.infer<typeof reviseQuotationInput>> = {
  name: "revise_quotation",
  description: "Change what a quotation says and regenerate it: the project name, total, dates, the whole list of deliverables, or its terms (add, remove or replace lines). A quotation is built from its deal, so this edits the deal and works only while the deal is PENDING. Only changes the user asked for; a price change always asks first.",
  risk: "SAFE_MUTATION",
  input: reviseQuotationInput,
  authorize: allOf(needsPermission("deals.edit", "revising quotations"), needsPermission("quotations.create", "regenerating quotations"), needsLinkedRead()),
  async prepare(ctx, { dealId, ...edit }) {
    const p = await planQuotationRevision(ctx.user as any, dealId, edit);
    if (!p.ok) return { ok: false, code: p.code, message: p.message };
    return {
      ok: true, args: { dealId, ...edit }, forceApproval: p.amountChanged,
      preview: {
        title: `Revise the quotation: ${p.deal.brandName} — ${p.deal.dealTitle}`,
        lines: p.lines,
        effects: [
          `Regenerates the quotation as a new draft (v${(p.quote?.version ?? 0) + 1}).`,
          ...(p.linkActive ? ["The link you already shared still shows the old quotation until you share a new one."] : []),
          "Nothing is sent to the client.",
        ],
      },
    };
  },
  async execute(ctx, args): Promise<ToolOutcome> {
    const { dealId, ...edit } = args as { dealId: number } & Record<string, unknown>;
    const r = await applyQuotationRevision(ctx.user as any, Number(dealId), edit);
    if (!r.ok) return fail(r.code, r.message);
    return { ok: true, route: r.route, summary: `Revised the quotation for ${r.deal.brandName}; it is now draft v${r.quoteVersion}. Nothing was sent to the client.` };
  },
};

const reviseAgreement: AgentTool<z.infer<typeof reviseAgreementInput>> = {
  name: "revise_agreement",
  description: "Change an agreement the CLIENT HAS NOT YET SIGNED: its name, dates, fee, exclusivity, or terms (add, remove or replace lines). Once the client has signed it is locked and cannot be changed. Only the person whose signature is on it may revise it, their signature is re-dated, and any signing link already sent stops working. Always asks, and needs an explicit confirmation.",
  risk: "CONSEQUENTIAL_MUTATION",
  input: reviseAgreementInput,
  authorize: allOf(needsPermission("agreements.create", "revising agreements"), needsPermission("deals.edit", "editing deals"), needsLinkedRead()),
  async prepare(ctx, { dealId, ...edit }) {
    const p = await planAgreementRevision(ctx.user as any, dealId, edit);
    if (!p.ok) return { ok: false, code: p.code, message: p.message };
    return {
      ok: true, args: { dealId, ...edit },
      preview: {
        title: `Revise the agreement: ${p.contract.brandName}`,
        lines: p.lines,
        effects: [
          "Your signature stays on the agreement and is re-dated to now, for the revised terms.",
          ...(p.linkActive ? ["The signing link you already sent stops working; you would create a new one."] : []),
          "Nothing is sent to the client.",
        ],
      },
    };
  },
  async execute(ctx, args): Promise<ToolOutcome> {
    const { dealId, ...edit } = args as { dealId: number } & Record<string, unknown>;
    const r = await applyAgreementRevision(ctx.user as any, Number(dealId), edit);
    if (!r.ok) return fail(r.code, r.message);
    return {
      ok: true, route: r.route,
      summary: `Revised the agreement for ${r.contract.brandName}. Your signature on it is re-dated to now.${r.linkRevoked ? " The signing link you sent earlier no longer works; create a new one when you are ready." : ""} Nothing was sent to the client.`,
    };
  },
};

export const REVISE_TOOLS: AgentTool<any>[] = [reviseQuotation, reviseAgreement];
