/**
 * Estimated model cost. DeepSeek bills per million tokens; these are the
 * published list prices at the time of writing, kept in ONE place and
 * overridable from the environment because prices change. The figures are an
 * ESTIMATE: cache-hit discounts are not modelled (input is priced as a cache
 * miss, an upper bound).
 */
export interface Prices {
  /** USD per million input tokens. */
  inputPerM: number;
  /** USD per million output tokens. */
  outputPerM: number;
}

export const DEFAULT_PRICES: Prices = { inputPerM: 0.27, outputPerM: 1.1 };

export function pricesFromEnv(env: Record<string, string | undefined> = process.env): Prices {
  const num = (v: string | undefined, fallback: number) => (v !== undefined && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : fallback);
  return { inputPerM: num(env.EVAL_PRICE_IN, DEFAULT_PRICES.inputPerM), outputPerM: num(env.EVAL_PRICE_OUT, DEFAULT_PRICES.outputPerM) };
}

export function estimateCostUsd(tokensIn: number, tokensOut: number, prices: Prices = DEFAULT_PRICES): number {
  return (tokensIn * prices.inputPerM + tokensOut * prices.outputPerM) / 1_000_000;
}
