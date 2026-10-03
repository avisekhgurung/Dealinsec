/**
 * A run, reduced to the facts the assertions and the metrics need. Built from
 * what the agent really did — the tool calls the store recorded, the approvals
 * it created, the world before and after — not from what its reply says it did.
 * Pure: it only reads the structures it is handed.
 */
export interface ToolStep {
  name: string;
  risk: string;
  /** ok | error | denied | invalid | needs_approval (from the audit row). */
  status: string;
  /** The redacted argument summary, as a stable string — for spotting repeats. */
  argsKey: string;
}

export interface Trajectory {
  /** The agent's final reply for each user turn. */
  replies: string[];
  /** Everything the user said, joined: the only source a value may legitimately come from. */
  userText: string;
  tools: ToolStep[];
  approvals: { tool: string; args: Record<string, any>; preview: Record<string, any> | null }[];
  /** Mutation tools that actually ran (not merely proposed). */
  executed: { tool: string; risk: string }[];
  steps: number;
  modelCalls: number;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  /** Any run ended failed (provider error, step limit, …). */
  failed: boolean;
  worldChanged: boolean;
  emailsSent: number;
}

/** The slice of MemoryAgentStore the trajectory reads. */
export interface StoreLike {
  toolCalls: { tool: string; risk: string; status: string; args?: Record<string, unknown> | null }[];
  approvals: Map<string, { tool: string; args: Record<string, unknown>; preview?: unknown }>;
  runs: Map<string, { status: string; steps?: number; tokensIn?: number; tokensOut?: number }>;
}

export function buildTrajectory(input: {
  store: StoreLike;
  replies: string[];
  userTurns: string[];
  modelCalls: number;
  latencyMs: number;
  worldBefore: string;
  worldAfter: string;
  emailsSent: number;
}): Trajectory {
  const { store } = input;
  const tools: ToolStep[] = store.toolCalls.map((c) => ({
    name: c.tool, risk: c.risk, status: c.status, argsKey: JSON.stringify(c.args ?? null),
  }));
  const runs = Array.from(store.runs.values());
  return {
    replies: input.replies,
    userText: input.userTurns.join("\n"),
    tools,
    approvals: Array.from(store.approvals.values()).map((a) => ({ tool: a.tool, args: a.args as Record<string, any>, preview: (a.preview as Record<string, any>) ?? null })),
    executed: tools.filter((t) => t.risk !== "READ_ONLY" && t.status === "ok").map((t) => ({ tool: t.name, risk: t.risk })),
    steps: runs.reduce((s, r) => s + (r.steps ?? 0), 0),
    modelCalls: input.modelCalls,
    tokensIn: runs.reduce((s, r) => s + (r.tokensIn ?? 0), 0),
    tokensOut: runs.reduce((s, r) => s + (r.tokensOut ?? 0), 0),
    latencyMs: input.latencyMs,
    failed: runs.some((r) => r.status === "failed"),
    worldChanged: input.worldBefore !== input.worldAfter,
    emailsSent: input.emailsSent,
  };
}
