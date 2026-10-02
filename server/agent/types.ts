/**
 * DealInSec agent — shared types. Pure: no database, no network, so the loop,
 * the policy and the tests can all import it.
 *
 * The agent is an orchestration layer ON TOP of the existing domain services.
 * It never writes to the database itself: a tool either reads, or it prepares a
 * change that the existing service validates and executes (after an approval
 * when the policy says so).
 */
import type { z } from "zod";

/** What a tool can do to the world. Decides whether it may run unasked. */
export type Risk = "READ_ONLY" | "SAFE_MUTATION" | "CONSEQUENTIAL_MUTATION";

/** 0 = ask before every change · 1 = may run SAFE internal changes unasked.
 *  2 and 3 (approved external actions / predefined workflows) are not built and
 *  are rejected by the settings API. */
export type AutonomyLevel = 0 | 1;
export const MAX_AUTONOMY: AutonomyLevel = 1;

export type RunStatus = "running" | "waiting_for_user" | "completed" | "failed" | "cancelled";

/** Coarse phase of a conversation, shown to the user as a label. */
export type AgentState =
  | "DISCOVERING" | "UNDERSTANDING" | "RESEARCHING" | "DRAFTING" | "WAITING_FOR_USER"
  | "NEGOTIATING" | "READY_TO_CLOSE" | "EXECUTING" | "WAITING_FOR_EXTERNAL_REPLY"
  | "COMPLETED" | "FAILED";

export type Channel = "web" | "voice" | "email";

/** The user as the agent sees them: the authenticated session user, nothing the
 *  model or the client supplied. */
export interface AgentUser {
  id: string;
  organizationId: string | null;
  orgRole?: string | null;
  customPermissions?: string[] | null;
  firstName?: string | null;
}

// The wire format lives in shared/agent.ts so the browser uses the same types.
export { AGENT_EVENT_TYPES } from "@shared/agent";
export type { AgentEvent, AgentEventType, ApprovalPreview, AgentCard } from "@shared/agent";
import type { AgentEvent, AgentEventType, ApprovalPreview, AgentCard } from "@shared/agent";

export type EmitEvent = (type: AgentEventType, data?: Record<string, unknown>) => void;

export type ToolOutcome =
  | { ok: true; summary: string; data?: unknown; cards?: AgentCard[]; route?: string }
  | { ok: false; code: string; message: string; route?: string };

/** What a mutation tool's `prepare` returns: the server-validated arguments and
 *  a plain-language preview, with nothing written yet. */
export type Prepared =
  | {
      ok: true;
      args: Record<string, unknown>;
      preview: ApprovalPreview;
      /** Ask the user even where the autonomy level would let this run — for a
       *  change with a cost the user has not agreed to (a monthly credit). */
      forceApproval?: boolean;
    }
  | { ok: false; code: string; message: string; route?: string };

export interface ToolContext {
  user: AgentUser & Record<string, any>;
  sessionId: string;
  runId: string;
  signal?: AbortSignal;
  /** The user's own messages in this conversation, for checking extracted
   *  values against what was actually said. */
  userText: string;
  /** The same messages one by one, oldest first. */
  userMessages: string[];
  progress: (message: string) => void;
  /** A tool that makes its own model call reports the tokens it used. */
  addUsage?: (inputTokens: number, outputTokens: number) => void;
}

export interface AgentTool<I = any> {
  name: string;
  description: string;
  risk: Risk;
  /** Validates the model's arguments. Anything that fails never reaches `run`. */
  input: z.ZodType<I, z.ZodTypeDef, any>;
  /** Which activity label to stream while the tool runs. */
  activity?: "searching" | "extracting";
  /** Gate: null when the user may use this tool, otherwise the reason. Checked
   *  before `run`/`prepare` and again before an approved action executes. */
  authorize(user: AgentUser, input: I): string | null;
  /** READ_ONLY tools only. */
  run?(ctx: ToolContext, input: I): Promise<ToolOutcome>;
  /** Mutation tools only: validate and describe the change without writing. */
  prepare?(ctx: ToolContext, input: I): Promise<Prepared>;
  /** Mutation tools only: perform the change through the existing service,
   *  with the arguments `prepare` returned. Re-validates (the world may have
   *  changed since the approval was created). */
  execute?(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolOutcome>;
}

/** Everything the loop needs from persistence. The database implementation is
 *  server/agent/store.ts; tests use the in-memory one. */
export interface AgentStore {
  addMessage(m: { sessionId: string; runId?: string | null; role: "user" | "assistant"; content: string; cards?: AgentCard[] | null }): Promise<void>;
  recentMessages(sessionId: string, limit: number): Promise<{ role: "user" | "assistant"; content: string }[]>;
  startRun(r: { sessionId: string; user: AgentUser; provider: string; model: string }): Promise<string>;
  finishRun(runId: string, r: { status: RunStatus; steps: number; tokensIn: number; tokensOut: number; latencyMs: number; errorCode?: string | null }): Promise<void>;
  recordToolCall(c: { runId: string; tool: string; risk: Risk; status: string; args?: Record<string, unknown> | null; resultSummary?: string | null; errorCode?: string | null; durationMs: number }): Promise<void>;
  createApproval(a: { runId: string; sessionId: string; user: AgentUser; tool: string; args: Record<string, unknown>; argsHash: string; preview: ApprovalPreview; expiresAt: Date }): Promise<string>;
  setSessionState(sessionId: string, state: AgentState, title?: string | null): Promise<void>;
  /** Single-use claim of a pending approval for this user. At most one caller
   *  ever gets `claimed` for a given approval. */
  claimApproval(id: string, user: AgentUser): Promise<ClaimResult>;
  /** After running the approved action: `executed` closes it for good;
   *  `reopen` puts it back to pending so the user can retry (nothing was
   *  written — for example an upgrade is needed first). */
  settleApproval(id: string, outcome: "executed" | "reopen", result: Record<string, unknown>): Promise<void>;
  rejectApproval(id: string, user: AgentUser): Promise<boolean>;
}

export type ClaimResult =
  | { kind: "claimed"; approval: ApprovalRecord }
  | { kind: "replay"; result: Record<string, unknown> }
  | { kind: "busy" }
  | { kind: "expired" }
  | { kind: "rejected" }
  | { kind: "not_found" };

export interface ApprovalRecord {
  id: string;
  runId: string;
  sessionId: string;
  organizationId: string;
  userId: string;
  tool: string;
  args: Record<string, unknown>;
  argsHash: string;
  status: "pending" | "approved" | "rejected" | "expired" | "executed";
  result: Record<string, unknown> | null;
  expiresAt: Date;
}
