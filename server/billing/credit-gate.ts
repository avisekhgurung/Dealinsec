/**
 * The quick "could a purchased credit pay for this?" answer the services give BEFORE a model call or an insert, so a
 * workspace whose plan window is full but that holds credits is not refused, and one with none is refused before any
 * model money is spent. Advisory only: the stores decide for real, under their locks, with the write
 * (server/billing/credits.ts consumeCreditTx), so this can never let anything past what they would.
 *
 * It imports the database lazily and fails to "no credits": a test world or a server whose credit tables aren't
 * migrated yet behaves exactly as it did before credits existed.
 */
import type { CreditKind } from "@shared/schema";
import { billingConfig } from "./config-cache";

/** What one action of this kind costs in purchased credits (billing_config.credit_cost). */
export const creditCostOf = (kind: CreditKind): number => billingConfig().creditCost[kind];

/** The spec the stores take to spend credits for an action of this kind. */
export const creditSpec = (kind: CreditKind): { cost: number } => ({ cost: creditCostOf(kind) });

/** Whether the workspace holds enough usable purchased credits for one action of this kind. */
export async function creditsCover(orgId: string, kind: CreditKind, now: Date = new Date()): Promise<boolean> {
  try {
    const { creditBalances } = await import("./credits");
    return (await creditBalances(orgId, now))[kind] >= creditCostOf(kind);
  } catch {
    return false;
  }
}
