/**
 * Deal edits: what must follow any change to a pending deal.
 *
 * Shared by PATCH /api/deals/:id and the agent's update_deal /
 * add_protection_term, so an edit made either way invalidates the draft
 * quotation the same way.
 */
import { storage } from "../storage";

/** A draft quotation no longer matches an edited deal: mark it revised so the
 *  user regenerates it. */
export async function reviseDraftQuote(dealId: number): Promise<void> {
  const existingQuote = await storage.getQuoteByDealId(dealId);
  if (existingQuote && existingQuote.status === "draft") {
    await storage.updateQuote(existingQuote.id, { status: "revised" });
  }
}
