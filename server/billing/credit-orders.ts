/**
 * Creating a credit-pack order (the checkout's first step). The pack is read from the database at THIS moment and its
 * kind, units, price and expiry are frozen onto the order (credit_purchases), so what the grant delivers is exactly
 * what the buyer was shown, whatever the founder edits or retires afterwards. A pack must be active to be bought; an
 * order already created keeps its terms (like every order: payment checks compare against the order's own amount).
 *
 * The payments pipeline is unchanged (server/billing/razorpay-events.ts): this only creates the pending order and the
 * frozen purchase terms. The credits are granted by payment-deps.ts after Razorpay's own record of the payment agrees.
 */
import { and, desc, eq, gte } from "drizzle-orm";
import { creditPurchases, payuOrders, type CreditKind, type CreditPackRow, type User } from "@shared/schema";
import { db } from "../db";
import { activeCreditPacks, creditPackById } from "./credits";

export const CREDIT_PURPOSE_PREFIX = "credits_";
export const creditPurposeOf = (kind: CreditKind) => `${CREDIT_PURPOSE_PREFIX}${kind}`;
export const kindOfCreditPurpose = (purpose: string): CreditKind | null =>
  purpose === "credits_search" ? "search" : purpose === "credits_draft" ? "draft" : null;
export const isCreditPurpose = (purpose: string) => kindOfCreditPurpose(purpose) !== null;

/** How long a still-pending order for the same pack is reused (a double click must not open two payments). */
const REUSE_MS = 5 * 60_000;

export const describePack = (p: Pick<CreditPackRow, "kind" | "units">) =>
  `${p.units} ${p.kind === "search" ? "Client Radar search" : "AI draft"} credit${p.units > 1 ? "s" : ""}`;

/** Plain-language expiry line, shown before checkout and in the wallet: never a silent expiry. */
export const expiryLine = (months: number | null) =>
  months == null ? "Never expire." : `Valid for ${months} month${months > 1 ? "s" : ""} from purchase; unused credits expire after that.`;

export type CreditOrderResult =
  | { ok: true; reused: boolean; order: { id: string; amount: number; currency: string }; pack: CreditPackRow; priceRupees: number }
  | { ok: false; status: number; code: string; error: string };

export async function createCreditPackOrder(
  user: Pick<User, "id" | "organizationId">,
  packIdRaw: unknown,
  createRazorpayOrder: (a: { amountInRupees: number; receipt: string; notes: Record<string, string> }) => Promise<{ id: string; amount: number | string; currency: string }>,
  now: Date = new Date(),
): Promise<CreditOrderResult> {
  const packId = Number(packIdRaw);
  if (!Number.isInteger(packId) || packId < 1) return { ok: false, status: 400, code: "INVALID_PACK", error: "Choose a credit pack." };
  if (!user.organizationId) return { ok: false, status: 403, code: "NO_ORGANIZATION", error: "Credits belong to a workspace, and this account has none." };
  const pack = await creditPackById(packId);
  if (!pack || !pack.active) return { ok: false, status: 409, code: "PACK_UNAVAILABLE", error: "That credit pack isn't on sale any more. Refresh the page to see the current packs." };

  // A pending order this person already opened for this very pack a moment ago is the same purchase.
  const since = new Date(now.getTime() - REUSE_MS);
  const [recent] = await db.select({ orderId: payuOrders.orderId, amount: payuOrders.amount }).from(payuOrders)
    .innerJoin(creditPurchases, eq(creditPurchases.orderId, payuOrders.orderId))
    .where(and(eq(payuOrders.userId, user.id), eq(payuOrders.status, "pending"), eq(creditPurchases.packId, pack.id),
      eq(creditPurchases.priceRupees, pack.priceRupees), eq(creditPurchases.units, pack.units), gte(payuOrders.createdAt, since)))
    .orderBy(desc(payuOrders.createdAt)).limit(1);
  if (recent) return { ok: true, reused: true, order: { id: recent.orderId, amount: recent.amount * 100, currency: "INR" }, pack, priceRupees: pack.priceRupees };

  const receipt = `DIS_${now.getTime()}_${Math.random().toString(36).slice(2, 9)}`;
  const order = await createRazorpayOrder({ amountInRupees: pack.priceRupees, receipt, notes: { userId: user.id, plan: "credit_pack", pack: String(pack.id), kind: pack.kind } });
  // The order row and its frozen terms are written together: a purchase without its terms could not be delivered.
  await db.transaction(async (tx) => {
    await tx.insert(payuOrders).values({ userId: user.id, orderId: order.id, amount: pack.priceRupees, credits: pack.units, purpose: creditPurposeOf(pack.kind as CreditKind), status: "pending" });
    await tx.insert(creditPurchases).values({
      orderId: order.id, organizationId: user.organizationId!, userId: user.id, packId: pack.id, kind: pack.kind, units: pack.units,
      priceRupees: pack.priceRupees, expiryMonths: pack.expiryMonths, createdAt: now,
    });
  });
  return { ok: true, reused: false, order: { id: order.id, amount: Number(order.amount), currency: order.currency }, pack, priceRupees: pack.priceRupees };
}

/** The packs a buyer is offered, with the expiry line they must see before paying. */
export async function packsForSale() {
  return (await activeCreditPacks()).map((p) => ({
    id: p.id, kind: p.kind as CreditKind, units: p.units, priceRupees: p.priceRupees, expiryMonths: p.expiryMonths,
    label: describePack(p), expiry: expiryLine(p.expiryMonths),
  }));
}
