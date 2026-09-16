/**
 * DealinSec Copilot — machine-readable workflow intelligence.
 *
 * getDealJourney() computes a deal's REAL stage checklist from live data
 * (never hardcoded assumptions in the prompt): which stages are done, what
 * the next recommended action is, and where to do it. The static STAGE
 * definitions mirror the actual route rules (see server/routes.ts) — if the
 * workflow changes there, change it here in the same commit.
 */
import { storage } from "../storage";
import { resolveLocaleSettings, type LocaleSettings, type User } from "@shared/schema";
import { contextAmountForModel, type ModelAmount } from "./voice";

/** The locale the Copilot works in: the ORG's, falling back to the member's —
 *  the same resolution the documents use. The prompt, every tool result and
 *  the create_deal conversion all read this one function, so the currency the
 *  model is told about and the currency of the numbers it is shown can never
 *  disagree. */
export async function copilotSettings(user: User): Promise<LocaleSettings> {
  const org = user.organizationId ? await storage.getOrganization(user.organizationId) : undefined;
  return resolveLocaleSettings(org, user);
}

export const WORKFLOW_STAGES = [
  { stage: "deal", label: "Deal", permission: "deals.create", pro: false },
  { stage: "quotation", label: "Quotation", permission: "quotations.create", pro: false },
  { stage: "agreement", label: "Agreement", permission: "agreements.create", pro: true },
  { stage: "invoice", label: "Invoice", permission: "invoices.create", pro: true },
  { stage: "payment", label: "Payment", permission: "payments.manage", pro: true },
] as const;

const inOrg = (
  resource: { organizationId?: string | null; userId?: string | null } | null | undefined,
  user: User,
): boolean => {
  if (!resource) return false;
  if (resource.organizationId) return resource.organizationId === user.organizationId;
  return resource.userId === user.id;
};

/** MODEL CONTEXT: this object is JSON.stringify'd whole into the prompt (the
 *  chat route's CONTEXT block and the get_workflow_status tool). So its money
 *  is major units — with the ISO code and printed label beside it outside the
 *  native voice (see contextAmountForModel) — and it must never gain a
 *  minor-unit field: a bare 6500000 beside "use ₹ Indian formatting" is quoted
 *  back to the user as ₹65,00,000. */
export interface DealJourney extends Pick<ModelAmount, "amount">, Partial<Omit<ModelAmount, "amount">> {
  dealId: number;
  dealTitle: string;
  brandName: string;
  status: string;
  checklist: { stage: string; label: string; done: boolean }[];
  nextAction: { stage: string; description: string; route: string } | null;
}

/** Live journey for one deal, org-checked. Returns null when the deal isn't
 *  visible to this user's organization (indistinguishable from missing).
 *  Pass the caller's settings when it already has them, so one chat turn reads
 *  the org once and every amount in it shares that snapshot. */
export async function getDealJourney(dealId: number, user: User, settings?: LocaleSettings): Promise<DealJourney | null> {
  const deal = await storage.getDeal(dealId);
  if (!deal || !inOrg(deal, user)) return null;

  const locale = settings ?? await copilotSettings(user);

  const quote = await storage.getQuoteByDealId(dealId);
  const contracts = await storage.getContractsByOrg(user.organizationId!, user.id);
  const contract = contracts.find((c) => c.dealId === dealId) ?? null;
  const invoices = await storage.getBrandInvoicesByOrg(user.organizationId!, user.id);
  const dealInvoices = invoices.filter((i) => i.dealId === dealId);
  const paid = dealInvoices.some((i) => i.status === "Paid");
  const signed = !!contract && (contract.status === "Signed" || !!(contract as any).signedByBrand);

  const checklist = [
    { stage: "deal", label: "Deal", done: true },
    { stage: "quotation", label: "Quotation", done: !!quote },
    { stage: "agreement", label: "Agreement", done: !!contract },
    { stage: "invoice", label: "Invoice", done: dealInvoices.length > 0 },
    { stage: "payment", label: "Payment", done: paid },
  ];

  let nextAction: DealJourney["nextAction"] = null;
  if (!quote) {
    nextAction = { stage: "quotation", description: "Generate the quotation for this deal", route: `/deals/${dealId}` };
  } else if (!contract) {
    nextAction = { stage: "agreement", description: "Create the agreement (Pro feature)", route: `/deals/${dealId}/contract` };
  } else if (!signed) {
    nextAction = { stage: "agreement", description: "Upload the signed proof to mark the agreement Signed", route: `/contracts/${contract.id}` };
  } else if (dealInvoices.length === 0) {
    nextAction = { stage: "invoice", description: "Generate the invoice from the signed agreement", route: `/contracts/${contract.id}` };
  } else if (!paid) {
    const unpaid = dealInvoices.find((i) => i.status !== "Paid");
    nextAction = { stage: "payment", description: "Record the payment when the client pays", route: unpaid ? `/brand-invoices/${unpaid.id}` : "/invoices" };
  }

  return {
    dealId,
    dealTitle: deal.dealTitle,
    brandName: deal.brandName,
    // Spread where `amount: 65000` always sat. An Indian account gets exactly
    // that key and nothing else, so its context is unchanged; others get the
    // currency and label beside it.
    ...contextAmountForModel(deal.dealAmountMinor, locale),
    status: deal.status,
    checklist,
    nextAction,
  };
}
