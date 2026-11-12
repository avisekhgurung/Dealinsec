/**
 * Purchased credits (script/migrate-credits.ts): the money-path store for credit lots and the ledger.
 *
 * The invariants, and where they are kept:
 *  - No overspend and no negative balance: consuming decrements ONE lot row in a single UPDATE whose subquery picks
 *    an open, unexpired lot FOR UPDATE; the CHECK (remaining BETWEEN 0 AND units) backs it whatever races. Callers
 *    on the hot paths (run start, draft insert) additionally hold their existing per-workspace advisory locks, so
 *    plan-count-then-consume is serialised the same way plan allowances already are.
 *  - No double-consume and no double-undo: every consume, undo and refund writes a ledger line keyed by
 *    (reason, source_ref) under a partial unique index; a replay inserts nothing and changes nothing.
 *  - A purchase grants once: the lot carries the order id under a unique index, and the payment layer
 *    (razorpay-events.ts completeOnce) claims the order exactly once anyway — this is the second lock on the same door.
 *  - Purchased credits expire only as the pack SOLD them (expiry frozen at order time): an expired lot stops being
 *    consumable and counted, but stays visible in the wallet. Nothing deletes paid-for rows.
 *  - Subscription allowance first, purchased second: callers consume a credit only after the plan's rolling-window
 *    count is full, and actions a credit paid for are marked funded_by='credit' so the plan count skips them.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import {
  adminAuditLog, creditLedger, creditLots, creditPacks, creditPurchases,
  type CreditKind, type CreditLedgerRow, type CreditLotRow, type CreditPackRow, type CreditPurchaseRow,
} from "@shared/schema";
import { db } from "../db";
import { expiryFrom } from "./expiry";
export { expiryFrom };

type Tx = Pick<typeof db, "execute" | "insert" | "select" | "update">;

const at = (d: Date) => d.toISOString();

/** The credit tables exist on this database (the migration ran). Cheap, for paths that degrade instead of failing. */
export async function creditTablesReady(): Promise<boolean> {
  try {
    const r = await db.execute(sql`SELECT to_regclass('credit_lots') IS NOT NULL AS present`);
    return Boolean((r.rows[0] as { present?: boolean } | undefined)?.present);
  } catch {
    return false;
  }
}

/**
 * Spend `cost` purchased credits (default 1) for ONE action, inside the caller's transaction. Open, unexpired lots are
 * locked FOR UPDATE in earliest-expiry order, so a concurrent consume waits instead of overspending; if together they
 * cannot cover `cost` nothing is taken and null is returned (the caller then refuses exactly as it would without this
 * module). Each lot touched gets its own ledger line, keyed `<sourceRef>` (first) or `<sourceRef>#k`, so every line
 * stays idempotent under the (reason, source_ref) unique index and an undo can find them all.
 * `sourceRef` ties the consume to the action that spent it (run:<id>, msg:<id>, …). Returns the lots charged.
 */
export async function consumeCreditTx(tx: Tx, o: { orgId: string; kind: CreditKind; sourceRef: string; now: Date; cost?: number }): Promise<number[] | null> {
  const cost = Math.max(1, Math.floor(o.cost ?? 1));
  const r = await tx.execute(sql`
    SELECT id, remaining FROM credit_lots
    WHERE organization_id = ${o.orgId} AND kind = ${o.kind} AND remaining > 0
      AND (expires_at IS NULL OR expires_at > ${at(o.now)}::timestamp)
    ORDER BY expires_at ASC NULLS LAST, id ASC
    FOR UPDATE`);
  const lots = r.rows as { id: number; remaining: number }[];
  if (lots.reduce((n, l) => n + Number(l.remaining), 0) < cost) return null;
  let left = cost, line = 0;
  const charged: number[] = [];
  for (const lot of lots) {
    if (left <= 0) break;
    const take = Math.min(left, Number(lot.remaining));
    await tx.execute(sql`UPDATE credit_lots SET remaining = remaining - ${take} WHERE id = ${lot.id}`);
    await tx.insert(creditLedger).values({
      organizationId: o.orgId, kind: o.kind, delta: -take, reason: "consume", lotId: Number(lot.id),
      sourceRef: line === 0 ? o.sourceRef : `${o.sourceRef}#${line}`, createdAt: o.now,
    });
    left -= take; line++; charged.push(Number(lot.id));
  }
  return charged;
}

/**
 * Give a consumed action's credits back, once: a credit-funded search that never actually searched (stopped before any
 * web search, failed to start, a local search that failed) cost the person nothing, the same rule the plan window
 * applies. Idempotent per ledger line by (consume_undo, sourceRef); safe to call on any settle path, any number of
 * times, including for actions that never consumed anything (then it does nothing). Returns credits given back.
 */
export async function undoCreditConsume(o: { orgId: string; sourceRef: string; now: Date }): Promise<number> {
  return db.transaction(async (tx) => {
    const lines = await tx.select().from(creditLedger)
      .where(and(eq(creditLedger.reason, "consume"), eq(creditLedger.organizationId, o.orgId),
        sql`(${creditLedger.sourceRef} = ${o.sourceRef} OR ${creditLedger.sourceRef} LIKE ${o.sourceRef + "#%"})`));
    let back = 0;
    for (const c of lines) {
      if (c.lotId == null) continue;
      const give = -c.delta;
      const undone = await tx.insert(creditLedger).values({
        organizationId: o.orgId, kind: c.kind as CreditKind, delta: give, reason: "consume_undo",
        lotId: c.lotId, sourceRef: c.sourceRef, createdAt: o.now,
      }).onConflictDoNothing().returning({ id: creditLedger.id });
      if (!undone.length) continue; // this line was already undone
      await tx.execute(sql`UPDATE credit_lots SET remaining = LEAST(units, remaining + ${give}) WHERE id = ${c.lotId}`);
      back += give;
    }
    return back;
  });
}

/** Usable purchased credits right now, per kind (open lots, not expired). Zero when the tables don't exist yet. */
export async function creditBalances(orgId: string, now: Date = new Date()): Promise<Record<CreditKind, number>> {
  const zero: Record<CreditKind, number> = { search: 0, draft: 0 };
  try {
    const r = await db.execute(sql`
      SELECT kind, COALESCE(sum(remaining), 0)::int AS n FROM credit_lots
      WHERE organization_id = ${orgId} AND remaining > 0
        AND (expires_at IS NULL OR expires_at > ${at(now)}::timestamp)
      GROUP BY kind`);
    const out = { ...zero };
    for (const row of r.rows as { kind: CreditKind; n: number }[]) if (row.kind in out) out[row.kind] = Number(row.n);
    return out;
  } catch {
    return zero; // tables not migrated yet: behave exactly like "no purchased credits"
  }
}

/** The workspace's lots, newest first, for the wallet (remaining, expiry, where each came from). */
export async function creditLotsOf(orgId: string): Promise<CreditLotRow[]> {
  return db.select().from(creditLots).where(eq(creditLots.organizationId, orgId)).orderBy(desc(creditLots.createdAt)).limit(100);
}

/** The workspace's ledger, newest first, for the wallet's history. */
export async function creditLedgerOf(orgId: string, limit = 100): Promise<CreditLedgerRow[]> {
  return db.select().from(creditLedger).where(eq(creditLedger.organizationId, orgId)).orderBy(desc(creditLedger.createdAt), desc(creditLedger.id)).limit(limit);
}

/** The packs on sale, in display order. */
export async function activeCreditPacks(): Promise<CreditPackRow[]> {
  return db.select().from(creditPacks).where(eq(creditPacks.active, true)).orderBy(creditPacks.kind, creditPacks.sortOrder, creditPacks.id);
}

/** One pack by id (any state — the admin screen edits inactive ones too). */
export async function creditPackById(id: number): Promise<CreditPackRow | undefined> {
  const [p] = await db.select().from(creditPacks).where(eq(creditPacks.id, id)).limit(1);
  return p;
}

/** Freeze what a credit-pack order buys, at order time (grant delivers THIS, however the pack is edited later). */
export async function recordCreditPurchase(p: Omit<CreditPurchaseRow, "createdAt"> & { now: Date }): Promise<void> {
  await db.insert(creditPurchases).values({
    orderId: p.orderId, organizationId: p.organizationId, userId: p.userId, packId: p.packId,
    kind: p.kind, units: p.units, priceRupees: p.priceRupees, expiryMonths: p.expiryMonths, createdAt: p.now,
  });
}

export async function creditPurchaseOf(orderId: string): Promise<CreditPurchaseRow | undefined> {
  const [r] = await db.select().from(creditPurchases).where(eq(creditPurchases.orderId, orderId)).limit(1);
  return r;
}

/**
 * Deliver a paid credit-pack order: one lot plus its ledger line, idempotent by the order id (the unique lot index —
 * a replayed grant finds the existing lot and delivers nothing twice). Called by the payment layer after completeOnce
 * claimed the order, so this second guard should never actually fire.
 */
export async function grantCreditPackOrder(purchase: CreditPurchaseRow, now: Date = new Date()): Promise<{ lotId: number; units: number; kind: CreditKind; expiresAt: Date | null }> {
  return db.transaction(async (tx) => {
    const expiresAt = expiryFrom(now, purchase.expiryMonths);
    const inserted = await tx.insert(creditLots).values({
      organizationId: purchase.organizationId, kind: purchase.kind as CreditKind, units: purchase.units, remaining: purchase.units,
      source: "purchase", orderId: purchase.orderId, packId: purchase.packId,
      expiresAt, createdAt: now,
    }).onConflictDoNothing().returning({ id: creditLots.id }); // the unique index on order_id is partial, so no explicit target
    const lotId = inserted[0]?.id;
    if (lotId == null) {
      const [existing] = await tx.select({ id: creditLots.id, expiresAt: creditLots.expiresAt }).from(creditLots).where(eq(creditLots.orderId, purchase.orderId)).limit(1);
      if (!existing) throw new Error(`credit grant: lot for order ${purchase.orderId} neither inserted nor found`);
      return { lotId: existing.id, units: purchase.units, kind: purchase.kind as CreditKind, expiresAt: existing.expiresAt };
    }
    await tx.insert(creditLedger).values({
      organizationId: purchase.organizationId, kind: purchase.kind as CreditKind, delta: purchase.units,
      reason: "purchase", lotId, sourceRef: `order:${purchase.orderId}`, createdAt: now,
    }).onConflictDoNothing();
    return { lotId, units: purchase.units, kind: purchase.kind as CreditKind, expiresAt };
  });
}

/**
 * Take back what a FULLY refunded credit-pack order still holds: the lot's remaining credits go to zero, once
 * (idempotent by the refund ledger line). Credits already spent are not clawed back — the money for them was spent on
 * provider and model costs; "lapsed" reports a lot that had nothing left (or expired) anyway.
 */
export async function revokeCreditPackOrder(orderId: string, now: Date = new Date()): Promise<"revoked" | "lapsed"> {
  return db.transaction(async (tx) => {
    const r = await tx.execute(sql`SELECT id, organization_id, kind, remaining, expires_at FROM credit_lots WHERE order_id = ${orderId} LIMIT 1 FOR UPDATE`);
    const lot = r.rows[0] as { id: number; organization_id: string; kind: CreditKind; remaining: number; expires_at: Date | null } | undefined;
    if (!lot) return "lapsed"; // never granted (refund-before-capture closed the order first): nothing to take back
    const expired = lot.expires_at != null && new Date(lot.expires_at).getTime() <= now.getTime();
    const toTake = expired ? 0 : Number(lot.remaining);
    const marked = await tx.insert(creditLedger).values({
      organizationId: lot.organization_id, kind: lot.kind, delta: -toTake, reason: "refund",
      lotId: Number(lot.id), sourceRef: `order:${orderId}`, createdAt: now,
    }).onConflictDoNothing().returning({ id: creditLedger.id });
    if (!marked.length) return "lapsed"; // this refund was already applied
    if (toTake > 0) await tx.execute(sql`UPDATE credit_lots SET remaining = 0 WHERE id = ${lot.id}`);
    return toTake > 0 ? "revoked" : "lapsed";
  });
}

/** An audit line written in the SAME transaction as the change it records (adminAuditLog). */
export interface AuditEntry { adminUserId: string; action: string; target: string | null; reason: string | null; detail?: unknown }
export async function writeAudit(tx: Pick<typeof db, "insert">, a: AuditEntry, now: Date = new Date()): Promise<void> {
  await tx.insert(adminAuditLog).values({ adminUserId: a.adminUserId, action: a.action, target: a.target, reason: a.reason, detail: (a.detail ?? null) as never, createdAt: now });
}

class Replay extends Error {}

/**
 * An operator grant: its own lot (no expiry unless given), its ledger line and its audit line, in ONE transaction,
 * with the mandatory reason. Idempotent by `requestId`: a replay (a double submit, a retried request) changes nothing
 * and reports `replay: true`.
 */
export async function adminGrantCredits(o: { orgId: string; kind: CreditKind; units: number; reason: string; adminUserId: string; requestId: string; expiresAt?: Date | null; targetLabel?: string; now?: Date }): Promise<{ replay: boolean; lotId: number | null }> {
  const now = o.now ?? new Date();
  try {
    return await db.transaction(async (tx) => {
      const [lot] = await tx.insert(creditLots).values({
        organizationId: o.orgId, kind: o.kind, units: o.units, remaining: o.units,
        source: "admin_grant", expiresAt: o.expiresAt ?? null, createdAt: now,
      }).returning({ id: creditLots.id });
      const line = await tx.insert(creditLedger).values({
        organizationId: o.orgId, kind: o.kind, delta: o.units, reason: "admin_grant",
        lotId: lot.id, sourceRef: `admin:${o.requestId}`, note: o.reason, actorUserId: o.adminUserId, createdAt: now,
      }).onConflictDoNothing().returning({ id: creditLedger.id });
      if (!line.length) throw new Replay(); // rolls the lot back
      await writeAudit(tx, { adminUserId: o.adminUserId, action: "credits.grant", target: o.targetLabel ?? `org:${o.orgId}`, reason: o.reason, detail: { kind: o.kind, units: o.units, lotId: lot.id, requestId: o.requestId } }, now);
      return { replay: false, lotId: lot.id };
    });
  } catch (e) {
    if (e instanceof Replay) return { replay: true, lotId: null };
    throw e;
  }
}

/**
 * An operator deduction: removes up to `units` from the workspace's open lots (earliest-expiring first), never below
 * zero, and reports how many were actually removed. One ledger line carries the total and the mandatory reason; the
 * audit line is written in the same transaction. Idempotent by `requestId`.
 */
export async function adminDeductCredits(o: { orgId: string; kind: CreditKind; units: number; reason: string; adminUserId: string; requestId: string; targetLabel?: string; now?: Date }): Promise<{ replay: boolean; removed: number }> {
  const now = o.now ?? new Date();
  try {
    return await db.transaction(async (tx) => {
      const marked = await tx.insert(creditLedger).values({
        organizationId: o.orgId, kind: o.kind, delta: 0, reason: "admin_deduct",
        sourceRef: `admin:${o.requestId}`, note: o.reason, actorUserId: o.adminUserId, createdAt: now,
      }).onConflictDoNothing().returning({ id: creditLedger.id });
      if (!marked.length) throw new Replay();
      const r = await tx.execute(sql`
        SELECT id, remaining FROM credit_lots
        WHERE organization_id = ${o.orgId} AND kind = ${o.kind} AND remaining > 0
          AND (expires_at IS NULL OR expires_at > ${at(now)}::timestamp)
        ORDER BY expires_at ASC NULLS LAST, id ASC FOR UPDATE`);
      let left = o.units, taken = 0;
      for (const lot of r.rows as { id: number; remaining: number }[]) {
        if (left <= 0) break;
        const take = Math.min(left, Number(lot.remaining));
        await tx.execute(sql`UPDATE credit_lots SET remaining = remaining - ${take} WHERE id = ${lot.id}`);
        left -= take; taken += take;
      }
      await tx.update(creditLedger).set({ delta: -taken }).where(eq(creditLedger.id, marked[0].id));
      await writeAudit(tx, { adminUserId: o.adminUserId, action: "credits.deduct", target: o.targetLabel ?? `org:${o.orgId}`, reason: o.reason, detail: { kind: o.kind, requested: o.units, removed: taken, requestId: o.requestId } }, now);
      return { replay: false, removed: taken };
    });
  } catch (e) {
    if (e instanceof Replay) return { replay: true, removed: 0 };
    throw e;
  }
}

/**
 * Net purchased credits spent in the window (consumes minus undos), per kind: what the workspace spend ceiling grows
 * by, so a bought search is never refused by a safety cap sized for the plan alone (server/billing/billing-config.ts
 * holds the per-credit headroom). Zero when the tables don't exist.
 */
export async function creditsConsumedSince(orgId: string, since: Date): Promise<Record<CreditKind, number>> {
  const zero: Record<CreditKind, number> = { search: 0, draft: 0 };
  try {
    const r = await db.execute(sql`
      SELECT kind, COALESCE(sum(CASE reason WHEN 'consume' THEN -delta WHEN 'consume_undo' THEN -delta ELSE 0 END), 0)::int AS n
      FROM credit_ledger
      WHERE organization_id = ${orgId} AND reason IN ('consume', 'consume_undo') AND created_at >= ${at(since)}::timestamp
      GROUP BY kind`);
    const out = { ...zero };
    for (const row of r.rows as { kind: CreditKind; n: number }[]) if (row.kind in out) out[row.kind] = Math.max(0, Number(row.n));
    return out;
  } catch {
    return zero;
  }
}

export interface CreditKindSummary {
  /** Usable purchased credits right now. */
  balance: number;
  /** The soonest expiry among lots that still hold credits (units + when), or null when none expires. */
  nextExpiry: { units: number; at: string } | null;
}

/** Balance and the next expiry per kind: what the wallet and the exhaustion hints show. Zeroes when the tables don't exist. */
export async function creditSummary(orgId: string, now: Date = new Date()): Promise<Record<CreditKind, CreditKindSummary>> {
  const out: Record<CreditKind, CreditKindSummary> = { search: { balance: 0, nextExpiry: null }, draft: { balance: 0, nextExpiry: null } };
  try {
    const r = await db.execute(sql`
      SELECT kind, remaining, expires_at FROM credit_lots
      WHERE organization_id = ${orgId} AND remaining > 0 AND (expires_at IS NULL OR expires_at > ${at(now)}::timestamp)
      ORDER BY expires_at ASC NULLS LAST, id ASC`);
    for (const row of r.rows as { kind: CreditKind; remaining: number; expires_at: Date | string | null }[]) {
      const k = out[row.kind];
      if (!k) continue;
      k.balance += Number(row.remaining);
      if (row.expires_at && !k.nextExpiry) k.nextExpiry = { units: Number(row.remaining), at: new Date(row.expires_at).toISOString() };
    }
  } catch { /* not migrated yet: no credits */ }
  return out;
}

/** When the oldest plan-funded AI draft in the window was made (email and channels, credit-funded drafts excluded): when the next plan draft frees up. */
export async function oldestPlanDraftSince(orgId: string, since: Date, prefix: string): Promise<Date | null> {
  try {
    const r = await db.execute(sql`SELECT min(t) AS at FROM (
      SELECT min(created_at) AS t FROM lead_messages WHERE organization_id = ${orgId} AND direction = 'out' AND prompt_version LIKE ${prefix + "%"} AND funded_by IS DISTINCT FROM 'credit' AND created_at >= ${at(since)}::timestamp
      UNION ALL
      SELECT min(created_at) AS t FROM channel_messages WHERE organization_id = ${orgId} AND direction = 'out' AND prompt_version LIKE ${prefix + "%"} AND funded_by IS DISTINCT FROM 'credit' AND created_at >= ${at(since)}::timestamp) x`);
    const v = (r.rows[0] as { at?: Date | string | null } | undefined)?.at;
    return v ? new Date(v instanceof Date ? v : `${v}Z`) : null;
  } catch { return null; }
}
