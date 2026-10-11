/** Database store for the LLM trace. Tests replace this module (eval/world-mocks.ts). Metadata only. */
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { llmCalls } from "@shared/schema";
import { tablesReadyCheck } from "../leads/ready";
import { clipCodeOrNull } from "@shared/error-code";

export const llmTraceReady = tablesReadyCheck(["llm_calls"]);

export interface TraceRow {
  organizationId: string; userId?: string | null; task: string; model: string; promptVersion: string;
  tokensIn: number; tokensOut: number; latencyMs: number; costMicroUsd: number;
  ok: boolean; errorCode?: string | null; leadId?: number | null; runId?: string | null;
}
export interface TraceStore {
  record(row: TraceRow): Promise<void>;
  /** Successful calls for this workspace and task since `since` (what a daily allowance counts). */
  count(o: { orgId: string; task: string; since: Date }): Promise<number>;
  /** Estimated spend in millionths of a dollar since `since`. */
  spendMicroUsd(o: { orgId: string; since: Date }): Promise<number>;
  /**
   * The platform-wide budget, atomically: every workspace's model spend since `since` (settled calls at their cost, calls
   * in flight at their reserved estimate) plus `row.costMicroUsd` must stay within `overallMicroUsd`, AND the spend of the
   * row's allocation (the tasks in `poolTasks`) plus it within `poolMicroUsd`. Then the row is inserted as a reservation
   * and its id returned; otherwise null. Throws when the spend can't be counted (the caller refuses).
   */
  reserve(row: TraceRow, o: { since: Date; overallMicroUsd: number; poolMicroUsd: number; poolTasks: readonly string[] }): Promise<number | null>;
  /** Replaces a reservation with what the call really was (tokens, latency, actual cost, ok or its error). */
  settle(id: number, row: TraceRow): Promise<void>;
}

/**
 * Serialises check-then-reserve for the platform-wide model budget across every process: a transaction-scoped advisory
 * lock, held only for the count and the insert (milliseconds), never across the model call itself.
 */
export const GLOBAL_LLM_BUDGET_LOCK = 7_310_001;

export const traceStore: TraceStore = {
  async record(row) {
    // created_at is written from here, in UTC, not by DEFAULT now(): the column has no time zone, so the
    // database default would store its own local clock and a "last 24 hours" window would be off by the offset.
    await db.insert(llmCalls).values({ ...row, userId: row.userId ?? null, errorCode: clipCodeOrNull(row.errorCode), leadId: row.leadId ?? null, runId: row.runId ?? null, createdAt: new Date() });
  },
  async count({ orgId, task, since }) {
    const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(llmCalls)
      .where(and(eq(llmCalls.organizationId, orgId), eq(llmCalls.task, task), eq(llmCalls.ok, true), gte(llmCalls.createdAt, since)));
    return Number(r?.n ?? 0);
  },
  async reserve(row, { since, overallMicroUsd, poolMicroUsd, poolTasks }) {
    return db.transaction(async (tx) => {
      // One lock for both allocations and the ceiling: the three sums and the insert see one consistent ledger.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${GLOBAL_LLM_BUDGET_LOCK})`);
      const [r] = await tx.select({
        all: sql<string>`coalesce(sum(${llmCalls.costMicroUsd}), 0)::bigint`,
        pool: sql<string>`coalesce(sum(${llmCalls.costMicroUsd}) FILTER (WHERE ${inArray(llmCalls.task, [...poolTasks])}), 0)::bigint`,
      }).from(llmCalls).where(gte(llmCalls.createdAt, since));
      if (Number(r?.all ?? 0) + row.costMicroUsd > overallMicroUsd || Number(r?.pool ?? 0) + row.costMicroUsd > poolMicroUsd) return null;
      const [ins] = await tx.insert(llmCalls).values({ ...row, userId: row.userId ?? null, errorCode: clipCodeOrNull(row.errorCode), leadId: row.leadId ?? null, runId: row.runId ?? null, createdAt: new Date() }).returning({ id: llmCalls.id });
      return ins.id;
    });
  },
  async settle(id, row) {
    await db.update(llmCalls).set({ model: row.model, tokensIn: row.tokensIn, tokensOut: row.tokensOut, latencyMs: row.latencyMs, costMicroUsd: row.costMicroUsd, ok: row.ok, errorCode: clipCodeOrNull(row.errorCode) }).where(eq(llmCalls.id, id));
  },
  async spendMicroUsd({ orgId, since }) {
    const [r] = await db.select({ n: sql<number>`coalesce(sum(${llmCalls.costMicroUsd}), 0)::int` }).from(llmCalls)
      .where(and(eq(llmCalls.organizationId, orgId), gte(llmCalls.createdAt, since)));
    return Number(r?.n ?? 0);
  },
};
