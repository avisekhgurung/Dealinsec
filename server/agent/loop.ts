/**
 * The agent loop: a small, explicit TypeScript loop — no framework.
 *
 *   user message → model (with tools) → tool calls → policy → run / ask the
 *   user → tool results back to the model → … → final reply.
 *
 * Pure with respect to I/O: the provider, the store and the tools are injected,
 * so the whole run (events, approvals, failures) is tested with fakes and no
 * database. Every event it emits marks work that has really just started or
 * finished; nothing here is a timer or a canned progress line.
 *
 * What the model can and cannot do:
 *  - It can only call the registered tools, with arguments zod validates.
 *  - A read tool runs. A mutation tool only `prepare`s: it validates and
 *    describes the change. The policy then either executes it (SAFE at
 *    autonomy 1) or stores an approval for the user to click.
 *  - The model never sees, supplies or alters the arguments of an approved
 *    action: execution reads the server-validated arguments from the approval.
 */
import crypto from "node:crypto";
import { ProviderError, type AIProvider, type ChatMessage } from "../copilot/provider";
import { toolSpecs } from "./jsonschema";
import { agentLog, summarizeArgs } from "./log";
import { authorizeCall, decide } from "./policy";
import { fenceUntrusted } from "./untrusted";
import type {
  AgentCard, AgentEvent, AgentState, AgentStore, AgentTool, AgentUser, AutonomyLevel, Channel,
  EmitEvent, RunStatus, ToolContext, ToolOutcome,
} from "./types";

export const APPROVAL_TTL_MS = 30 * 60_000;
const MAX_CALLS_PER_STEP = 6;
const TOOL_RESULT_CAP = 3000;

export interface RunDeps {
  provider: AIProvider;
  store: AgentStore;
  tools: readonly AgentTool[];
  /** System prompts, already built (identity, rules, knowledge, context). */
  systemMessages: string[];
  autonomy: AutonomyLevel;
  maxSteps?: number;
  maxMs?: number;
  maxTokens?: number;
}

export interface RunInput {
  sessionId: string;
  user: AgentUser & Record<string, any>;
  text: string;
  channel: Channel;
}

export interface RunResult {
  runId: string;
  status: RunStatus;
  reply: string;
  cards: AgentCard[];
  approvalIds: string[];
}

export const stableStringify = (v: unknown): string =>
  JSON.stringify(v, (_k, val) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => (a < b ? -1 : 1)))
      : val);

export const hashArgs = (args: Record<string, unknown>) =>
  crypto.createHash("sha256").update(stableStringify(args)).digest("hex");

/** A provider failure in words the user can act on. */
export function describeProviderFailure(err: unknown): { code: string; message: string } {
  if (err instanceof ProviderError) {
    if (err.code === "timeout") return { code: "provider_timeout", message: "The AI service took too long to answer." };
    if (err.code === "rate_limited") return { code: "provider_busy", message: "The AI service is busy right now." };
    return { code: "provider_unavailable", message: "I couldn't reach the AI service." };
  }
  return { code: "internal", message: "Something went wrong on our side while I was working." };
}

export async function runAgent(
  deps: RunDeps,
  input: RunInput,
  emitEvent: (e: AgentEvent) => void,
  signal?: AbortSignal,
): Promise<RunResult> {
  const { provider, store, tools, autonomy } = deps;
  const maxSteps = deps.maxSteps ?? 6;
  const maxMs = deps.maxMs ?? 90_000;
  const t0 = Date.now();
  const byName = new Map(tools.map((t) => [t.name, t]));
  const specs = toolSpecs(tools);

  const runId = await store.startRun({ sessionId: input.sessionId, user: input.user, provider: provider.name, model: provider.model });
  let seq = 0;
  const emit: EmitEvent = (type, data = {}) =>
    emitEvent({ type, runId, seq: ++seq, at: new Date().toISOString(), data });

  const ac = new AbortController();
  const onAbort = () => ac.abort("client");
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  const timer = setTimeout(() => ac.abort("budget"), maxMs);

  let steps = 0, tokensIn = 0, tokensOut = 0;
  let mutated = false;
  const cards: AgentCard[] = [];
  const approvalIds: string[] = [];
  const toolsUsed: string[] = [];
  const setState = (s: AgentState) => store.setSessionState(input.sessionId, s).catch(() => {});

  const finish = async (status: RunStatus, errorCode?: string | null) => {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    const latencyMs = Date.now() - t0;
    await store.finishRun(runId, { status, steps, tokensIn, tokensOut, latencyMs, errorCode: errorCode ?? null }).catch(() => {});
    agentLog("agent_run", { runId, sessionId: input.sessionId, organizationId: input.user.organizationId, userId: input.user.id, status, steps, tokensIn, tokensOut, latencyMs, tools: toolsUsed.length, errorCode: errorCode ?? undefined });
  };

  const fail = async (code: string, message: string, status: RunStatus = "failed"): Promise<RunResult> => {
    const suffix = mutated ? " The changes made before this point are saved." : " Nothing was changed.";
    const reply = `${message}${suffix}`;
    await store.addMessage({ sessionId: input.sessionId, runId, role: "assistant", content: reply, cards: cards.length ? cards : null }).catch(() => {});
    await setState(status === "cancelled" ? "WAITING_FOR_USER" : "FAILED");
    if (status === "cancelled") emit("agent.failed", { code, message: "Stopped.", cancelled: true });
    else emit("agent.failed", { code, message: reply });
    await finish(status, code);
    return { runId, status, reply, cards, approvalIds };
  };

  try {
    emit("agent.started", { sessionId: input.sessionId, channel: input.channel });
    await store.addMessage({ sessionId: input.sessionId, runId, role: "user", content: input.text });
    await setState("UNDERSTANDING");

    const history = await store.recentMessages(input.sessionId, 16);
    const userMessages = history.filter((m) => m.role === "user").map((m) => m.content);
    const userText = userMessages.join("\n");
    const messages: ChatMessage[] = [
      ...deps.systemMessages.map((content) => ({ role: "system" as const, content })),
      ...history.map((m) => ({ role: m.role, content: m.content })),
    ];

    const ctx: ToolContext = {
      user: input.user, sessionId: input.sessionId, runId, signal: ac.signal, userText, userMessages,
      progress: (message) => emit("agent.tool_progress", { message: String(message).slice(0, 120) }),
      addUsage: (i, o) => { tokensIn += i; tokensOut += o; },
    };

    emit("agent.understanding", {});

    // ── one tool call ────────────────────────────────────────────────────
    const handleCall = async (call: { id: string; name: string; arguments: any }): Promise<string> => {
      const started = Date.now();
      const tool = byName.get(call.name);
      const record = (status: string, extra: { risk?: AgentTool["risk"]; args?: unknown; summary?: string; code?: string } = {}) =>
        store.recordToolCall({
          runId, tool: call.name.slice(0, 48), risk: extra.risk ?? tool?.risk ?? "READ_ONLY", status,
          args: summarizeArgs(extra.args ?? call.arguments), resultSummary: extra.summary?.slice(0, 300) ?? null,
          errorCode: extra.code ?? null, durationMs: Date.now() - started,
        }).catch(() => {});
      toolsUsed.push(call.name);

      if (!tool || call.arguments?.__invalid) {
        emit("agent.tool_failed", { tool: call.name.slice(0, 48), code: "invalid", message: "I asked for something that doesn't exist." });
        await record("invalid", { code: "invalid" });
        return "TOOL_ERROR (invalid): unknown tool or unreadable arguments. Ask the user to clarify instead of guessing.";
      }
      const parsed = tool.input.safeParse(call.arguments ?? {});
      if (!parsed.success) {
        // Field names and rules only — never the values the model sent.
        const why = parsed.error.issues.slice(0, 4).map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
        emit("agent.tool_failed", { tool: tool.name, code: "invalid_arguments", message: "The details weren't usable." });
        await record("invalid", { code: "invalid_arguments" });
        return `TOOL_ERROR (invalid_arguments): ${why}. Ask the user for what is missing; do not guess.`;
      }
      const denied = authorizeCall(tool, input.user, parsed.data);
      if (denied) {
        emit("agent.tool_failed", { tool: tool.name, code: "denied", message: denied });
        await record("denied", { code: "denied", args: parsed.data });
        agentLog("tool_call", { runId, tool: tool.name, risk: tool.risk, status: "denied" });
        return `PERMISSION_DENIED: ${denied}`;
      }

      if (tool.activity === "extracting") emit("agent.extracting", { tool: tool.name });
      else if (tool.activity === "searching" || tool.risk === "READ_ONLY") emit("agent.searching", { tool: tool.name });
      emit("agent.tool_started", { tool: tool.name, risk: tool.risk });
      if (tool.risk === "READ_ONLY") await setState("RESEARCHING");

      let outcome: ToolOutcome;
      try {
        if (tool.risk === "READ_ONLY") {
          outcome = await tool.run!(ctx, parsed.data);
        } else {
          const prepared = await tool.prepare!(ctx, parsed.data);
          if (!prepared.ok) {
            outcome = { ok: false, code: prepared.code, message: prepared.message, route: prepared.route };
          } else if (decide(tool.risk, autonomy, prepared.forceApproval) === "run") {
            await setState("EXECUTING");
            emit("agent.executing", { tool: tool.name });
            outcome = await tool.execute!(ctx, prepared.args);
            if (outcome.ok) mutated = true;
          } else {
            await setState("DRAFTING");
            const approvalId = await store.createApproval({
              runId, sessionId: input.sessionId, user: input.user, tool: tool.name,
              args: prepared.args, argsHash: hashArgs(prepared.args), preview: prepared.preview,
              expiresAt: new Date(Date.now() + APPROVAL_TTL_MS),
            });
            approvalIds.push(approvalId);
            const card: AgentCard = {
              kind: "approval",
              data: { approvalId, tool: tool.name, risk: tool.risk, preview: prepared.preview, expiresInMinutes: APPROVAL_TTL_MS / 60_000 },
            };
            cards.push(card);
            emit("agent.needs_confirmation", { approvalId, tool: tool.name, risk: tool.risk, title: prepared.preview.title });
            await record("needs_approval", { args: parsed.data, summary: prepared.preview.title });
            agentLog("approval", { runId, approvalId, tool: tool.name, risk: tool.risk, status: "requested" });
            return fenceUntrusted(`tool:${tool.name}`,
              `Awaiting the user's approval: ${prepared.preview.title}. It has NOT been done. ` +
              "Tell the user it is ready for their approval; never say it was created, sent or completed.");
          }
        }
      } catch (err) {
        agentLog("error", { runId, tool: tool.name, errorType: (err as Error)?.name ?? "Error" });
        outcome = { ok: false, code: "tool_error", message: "That step failed unexpectedly." };
      }

      if (outcome.ok) {
        for (const c of outcome.cards ?? []) {
          cards.push(c);
          if (c.kind === "findings" && Array.isArray((c.data as any).findings)) {
            for (const f of (c.data as any).findings.slice(0, 10)) emit("agent.finding", { title: String(f?.title ?? "").slice(0, 120), level: f?.level });
          }
        }
        emit("agent.tool_completed", { tool: tool.name, route: outcome.route });
        await record("ok", { args: parsed.data, summary: outcome.summary });
        agentLog("tool_call", { runId, tool: tool.name, risk: tool.risk, status: "ok", durationMs: Date.now() - started });
        return fenceUntrusted(`tool:${tool.name}`, outcome.summary, TOOL_RESULT_CAP);
      }
      emit("agent.tool_failed", { tool: tool.name, code: outcome.code, message: outcome.message });
      await record("error", { args: parsed.data, code: outcome.code, summary: outcome.message });
      agentLog("tool_call", { runId, tool: tool.name, risk: tool.risk, status: "error", errorCode: outcome.code, durationMs: Date.now() - started });
      return `TOOL_ERROR (${outcome.code}): ${outcome.message}${outcome.route ? ` route:${outcome.route}` : ""}`;
    };


    let content: string | null = null;
    for (let step = 0; step < maxSteps; step++) {
      if (ac.signal.aborted) throw new ProviderError("aborted", "aborted");
      steps++;
      const result = await provider.chat(messages, specs, { signal: ac.signal, maxTokens: deps.maxTokens ?? 900 });
      tokensIn += result.usage?.inputTokens ?? 0;
      tokensOut += result.usage?.outputTokens ?? 0;

      if (!result.toolCalls.length) { content = result.content; break; }

      const calls = result.toolCalls.slice(0, MAX_CALLS_PER_STEP);
      messages.push({
        role: "assistant",
        content: result.content ?? "",
        tool_calls: calls.map((t) => ({ id: t.id, type: "function" as const, function: { name: t.name, arguments: JSON.stringify(t.arguments) } })),
      });

      const outputs = new Map<string, string>();
      const handle = async (call: (typeof calls)[number]) => {
        outputs.set(call.id, await handleCall(call));
      };
      // Independent reads run together; anything that writes or asks goes
      // afterwards, in the order the model gave it.
      const isRead = (c: (typeof calls)[number]) => byName.get(c.name)?.risk === "READ_ONLY";
      await Promise.all(calls.filter(isRead).map(handle));
      for (const c of calls.filter((c) => !isRead(c))) await handle(c);
      for (const c of calls) messages.push({ role: "tool", content: outputs.get(c.id) ?? "", tool_call_id: c.id });
    }

    // ── closing the run ──────────────────────────────────────────────────
    const waiting = approvalIds.length > 0;
    let reply = (content ?? "").trim();
    if (!reply && waiting) {
      reply = approvalIds.length === 1 ? "That's ready for your approval." : `${approvalIds.length} actions are ready for your approval.`;
    }
    if (!reply) {
      return await fail("step_limit", "I couldn't finish that within the limits I work to. Tell me where to pick it up, or try a smaller request.");
    }

    await store.addMessage({ sessionId: input.sessionId, runId, role: "assistant", content: reply, cards: cards.length ? cards : null });
    emit("agent.message", { text: reply, cards });
    const status: RunStatus = waiting ? "waiting_for_user" : "completed";
    await setState(waiting ? "WAITING_FOR_USER" : "COMPLETED");
    emit("agent.completed", { status, approvals: approvalIds.length });
    await finish(status);
    return { runId, status, reply, cards, approvalIds };
  } catch (err) {
    if ((err instanceof ProviderError && err.code === "aborted") || (ac.signal.aborted && ac.signal.reason === "client")) {
      return fail("cancelled", "Stopped.", "cancelled");
    }
    if (ac.signal.aborted && ac.signal.reason === "budget") {
      return fail("run_timeout", "That took longer than I'm allowed to spend on one request.");
    }
    const { code, message } = describeProviderFailure(err);
    agentLog("error", { runId, errorCode: code, errorType: (err as Error)?.name ?? "Error" });
    return fail(code, message);
  }
}
