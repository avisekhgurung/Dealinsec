/** Database store for the LLM trace. Tests replace this module (eval/world-mocks.ts). Metadata only. */
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../db";
import { llmCalls } from "@shared/schema";
import { tablesReadyCheck } from "../leads/ready";

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
}

export const traceStore: TraceStore = {
  async record(row) {
    // created_at is written from here, in UTC, not by DEFAULT now(): the column has no time zone, so the
    // database default would store its own local clock and a "last 24 hours" window would be off by the offset.
    await db.insert(llmCalls).values({ ...row, userId: row.userId ?? null, errorCode: row.errorCode ?? null, leadId: row.leadId ?? null, runId: row.runId ?? null, createdAt: new Date() });
  },
  async count({ orgId, task, since }) {
    const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(llmCalls)
      .where(and(eq(llmCalls.organizationId, orgId), eq(llmCalls.task, task), eq(llmCalls.ok, true), gte(llmCalls.createdAt, since)));
    return Number(r?.n ?? 0);
  },
  async spendMicroUsd({ orgId, since }) {
    const [r] = await db.select({ n: sql<number>`coalesce(sum(${llmCalls.costMicroUsd}), 0)::int` }).from(llmCalls)
      .where(and(eq(llmCalls.organizationId, orgId), gte(llmCalls.createdAt, since)));
    return Number(r?.n ?? 0);
  },
};
