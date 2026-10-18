/**
 * Where AI League keeps its threads, runs, events, schedules and memory (shared/schema.ts; server/ai-league/ddl.ts).
 * Every read and write a person can reach is scoped by organization AND user; the workflow's own claim/save calls are
 * fenced by the claim number, so a worker that lost its lease writes nothing.
 *
 * Guarantees decided by the database:
 *   - one conversation per person and coworker (unique index);
 *   - a run is created once per idempotency key (a double click, a retried request or a re-fired schedule slot);
 *   - a run is claimed by one worker at a time (UPDATE … WHERE lease free … FOR UPDATE SKIP LOCKED);
 *   - the monthly run allowance and the per-workspace concurrency cap are checked with the insert, under one lock;
 *   - a schedule slot fires once: its run's idempotency key is the slot (schedule id + due time).
 */
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { leagueMemory, leagueRunEvents, leagueRuns, leagueSchedules, leagueThreads, type LeagueMemoryRow, type LeagueRunEventRow, type LeagueRunRow, type LeagueScheduleRow, type LeagueThreadRow } from "@shared/schema";
import { tablesReadyCheck } from "../leads/ready";
import { LEAGUE_TABLES } from "./ddl";

export const leagueTablesReady = tablesReadyCheck([...LEAGUE_TABLES]);
export const LEAGUE_RUN_LOCK = 7_310_040;

export class RunLimit extends Error { constructor(readonly kind: "monthly" | "concurrent", readonly max: number) { super(`league ${kind} limit`); } }

export interface NewRun {
  id: string; orgId: string; userId: string; bot: string; task: string; input: Record<string, unknown>; idemKey: string;
  source: "chat" | "page" | "schedule"; scheduleId?: number | null; now: Date;
  limits: { monthly: { since: Date; max: number }; concurrent: number };
}
export interface ClaimedLeagueRun extends LeagueRunRow { fence: number }
export interface RunPatch { status?: string; stage?: string; checkpoint?: Record<string, unknown>; report?: Record<string, unknown> | null; errorCode?: string | null; tokensIn?: number; tokensOut?: number; startedAt?: Date; finishedAt?: Date }

export interface LeagueStore {
  thread(orgId: string, userId: string, bot: string): Promise<LeagueThreadRow | null>;
  /** Links a fresh agent session as this person's conversation with the coworker; returns the existing one if two requests raced. */
  createThread(t: { orgId: string; userId: string; bot: string; sessionId: string; now: Date }): Promise<LeagueThreadRow>;
  threads(orgId: string, userId: string): Promise<LeagueThreadRow[]>;
  markThreadRead(orgId: string, userId: string, bot: string, now: Date): Promise<void>;
  /** Session ids that belong to AI League (Agent mode's history leaves them out). */
  sessionIds(orgId: string, userId: string): Promise<string[]>;

  /** Creates the run, or returns the existing one for the same idempotency key. Throws RunLimit. */
  createRun(r: NewRun): Promise<{ run: LeagueRunRow; existing: boolean }>;
  getRun(orgId: string, userId: string, id: string): Promise<LeagueRunRow | null>;
  listRuns(orgId: string, userId: string, f: { bot?: string; status?: string[]; task?: string; since?: Date; limit: number }): Promise<LeagueRunRow[]>;
  events(orgId: string, runId: string, limit?: number): Promise<LeagueRunEventRow[]>;
  addEvent(e: { runId: string; orgId: string; kind: string; message: string; data?: Record<string, unknown> | null; now: Date }): Promise<void>;
  /** A queued run is cancelled at once; a working one is asked to stop at its next step. */
  requestCancel(orgId: string, userId: string, id: string, now: Date): Promise<LeagueRunRow | null>;
  markRunRead(orgId: string, userId: string, id: string, now: Date): Promise<void>;
  usage(orgId: string, since: Date): Promise<{ runs: number; byBot: Record<string, number>; tokensIn: number; tokensOut: number; failed: number }>;

  claim(now: Date, leaseMs: number): Promise<ClaimedLeagueRun | null>;
  /** One fenced write: only while this worker still holds the run and it isn't finished. */
  save(id: string, fence: number, patch: RunPatch, now: Date): Promise<boolean>;
  setLease(id: string, fence: number, until: Date | null): Promise<boolean>;
  nextWake(now: Date): Promise<Date | null>;
  /** Fresh read for the workflow (cancel requests, status). */
  peek(id: string): Promise<LeagueRunRow | null>;

  schedules(orgId: string, userId: string): Promise<LeagueScheduleRow[]>;
  getSchedule(orgId: string, userId: string, id: number): Promise<LeagueScheduleRow | null>;
  createSchedule(s: Omit<LeagueScheduleRow, "id" | "leaseUntil" | "lastRunId" | "lastRunAt" | "createdAt" | "updatedAt"> & { now: Date }): Promise<LeagueScheduleRow>;
  updateSchedule(orgId: string, userId: string, id: number, set: Partial<LeagueScheduleRow>): Promise<LeagueScheduleRow | null>;
  deleteSchedule(orgId: string, userId: string, id: number): Promise<boolean>;
  countSchedules(orgId: string): Promise<number>;
  /** Takes one due, active schedule (lease), across workspaces: the scheduler's claim. */
  claimDueSchedule(now: Date, leaseMs: number): Promise<LeagueScheduleRow | null>;
  /** After its run was created: the next slot, the lease released. Fenced on the slot that was taken. */
  advanceSchedule(id: number, takenSlot: Date, set: { nextRunAt: Date; lastRunId: string | null; now: Date }): Promise<void>;
  nextScheduleWake(now: Date): Promise<Date | null>;

  memory(orgId: string, userId: string): Promise<LeagueMemoryRow[]>;
  setMemory(m: { orgId: string; userId: string; bot: string; key: string; value: string; source: string; now: Date }): Promise<LeagueMemoryRow>;
  deleteMemory(orgId: string, userId: string, id: number): Promise<boolean>;
}

const n = (r: { rows: unknown[] }) => Number((r.rows[0] as { n: unknown } | undefined)?.n ?? 0);
const isUnique = (e: unknown) => (e as { code?: string })?.code === "23505";
const ACTIVE = ["queued", "running", "waiting"];

export const leagueStore: LeagueStore = {
  async thread(orgId, userId, bot) {
    const [r] = await db.select().from(leagueThreads).where(and(eq(leagueThreads.organizationId, orgId), eq(leagueThreads.userId, userId), eq(leagueThreads.bot, bot))).limit(1);
    return r ?? null;
  },
  async createThread(t) {
    try {
      const [r] = await db.insert(leagueThreads).values({ organizationId: t.orgId, userId: t.userId, bot: t.bot, sessionId: t.sessionId, createdAt: t.now }).returning();
      return r;
    } catch (e) {
      if (!isUnique(e)) throw e;
      return (await leagueStore.thread(t.orgId, t.userId, t.bot))!;
    }
  },
  async threads(orgId, userId) {
    return db.select().from(leagueThreads).where(and(eq(leagueThreads.organizationId, orgId), eq(leagueThreads.userId, userId)));
  },
  async markThreadRead(orgId, userId, bot, now) {
    await db.update(leagueThreads).set({ lastReadAt: now }).where(and(eq(leagueThreads.organizationId, orgId), eq(leagueThreads.userId, userId), eq(leagueThreads.bot, bot)));
  },
  async sessionIds(orgId, userId) {
    return (await leagueStore.threads(orgId, userId)).map((t) => t.sessionId);
  },

  async createRun(r) {
    const found = async () => (await db.select().from(leagueRuns).where(and(eq(leagueRuns.organizationId, r.orgId), eq(leagueRuns.idemKey, r.idemKey))).limit(1))[0] ?? null;
    const prior = await found();
    if (prior) return { run: prior, existing: true };
    try {
      return await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${LEAGUE_RUN_LOCK}, hashtext(${r.orgId}))`);
        // Same key again under the lock: a double click waits here, then gets the first run instead of a limit refusal.
        const [same] = await tx.select().from(leagueRuns).where(and(eq(leagueRuns.organizationId, r.orgId), eq(leagueRuns.idemKey, r.idemKey))).limit(1);
        if (same) return { run: same, existing: true };
        const active = n(await tx.execute(sql`SELECT count(*)::int AS n FROM ${leagueRuns} WHERE organization_id = ${r.orgId} AND status IN ('queued', 'running', 'waiting')`));
        if (active >= r.limits.concurrent) throw new RunLimit("concurrent", r.limits.concurrent);
        // Runs that did real work count; a run that was cancelled before it started, or failed before doing anything, doesn't.
        const used = n(await tx.execute(sql`SELECT count(*)::int AS n FROM ${leagueRuns} WHERE organization_id = ${r.orgId} AND created_at >= ${r.limits.monthly.since.toISOString()}::timestamp
          AND NOT (status = 'cancelled' AND started_at IS NULL) AND NOT (status = 'failed' AND error_code IN ('not_started', 'limit'))`));
        if (used >= r.limits.monthly.max) throw new RunLimit("monthly", r.limits.monthly.max);
        const [row] = await tx.insert(leagueRuns).values({
          id: r.id, organizationId: r.orgId, userId: r.userId, bot: r.bot, task: r.task, input: r.input, status: "queued", idemKey: r.idemKey,
          source: r.source, scheduleId: r.scheduleId ?? null, createdAt: r.now, updatedAt: r.now,
        }).returning();
        await tx.insert(leagueRunEvents).values({ runId: r.id, organizationId: r.orgId, kind: "queued", message: "Task queued", createdAt: r.now });
        return { run: row, existing: false };
      });
    } catch (e) {
      if (isUnique(e)) { const p = await found(); if (p) return { run: p, existing: true }; }
      throw e;
    }
  },
  async getRun(orgId, userId, id) {
    const [r] = await db.select().from(leagueRuns).where(and(eq(leagueRuns.organizationId, orgId), eq(leagueRuns.userId, userId), eq(leagueRuns.id, id))).limit(1);
    return r ?? null;
  },
  async listRuns(orgId, userId, f) {
    return db.select().from(leagueRuns).where(and(
      eq(leagueRuns.organizationId, orgId), eq(leagueRuns.userId, userId),
      f.bot ? eq(leagueRuns.bot, f.bot) : undefined, f.task ? eq(leagueRuns.task, f.task) : undefined,
      f.status?.length ? inArray(leagueRuns.status, f.status) : undefined, f.since ? gte(leagueRuns.createdAt, f.since) : undefined,
    )).orderBy(desc(leagueRuns.createdAt)).limit(f.limit);
  },
  async events(orgId, runId, limit = 200) {
    return db.select().from(leagueRunEvents).where(and(eq(leagueRunEvents.organizationId, orgId), eq(leagueRunEvents.runId, runId))).orderBy(leagueRunEvents.id).limit(limit);
  },
  async addEvent(e) {
    await db.insert(leagueRunEvents).values({ runId: e.runId, organizationId: e.orgId, kind: e.kind.slice(0, 32), message: e.message.slice(0, 300), data: e.data ?? null, createdAt: e.now });
  },
  async requestCancel(orgId, userId, id, now) {
    const scope = and(eq(leagueRuns.organizationId, orgId), eq(leagueRuns.userId, userId), eq(leagueRuns.id, id));
    const [queued] = await db.update(leagueRuns).set({ status: "cancelled", finishedAt: now, updatedAt: now, leaseUntil: null }).where(and(scope, eq(leagueRuns.status, "queued"), sql`(${leagueRuns.leaseUntil} IS NULL OR ${leagueRuns.leaseUntil} < ${now.toISOString()}::timestamp)`)).returning();
    if (queued) { await leagueStore.addEvent({ runId: id, orgId, kind: "cancelled", message: "Cancelled before it started", now }); return queued; }
    const [asked] = await db.update(leagueRuns).set({ cancelRequested: true, updatedAt: now }).where(and(scope, inArray(leagueRuns.status, ACTIVE))).returning();
    return asked ?? (await leagueStore.getRun(orgId, userId, id));
  },
  async markRunRead(orgId, userId, id, now) {
    await db.update(leagueRuns).set({ readAt: now }).where(and(eq(leagueRuns.organizationId, orgId), eq(leagueRuns.userId, userId), eq(leagueRuns.id, id), sql`${leagueRuns.readAt} IS NULL`));
  },
  async usage(orgId, since) {
    const rows = await db.select({ bot: leagueRuns.bot, status: leagueRuns.status, tokensIn: leagueRuns.tokensIn, tokensOut: leagueRuns.tokensOut, startedAt: leagueRuns.startedAt, errorCode: leagueRuns.errorCode })
      .from(leagueRuns).where(and(eq(leagueRuns.organizationId, orgId), gte(leagueRuns.createdAt, since)));
    const counted = rows.filter((r) => !(r.status === "cancelled" && !r.startedAt) && !(r.status === "failed" && (r.errorCode === "not_started" || r.errorCode === "limit")));
    const byBot: Record<string, number> = { nibo: 0, mika: 0, zee: 0 };
    for (const r of counted) byBot[r.bot] = (byBot[r.bot] ?? 0) + 1;
    return { runs: counted.length, byBot, tokensIn: rows.reduce((a, r) => a + r.tokensIn, 0), tokensOut: rows.reduce((a, r) => a + r.tokensOut, 0), failed: rows.filter((r) => r.status === "failed").length };
  },

  async claim(now, leaseMs) {
    const until = new Date(now.getTime() + leaseMs).toISOString(), at = now.toISOString();
    const r = await db.execute(sql`UPDATE ${leagueRuns} SET lease_until = ${until}::timestamp, attempts = attempts + 1, updated_at = ${at}::timestamp,
        status = CASE WHEN status = 'queued' THEN 'running' ELSE status END, started_at = COALESCE(started_at, ${at}::timestamp)
      WHERE id = (SELECT id FROM ${leagueRuns} WHERE status IN ('queued', 'running', 'waiting') AND (lease_until IS NULL OR lease_until < ${at}::timestamp)
        ORDER BY updated_at LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING *`);
    const row = r.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    const run = (await leagueStore.peek(String(row.id)))!;
    return { ...run, fence: run.attempts };
  },
  async save(id, fence, p, now) {
    const set: Record<string, unknown> = { updatedAt: now };
    for (const k of ["status", "stage", "checkpoint", "report", "errorCode", "startedAt", "finishedAt"] as const) if (p[k] !== undefined) set[k] = p[k];
    if (p.tokensIn !== undefined) set.tokensIn = sql`${leagueRuns.tokensIn} + ${Math.max(0, Math.round(p.tokensIn))}`;
    if (p.tokensOut !== undefined) set.tokensOut = sql`${leagueRuns.tokensOut} + ${Math.max(0, Math.round(p.tokensOut))}`;
    if (p.status && !ACTIVE.includes(p.status)) set.leaseUntil = null;
    const r = await db.update(leagueRuns).set(set).where(and(eq(leagueRuns.id, id), eq(leagueRuns.attempts, fence), inArray(leagueRuns.status, ACTIVE))).returning({ id: leagueRuns.id });
    return r.length > 0;
  },
  async setLease(id, fence, until) {
    const r = await db.update(leagueRuns).set({ leaseUntil: until }).where(and(eq(leagueRuns.id, id), eq(leagueRuns.attempts, fence), inArray(leagueRuns.status, ACTIVE))).returning({ id: leagueRuns.id });
    return r.length > 0;
  },
  async nextWake(now) {
    const [r] = await db.select({ t: sql<Date | null>`min(${leagueRuns.leaseUntil})`.mapWith(leagueRuns.leaseUntil) }).from(leagueRuns)
      .where(and(inArray(leagueRuns.status, ACTIVE), sql`${leagueRuns.leaseUntil} > ${now.toISOString()}::timestamp`));
    return r?.t ?? null;
  },
  async peek(id) {
    const [r] = await db.select().from(leagueRuns).where(eq(leagueRuns.id, id)).limit(1);
    return r ?? null;
  },

  async schedules(orgId, userId) {
    return db.select().from(leagueSchedules).where(and(eq(leagueSchedules.organizationId, orgId), eq(leagueSchedules.userId, userId))).orderBy(leagueSchedules.id);
  },
  async getSchedule(orgId, userId, id) {
    const [r] = await db.select().from(leagueSchedules).where(and(eq(leagueSchedules.organizationId, orgId), eq(leagueSchedules.userId, userId), eq(leagueSchedules.id, id))).limit(1);
    return r ?? null;
  },
  async createSchedule(s) {
    const { now, ...rest } = s;
    const [r] = await db.insert(leagueSchedules).values({ ...rest, createdAt: now, updatedAt: now }).returning();
    return r;
  },
  async updateSchedule(orgId, userId, id, set) {
    const [r] = await db.update(leagueSchedules).set({ ...set, updatedAt: new Date() }).where(and(eq(leagueSchedules.organizationId, orgId), eq(leagueSchedules.userId, userId), eq(leagueSchedules.id, id))).returning();
    return r ?? null;
  },
  async deleteSchedule(orgId, userId, id) {
    const r = await db.delete(leagueSchedules).where(and(eq(leagueSchedules.organizationId, orgId), eq(leagueSchedules.userId, userId), eq(leagueSchedules.id, id))).returning({ id: leagueSchedules.id });
    return r.length > 0;
  },
  async countSchedules(orgId) {
    return n(await db.execute(sql`SELECT count(*)::int AS n FROM ${leagueSchedules} WHERE organization_id = ${orgId}`));
  },
  async claimDueSchedule(now, leaseMs) {
    const at = now.toISOString(), until = new Date(now.getTime() + leaseMs).toISOString();
    const r = await db.execute(sql`UPDATE ${leagueSchedules} SET lease_until = ${until}::timestamp
      WHERE id = (SELECT id FROM ${leagueSchedules} WHERE status = 'active' AND next_run_at <= ${at}::timestamp AND (lease_until IS NULL OR lease_until < ${at}::timestamp)
        ORDER BY next_run_at LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING id`);
    const id = (r.rows[0] as { id: unknown } | undefined)?.id;
    if (!id) return null;
    const [row] = await db.select().from(leagueSchedules).where(eq(leagueSchedules.id, Number(id))).limit(1);
    return row ?? null;
  },
  async advanceSchedule(id, takenSlot, set) {
    await db.update(leagueSchedules).set({ nextRunAt: set.nextRunAt, lastRunId: set.lastRunId, lastRunAt: set.lastRunId ? set.now : undefined, leaseUntil: null, updatedAt: set.now })
      .where(and(eq(leagueSchedules.id, id), eq(leagueSchedules.nextRunAt, takenSlot)));
  },
  async nextScheduleWake(now) {
    const [r] = await db.select({ t: sql<Date | null>`min(${leagueSchedules.nextRunAt})`.mapWith(leagueSchedules.nextRunAt) }).from(leagueSchedules)
      .where(and(eq(leagueSchedules.status, "active"), sql`${leagueSchedules.nextRunAt} IS NOT NULL`));
    if (!r?.t) return null;
    return r.t > now ? r.t : now;
  },

  async memory(orgId, userId) {
    return db.select().from(leagueMemory).where(and(eq(leagueMemory.organizationId, orgId), eq(leagueMemory.userId, userId))).orderBy(leagueMemory.bot, leagueMemory.key);
  },
  async setMemory(m) {
    const [r] = await db.insert(leagueMemory).values({ organizationId: m.orgId, userId: m.userId, bot: m.bot, key: m.key, value: m.value, source: m.source, updatedAt: m.now })
      .onConflictDoUpdate({ target: [leagueMemory.organizationId, leagueMemory.userId, leagueMemory.bot, leagueMemory.key], set: { value: m.value, source: m.source, updatedAt: m.now } }).returning();
    return r;
  },
  async deleteMemory(orgId, userId, id) {
    const r = await db.delete(leagueMemory).where(and(eq(leagueMemory.organizationId, orgId), eq(leagueMemory.userId, userId), eq(leagueMemory.id, id))).returning({ id: leagueMemory.id });
    return r.length > 0;
  },
};
