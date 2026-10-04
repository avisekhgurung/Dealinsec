/**
 * Estimated model cost, and which model a task uses. Pure.
 *
 * DeepSeek bills per million tokens; these are the published list prices at the
 * time of writing, kept in ONE place and overridable from the environment because
 * prices change. The figures are an ESTIMATE: cache-hit discounts are not modelled
 * (input is priced as a cache miss, an upper bound).
 */
export interface Prices {
  /** USD per million input tokens. */
  inputPerM: number;
  /** USD per million output tokens. */
  outputPerM: number;
}

export const DEFAULT_PRICES: Prices = { inputPerM: 0.27, outputPerM: 1.1 };

type Env = Record<string, string | undefined>;
const num = (v: string | undefined, fallback: number) => (v !== undefined && v.trim() !== "" && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : fallback);

/** LLM_PRICE_IN / LLM_PRICE_OUT, falling back to the eval's older EVAL_PRICE_* names, then the defaults. */
export function pricesFromEnv(env: Env = process.env): Prices {
  return {
    inputPerM: num(env.LLM_PRICE_IN, num(env.EVAL_PRICE_IN, DEFAULT_PRICES.inputPerM)),
    outputPerM: num(env.LLM_PRICE_OUT, num(env.EVAL_PRICE_OUT, DEFAULT_PRICES.outputPerM)),
  };
}

export function estimateCostUsd(tokensIn: number, tokensOut: number, prices: Prices = DEFAULT_PRICES): number {
  return (tokensIn * prices.inputPerM + tokensOut * prices.outputPerM) / 1_000_000;
}

/** The same estimate in millionths of a dollar, as a whole number: what the trace table stores. Never negative, never NaN. */
export function costMicroUsd(tokensIn: number, tokensOut: number, prices: Prices = DEFAULT_PRICES): number {
  const safe = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
  return Math.round(safe(tokensIn) * prices.inputPerM + safe(tokensOut) * prices.outputPerM);
}

/** What the sales features ask a model to do. Each can use a different model and has its own daily allowance. */
export const LLM_TASKS = ["research", "draft", "classify"] as const;
export type LlmTask = (typeof LLM_TASKS)[number];

const MODEL_ENV: Record<LlmTask, string> = { research: "SALES_RESEARCH_MODEL", draft: "SALES_DRAFT_MODEL", classify: "SALES_CLASSIFY_MODEL" };
const LIMIT_ENV: Record<LlmTask, string> = { research: "SALES_DAILY_RESEARCH_LIMIT", draft: "SALES_DAILY_DRAFT_LIMIT", classify: "SALES_DAILY_CLASSIFY_LIMIT" };
const DEFAULT_LIMIT: Record<LlmTask, number> = { research: 20, draft: 40, classify: 200 };

/** The task's own model if set, else the app's default model, else deepseek-chat. A model name is letters, digits and - . _ : / only. */
export function modelFor(task: LlmTask, env: Env = process.env): string {
  const ok = (v: string | undefined) => (v && /^[A-Za-z0-9._:/-]{1,80}$/.test(v.trim()) ? v.trim() : null);
  return ok(env[MODEL_ENV[task]]) ?? ok(env.DEEPSEEK_MODEL) ?? "deepseek-chat";
}

/** How many times a workspace may run this task in 24 hours. A whole number of at least 1; anything else is the default. */
export function dailyLimit(task: LlmTask, env: Env = process.env): number {
  const n = Number(env[LIMIT_ENV[task]]);
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_LIMIT[task];
}
