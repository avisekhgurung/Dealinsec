/**
 * Database implementation of AgentStore (and the session CRUD the routes use).
 * Imports the database, so it is never imported by the pure modules or tests.
 *
 * Every query that touches a session, run or approval is scoped by the caller's
 * organization AND user: a foreign id behaves exactly like an unknown one.
 */
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  agentApprovals, agentMessages, agentRuns, agentSessions, agentSettings, agentToolCalls,
  type AgentSession,
} from "@shared/schema";
import { normalizeAutonomy } from "./policy";
import type { AgentCard, AgentState, AgentStore, AgentUser, ApprovalRecord, AutonomyLevel, ClaimResult } from "./types";

const TABLES = ["agent_sessions", "agent_messages", "agent_runs", "agent_tool_calls", "agent_approvals", "agent_settings"];

/** Are the agent's tables there? Read-only. A positive answer is cached for
 *  good; a negative one for 30s, so running the migration switches the agent on
 *  without a restart. Concurrent callers share one in-flight check — otherwise
 *  the second of two simultaneous first requests would read "not yet checked"
 *  as "not ready". */
let ready = false;
let lastCheck = 0;
let inflight: Promise<boolean> | null = null;
export function agentTablesReady(): Promise<boolean> {
  if (ready) return Promise.resolve(true);
  if (inflight) return inflight;
  if (lastCheck && Date.now() - lastCheck < 30_000) return Promise.resolve(false);
  inflight = (async () => {
    try {
      const r = await db.execute(sql`
        SELECT count(*)::int AS n FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name IN (${sql.join(TABLES.map((t) => sql`${t}`), sql`, `)})`);
      ready = Number((r.rows?.[0] as any)?.n) === TABLES.length;
      return ready;
    } finally {
      lastCheck = Date.now();
      inflight = null;
    }
  })();
  return inflight;
}

const scope = (user: AgentUser) => and(
  eq(agentSessions.organizationId, user.organizationId ?? ""),
  eq(agentSessions.userId, user.id),
);

export class DbAgentStore implements AgentStore {
  async addMessage(m: Parameters<AgentStore["addMessage"]>[0]) {
    await db.insert(agentMessages).values({
      sessionId: m.sessionId, runId: m.runId ?? null, role: m.role,
      content: m.content.slice(0, 20_000), cards: (m.cards as unknown[] | undefined) ?? null,
    });
    await db.update(agentSessions).set({ updatedAt: new Date() }).where(eq(agentSessions.id, m.sessionId));
  }

  async recentMessages(sessionId: string, limit: number) {
    const rows = await db.select({ role: agentMessages.role, content: agentMessages.content })
      .from(agentMessages).where(eq(agentMessages.sessionId, sessionId))
      .orderBy(desc(agentMessages.id)).limit(limit);
    return rows.reverse().map((r) => ({ role: r.role as "user" | "assistant", content: r.content }));
  }

  async startRun(r: Parameters<AgentStore["startRun"]>[0]) {
    const [row] = await db.insert(agentRuns).values({
      sessionId: r.sessionId, organizationId: r.user.organizationId ?? "", userId: r.user.id,
      provider: r.provider, model: r.model,
    }).returning({ id: agentRuns.id });
    return row.id;
  }

  async finishRun(runId: string, r: Parameters<AgentStore["finishRun"]>[1]) {
    await db.update(agentRuns).set({
      status: r.status, steps: r.steps, tokensIn: r.tokensIn, tokensOut: r.tokensOut,
      latencyMs: r.latencyMs, errorCode: r.errorCode ?? null, finishedAt: new Date(),
    }).where(eq(agentRuns.id, runId));
  }

  async recordToolCall(c: Parameters<AgentStore["recordToolCall"]>[0]) {
    await db.insert(agentToolCalls).values({
      runId: c.runId, tool: c.tool, risk: c.risk, status: c.status, args: c.args ?? null,
      resultSummary: c.resultSummary ?? null, errorCode: c.errorCode ?? null, durationMs: c.durationMs,
    });
  }

  async setSessionState(sessionId: string, state: AgentState, title?: string | null) {
    await db.update(agentSessions)
      .set({ state, updatedAt: new Date(), ...(title ? { title: title.slice(0, 120) } : {}) })
      .where(eq(agentSessions.id, sessionId));
  }

  async createApproval(a: Parameters<AgentStore["createApproval"]>[0]) {
    const [row] = await db.insert(agentApprovals).values({
      runId: a.runId, sessionId: a.sessionId, organizationId: a.user.organizationId ?? "", userId: a.user.id,
      tool: a.tool, args: a.args, argsHash: a.argsHash, preview: a.preview, expiresAt: a.expiresAt,
    }).returning({ id: agentApprovals.id });
    return row.id;
  }

  /** The single-use claim: one UPDATE that only matches a still-pending,
   *  unexpired approval that belongs to this user and organization. */
  async claimApproval(id: string, user: AgentUser): Promise<ClaimResult> {
    const owner = and(eq(agentApprovals.id, id), eq(agentApprovals.userId, user.id), eq(agentApprovals.organizationId, user.organizationId ?? ""));
    const [won] = await db.update(agentApprovals)
      .set({ status: "approved", decidedAt: new Date() })
      .where(and(owner, eq(agentApprovals.status, "pending"), gt(agentApprovals.expiresAt, new Date())))
      .returning();
    if (won) return { kind: "claimed", approval: toRecord(won) };
    const [row] = await db.select().from(agentApprovals).where(owner);
    if (!row) return { kind: "not_found" };
    if (row.status === "executed") return { kind: "replay", result: (row.result as Record<string, unknown>) ?? {} };
    if (row.status === "approved") return { kind: "busy" };
    if (row.status === "rejected") return { kind: "rejected" };
    await db.update(agentApprovals).set({ status: "expired" }).where(and(eq(agentApprovals.id, id), eq(agentApprovals.status, "pending")));
    return { kind: "expired" };
  }

  async settleApproval(id: string, outcome: "executed" | "reopen", result: Record<string, unknown>) {
    await db.update(agentApprovals)
      .set({ status: outcome === "executed" ? "executed" : "pending", result })
      .where(and(eq(agentApprovals.id, id), eq(agentApprovals.status, "approved")));
  }

  async rejectApproval(id: string, user: AgentUser) {
    const rows = await db.update(agentApprovals)
      .set({ status: "rejected", decidedAt: new Date() })
      .where(and(eq(agentApprovals.id, id), eq(agentApprovals.userId, user.id), eq(agentApprovals.organizationId, user.organizationId ?? ""), eq(agentApprovals.status, "pending")))
      .returning({ id: agentApprovals.id });
    return rows.length > 0;
  }

  // ── sessions (used by the routes) ────────────────────────────────────────

  async createSession(user: AgentUser, init: { channel?: string; dealId?: number | null } = {}): Promise<AgentSession> {
    const [row] = await db.insert(agentSessions).values({
      organizationId: user.organizationId ?? "", userId: user.id,
      channel: init.channel ?? "web", dealId: init.dealId ?? null,
    }).returning();
    return row;
  }

  async getSession(user: AgentUser, id: string): Promise<AgentSession | null> {
    const [row] = await db.select().from(agentSessions).where(and(eq(agentSessions.id, id), scope(user)));
    return row ?? null;
  }

  async listSessions(user: AgentUser, limit = 40) {
    return db.select({
      id: agentSessions.id, title: agentSessions.title, state: agentSessions.state,
      dealId: agentSessions.dealId, updatedAt: agentSessions.updatedAt,
    }).from(agentSessions).where(scope(user)).orderBy(desc(agentSessions.updatedAt)).limit(limit);
  }

  /** Messages plus the live status of every approval, so a reloaded page shows
   *  a card that was already approved as approved. */
  async transcript(session: AgentSession) {
    const [messages, approvals] = await Promise.all([
      db.select().from(agentMessages).where(eq(agentMessages.sessionId, session.id)).orderBy(agentMessages.id),
      db.select({
        id: agentApprovals.id, tool: agentApprovals.tool, status: agentApprovals.status,
        expiresAt: agentApprovals.expiresAt, result: agentApprovals.result,
      }).from(agentApprovals).where(eq(agentApprovals.sessionId, session.id)),
    ]);
    return {
      messages: messages.map((m) => ({ id: m.id, role: m.role, content: m.content, cards: (m.cards as AgentCard[] | null) ?? [], createdAt: m.createdAt })),
      approvals,
    };
  }

  /** Deletes the conversation and everything recorded about it. The deals,
   *  quotations and so on the agent created are NOT touched — they are the
   *  user's records now, and the activity log still names who made them. */
  async deleteSession(user: AgentUser, id: string): Promise<boolean> {
    const session = await this.getSession(user, id);
    if (!session) return false;
    await db.transaction(async (tx) => {
      const runIds = (await tx.select({ id: agentRuns.id }).from(agentRuns).where(eq(agentRuns.sessionId, id))).map((r) => r.id);
      if (runIds.length) await tx.delete(agentToolCalls).where(inArray(agentToolCalls.runId, runIds));
      await tx.delete(agentApprovals).where(eq(agentApprovals.sessionId, id));
      await tx.delete(agentRuns).where(eq(agentRuns.sessionId, id));
      await tx.delete(agentMessages).where(eq(agentMessages.sessionId, id));
      await tx.delete(agentSessions).where(eq(agentSessions.id, id));
    });
    return true;
  }

  // ── settings ─────────────────────────────────────────────────────────────

  async getAutonomy(organizationId: string): Promise<AutonomyLevel> {
    const [row] = await db.select({ level: agentSettings.autonomyLevel }).from(agentSettings).where(eq(agentSettings.organizationId, organizationId));
    return normalizeAutonomy(row?.level);
  }

  async setAutonomy(organizationId: string, level: AutonomyLevel) {
    await db.insert(agentSettings).values({ organizationId, autonomyLevel: level })
      .onConflictDoUpdate({ target: agentSettings.organizationId, set: { autonomyLevel: level, updatedAt: new Date() } });
  }
}

const toRecord = (r: typeof agentApprovals.$inferSelect): ApprovalRecord => ({
  id: r.id, runId: r.runId, sessionId: r.sessionId, organizationId: r.organizationId, userId: r.userId,
  tool: r.tool, args: r.args, argsHash: r.argsHash, status: r.status as ApprovalRecord["status"],
  result: (r.result as Record<string, unknown> | null) ?? null, expiresAt: r.expiresAt,
});

export const agentStore = new DbAgentStore();
