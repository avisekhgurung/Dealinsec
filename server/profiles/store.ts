/**
 * Client profiles: the database. Every statement is filtered by the caller's organization, so a profile in another
 * workspace is simply not found. Imports the database; the service's tests replace this with an in-memory store.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { acquisitionProfiles, type AcquisitionProfileRow } from "@shared/schema";
import type { AcquisitionProfileInput } from "@shared/acquisition-profile";
import { tablesReadyCheck } from "../leads/ready";

export const profilesTableReady = tablesReadyCheck(["acquisition_profiles"]);

/** Thrown by create/update when the workspace already has a profile with that name (the unique index said so). */
export class NameTaken extends Error { constructor() { super("name_taken"); this.name = "NameTaken"; } }
const isUnique = (e: unknown, index: string) => (e as { code?: string })?.code === "23505" && String((e as { constraint?: string })?.constraint ?? "").includes(index);

export interface AcquisitionProfileStore {
  list(orgId: string): Promise<AcquisitionProfileRow[]>;
  get(orgId: string, id: number): Promise<AcquisitionProfileRow | null>;
  /** Creates one, unless the workspace already holds `max`: then null. Counted and inserted under one per-workspace lock. */
  create(orgId: string, userId: string, p: AcquisitionProfileInput, now: Date, max: number): Promise<AcquisitionProfileRow | null>;
  update(orgId: string, id: number, p: AcquisitionProfileInput, now: Date): Promise<AcquisitionProfileRow | null>;
  /** Makes this the workspace's default (and no other), or clears the default when `on` is false. */
  setDefault(orgId: string, id: number, on: boolean, now: Date): Promise<AcquisitionProfileRow | null>;
  remove(orgId: string, id: number): Promise<boolean>;
}

const cols = (p: AcquisitionProfileInput) => ({
  name: p.name, nameKey: p.name.toLowerCase(), kind: p.kind, services: p.services, industries: p.industries, keywords: p.keywords, countries: p.countries,
  locations: p.locations, employeeMin: p.employeeMin, employeeMax: p.employeeMax, exclusions: p.exclusions, signals: p.signals, requirements: p.requirements,
  roles: p.roles, outreach: p.outreach,
});

export const acquisitionProfileStore: AcquisitionProfileStore = {
  async list(orgId) {
    return db.select().from(acquisitionProfiles).where(eq(acquisitionProfiles.organizationId, orgId)).orderBy(asc(acquisitionProfiles.createdAt), asc(acquisitionProfiles.id));
  },
  async get(orgId, id) {
    const [r] = await db.select().from(acquisitionProfiles).where(and(eq(acquisitionProfiles.organizationId, orgId), eq(acquisitionProfiles.id, id))).limit(1);
    return r ?? null;
  },
  async create(orgId, userId, p, now, max) {
    try {
      // The count and the insert sit behind one per-workspace lock, held to the end of the transaction: two people
      // saving at once can't take the workspace past its cap (a plain "count, then insert" would let both through).
      const id = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`acquisition_profiles|${orgId}`}))`);
        const n = await tx.execute(sql`SELECT count(*)::int AS n FROM acquisition_profiles WHERE organization_id = ${orgId}`);
        if (Number((n.rows?.[0] as { n?: unknown })?.n) >= max) return null;
        const [r] = await tx.insert(acquisitionProfiles).values({ organizationId: orgId, createdByUser: userId, ...cols(p), isDefault: false, createdAt: now, updatedAt: now }).returning({ id: acquisitionProfiles.id });
        return r?.id ?? null;
      });
      return id ? this.get(orgId, id) : null;
    } catch (e) { if (isUnique(e, "acquisition_profiles_org_name_uq")) throw new NameTaken(); throw e; }
  },
  async update(orgId, id, p, now) {
    try {
      const [r] = await db.update(acquisitionProfiles).set({ ...cols(p), updatedAt: now }).where(and(eq(acquisitionProfiles.organizationId, orgId), eq(acquisitionProfiles.id, id))).returning();
      return r ?? null;
    } catch (e) { if (isUnique(e, "acquisition_profiles_org_name_uq")) throw new NameTaken(); throw e; }
  },
  async setDefault(orgId, id, on, now) {
    return db.transaction(async (tx) => {
      const [cur] = await tx.select({ id: acquisitionProfiles.id }).from(acquisitionProfiles).where(and(eq(acquisitionProfiles.organizationId, orgId), eq(acquisitionProfiles.id, id))).for("update").limit(1);
      if (!cur) return null;
      // Clear first, then set: the partial unique index allows one default per workspace at every moment.
      await tx.update(acquisitionProfiles).set({ isDefault: false }).where(and(eq(acquisitionProfiles.organizationId, orgId), eq(acquisitionProfiles.isDefault, true)));
      const [r] = await tx.update(acquisitionProfiles).set({ isDefault: on, updatedAt: now }).where(and(eq(acquisitionProfiles.organizationId, orgId), eq(acquisitionProfiles.id, id))).returning();
      return r ?? null;
    });
  },
  async remove(orgId, id) {
    const r = await db.delete(acquisitionProfiles).where(and(eq(acquisitionProfiles.organizationId, orgId), eq(acquisitionProfiles.id, id))).returning({ id: acquisitionProfiles.id });
    return r.length > 0;
  },
};
