import { describe, expect, it, vi } from "vitest";

// The real store talks to the database; these tests inject a fake one.
vi.mock("./trace-store", () => ({ traceStore: {}, llmTraceReady: async () => true }));

import { ProviderError, type AIProvider, type ChatResult } from "../copilot/provider";
import { CapExceeded, CapUnavailable, assertWithinCap, tracedChat, type TraceCtx, type TraceDeps } from "./traced";
import type { TraceRow, TraceStore } from "./trace-store";

const CTX: TraceCtx = { task: "research", orgId: "org-1", userId: "u1", leadId: 7, promptVersion: "r1" };
const MSGS = [{ role: "system" as const, content: "SECRET PROMPT TEXT" }, { role: "user" as const, content: "private customer words" }];

function rig(over: { chat?: AIProvider["chat"]; used?: number; countFails?: boolean; recordFails?: boolean } = {}) {
  const rows: TraceRow[] = []; const logs: any[] = []; const calls: any[] = [];
  let t = 1_000;
  const provider: AIProvider = { name: "fake", model: "m-default", chat: over.chat ?? (async (m, tools, o) => { calls.push({ m, tools, o }); t += 250; return { content: "ok", toolCalls: [], usage: { inputTokens: 1000, outputTokens: 200 } } as ChatResult; }) };
  const store: TraceStore = {
    record: async (r) => { if (over.recordFails) throw new Error("table missing"); rows.push(r); },
    count: async () => { if (over.countFails) throw new Error("table missing"); return over.used ?? 0; },
    spendMicroUsd: async () => 0,
  };
  const deps: Partial<TraceDeps> = { provider, store, now: () => t, log: (k, f) => logs.push({ k, ...f }) };
  return { rows, logs, calls, deps };
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
  it("a trace that cannot be written never fails the call, and the error is logged without the text", async () => {
    const r = rig({ recordFails: true });
    await expect(tracedChat(CTX, MSGS, {}, r.deps, {})).resolves.toMatchObject({ content: "ok" });
    expect(r.logs).toEqual([{ k: "llm_trace_error", task: "research", errorType: "Error" }]);
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
    expect(seen[0].since.getTime()).toBe(1_000 - 86_400_000);
  });
});
