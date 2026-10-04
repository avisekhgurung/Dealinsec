import { describe, expect, it } from "vitest";
import { DEFAULT_PRICES, costMicroUsd, dailyLimit, estimateCostUsd, modelFor, pricesFromEnv } from "./llm-cost";

describe("cost", () => {
  it("prices input and output separately, per million tokens", () => {
    expect(estimateCostUsd(1_000_000, 0)).toBeCloseTo(0.27);
    expect(estimateCostUsd(0, 1_000_000)).toBeCloseTo(1.1);
    expect(costMicroUsd(1000, 100)).toBe(Math.round(1000 * 0.27 + 100 * 1.1));
  });
  it("is a whole, non-negative number whatever it is given", () => {
    for (const [a, b] of [[NaN, 5], [-10, -10], [Infinity, 1], [0, 0], [3.7, 2.2]] as const) {
      const c = costMicroUsd(a, b);
      expect(Number.isInteger(c) && c >= 0, `${a},${b}`).toBe(true);
    }
    expect(costMicroUsd(-10, 100)).toBe(110);
  });
  it("reads prices from the environment, new names first, and ignores nonsense", () => {
    expect(pricesFromEnv({})).toEqual(DEFAULT_PRICES);
    expect(pricesFromEnv({ LLM_PRICE_IN: "1", LLM_PRICE_OUT: "2" })).toEqual({ inputPerM: 1, outputPerM: 2 });
    expect(pricesFromEnv({ EVAL_PRICE_IN: "3" }).inputPerM).toBe(3);
    expect(pricesFromEnv({ LLM_PRICE_IN: "1", EVAL_PRICE_IN: "3" }).inputPerM).toBe(1);
    for (const bad of ["abc", "-1", "", " "]) expect(pricesFromEnv({ LLM_PRICE_IN: bad }).inputPerM, bad).toBe(DEFAULT_PRICES.inputPerM);
  });
});

describe("modelFor", () => {
  it("uses the task's own model, else deepseek-chat, and never inherits the app-wide model (it may be a reasoning model that returns nothing)", () => {
    expect(modelFor("research", {})).toBe("deepseek-chat");
    expect(modelFor("research", { DEEPSEEK_MODEL: "deepseek-flash" })).toBe("deepseek-chat");
    expect(modelFor("research", { DEEPSEEK_MODEL: "deepseek-flash", SALES_RESEARCH_MODEL: "deepseek-reasoner" })).toBe("deepseek-reasoner");
    expect(modelFor("draft", { SALES_RESEARCH_MODEL: "x-research" })).toBe("deepseek-chat");
  });
  it("ignores a model name that is not a plain identifier", () => {
    for (const bad of ["", "  ", "a b", "model;rm -rf", "x".repeat(81), "<script>"]) expect(modelFor("draft", { SALES_DRAFT_MODEL: bad }), bad).toBe("deepseek-chat");
    expect(modelFor("draft", { SALES_DRAFT_MODEL: " openai/gpt-4o-mini " })).toBe("openai/gpt-4o-mini");
  });
});

describe("dailyLimit", () => {
  it("has a default per task and takes a whole number of at least one from the environment", () => {
    expect(dailyLimit("research", {})).toBe(20);
    expect(dailyLimit("draft", {})).toBe(40);
    expect(dailyLimit("research", { SALES_DAILY_RESEARCH_LIMIT: "5" })).toBe(5);
    for (const bad of ["0", "-3", "2.5", "many", ""]) expect(dailyLimit("research", { SALES_DAILY_RESEARCH_LIMIT: bad }), bad).toBe(20);
  });
});
