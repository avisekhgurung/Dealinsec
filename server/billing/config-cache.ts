/**
 * The billing configuration as the server reads it: one in-memory snapshot of the billing_config rows, so the
 * synchronous limit lookups (server/outbound/limits.ts is called from dozens of places) never wait on the database.
 *
 * This module is pure on purpose (no db import): limits.ts is loaded by tests and tools that have no DATABASE_URL.
 * The loader that fills it lives in config-store.ts; until a load succeeds the snapshot IS the defaults, which is
 * exactly the behaviour before this feature existed (environment variables and shared/outbound-plans.ts).
 */
import { BILLING_CONFIG_DEFAULTS, configFromRows, type BillingConfig } from "@shared/billing-config";

let snapshot: BillingConfig = BILLING_CONFIG_DEFAULTS;
let loadedAt = 0;

export const billingConfig = (): BillingConfig => snapshot;
export const billingConfigLoadedAt = () => loadedAt;

/** Replace the snapshot from stored rows (an invalid row keeps its default). */
export function applyBillingConfigRows(rows: { key: string; value: unknown }[], now: number = Date.now()): BillingConfig {
  snapshot = configFromRows(rows);
  loadedAt = now;
  return snapshot;
}

/** Tests only: back to the defaults. */
export function resetBillingConfigForTests(): void {
  snapshot = BILLING_CONFIG_DEFAULTS;
  loadedAt = 0;
}
