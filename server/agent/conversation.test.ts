import { beforeAll, describe, expect, it, vi } from "vitest";
import { ProviderError } from "../copilot/provider";
import { converse, MAX_TEXT, titleFrom, type ChannelAdapter, type ConversationDeps, type SessionRef } from "./conversation";
import { MemoryAgentStore } from "./memory-store";
import { agentSystemPrompt } from "./prompt";
import { FakeProvider, USER, call, mutationTool, readTool, say, type Step } from "./testing";
import type { AgentEvent, Channel } from "./types";
import { getLocaleSettings } from "@shared/schema";

beforeAll(() => { vi.spyOn(console, "log").mockImplementation(() => {}); });

function setup(steps: Step[], over: Partial<ConversationDeps> = {}) {
  const store = new MemoryAgentStore();
  const sessions = new Map<string, SessionRef & { userId: string; channel: Channel }>();
  const provider = new FakeProvider(steps);
  const find = readTool({ name: "search_deals", description: "search the deals please" }, () => ({ ok: true, summary: "#1 Acme" }));
  const create = mutationTool({ name: "create_deal", description: "create a deal from stated details" });
  const quota = { n: 0, limit: 99 };
  const deps: ConversationDeps = {
    store, provider, tools: [find, create],
    enabled: () => true,
    takeQuota: () => ++quota.n <= quota.limit,
    getSession: async (u, id) => { const s = sessions.get(id); return s && s.userId === u.id ? s : null; },
    createSession: async (u, channel) => { const s = { id: `s${sessions.size + 1}`, title: null, dealId: null, userId: u.id, channel }; sessions.set(s.id, s); return s; },
    loadContext: async ({ channel }) => ({ systemMessages: [agentSystemPrompt(getLocaleSettings({ country: "IN" }), "client_work", channel)], autonomy: 0 }),
    locks: new Set(),
    ...over,
  };
  return { deps, store, sessions, provider, quota };
}

/** A voice-like adapter: it ignores cards and progress, and "speaks" only the agent's reply. */
function voiceAdapter(signal?: AbortSignal) {
  const events: AgentEvent[] = [];
  const spoken: string[] = [];
  const adapter: ChannelAdapter = {
    channel: "voice", signal,
    emit: (e) => { events.push(e); if (e.type === "agent.message") spoken.push(String(e.data.text)); },
  };
  return { adapter, events, spoken };
}
const webAdapter = (): { adapter: ChannelAdapter; events: AgentEvent[] } => {
  const events: AgentEvent[] = [];
  return { adapter: { channel: "web", emit: (e) => events.push(e) }, events };
};

describe("one agent, any channel", () => {
  it("a spoken turn runs the same agent and is delivered through its own adapter", async () => {
    const { deps, provider } = setup([call("search_deals", {}), say("You have one deal, with Acme.")]);
    const { adapter, events, spoken } = voiceAdapter();
    const out = await converse(deps, { user: USER, text: "how many deals do I have", adapter });
    expect(out).toMatchObject({ ok: true });
    expect(spoken).toEqual(["You have one deal, with Acme."]);
    expect(events.map((e) => e.type)).toContain("agent.searching");
    // The voice style reached the model; the logic did not change.
    expect(provider.calls[0][0].content).toMatch(/live voice call/);
  });

  it("the same turn on the web and by voice produces the same run — the loop never branches on channel", async () => {
    const script = (): Step[] => [call("create_deal", { dealId: 4 }), say("Ready for your approval.")];
    const a = setup(script()), b = setup(script());
    const w = webAdapter(), v = voiceAdapter();
    const ra = await converse(a.deps, { user: USER, text: "make the deal", adapter: w.adapter });
    const rb = await converse(b.deps, { user: USER, text: "make the deal", adapter: v.adapter });
    expect(w.events.map((e) => e.type)).toEqual(v.events.map((e) => e.type));
    expect(ra.ok && rb.ok && ra.result.status).toBe("waiting_for_user");
    expect(rb.ok && rb.result.status).toBe("waiting_for_user");
    expect(a.store.approvals.size).toBe(1);
    expect(b.store.approvals.size).toBe(1);
  });

  it("records the channel the conversation started on, and reuses a conversation across turns", async () => {
    const { deps, sessions } = setup([say("Hello."), say("Again.")]);
    const first = await converse(deps, { user: USER, text: "hello there", adapter: voiceAdapter().adapter });
    expect(first.ok && sessions.get(first.sessionId)!.channel).toBe("voice");
    const second = await converse(deps, { user: USER, text: "and again", adapter: voiceAdapter().adapter, sessionId: first.ok ? first.sessionId : null });
    expect(second.ok && second.sessionId).toBe(first.ok && first.sessionId);
    expect(sessions.size).toBe(1);
  });

  it("the conversation is titled from the first message only", async () => {
    const { deps, store } = setup([say("ok")]);
    await converse(deps, { user: USER, text: "  Glow Skincare   offered ₹30,000 for three reels  ", adapter: webAdapter().adapter });
    expect(store.states.find((s) => s.state === "UNDERSTANDING")).toBeTruthy();
    expect(titleFrom("  Glow Skincare   offered ₹30,000 for three reels  ")).toBe("Glow Skincare offered ₹30,000 for three reels");
    expect(titleFrom("x".repeat(200))).toHaveLength(60);
  });

  it("a hang-up (the adapter's signal) cancels the run", async () => {
    const ac = new AbortController();
    const { deps } = setup([async () => { ac.abort(); throw new ProviderError("aborted", "aborted"); }]);
    const { adapter } = voiceAdapter(ac.signal);
    const out = await converse(deps, { user: USER, text: "hello", adapter });
    expect(out.ok && out.result.status).toBe("cancelled");
  });
});

describe("refusals before the agent starts emit nothing, so each channel can report them its own way", () => {
  const refused = async (deps: ConversationDeps, input: Partial<Parameters<typeof converse>[1]> = {}) => {
    const { adapter, events } = webAdapter();
    const out = await converse(deps, { user: USER, text: "hello", adapter, ...input });
    expect(events, "no events before a refusal").toEqual([]);
    return out;
  };

  it("empty and oversized messages", async () => {
    const { deps } = setup([]);
    expect(await refused(deps, { text: "   " })).toMatchObject({ ok: false, code: "empty" });
    expect(await refused(deps, { text: "x".repeat(MAX_TEXT + 1) })).toMatchObject({ ok: false, code: "too_long" });
  });
  it("the agent switched off", async () => {
    expect(await refused(setup([], { enabled: () => false }).deps)).toMatchObject({ ok: false, code: "unavailable" });
  });
  it("someone else's conversation looks like no conversation", async () => {
    const { deps } = setup([say("hi")]);
    const mine = await converse(deps, { user: USER, text: "hello", adapter: webAdapter().adapter });
    expect(mine.ok).toBe(true);
    const out = await refused(deps, { user: { ...USER, id: "intruder" }, sessionId: mine.ok ? mine.sessionId : "x" });
    expect(out).toMatchObject({ ok: false, code: "not_found" });
    expect(await refused(deps, { sessionId: "nope" })).toMatchObject({ ok: false, code: "not_found" });
  });
  it("the daily quota", async () => {
    const { deps, quota } = setup([say("a"), say("b")]);
    quota.limit = 1;
    expect((await converse(deps, { user: USER, text: "one", adapter: webAdapter().adapter })).ok).toBe(true);
    expect(await refused(deps, { text: "two" })).toMatchObject({ ok: false, code: "quota" });
  });
});

describe("one run at a time, and never stuck", () => {
  it("a second message while the first is running is refused; afterwards the conversation is free again", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { deps } = setup([say("first"), async () => { await gate; return say("done"); }, say("third")]);
    const first = await converse(deps, { user: USER, text: "start", adapter: webAdapter().adapter });
    // The lock is per conversation: start a run that waits, and try again on the same conversation.
    const s = first.ok ? first.sessionId : "";
    const pending = converse(deps, { user: USER, text: "slow one", adapter: webAdapter().adapter, sessionId: s });
    await Promise.resolve();
    const clash = await converse(deps, { user: USER, text: "too soon", adapter: webAdapter().adapter, sessionId: s });
    expect(clash).toMatchObject({ ok: false, code: "busy" });
    release();
    expect((await pending).ok).toBe(true);
    expect((await converse(deps, { user: USER, text: "now fine", adapter: webAdapter().adapter, sessionId: s })).ok).toBe(true);
  });

  it("an unexpected error is delivered as a failed event, nothing is changed, and the lock is released", async () => {
    const { deps } = setup([say("a"), say("b")], {
      loadContext: vi.fn().mockRejectedValueOnce(new Error("db exploded")).mockResolvedValue({ systemMessages: ["S"], autonomy: 0 }),
    });
    const { adapter, events } = webAdapter();
    const out = await converse(deps, { user: USER, text: "hello", adapter });
    expect(out).toMatchObject({ ok: true, result: { status: "failed" } });
    expect(events.at(-1)).toMatchObject({ type: "agent.failed", data: { code: "internal" } });
    expect(JSON.stringify(events)).not.toContain("db exploded");
    const again = await converse(deps, { user: USER, text: "retry", adapter: webAdapter().adapter, sessionId: out.ok ? out.sessionId : "" });
    expect(again.ok).toBe(true);
  });
});
