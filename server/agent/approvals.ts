/**
 * Acting on an approval the user has clicked.
 *
 * The approval row holds the server-validated arguments from when it was
 * created; execution reads those and nothing the request carries. Claiming is
 * a single atomic step in the store, so a double click or two tabs can never
 * run the action twice. A failed action puts the approval back to pending
 * (nothing was written) so the user can retry — for example after upgrading.
 */
import { agentLog } from "./log";
import { authorizeCall } from "./policy";
import type { AgentCard, AgentEvent, AgentStore, AgentTool, AgentUser, EmitEvent, ToolContext } from "./types";

export interface ApprovalOutcome {
  status: number;
  ok: boolean;
  message: string;
  route?: string;
  replay?: boolean;
}

/** Runs the approval and always ends the stream with one final frame —
 *  `agent.completed` or `agent.failed` carrying the outcome — whichever way it
 *  went, so a client never has to infer the result from which events arrived. */
export async function executeApproval(
  deps: { store: AgentStore; tools: readonly AgentTool[] },
  user: AgentUser & Record<string, any>,
  approvalId: string,
  emitEvent: (e: AgentEvent) => void,
): Promise<ApprovalOutcome> {
  let seq = 0;
  let runId = "";
  const emit: EmitEvent = (type, data = {}) =>
    emitEvent({ type, runId, seq: ++seq, at: new Date().toISOString(), data });
  const out = await run(deps, user, approvalId, emit, (id) => { runId = id; });
  emit(out.ok ? "agent.completed" : "agent.failed", {
    final: true, ok: out.ok, status: out.status, message: out.message, route: out.route, replay: !!out.replay,
  });
  return out;
}

async function run(
  deps: { store: AgentStore; tools: readonly AgentTool[] },
  user: AgentUser & Record<string, any>,
  approvalId: string,
  emit: EmitEvent,
  setRunId: (id: string) => void,
): Promise<ApprovalOutcome> {
  const started = Date.now();
  const claim = await deps.store.claimApproval(approvalId, user);
  if (claim.kind === "not_found") return { status: 404, ok: false, message: "That request isn't available any more. Ask me again and I'll prepare it." };
  if (claim.kind === "expired") return { status: 410, ok: false, message: "That request expired. Ask me again and I'll prepare a fresh one." };
  if (claim.kind === "rejected") return { status: 409, ok: false, message: "That request was declined." };
  if (claim.kind === "busy") return { status: 409, ok: false, message: "That's already being done." };
  if (claim.kind === "replay") {
    const r = claim.result as { ok?: boolean; message?: string; route?: string };
    return { status: 200, ok: r.ok !== false, message: String(r.message ?? "Already done."), route: r.route, replay: true };
  }

  const { approval } = claim;
  setRunId(approval.runId);
  const tool = deps.tools.find((t) => t.name === approval.tool);
  const reopen = async (message: string, extra: Record<string, unknown> = {}) => {
    await deps.store.settleApproval(approval.id, "reopen", { ok: false, message, ...extra });
  };

  if (!tool || !tool.execute) {
    await reopen("That action isn't available.");
    return { status: 400, ok: false, message: "That action isn't available." };
  }
  // The role may have changed since the request was made.
  const denied = authorizeCall(tool, user, approval.args as any);
  if (denied) {
    await reopen(denied);
    return { status: 403, ok: false, message: `Your role doesn't allow this: ${denied}` };
  }

  emit("agent.started", { approvalId: approval.id, tool: tool.name });
  emit("agent.executing", { tool: tool.name });
  const ctx: ToolContext = {
    user, sessionId: approval.sessionId, runId: approval.runId, userText: "", userMessages: [],
    progress: (m) => emit("agent.tool_progress", { message: String(m).slice(0, 120) }),
  };
  let result;
  try {
    result = await tool.execute(ctx, approval.args);
  } catch {
    agentLog("error", { approvalId: approval.id, tool: tool.name, errorType: "ExecuteThrew" });
    await reopen("That didn't go through and nothing was changed. You can try again.");
    return { status: 500, ok: false, message: "That didn't go through and nothing was changed. You can try again." };
  }

  await deps.store.recordToolCall({
    runId: approval.runId, tool: tool.name, risk: tool.risk, status: result.ok ? "ok" : "error",
    args: null, resultSummary: result.ok ? result.summary : result.message,
    errorCode: result.ok ? null : result.code, durationMs: Date.now() - started,
  }).catch(() => {});

  if (!result.ok) {
    await reopen(result.message, { code: result.code });
    agentLog("approval", { approvalId: approval.id, tool: tool.name, status: "failed", errorCode: result.code });
    return { status: 403, ok: false, message: result.message, route: result.route };
  }

  await deps.store.settleApproval(approval.id, "executed", { ok: true, message: result.summary, route: result.route });
  const cards: AgentCard[] = result.cards ?? [];
  await deps.store.addMessage({ sessionId: approval.sessionId, runId: approval.runId, role: "assistant", content: result.summary, cards: cards.length ? cards : null });
  emit("agent.tool_completed", { tool: tool.name, route: result.route });
  emit("agent.message", { text: result.summary, cards, route: result.route });
  agentLog("approval", { approvalId: approval.id, tool: tool.name, status: "executed", durationMs: Date.now() - started });
  return { status: 200, ok: true, message: result.summary, route: result.route };
}
