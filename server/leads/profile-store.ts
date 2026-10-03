/**
 * Database implementation of the ideal-client store. Imports the database;
 * tests replace this module with the in-memory one (eval/world-mocks.ts).
 */
import { eq } from "drizzle-orm";
import { db } from "../db";
import { clientProfiles, type ClientProfileRow } from "@shared/schema";
import { tablesReadyCheck } from "./ready";

export const profileTableReady = tablesReadyCheck(["client_profiles"]);

export interface ProfileData {
  about: string | null; services: string[]; targetIndustries: string[]; targetLocations: string[]; exclusions: string[];
  minDealMinor: number | null; currency: string | null;
}
export interface ProfileStore {
  get(orgId: string): Promise<ClientProfileRow | null>;
  /** Replaces the organization's profile. */
  save(orgId: string, data: ProfileData, userId: string): Promise<ClientProfileRow>;
}

export const profileStore: ProfileStore = {
  async get(orgId) {
    const [row] = await db.select().from(clientProfiles).where(eq(clientProfiles.organizationId, orgId)).limit(1);
    return row ?? null;
  },
  async save(orgId, data, userId) {
    const values = { organizationId: orgId, ...data, updatedBy: userId, updatedAt: new Date() };
    const [row] = await db.insert(clientProfiles).values(values)
      .onConflictDoUpdate({ target: clientProfiles.organizationId, set: { ...data, updatedBy: userId, updatedAt: new Date() } }).returning();
    return row;
  },
};
