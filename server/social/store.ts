/**
 * Database store for Social Intent. Every query a person's request can reach is scoped by organization; the one
 * deliberately global query is the scheduler's claim, which serves every workspace and returns the profile whose
 * organization then scopes everything else.
 */
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "../db";
import { socialOpportunities, socialProfiles, socialScans, type SocialOpportunityRow, type SocialProfileRow, type SocialScanRow } from "@shared/schema";
import { tablesReadyCheck } from "../leads/ready";

export const socialTablesReady = tablesReadyCheck(["social_profiles", "social_scans", "social_opportunities"]);

/** Advisory-lock namespace for starting a scan; the second key is the workspace (hashtext of its id). */
export const SOCIAL_SCAN_LOCK = 7_310_011;

export interface NewOpportunity {
  profileId: number | null; source: string; origin: "scan" | "manual"; url: string; community: string | null;
  title: string; excerpt: string; postedAt: Date | null; intent: string; intentMatched: string | null; service: string | null;
  signals: Record<string, unknown>; score: number; scoreDetail: Record<string, unknown>; companyUrl: string | null; expiresAt: Date | null;
}
export interface ListFilter { status?: string[]; intent?: string[]; source?: string[]; minScore?: number; limit: number; offset: number }
export interface SourceOutcome { name: string; ok: boolean; posts: number; error?: string }
export interface ProfileFields { name: string; services: string[]; keywords: string[]; platforms: string[]; minScore: number; schedule: string; status: string; nextRunAt: Date | null }

export interface SocialStore {
  /**
   * Starts a scan if the workspace has allowance left: the count and the insert happen under one per-workspace lock,
   * so two scans started at the same moment can't both fit under the limit. Null = the limit is reached.
   */
  reserveScan(r: { orgId: string; userId: string; profileId: number | null; trigger: "manual" | "scheduled"; since: Date; max: number; now: Date }): Promise<SocialScanRow | null>;
  finishScan(id: number, r: { sources: SourceOutcome[]; read: number; kept: number; fresh: number }): Promise<void>;
  /** A scan no source answered is not charged: its row is removed. */
  dropScan(id: number): Promise<void>;
  countScansSince(orgId: string, since: Date): Promise<number>;
  oldestScanSince(orgId: string, since: Date): Promise<Date | null>;
  /** One row per workspace and post. A post seen again keeps its status and its lead, and takes the newer analysis. */
  upsertOpportunity(orgId: string, o: NewOpportunity, now: Date): Promise<{ id: number; fresh: boolean }>;
  listOpportunities(orgId: string, f: ListFilter): Promise<{ rows: SocialOpportunityRow[]; total: number }>;
  stats(orgId: string, highScore: number): Promise<{ total: number; fresh: number; high: number; saved: number }>;
  getOpportunity(orgId: string, id: number): Promise<SocialOpportunityRow | null>;
  setOpportunity(orgId: string, id: number, patch: Partial<Pick<SocialOpportunityRow, "status" | "leadId" | "expiresAt">>, now: Date): Promise<SocialOpportunityRow | null>;
  deleteOpportunity(orgId: string, id: number): Promise<boolean>;
  countManualSince(orgId: string, since: Date): Promise<number>;
  /** Deletes this workspace's opportunities nobody acted on, past their retention. */
  purgeExpired(orgId: string, now: Date): Promise<number>;
  listProfiles(orgId: string): Promise<SocialProfileRow[]>;
  getProfile(orgId: string, id: number): Promise<SocialProfileRow | null>;
  createProfile(orgId: string, userId: string, f: ProfileFields, now: Date): Promise<SocialProfileRow>;
  updateProfile(orgId: string, id: number, f: Partial<ProfileFields>, now: Date): Promise<SocialProfileRow | null>;
  deleteProfile(orgId: string, id: number): Promise<boolean>;
  markProfileRun(orgId: string, id: number, now: Date): Promise<void>;
  /** The scheduler's claim: one due profile, its next run already moved on, so a crash mid-scan can't run it twice. */
  claimDueProfile(now: Date): Promise<SocialProfileRow | null>;
  nextDue(now: Date): Promise<Date | null>;
}

const filterWhere = (orgId: string, f: Pick<ListFilter, "status" | "intent" | "source" | "minScore">) => and(
  eq(socialOpportunities.organizationId, orgId),
  f.status?.length ? inArray(socialOpportunities.status, f.status) : undefined,
  f.intent?.length ? inArray(socialOpportunities.intent, f.intent) : undefined,
  f.source?.length ? inArray(socialOpportunities.source, f.source) : undefined,
  typeof f.minScore === "number" && f.minScore > 0 ? gte(socialOpportunities.score, f.minScore) : undefined,
);

export const socialStore: SocialStore = {
  async reserveScan(r) {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${SOCIAL_SCAN_LOCK}, hashtext(${r.orgId}))`);
      const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(socialScans).where(and(eq(socialScans.organizationId, r.orgId), gte(socialScans.createdAt, r.since)));
      if ((c?.n ?? 0) >= r.max) return null;
      const [row] = await tx.insert(socialScans).values({ organizationId: r.orgId, profileId: r.profileId, createdByUser: r.userId, trigger: r.trigger, createdAt: r.now }).returning();
      return row;
    });
  },
  async finishScan(id, r) {
    await db.update(socialScans).set({ sources: r.sources, read: r.read, kept: r.kept, fresh: r.fresh }).where(eq(socialScans.id, id));
  },
  async dropScan(id) { await db.delete(socialScans).where(eq(socialScans.id, id)); },
  async countScansSince(orgId, since) {
    const [c] = await db.select({ n: sql<number>`count(*)::int` }).from(socialScans).where(and(eq(socialScans.organizationId, orgId), gte(socialScans.createdAt, since)));
    return c?.n ?? 0;
  },
  async oldestScanSince(orgId, since) {
    const [r] = await db.select({ at: socialScans.createdAt }).from(socialScans).where(and(eq(socialScans.organizationId, orgId), gte(socialScans.createdAt, since))).orderBy(asc(socialScans.createdAt)).limit(1);
    return r?.at ?? null;
  },
  async upsertOpportunity(orgId, o, now) {
    const r = await db.insert(socialOpportunities).values({
      organizationId: orgId, profileId: o.profileId, source: o.source, origin: o.origin, url: o.url, community: o.community, title: o.title, excerpt: o.excerpt,
      postedAt: o.postedAt, discoveredAt: now, lastSeenAt: now, intent: o.intent, intentMatched: o.intentMatched, service: o.service, signals: o.signals,
      score: o.score, scoreDetail: o.scoreDetail, companyUrl: o.companyUrl, expiresAt: o.expiresAt, createdAt: now, updatedAt: now,
    }).onConflictDoUpdate({
      target: [socialOpportunities.organizationId, socialOpportunities.url],
      // Seen again: the newer reading of the post replaces the older one. The person's own decisions about it — its
      // status, its lead, whether it is kept — are theirs and are never overwritten by a scan.
      set: { lastSeenAt: now, updatedAt: now, title: o.title, excerpt: o.excerpt, intent: o.intent, intentMatched: o.intentMatched, service: o.service, signals: o.signals, score: o.score, scoreDetail: o.scoreDetail,
        postedAt: sql`COALESCE(${socialOpportunities.postedAt}, ${o.postedAt ? o.postedAt.toISOString() : null}::timestamp)` },
    }).returning({ id: socialOpportunities.id, fresh: sql<boolean>`(xmax = 0)` });
    return { id: r[0].id, fresh: !!r[0].fresh };
  },
  async listOpportunities(orgId, f) {
    const where = filterWhere(orgId, f);
    const [c] = await db.select({ n: sql<number>`count(*)::int` }).from(socialOpportunities).where(where);
    const rows = await db.select().from(socialOpportunities).where(where)
      .orderBy(desc(socialOpportunities.score), desc(socialOpportunities.discoveredAt), desc(socialOpportunities.id)).limit(f.limit).offset(f.offset);
    return { rows, total: c?.n ?? 0 };
  },
  async stats(orgId, highScore) {
    const [r] = await db.select({
      total: sql<number>`count(*) FILTER (WHERE ${socialOpportunities.status} <> 'ignored')::int`,
      fresh: sql<number>`count(*) FILTER (WHERE ${socialOpportunities.status} = 'new')::int`,
      high: sql<number>`count(*) FILTER (WHERE ${socialOpportunities.status} = 'new' AND ${socialOpportunities.score} >= ${highScore})::int`,
      saved: sql<number>`count(*) FILTER (WHERE ${socialOpportunities.status} IN ('saved', 'contacted'))::int`,
    }).from(socialOpportunities).where(eq(socialOpportunities.organizationId, orgId));
    return { total: r?.total ?? 0, fresh: r?.fresh ?? 0, high: r?.high ?? 0, saved: r?.saved ?? 0 };
  },
  async getOpportunity(orgId, id) {
    const [r] = await db.select().from(socialOpportunities).where(and(eq(socialOpportunities.organizationId, orgId), eq(socialOpportunities.id, id))).limit(1);
    return r ?? null;
  },
  async setOpportunity(orgId, id, patch, now) {
    const [r] = await db.update(socialOpportunities).set({ ...patch, updatedAt: now }).where(and(eq(socialOpportunities.organizationId, orgId), eq(socialOpportunities.id, id))).returning();
    return r ?? null;
  },
  async deleteOpportunity(orgId, id) {
    const r = await db.delete(socialOpportunities).where(and(eq(socialOpportunities.organizationId, orgId), eq(socialOpportunities.id, id))).returning({ id: socialOpportunities.id });
    return r.length > 0;
  },
  async countManualSince(orgId, since) {
    const [c] = await db.select({ n: sql<number>`count(*)::int` }).from(socialOpportunities).where(and(eq(socialOpportunities.organizationId, orgId), eq(socialOpportunities.origin, "manual"), gte(socialOpportunities.createdAt, since)));
    return c?.n ?? 0;
  },
  async purgeExpired(orgId, now) {
    const r = await db.delete(socialOpportunities).where(and(eq(socialOpportunities.organizationId, orgId), lte(socialOpportunities.expiresAt, now), inArray(socialOpportunities.status, ["new", "ignored"]))).returning({ id: socialOpportunities.id });
    return r.length;
  },
  async listProfiles(orgId) {
    return db.select().from(socialProfiles).where(eq(socialProfiles.organizationId, orgId)).orderBy(desc(socialProfiles.createdAt));
  },
  async getProfile(orgId, id) {
    const [r] = await db.select().from(socialProfiles).where(and(eq(socialProfiles.organizationId, orgId), eq(socialProfiles.id, id))).limit(1);
    return r ?? null;
  },
  async createProfile(orgId, userId, f, now) {
    const [r] = await db.insert(socialProfiles).values({ organizationId: orgId, createdByUser: userId, ...f, createdAt: now, updatedAt: now }).returning();
    return r;
  },
  async updateProfile(orgId, id, f, now) {
    const [r] = await db.update(socialProfiles).set({ ...f, updatedAt: now }).where(and(eq(socialProfiles.organizationId, orgId), eq(socialProfiles.id, id))).returning();
    return r ?? null;
  },
  async deleteProfile(orgId, id) {
    const r = await db.delete(socialProfiles).where(and(eq(socialProfiles.organizationId, orgId), eq(socialProfiles.id, id))).returning({ id: socialProfiles.id });
    return r.length > 0;
  },
  async markProfileRun(orgId, id, now) {
    await db.update(socialProfiles).set({ lastRunAt: now, updatedAt: now }).where(and(eq(socialProfiles.organizationId, orgId), eq(socialProfiles.id, id)));
  },
  async claimDueProfile(now) {
    // Times go to SQL as UTC text (the columns are zone-less; a Date handed to the driver is written in local time).
    const at = now.toISOString();
    const r = await db.execute(sql`
      UPDATE social_profiles SET last_run_at = ${at}::timestamp, updated_at = ${at}::timestamp,
        next_run_at = ${at}::timestamp + CASE schedule WHEN 'weekly' THEN interval '7 days' ELSE interval '1 day' END
      WHERE id = (SELECT id FROM social_profiles WHERE status = 'active' AND schedule IN ('daily', 'weekly') AND next_run_at IS NOT NULL AND next_run_at <= ${at}::timestamp
                  ORDER BY next_run_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING id, organization_id`);
    const row = r.rows?.[0] as { id?: unknown; organization_id?: unknown } | undefined;
    if (!row?.id) return null;
    return this.getProfile(String(row.organization_id), Number(row.id));
  },
  async nextDue(now) {
    const r = await db.execute(sql`SELECT to_char(min(next_run_at), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at FROM social_profiles WHERE status = 'active' AND schedule IN ('daily', 'weekly') AND next_run_at IS NOT NULL`);
    const at = (r.rows?.[0] as { at?: string | null } | undefined)?.at;
    if (!at) return null;
    const d = new Date(at);
    return Number.isFinite(d.getTime()) ? (d.getTime() < now.getTime() ? now : d) : null;
  },
};
