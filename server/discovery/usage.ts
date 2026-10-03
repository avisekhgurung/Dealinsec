/**
 * How many company searches have run, from the agent's existing audit rows (a
 * search is a tool call named find_companies that succeeded). No table of its
 * own. Rolling windows, so "per day" means "in the last 24 hours".
 */
import { and, count, eq, gte } from "drizzle-orm";
import { db } from "../db";
import { agentRuns, agentToolCalls } from "@shared/schema";

export async function searchCount(o: { since: Date; orgId?: string }): Promise<number> {
  const [row] = await db.select({ n: count() }).from(agentToolCalls)
    .innerJoin(agentRuns, eq(agentRuns.id, agentToolCalls.runId))
    .where(and(eq(agentToolCalls.tool, "find_companies"), eq(agentToolCalls.status, "ok"), gte(agentToolCalls.createdAt, o.since), o.orgId ? eq(agentRuns.organizationId, o.orgId) : undefined));
  return Number(row?.n ?? 0);
}
