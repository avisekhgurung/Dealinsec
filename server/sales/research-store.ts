/** Database store for research runs. Tests replace this module (eval/world-mocks.ts). Every query is scoped by organization. */
import { and, desc, eq, lt } from "drizzle-orm";
import { db } from "../db";
import { leadResearch, type LeadResearchRow } from "@shared/schema";
import { tablesReadyCheck } from "../leads/ready";

/** The sales agent needs both its own table and the model-call trace (daily allowances are counted from it). */
export const salesTablesReady = tablesReadyCheck(["lead_research", "llm_calls"]);

export interface PageNote { url: string; ok: boolean; note?: string }
export interface RunResult {
  status: "done" | "failed"; finishedAt: Date; pages: PageNote[]; claimIds: number[];
  summary?: unknown; errorCode?: string | null; model?: string | null; promptVersion?: string | null;
}
export class RunBusy extends Error { constructor() { super("research is already running for this lead"); } }

export interface ResearchStore {
  /** Starts a run, or throws RunBusy if one is already running for the lead. A run left "running" longer than `staleMs` is first marked failed (stale). */
  startRun(o: { orgId: string; leadId: number; by: "user" | "agent"; userId: string; now: Date; staleMs: number }): Promise<LeadResearchRow>;
  finish(orgId: string, id: number, r: RunResult): Promise<void>;
  latest(orgId: string, leadId: number): Promise<LeadResearchRow | null>;
}

export const researchStore: ResearchStore = {
  async startRun({ orgId, leadId, by, userId, now, staleMs }) {
    await db.update(leadResearch)
      .set({ status: "failed", errorCode: "stale", finishedAt: now })
      .where(and(eq(leadResearch.organizationId, orgId), eq(leadResearch.leadId, leadId), eq(leadResearch.status, "running"), lt(leadResearch.startedAt, new Date(now.getTime() - staleMs))));
    try {
      const [row] = await db.insert(leadResearch).values({ leadId, organizationId: orgId, status: "running", startedAt: now, createdBy: by, createdByUser: userId }).returning();
      return row;
    } catch (e) {
      // The partial unique index (one running run per lead) is what decides, not a check-then-insert.
      if ((e as { code?: string })?.code === "23505") throw new RunBusy();
      throw e;
    }
  },
  async finish(orgId, id, r) {
    await db.update(leadResearch)
      .set({ status: r.status, finishedAt: r.finishedAt, pages: r.pages, claimIds: r.claimIds, summary: r.summary ?? null, errorCode: r.errorCode ?? null, model: r.model ?? null, promptVersion: r.promptVersion ?? null })
      .where(and(eq(leadResearch.organizationId, orgId), eq(leadResearch.id, id), eq(leadResearch.status, "running")));
  },
  async latest(orgId, leadId) {
    const [row] = await db.select().from(leadResearch).where(and(eq(leadResearch.organizationId, orgId), eq(leadResearch.leadId, leadId))).orderBy(desc(leadResearch.startedAt), desc(leadResearch.id)).limit(1);
    return row ?? null;
  },
};
