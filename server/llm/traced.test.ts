import { describe, expect, it, vi } from "vitest";

// The real store talks to the database; these tests inject a fake one.
vi.mock("./trace-store", () => ({ traceStore: {}, llmTraceReady: async () => true }));

import { ProviderError, type AIProvider, type ChatResult } from "../copilot/provider";
import { CapExceeded, CapUnavailable, GlobalCapExceeded, assertWithinCap, estimateCallMicroUsd, tracedChat, type TraceCtx, type TraceDeps } from "./traced";
import { globalDailySpendMicroUsd } from "@shared/llm-cost";
import type { TraceRow, TraceStore } from "./trace-store";

const CTX: TraceCtx = { task: "research", orgId: "org-1", userId: "u1", leadId: 7, promptVersion: "r1" };
const MSGS = [{ role: "system" as const, content: "SECRET PROMPT TEXT" }, { role: "user" as const, content: "private customer words" }];

function rig(over: { chat?: AIProvider["chat"]; used?: number; countFails?: boolean; settleFails?: boolean; reserveFails?: boolean; ledger?: { at: number; cost: number }[] } = {}) {
  const rows: TraceRow[] = []; const logs: any[] = []; const calls: any[] = [];
  let t = Date.UTC(2026, 9, 11, 12, 0, 0);
  // The platform-wide ledger: every reserved or settled call's cost, with when it was made.
  const ledger = over.ledger ?? [];
  const provider: AIProvider = { name: "fake", model: "m-default", chat: over.chat ?? (async (m, tools, o) => { calls.push({ m, tools, o }); t += 250; return { content: "ok", toolCalls: [], usage: { inputTokens: 1000, outputTokens: 200 } } as ChatResult; }) };
  const store: TraceStore = {
    record: async (r) => { rows.push(r); },
    count: async () => { if (over.countFails) throw new Error("table missing"); return over.used ?? 0; },
    spendMicroUsd: async () => 0,
    // Atomic like the database's: the check and the insert happen with nothing in between.
    reserve: async (r, o) => {
      if (over.reserveFails) throw new Error("db down");
      const used = ledger.filter((x) => x.at >= o.since.getTime()).reduce((n, x) => n + x.cost, 0);
      if (used + r.costMicroUsd > o.limitMicroUsd) return null;
      rows.push({ ...r }); ledger.push({ at: t, cost: r.costMicroUsd });
      return rows.length - 1;
    },
    settle: async (id, r) => { if (over.settleFails) throw new Error("table missing"); Object.assign(rows[id], r); ledger[ledger.length - rows.length + id] = { ...ledger[ledger.length - rows.length + id], cost: r.costMicroUsd }; },
  };
  const deps: Partial<TraceDeps> = { provider, store, now: () => t, log: (k, f) => logs.push({ k, ...f }) };
  return { rows, logs, calls, deps, ledger, advance: (ms: number) => { t += ms; } };
}

describe("tracedChat", () => {
  it("uses the task's model, sends no tools, and records tokens, latency and an estimated cost", async () => {
    const r = rig();
    const out = await tracedChat(CTX, MSGS, {}, r.deps, { SALES_RESEARCH_MODEL: "deepseek-reasoner" });
    expect(out.content).toBe("ok");
    expect(r.calls[0].o.model).toBe("deepseek-reasoner");
    expect(r.calls[0].tools).toEqual([]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ organizationId: "org-1", task: "research", model: "deepseek-reasoner", promptVersion: "r1", tokensIn: 1000, tokensOut: 200, latencyMs: 250, ok: true, errorCode: null, leadId: 7 });
    expect(r.rows[0].costMicroUsd).toBe(Math.round(1000 * 0.27 + 200 * 1.1));
  });
  it("never records the prompt or the reply", async () => {
    const r = rig(); await tracedChat(CTX, MSGS, {}, r.deps, {});
    const dump = JSON.stringify(r.rows) + JSON.stringify(r.logs);
    expect(dump).not.toMatch(/SECRET PROMPT|private customer/);
    expect(dump).not.toMatch(/:"ok"[,}]/); // the reply text, as a value
  });
  it("an explicit model in the options wins over the task's", async () => {
    const r = rig(); await tracedChat(CTX, MSGS, { model: "pinned" }, r.deps, { SALES_RESEARCH_MODEL: "other" });
    expect(r.calls[0].o.model).toBe("pinned"); expect(r.rows[0].model).toBe("pinned");
  });
  it("records a provider failure with its code and rethrows it", async () => {
    const r = rig({ chat: async () => { throw new ProviderError("timeout", "slow"); } });
    await expect(tracedChat(CTX, MSGS, {}, r.deps, {})).rejects.toMatchObject({ code: "timeout" });
    expect(r.rows[0]).toMatchObject({ ok: false, errorCode: "timeout", tokensIn: 0, tokensOut: 0 });
    const odd = rig({ chat: async () => { throw new TypeError("boom"); } });
    await expect(tracedChat(CTX, MSGS, {}, odd.deps, {})).rejects.toThrow("boom");
    expect(odd.rows[0]).toMatchObject({ ok: false, errorCode: "internal" });
  });
  it("a trace that cannot be completed never fails the call, the error is logged without the text, and the reservation keeps its (larger) estimate", async () => {
    const r = rig({ settleFails: true });
    await expect(tracedChat(CTX, MSGS, {}, r.deps, {})).resolves.toMatchObject({ content: "ok" });
    expect(r.logs).toEqual([{ k: "llm_trace_error", task: "research", errorType: "Error" }]);
    expect(r.rows[0]).toMatchObject({ ok: false, errorCode: "reserved" });
    expect(r.ledger[0].cost).toBe(estimateCallMicroUsd(MSGS, undefined));
  });
});

describe("the daily allowance", () => {
  it("refuses once the workspace has used its allowance, WITHOUT calling the model", async () => {
    const r = rig({ used: 3 });
    await expect(tracedChat(CTX, MSGS, {}, r.deps, { SALES_DAILY_RESEARCH_LIMIT: "3" })).rejects.toBeInstanceOf(CapExceeded);
    expect(r.calls).toHaveLength(0); expect(r.rows).toHaveLength(0);
  });
  it("allows the last call under the limit", async () => {
    const r = rig({ used: 2 });
    await expect(tracedChat(CTX, MSGS, {}, r.deps, { SALES_DAILY_RESEARCH_LIMIT: "3" })).resolves.toBeTruthy();
  });
  it("fails closed when the allowance cannot be counted (no table): the model is not called", async () => {
    const r = rig({ countFails: true });
    await expect(tracedChat(CTX, MSGS, {}, r.deps, {})).rejects.toBeInstanceOf(CapUnavailable);
    expect(r.calls).toHaveLength(0);
  });
  it("counts only the last 24 hours, for this workspace and task", async () => {
    const seen: any[] = []; const r = rig();
    const deps = { ...r.deps, store: { ...r.deps.store!, count: async (o: any) => { seen.push(o); return 0; } } };
    await assertWithinCap("draft", "org-9", deps, {});
    expect(seen[0].orgId).toBe("org-9"); expect(seen[0].task).toBe("draft");
    expect(seen[0].since.getTime()).toBe(Date.UTC(2026, 9, 11, 12, 0, 0) - 86_400_000); // the workspace allowance is a rolling 24 hours
  });
});

/* ── R3: a platform-wide daily model budget, on top of each workspace's allowance ──────────────────────────── */
describe("the platform-wide model budget (every workspace, one UTC day)", () => {
  const ENV = (usd: string) => ({ LLM_GLOBAL_DAILY_SPEND_USD: usd });
  const est = estimateCallMicroUsd(MSGS, undefined);
  it("defaults to $1.00 a day; a bad value is the default, never 'no limit'", () => {
    expect(globalDailySpendMicroUsd({})).toBe(1_000_000);
    expect(globalDailySpendMicroUsd({ LLM_GLOBAL_DAILY_SPEND_USD: "0.5" })).toBe(500_000);
    for (const v of ["", "-1", "abc", "0", "Infinity"]) expect(globalDailySpendMicroUsd({ LLM_GLOBAL_DAILY_SPEND_USD: v }), v).toBe(1_000_000);
  });
  it("reserves an upper-bound estimate BEFORE the call and replaces it with the actual cost after", async () => {
    const r = rig();
    await tracedChat(CTX, MSGS, {}, r.deps, ENV("1"));
    expect(est).toBeGreaterThan(Math.round(1000 * 0.27 + 200 * 1.1)); // the estimate is an upper bound
    expect(r.ledger.map((x) => x.cost)).toEqual([Math.round(1000 * 0.27 + 200 * 1.1)]);
    expect(r.rows[0]).toMatchObject({ ok: true, errorCode: null, tokensIn: 1000 });
  });
  it("used up: refused with its own code BEFORE the provider is called, and nothing is recorded", async () => {
    const r = rig({ ledger: [{ at: Date.UTC(2026, 9, 11, 1), cost: 999_000 }] });
    const e = await tracedChat(CTX, MSGS, {}, r.deps, ENV("1")).catch((x) => x);
    expect(e).toBeInstanceOf(GlobalCapExceeded);
    expect(e).toBeInstanceOf(CapExceeded); // every existing handler already stops cleanly on it
    expect(e.code).toBe("global_limit");
    expect(r.calls).toHaveLength(0);
    expect(r.rows).toHaveLength(0);
  });
  it("concurrent calls can't overspend: with room for three estimates, ten at once make exactly three calls", async () => {
    const r = rig();
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => tracedChat(CTX, MSGS, {}, r.deps, { LLM_GLOBAL_DAILY_SPEND_USD: String((3 * est + est / 2) / 1e6) })));
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(3);
    expect(results.filter((x) => x.status === "rejected" && (x as any).reason instanceof GlobalCapExceeded)).toHaveLength(7);
    expect(r.calls).toHaveLength(3);
  });
  it("a provider failure costs nothing: its reservation is settled at zero and frees the budget", async () => {
    let n = 0;
    const r = rig({ chat: async () => { if (n++ === 0) throw new ProviderError("timeout", "slow"); return { content: "ok", toolCalls: [], usage: { inputTokens: 10, outputTokens: 10 } } as ChatResult; } });
    const env = { LLM_GLOBAL_DAILY_SPEND_USD: String((est + est / 2) / 1e6) }; // room for one estimate at a time
    await expect(tracedChat(CTX, MSGS, {}, r.deps, env)).rejects.toMatchObject({ code: "timeout" });
    expect(r.ledger[0].cost).toBe(0);
    await expect(tracedChat(CTX, MSGS, {}, r.deps, env)).resolves.toMatchObject({ content: "ok" });
  });
  it("rolls over at midnight UTC: yesterday's spend doesn't count today", async () => {
    const r = rig({ ledger: [{ at: Date.UTC(2026, 9, 10, 23, 59), cost: 999_999 }] });
    await expect(tracedChat(CTX, MSGS, {}, r.deps, ENV("1"))).resolves.toMatchObject({ content: "ok" });
  });
  it("can't tell how much was spent: refused (fail closed), the provider is never called", async () => {
    const r = rig({ reserveFails: true });
    await expect(tracedChat(CTX, MSGS, {}, r.deps, ENV("1"))).rejects.toBeInstanceOf(CapUnavailable);
    expect(r.calls).toHaveLength(0);
  });
  it("the workspace allowance is checked first: a workspace at its limit is refused with ITS code and reserves nothing", async () => {
    const r = rig({ used: 20 });
    const e = await tracedChat(CTX, MSGS, {}, r.deps, ENV("1")).catch((x) => x);
    expect(e).toBeInstanceOf(CapExceeded);
    expect(e).not.toBeInstanceOf(GlobalCapExceeded);
    expect(r.ledger).toHaveLength(0);
  });
  it("the estimate grows with the prompt and the output budget asked for", () => {
    expect(estimateCallMicroUsd(MSGS, 1000)).toBeLessThan(estimateCallMicroUsd(MSGS, 8000));
    expect(estimateCallMicroUsd([{ role: "user", content: "x".repeat(30_000) }], 1000)).toBeGreaterThan(estimateCallMicroUsd(MSGS, 1000));
  });
});
