/**
 * In-memory AgentStore with the same semantics as the database one (single-use
 * claim, expiry, reopen). Used by the tests; never imported by server code.
 */
import { randomUUID } from "node:crypto";
import type { AgentCard, AgentState, AgentStore, AgentUser, ApprovalPreview, ApprovalRecord, ClaimResult, RunStatus } from "./types";

export class MemoryAgentStore implements AgentStore {
  messages: { sessionId: string; runId?: string | null; role: "user" | "assistant"; content: string; cards?: AgentCard[] | null }[] = [];
  runs = new Map<string, { sessionId: string; userId: string; status: RunStatus; steps?: number; tokensIn?: number; tokensOut?: number; errorCode?: string | null }>();
  toolCalls: { runId: string; tool: string; risk: string; status: string; args?: Record<string, unknown> | null; resultSummary?: string | null; errorCode?: string | null }[] = [];
  approvals = new Map<string, ApprovalRecord & { preview: ApprovalPreview; settled?: Record<string, unknown> }>();
  states: { sessionId: string; state: AgentState }[] = [];
  now = () => Date.now();

  async addMessage(m: Parameters<AgentStore["addMessage"]>[0]) { this.messages.push(m); }
  async recentMessages(sessionId: string, limit: number) {
    return this.messages.filter((m) => m.sessionId === sessionId).slice(-limit).map(({ role, content }) => ({ role, content }));
  }
  async startRun(r: Parameters<AgentStore["startRun"]>[0]) {
    const id = randomUUID();
    this.runs.set(id, { sessionId: r.sessionId, userId: r.user.id, status: "running" });
    return id;
  }
  async finishRun(runId: string, r: Parameters<AgentStore["finishRun"]>[1]) {
    const run = this.runs.get(runId);
    if (run) Object.assign(run, { status: r.status, steps: r.steps, tokensIn: r.tokensIn, tokensOut: r.tokensOut, errorCode: r.errorCode ?? null });
  }
  async recordToolCall(c: Parameters<AgentStore["recordToolCall"]>[0]) { this.toolCalls.push(c); }
  async createApproval(a: Parameters<AgentStore["createApproval"]>[0]) {
    const id = randomUUID();
    this.approvals.set(id, {
      id, runId: a.runId, sessionId: a.sessionId, organizationId: a.user.organizationId ?? "", userId: a.user.id,
      tool: a.tool, args: a.args, argsHash: a.argsHash, status: "pending", result: null, expiresAt: a.expiresAt, preview: a.preview,
    });
    return id;
  }
  async setSessionState(sessionId: string, state: AgentState) { this.states.push({ sessionId, state }); }

  async claimApproval(id: string, user: AgentUser): Promise<ClaimResult> {
    const a = this.approvals.get(id);
    if (!a || a.userId !== user.id || a.organizationId !== (user.organizationId ?? "")) return { kind: "not_found" };
    if (a.status === "executed") return { kind: "replay", result: a.result ?? {} };
    if (a.status === "approved") return { kind: "busy" };
    if (a.status === "rejected") return { kind: "rejected" };
    if (a.expiresAt.getTime() <= this.now()) { a.status = "expired"; return { kind: "expired" }; }
    if (a.status === "expired") return { kind: "expired" };
    a.status = "approved";
    return { kind: "claimed", approval: { ...a } };
  }
  async settleApproval(id: string, outcome: "executed" | "reopen", result: Record<string, unknown>) {
    const a = this.approvals.get(id);
    if (!a) return;
    a.status = outcome === "executed" ? "executed" : "pending";
    a.result = result;
  }
  async rejectApproval(id: string, user: AgentUser) {
    const a = this.approvals.get(id);
    if (!a || a.userId !== user.id || a.status !== "pending") return false;
    a.status = "rejected";
    return true;
  }
}
