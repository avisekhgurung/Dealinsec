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
export const LLM_TASKS = ["research", "draft", "classify", "negotiate"] as const;
export type LlmTask = (typeof LLM_TASKS)[number];

const MODEL_ENV: Record<LlmTask, string> = { research: "SALES_RESEARCH_MODEL", draft: "SALES_DRAFT_MODEL", classify: "SALES_CLASSIFY_MODEL", negotiate: "SALES_NEGOTIATE_MODEL" };
const LIMIT_ENV: Record<LlmTask, string> = { research: "SALES_DAILY_RESEARCH_LIMIT", draft: "SALES_DAILY_DRAFT_LIMIT", classify: "SALES_DAILY_CLASSIFY_LIMIT", negotiate: "SALES_DAILY_NEGOTIATE_LIMIT" };
const DEFAULT_LIMIT: Record<LlmTask, number> = { research: 20, draft: 40, classify: 200, negotiate: 20 };

/**
 * The task's own model (SALES_<TASK>_MODEL) if set, else DEFAULT_SALES_MODEL ("deepseek-flash", the DeepSeek Flash model, as the founder chose). Deliberately NOT the app-wide DEEPSEEK_MODEL:
 * that is often a reasoning model, which can spend a whole token budget "thinking" and return an empty reply, and these
 * tasks need strict JSON back. (Found the hard way: 2 of 8 real research runs came back empty on deepseek-flash.)
 * A model name is letters, digits and - . _ : / only.
 */
/**
 * The model router, as the founder specified it: DeepSeek Flash for the everyday work (research, classification, scoring
 * explanations, outreach, reply analysis), DeepSeek V4 Pro only for negotiation and other hard multi-step sales decisions.
 * "negotiate" is reserved for V3 (nothing calls it yet). If the provider names a model differently, set SALES_<TASK>_MODEL:
 * no code change needed.
 */
export const DEFAULT_SALES_MODEL = "deepseek-flash";
export const DEFAULT_MODEL: Record<LlmTask, string> = { research: DEFAULT_SALES_MODEL, draft: DEFAULT_SALES_MODEL, classify: DEFAULT_SALES_MODEL, negotiate: "deepseek-v4-pro" };
export function modelFor(task: LlmTask, env: Env = process.env): string {
  const v = env[MODEL_ENV[task]]?.trim();
  return v && /^[A-Za-z0-9._:/-]{1,80}$/.test(v) ? v : DEFAULT_MODEL[task];
}

/** How many times a workspace may run this task in 24 hours. A whole number of at least 1; anything else is the default. */
export function dailyLimit(task: LlmTask, env: Env = process.env): number {
  const n = Number(env[LIMIT_ENV[task]]);
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_LIMIT[task];
}
