/**
 * Loads billing_config into the config cache (config-cache.ts) and writes admin edits to it. Kept apart from the cache
 * because this file imports the database. The server and the worker call primeBillingConfig() at boot; afterwards the
 * snapshot refreshes in the background every REFRESH_MS, and an admin write refreshes THIS process at once (other
 * processes pick it up within the interval: at most REFRESH_MS late, never wrong).
 *
 * A failed load keeps the last good snapshot (or the defaults on a fresh process, i.e. the pre-feature behaviour);
 * it never throws into a request.
 */
import { eq } from "drizzle-orm";
import { billingConfig as billingConfigTable } from "@shared/schema";
import { validateConfigValue, type BillingConfigKey } from "@shared/billing-config";
import { db } from "../db";
import { applyBillingConfigRows } from "./config-cache";
import { writeAudit } from "./credits";

export const REFRESH_MS = 30_000;
let timer: NodeJS.Timeout | null = null;

export async function refreshBillingConfig(): Promise<void> {
  try {
    const rows = await db.select().from(billingConfigTable);
    applyBillingConfigRows(rows.map((r) => ({ key: r.key, value: r.value })));
  } catch {
    // table not migrated yet, or the database is unreachable: keep what we have
  }
}

/** Load once and keep refreshing. Idempotent; the timer never keeps the process alive. */
export async function primeBillingConfig(): Promise<void> {
  await refreshBillingConfig();
  if (!timer) {
    timer = setInterval(() => { void refreshBillingConfig(); }, REFRESH_MS);
    timer.unref?.();
  }
}

/** Validate and store one key (admin). Returns the validation error instead of throwing. */
export async function setBillingConfig(key: BillingConfigKey, value: unknown, adminUserId: string, reason: string | null = null): Promise<{ ok: true } | { ok: false; error: string }> {
  const checked = validateConfigValue(key, value);
  if (!checked.ok) return checked;
  const now = new Date();
  // The change and its audit line (old value, new value, who, why) commit together or not at all.
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(billingConfigTable).where(eq(billingConfigTable.key, key)).limit(1);
    await tx.insert(billingConfigTable).values({ key, value: checked.value as never, updatedBy: adminUserId, updatedAt: now })
      .onConflictDoUpdate({ target: billingConfigTable.key, set: { value: checked.value as never, updatedBy: adminUserId, updatedAt: now } });
    await writeAudit(tx, { adminUserId, action: "config.set", target: key, reason, detail: { before: before?.value ?? null, after: checked.value } }, now);
  });
  await refreshBillingConfig();
  return { ok: true };
}

export async function storedBillingConfig(): Promise<{ key: string; value: unknown; updatedBy: string | null; updatedAt: Date }[]> {
  return db.select().from(billingConfigTable);
}
