/**
 * Word-by-word replies: the provider streams the model's text, the loop batches it into agent.text_delta events tagged
 * with the model step, the final agent.message stays authoritative, and a stop keeps the text the person already saw.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ProviderError, aiProvider, readChatStream } from "../copilot/provider";
import { runAgent, type RunDeps } from "./loop";
import { MemoryAgentStore } from "./memory-store";
import { call, collect, FakeProvider, readTool, USER } from "./testing";
import type { AgentTool, AutonomyLevel } from "./types";

beforeAll(() => { vi.spyOn(console, "log").mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllGlobals(); });

const base = (provider: FakeProvider, tools: AgentTool[] = []) => {
  const store = new MemoryAgentStore();
  const deps: RunDeps = { provider, store, tools, systemMessages: ["SYSTEM"], autonomy: 0 as AutonomyLevel };
  return { deps, store };
};
const input = (channel: "web" | "voice" = "web") => ({ sessionId: "s1", user: USER, text: "hello", channel });
const usage = { inputTokens: 10, outputTokens: 5 };
const deltas = (ev: ReturnType<typeof collect>) => ev.events.filter((e) => e.type === "agent.text_delta").map((e) => e.data as { step: number; text: string });

describe("the loop streams the reply", () => {
  it("text pieces arrive as agent.text_delta before the final message, which stays authoritative", async () => {
    const provider = new FakeProvider([async (_m, opts) => {
      for (const piece of ["Two ", "invoices ", "are ", "overdue."]) opts?.onText?.(piece);
      return { content: "Two invoices are overdue.", toolCalls: [], usage };
    }]);
    const { deps, store } = base(provider);
    const ev = collect();
    const r = await runAgent(deps, input(), ev.emit);
    const d = deltas(ev);
    expect(d.map((x) => x.text).join("")).toBe("Two invoices are overdue.");
    expect(d.every((x) => x.step === 0)).toBe(true);
    const types = ev.types();
    expect(types.lastIndexOf("agent.text_delta")).toBeLessThan(types.indexOf("agent.message"));
    expect(r.reply).toBe("Two invoices are overdue.");
    expect(store.messages.at(-1)?.content).toBe("Two invoices are overdue.");
  });

  it("a step that calls tools streams as its own step, so its preamble can be dropped", async () => {
    const find = readTool({ name: "search_invoices" }, () => ({ ok: true, summary: "#1 overdue" }));
    const provider = new FakeProvider([
      async (_m, opts) => { opts?.onText?.("Let me check. "); return call("search_invoices", {}); },
      async (_m, opts) => { opts?.onText?.("One invoice is overdue."); return { content: "One invoice is overdue.", toolCalls: [], usage }; },
    ]);
    const { deps } = base(provider, [find]);
    const ev = collect();
    const r = await runAgent(deps, input(), ev.emit);
    expect(deltas(ev)).toEqual([{ step: 0, text: "Let me check. " }, { step: 1, text: "One invoice is overdue." }]);
    expect(r.reply).toBe("One invoice is overdue.");
  });

  it("a voice call isn't streamed (it speaks whole replies)", async () => {
    let got: unknown = "unset";
    const provider = new FakeProvider([async (_m, opts) => { got = opts?.onText; return { content: "Fine.", toolCalls: [], usage }; }]);
    const ev = collect();
    await runAgent(base(provider).deps, input("voice"), ev.emit);
    expect(got).toBeUndefined();
    expect(deltas(ev)).toEqual([]);
  });

  it("Stop keeps what was already shown, saved with the reason after it", async () => {
    const ac = new AbortController();
    const provider = new FakeProvider([async (_m, opts) => {
      opts?.onText?.("Harbor Logistics owes ₹75,000");
      ac.abort();
      throw new ProviderError("aborted", "aborted");
    }]);
    const { deps, store } = base(provider);
    const ev = collect();
    const r = await runAgent(deps, input(), ev.emit, ac.signal);
    expect(r.status).toBe("cancelled");
    expect(store.messages.at(-1)?.content).toBe("Harbor Logistics owes ₹75,000\n\n_Stopped. Nothing was changed._");
    expect(ev.events.find((e) => e.type === "agent.failed")?.data).toMatchObject({ cancelled: true });
  });

  it("a reply that breaks off on a provider error keeps its text too, with the error after it", async () => {
    const provider = new FakeProvider([async (_m, opts) => { opts?.onText?.("Here is what I found"); throw new ProviderError("upstream", "boom", 503); }]);
    const { deps, store } = base(provider);
    const r = await runAgent(deps, input(), collect().emit);
    expect(r.status).toBe("failed");
    expect(store.messages.at(-1)?.content).toMatch(/^Here is what I found\n\n_I couldn't reach the AI service\. Nothing was changed\._$/);
  });
});

/* ── the provider's stream reader ── */

const sse = (chunks: string[], fail = false) => new Response(new ReadableStream({
  start(c) {
    const enc = new TextEncoder();
    for (const ch of chunks) c.enqueue(enc.encode(ch));
    // Break the connection only after the queued text can be read (error() would discard the queue).
    if (fail) setTimeout(() => c.error(new Error("socket hang up")), 20); else c.close();
  },
}), { headers: { "content-type": "text/event-stream" } });
const frame = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;

describe("reading a streamed completion", () => {
  it("text deltas (split across network chunks), tool calls from fragments, usage, [DONE], malformed frames skipped", async () => {
    const whole = frame({ choices: [{ delta: { content: "Hel" } }] }) + frame({ choices: [{ delta: { content: "lo" } }] });
    const pieces: string[] = [];
    const r = await readChatStream(sse([
      whole.slice(0, 17), whole.slice(17),
      "data: {not json}\n\n",
      frame({ choices: [{ delta: { reasoning_content: "thinking…" } }] }),
      frame({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "search_", arguments: "{\"q\":" } }] } }] }),
      frame({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "deals", arguments: "\"acme\"}" } }] } }] }),
      frame({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 7 } }),
      "data: [DONE]\n\n",
    ]), (d) => pieces.push(d));
    expect(pieces).toEqual(["Hel", "lo"]); // never the reasoning
    expect(r).toEqual({ content: "Hello", toolCalls: [{ id: "c1", name: "search_deals", arguments: { q: "acme" } }], usage: { inputTokens: 12, outputTokens: 7 } });
  });

  it("an empty or unreadable stream is an error, not an empty answer", async () => {
    await expect(readChatStream(sse(["data: nope\n\n"]), () => {})).rejects.toMatchObject({ code: "invalid_response" });
  });
});

describe("the provider streams only when asked, and never retries after showing text", () => {
  it("streams with onText; without it, the call is a plain JSON request (other features unchanged)", async () => {
    const bodies: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: any) => {
      const body = JSON.parse(init.body);
      bodies.push(body);
      return body.stream
        ? sse([frame({ choices: [{ delta: { content: "Hi" } }] }), "data: [DONE]\n\n"])
        : new Response(JSON.stringify({ choices: [{ message: { content: "Hi" } }] }), { headers: { "content-type": "application/json" } });
    }));
    const seen: string[] = [];
    expect((await aiProvider.chat([{ role: "user", content: "x" }], [], { onText: (d) => seen.push(d) })).content).toBe("Hi");
    expect((await aiProvider.chat([{ role: "user", content: "x" }], [])).content).toBe("Hi");
    expect(bodies[0]).toMatchObject({ stream: true, stream_options: { include_usage: true } });
    expect(bodies[1].stream).toBeUndefined();
    expect(seen).toEqual(["Hi"]);
  });

  it("a stream that breaks after text was shown is not retried (it would show the text twice)", async () => {
    const f = vi.fn(async () => sse([frame({ choices: [{ delta: { content: "Half an ans" } }] })], true));
    vi.stubGlobal("fetch", f);
    await expect(aiProvider.chat([{ role: "user", content: "x" }], [], { onText: () => {} })).rejects.toBeInstanceOf(ProviderError);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("a busy service before any text is retried once, as before", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(sse([frame({ choices: [{ delta: { content: "OK" } }] }), "data: [DONE]\n\n"]));
    vi.stubGlobal("fetch", f);
    expect((await aiProvider.chat([{ role: "user", content: "x" }], [], { onText: () => {} })).content).toBe("OK");
    expect(f).toHaveBeenCalledTimes(2);
  });
});
