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
import type { User } from "@shared/schema";

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

export interface DealJourney {
  dealId: number;
  dealTitle: string;
  brandName: string;
  amount: number;
  status: string;
  checklist: { stage: string; label: string; done: boolean }[];
  nextAction: { stage: string; description: string; route: string } | null;
}

/** Live journey for one deal, org-checked. Returns null when the deal isn't
 *  visible to this user's organization (indistinguishable from missing). */
export async function getDealJourney(dealId: number, user: User): Promise<DealJourney | null> {
  const deal = await storage.getDeal(dealId);
  if (!deal || !inOrg(deal, user)) return null;

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
    amount: Number(deal.dealAmount),
    status: deal.status,
    checklist,
    nextAction,
  };
}
