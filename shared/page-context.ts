/**
 * What the person was looking at when they asked the agent: derived from the page's route, so the
 * agent can answer "what should I do next on this deal?" without being told which deal. Pure.
 */
export interface PageContext { page: string; route: string; entityType?: "deal" | "contract" | "invoice"; entityId?: number }

export function pageContext(route: string): PageContext {
  const deal = route.match(/^\/deals\/(\d+)/);
  if (deal) return { page: "deal-details", route, entityType: "deal", entityId: Number(deal[1]) };
  const contract = route.match(/^\/contracts\/(\d+)/);
  if (contract) return { page: "agreement-details", route, entityType: "contract", entityId: Number(contract[1]) };
  const invoice = route.match(/^\/brand-invoices\/(\d+)/);
  if (invoice) return { page: "invoice-details", route, entityType: "invoice", entityId: Number(invoice[1]) };
  return { page: route.split("/")[1] || "dashboard", route };
}

/** Suggested first questions for what the person was looking at. */
export function contextPrompts(ctx: PageContext): string[] {
  if (ctx.entityType === "deal") return ["What should I do next on this deal?", "Run the Protection Check on this deal", "What's the payment status?"];
  if (ctx.entityType === "invoice") return ["Is this invoice overdue?", "Prepare a payment reminder"];
  return [];
}
