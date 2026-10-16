/**
 * The process-wide Gmail gate, bound to the app's database. Routes (Milestone 1 onwards) ask `gmailStatus()` and
 * refuse unless it says enabled. Kept apart from config.ts so the pure logic can be tested without a database.
 */
import { db } from "../db";
import { gmailIntegrationGate } from "./config";
import { mailSyncSchemaPresent } from "./mail-sync-schema";

export const gmailStatus = gmailIntegrationGate(() => (text, params) => db.$client.query(text, params as any[]));

/** Whether the reply-sync tables are migrated: a yes is kept for the process, a no is rechecked at most every 30 seconds. */
let syncSchemaOk = false;
let syncSchemaChecked = 0;
export async function mailSyncSchemaReady(): Promise<boolean> {
  if (syncSchemaOk || Date.now() - syncSchemaChecked < 30_000) return syncSchemaOk;
  syncSchemaChecked = Date.now();
  try {
    syncSchemaOk = (await mailSyncSchemaPresent((text, params) => db.$client.query(text, params as any[]))).ok;
  } catch { syncSchemaOk = false; }
  return syncSchemaOk;
}
