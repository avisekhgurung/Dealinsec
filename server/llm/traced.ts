/**
 * Every model call made for a sales feature goes through here: it picks the task's model,
 * enforces the workspace's daily allowance, times the call and records what happened (task,
 * model, prompt version, tokens, latency, estimated cost, ok or error). It never records the
 * prompt or the reply. A trace that cannot be written never fails the call; an allowance that
 * cannot be counted refuses it (fail closed), because that allowance is the cost control.
 */
import { ProviderError, aiProvider, type AIProvider, type ChatMessage, type ChatOptions, type ChatResult } from "../copilot/provider";
import { costMicroUsd, dailyLimit, modelFor, pricesFromEnv, type LlmTask } from "@shared/llm-cost";
import { traceStore, type TraceStore } from "./trace-store";

export interface TraceCtx {
  task: LlmTask; orgId: string; userId?: string | null; leadId?: number | null; runId?: string | null;
  /** Bump when the prompt changes, so a change in results can be tied to a change in the prompt. */
  promptVersion: string;
}
export interface TraceDeps { provider: AIProvider; store: TraceStore; now: () => number; log: (kind: string, fields: Record<string, unknown>) => void }

const DAY_MS = 86_400_000;
const defaultDeps = (): TraceDeps => ({ provider: aiProvider, store: traceStore, now: Date.now, log: (kind, fields) => console.log(JSON.stringify({ kind, ...fields })) });

export class CapExceeded extends Error {
  constructor(public task: LlmTask, public used: number, public limit: number) { super(`daily limit for ${task} reached (${used}/${limit})`); }
}
export class CapUnavailable extends Error { constructor() { super("the daily allowance could not be checked"); } }

/** Throws CapExceeded when the workspace has used its allowance for this task in the last 24 hours, CapUnavailable if that cannot be counted. */
export async function assertWithinCap(task: LlmTask, orgId: string, deps: Partial<TraceDeps> = {}, env: Record<string, string | undefined> = process.env): Promise<void> {
  const d = { ...defaultDeps(), ...deps };
  const limit = dailyLimit(task, env);
  let used: number;
  try { used = await d.store.count({ orgId, task, since: new Date(d.now() - DAY_MS) }); } catch { throw new CapUnavailable(); }
  if (used >= limit) throw new CapExceeded(task, used, limit);
}

/** How many calls of this task the workspace may still make in the rolling 24 hours (0 when used up; throws CapUnavailable if it can't be counted). */
export async function remainingToday(task: LlmTask, orgId: string, deps: Partial<TraceDeps> = {}, env: Record<string, string | undefined> = process.env): Promise<number> {
  const d = { ...defaultDeps(), ...deps };
  let used: number;
  try { used = await d.store.count({ orgId, task, since: new Date(d.now() - DAY_MS) }); } catch { throw new CapUnavailable(); }
  return Math.max(0, dailyLimit(task, env) - used);
}

/** A tool-less chat call, traced. The task's allowance is checked first; errors from the provider are rethrown after being recorded. */
export async function tracedChat(ctx: TraceCtx, messages: ChatMessage[], opts: ChatOptions = {}, deps: Partial<TraceDeps> = {}, env: Record<string, string | undefined> = process.env): Promise<ChatResult> {
  const d = { ...defaultDeps(), ...deps };
  await assertWithinCap(ctx.task, ctx.orgId, d, env);
  const model = opts.model ?? modelFor(ctx.task, env);
  const started = d.now();
  const write = async (ok: boolean, usage: { inputTokens: number; outputTokens: number } | undefined, errorCode: string | null) => {
    const tokensIn = usage?.inputTokens ?? 0, tokensOut = usage?.outputTokens ?? 0;
    try {
      await d.store.record({
        organizationId: ctx.orgId, userId: ctx.userId ?? null, task: ctx.task, model, promptVersion: ctx.promptVersion,
        tokensIn, tokensOut, latencyMs: Math.max(0, d.now() - started), costMicroUsd: costMicroUsd(tokensIn, tokensOut, pricesFromEnv(env)),
        ok, errorCode, leadId: ctx.leadId ?? null, runId: ctx.runId ?? null,
      });
    } catch (e) {
      d.log("llm_trace_error", { task: ctx.task, errorType: (e as Error)?.name ?? "Error" }); // never the text, never fails the call
    }
  };
  try {
    const result = await d.provider.chat(messages, [], { ...opts, model });
    await write(true, result.usage, null);
    return result;
  } catch (e) {
    await write(false, undefined, e instanceof ProviderError ? e.code : "internal");
    throw e;
  }
}
