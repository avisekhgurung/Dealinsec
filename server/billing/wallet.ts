/**
 * The credit wallet: one read-only view of a workspace's plan allowances (used, left, when the next one frees up),
 * its purchased credits (balance, lots with their expiry), the credit ledger (every movement) and its purchases, plus
 * the packs on sale. Everything is read from the server's own tables; no client number is ever trusted or accepted here.
 *
 * "Next reset" is told honestly. Plan allowances are a ROLLING window (OUTBOUND_WINDOW_DAYS), not a calendar month:
 * a search counted today frees up that many days from today. So each allowance reports when its EARLIEST counted use
 * passes the window (`nextFreesAt`, null while there is room) instead of a made-up first-of-the-month date.
 */
import { desc, eq } from "drizzle-orm";
import { creditPurchases, payuOrders, type CreditKind } from "@shared/schema";
import { OUTBOUND_WINDOW_DAYS } from "@shared/outbound-plans";
import { db } from "../db";
import { outboundUsage, type OutboundUsage } from "../outbound/usage";
import { creditLedgerOf, creditLotsOf, creditSummary } from "./credits";
import { billingConfig } from "./config-cache";
import { packsForSale } from "./credit-orders";
import type { Who } from "../services/leads";

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

export interface Wallet {
  asOf: string;
  windowDays: number;
  /** Always "rolling": plan allowances free up one use at a time, a window after each use (see the file header). */
  resetRule: "rolling";
  plan: OutboundUsage["plan"] | null;
  credits: Record<CreditKind, { balance: number; cost: number; nextExpiry: { units: number; at: string } | null }>;
  lots: { id: number; kind: CreditKind; units: number; remaining: number; source: string; expiresAt: string | null; createdAt: string; expired: boolean }[];
  ledger: { id: number; kind: CreditKind; delta: number; reason: string; note: string | null; createdAt: string }[];
  purchases: { orderId: string; kind: CreditKind; units: number; priceRupees: number; status: string; createdAt: string | null; completedAt: string | null }[];
  packs: Awaited<ReturnType<typeof packsForSale>>;
  warn: { percent: number; warn: boolean; exhausted: boolean };
}

export async function getWallet(user: Who, now: Date = new Date()): Promise<Wallet> {
  const orgId = user.organizationId!;
  const cfg = billingConfig();
  const usage = await outboundUsage(user).catch(() => null);
  const [summary, lots, ledger, packs, purchases] = await Promise.all([
    creditSummary(orgId, now),
    creditLotsOf(orgId).catch(() => []),
    creditLedgerOf(orgId, 100).catch(() => []),
    packsForSale().catch(() => []),
    db.select({
      orderId: creditPurchases.orderId, kind: creditPurchases.kind, units: creditPurchases.units, priceRupees: creditPurchases.priceRupees,
      status: payuOrders.status, createdAt: payuOrders.createdAt, completedAt: payuOrders.completedAt,
    }).from(creditPurchases).innerJoin(payuOrders, eq(payuOrders.orderId, creditPurchases.orderId))
      .where(eq(creditPurchases.organizationId, orgId)).orderBy(desc(payuOrders.createdAt)).limit(50).catch(() => []),
  ]);
  return {
    asOf: now.toISOString(),
    windowDays: OUTBOUND_WINDOW_DAYS,
    resetRule: "rolling",
    plan: usage && usage.ok ? usage.usage.plan : null,
    credits: {
      search: { ...summary.search, cost: cfg.creditCost.search },
      draft: { ...summary.draft, cost: cfg.creditCost.draft },
    },
    lots: lots.map((l) => ({
      id: l.id, kind: l.kind as CreditKind, units: l.units, remaining: l.remaining, source: l.source, expiresAt: iso(l.expiresAt), createdAt: iso(l.createdAt)!,
      expired: !!l.expiresAt && new Date(l.expiresAt).getTime() <= now.getTime(),
    })),
    ledger: ledger.map((r) => ({ id: r.id, kind: r.kind as CreditKind, delta: r.delta, reason: r.reason, note: r.note, createdAt: iso(r.createdAt)! })),
    purchases: purchases.map((p) => ({ ...p, kind: p.kind as CreditKind, createdAt: iso(p.createdAt), completedAt: iso(p.completedAt) })),
    packs,
    warn: { percent: cfg.warnPercent, warn: cfg.notify.warn, exhausted: cfg.notify.exhausted },
  };
}
