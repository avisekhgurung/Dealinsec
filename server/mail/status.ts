/**
 * The process-wide Gmail gate, bound to the app's database. Routes (Milestone 1 onwards) ask `gmailStatus()` and
 * refuse unless it says enabled. Kept apart from config.ts so the pure logic can be tested without a database.
 */
import { db } from "../db";
import { gmailIntegrationGate } from "./config";

export const gmailStatus = gmailIntegrationGate(() => (text, params) => db.$client.query(text, params as any[]));
