/**
 * Every model call made for a sales feature goes through here: it picks the task's model,
 * enforces the workspace's daily allowance and the platform-wide daily budget, times the call and records what happened (task,
 * model, prompt version, tokens, latency, estimated cost, ok or error). It never records the
 * prompt or the reply. A trace that cannot be completed never fails the call; an allowance or a
 * budget that cannot be counted (or reserved) refuses it (fail closed), because those are the cost control.
 */
import { ProviderError, aiProvider, type AIProvider, type ChatMessage, type ChatOptions, type ChatResult } from "../copilot/provider";
import { budgetPoolOf, costMicroUsd, dailyLimit, globalDailySpendMicroUsd, modelFor, poolDailySpendMicroUsd, poolTasks, pricesFromEnv, utcDayStart, type BudgetPool, type LlmTask } from "@shared/llm-cost";
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
/**
 * The platform-wide model budget for today (every workspace together) is used up: the task's own allocation (`pool`:
 * AI Outbound or the other metered features) or the overall ceiling. It IS a CapExceeded, so every caller that already
 * stops cleanly on a workspace's limit stops on this too; `code` tells the two apart.
 */
export class GlobalCapExceeded extends CapExceeded {
  readonly code = "global_limit";
  constructor(task: LlmTask, limitMicroUsd: number, readonly pool: BudgetPool = budgetPoolOf(task)) { super(task, limitMicroUsd, limitMicroUsd); this.message = `today's platform-wide AI budget for ${pool === "outbound" ? "AI Outbound" : "lead research and drafting"} is used up`; }
}

/** An output budget asked for when the caller sets none: the reservation must not be smaller than what a call could cost. */
const DEFAULT_MAX_OUTPUT_TOKENS = 8000;
/**
 * An upper bound on what one call can cost, reserved before it is made: the prompt at about 3 characters a token (an
 * over-count for English) plus the whole output budget asked for. Replaced by the real cost when the call returns.
 */
export function estimateCallMicroUsd(messages: ChatMessage[], maxTokens: number | undefined, env: Record<string, string | undefined> = process.env): number {
  const chars = messages.reduce((n, m) => n + String((m as any).content ?? "").length, 0);
  return Math.max(1, costMicroUsd(Math.ceil(chars / 3), maxTokens && maxTokens > 0 ? maxTokens : DEFAULT_MAX_OUTPUT_TOKENS, pricesFromEnv(env)));
}

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

/**
 * A tool-less chat call, traced. In order: the workspace's allowance for the task (CapExceeded); then the platform-wide
 * daily budget, by atomically reserving an upper-bound estimate (GlobalCapExceeded when it would pass the budget,
 * CapUnavailable when spend can't be counted: fail closed, the provider is never called); then the call; then the
 * reservation is settled at the real cost (a failed call costs nothing). Errors from the provider are rethrown after being recorded.
 */
export async function tracedChat(ctx: TraceCtx, messages: ChatMessage[], opts: ChatOptions = {}, deps: Partial<TraceDeps> = {}, env: Record<string, string | undefined> = process.env): Promise<ChatResult> {
  const d = { ...defaultDeps(), ...deps };
  await assertWithinCap(ctx.task, ctx.orgId, d, env);
  const model = opts.model ?? modelFor(ctx.task, env);
  const base = { organizationId: ctx.orgId, userId: ctx.userId ?? null, task: ctx.task, model, promptVersion: ctx.promptVersion, leadId: ctx.leadId ?? null, runId: ctx.runId ?? null };
  // The task's allocation and the overall ceiling are checked together, in one atomic reservation.
  const pool = budgetPoolOf(ctx.task), limit = poolDailySpendMicroUsd(pool, env);
  let reservation: number | null;
  try {
    reservation = await d.store.reserve({ ...base, tokensIn: 0, tokensOut: 0, latencyMs: 0, costMicroUsd: estimateCallMicroUsd(messages, opts.maxTokens, env), ok: false, errorCode: "reserved" },
      { since: utcDayStart(d.now()), overallMicroUsd: globalDailySpendMicroUsd(env), poolMicroUsd: limit, poolTasks: poolTasks(pool) });
  } catch { throw new CapUnavailable(); }
  if (reservation === null) throw new GlobalCapExceeded(ctx.task, limit, pool);
  const id = reservation;
  const started = d.now();
  const write = async (ok: boolean, usage: { inputTokens: number; outputTokens: number } | undefined, errorCode: string | null) => {
    const tokensIn = usage?.inputTokens ?? 0, tokensOut = usage?.outputTokens ?? 0;
    try {
      await d.store.settle(id, { ...base, tokensIn, tokensOut, latencyMs: Math.max(0, d.now() - started), costMicroUsd: costMicroUsd(tokensIn, tokensOut, pricesFromEnv(env)), ok, errorCode });
    } catch (e) {
      // Never the text, never fails the call. The reservation keeps its (larger) estimate: the budget errs on the safe side.
      d.log("llm_trace_error", { task: ctx.task, errorType: (e as Error)?.name ?? "Error" });
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
