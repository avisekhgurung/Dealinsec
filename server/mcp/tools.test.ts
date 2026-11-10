/**
 * The MCP tool layer, without the SDK or a database: which tools an outside client is offered, and what happens on
 * each call. The promise here is narrow and worth guarding hard — an MCP client can READ, as one workspace member,
 * and can never change anything.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { AgentTool } from "../agent/types";
import { CALL_TIMEOUT_MS, MAX_CALLS_PER_MINUTE, MAX_RESULT_CHARS, createCaller, mcpTools, socialTools, toSpecs } from "./tools";

const ana = { id: "ana", organizationId: "org-a", orgRole: "SALES" } as any;
const read = (name: string, over: Partial<AgentTool<any>> = {}): AgentTool<any> => ({
  name, description: `${name} tool`, risk: "READ_ONLY", input: z.object({ q: z.string().optional() }).strict(), authorize: () => null,
  run: async (_ctx, i) => ({ ok: true, summary: `ran ${name}`, data: { q: i.q ?? null } }), ...over,
});
const write = (name: string, risk: "SAFE_MUTATION" | "CONSEQUENTIAL_MUTATION"): AgentTool<any> => ({
  name, description: name, risk, input: z.object({}), authorize: () => null,
  prepare: async () => ({ ok: true } as any), execute: async () => { throw new Error("a write must never run over MCP"); },
});
function session(tools: AgentTool<any>[], over: Record<string, unknown> = {}) {
  const audit: any[] = [];
  let clock = 1_000_000;
  const call = createCaller({ tools, user: ana, audit: (e) => audit.push(e), now: () => clock, ...over });
  return { call, audit, tick: (ms: number) => { clock += ms; } };
}

describe("which tools an MCP client is offered", () => {
  it("read-only tools only: nothing that changes anything, whatever its risk class", () => {
    const offered = mcpTools([read("get_lead"), write("create_lead", "SAFE_MUTATION"), write("approve_outreach", "CONSEQUENTIAL_MUTATION"), read("get_run")]);
    expect(offered.map((t) => t.name)).toEqual(["get_lead", "get_run"]);
  });
  it("a tool marked read-only that has no read to run is not offered, and a name is offered once", () => {
    expect(mcpTools([read("a", { run: undefined }), read("b"), read("b")]).map((t) => t.name)).toEqual(["b"]);
  });
  // The whole registry, as shipped: this is the list a real client would see, checked for anything that writes.
  it("the real registry offers no tool that prepares or executes a change", async () => {
    process.env.DATABASE_URL ??= "postgresql://unused:unused@localhost:5432/unused";
    const { AGENT_TOOLS } = await import("../agent/tools");
    const offered = mcpTools(AGENT_TOOLS, socialTools({ overview: async () => ({}), list: async () => ({}) }));
    expect(offered.length).toBeGreaterThan(10);
    for (const t of offered) { expect([t.name, t.risk]).toEqual([t.name, "READ_ONLY"]); expect(typeof t.run).toBe("function"); }
    const names = offered.map((t) => t.name);
    for (const never of ["create_lead", "draft_outreach", "approve_outreach", "mark_outreach_sent", "discover_prospects", "research_prospect", "add_prospect_to_leads", "create_invoice", "mark_paid", "archive_lead"]) expect(names).not.toContain(never);
    for (const has of ["social_intent_overview", "list_social_opportunities", "analyze_post"]) expect(names).toContain(has);
    // The newest reads are offered too, and they are reads: profiles and campaigns, never a message's text.
    for (const has of ["list_client_profiles", "list_campaigns", "get_campaign"]) expect(names).toContain(has);
  }, 30_000); // loading the whole real registry is slow on a cold or busy machine; the default 5 s made this test flaky
  it("describes each tool with an object schema a client can validate against", () => {
    const [spec] = toSpecs([read("get_lead", { input: z.object({ id: z.number().int() }).strict() })]);
    expect(spec).toMatchObject({ name: "get_lead", description: "get_lead tool", inputSchema: { type: "object" } });
    expect(JSON.stringify(spec.inputSchema)).toContain("id");
  });
});

describe("a call", () => {
  it("runs the tool as the connected member and returns its result as text", async () => {
    let seen: any;
    const s = session([read("get_lead", { run: async (ctx, i) => { seen = ctx.user; return { ok: true, summary: "1 lead", data: { q: i.q } }; } })]);
    const r = await s.call("get_lead", { q: "acme" });
    expect(r.isError).toBeUndefined();
    expect(r.content[0].text).toContain("1 lead");
    expect(r.content[0].text).toContain('"q": "acme"');
    expect(seen).toMatchObject({ id: "ana", organizationId: "org-a" });
    expect(s.audit).toEqual([{ tool: "get_lead", ok: true, ms: 0, userId: "ana", orgId: "org-a" }]);
  });
  it("arguments are validated before anything runs; the audit line never holds them", async () => {
    let ran = false;
    const s = session([read("get_lead", { run: async () => { ran = true; return { ok: true, summary: "x" }; } })]);
    const r = await s.call("get_lead", { q: 5, secret: "do-not-log" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("Invalid arguments");
    expect(ran).toBe(false);
    expect(JSON.stringify(s.audit)).not.toContain("do-not-log");
    expect(s.audit[0]).toMatchObject({ ok: false, code: "invalid_arguments" });
  });
  it("the member's own permission decides: a tool they may not use is refused with its reason", async () => {
    let ran = false;
    const s = session([read("get_invoices", { authorize: () => "Your role doesn't include viewing invoices.", run: async () => { ran = true; return { ok: true, summary: "x" }; } })]);
    const r = await s.call("get_invoices", {});
    expect(r).toMatchObject({ isError: true });
    expect(r.content[0].text).toBe("Your role doesn't include viewing invoices.");
    expect(ran).toBe(false);
  });
  it("an unknown tool, and a write tool asked for by name, are both just unknown", async () => {
    const s = session(mcpTools([read("get_lead"), write("create_lead", "SAFE_MUTATION")]));
    expect((await s.call("nope", {})).content[0].text).toContain("Unknown tool");
    expect(await s.call("create_lead", {})).toMatchObject({ isError: true });
    expect(s.audit.map((a) => a.code)).toEqual(["unknown_tool", "unknown_tool"]);
  });
  it("a tool's own refusal comes back as an error with its message", async () => {
    const s = session([read("get_lead", { run: async () => ({ ok: false, code: "not_found", message: "That lead isn't in your workspace." }) })]);
    const r = await s.call("get_lead", {});
    expect(r).toMatchObject({ isError: true });
    expect(r.content[0].text).toBe("That lead isn't in your workspace.");
    expect(s.audit[0]).toMatchObject({ ok: false, code: "not_found" });
  });
  it("a crash inside a tool is a plain error: no stack, no internal message", async () => {
    const s = session([read("get_lead", { run: async () => { throw Object.assign(new Error("SELECT * FROM leads WHERE secret"), { name: "PgError" }); } })]);
    const r = await s.call("get_lead", {});
    expect(r).toMatchObject({ isError: true });
    expect(r.content[0].text).not.toContain("SELECT");
    expect(s.audit[0]).toMatchObject({ ok: false, code: "error:PgError" });
  });
  it("a call that runs too long is stopped", async () => {
    const s = session([read("slow", { run: (ctx) => new Promise((_, rej) => ctx.signal!.addEventListener("abort", () => rej(new Error("aborted")))) })], { timeoutMs: 20 });
    const r = await s.call("slow", {});
    expect(r).toMatchObject({ isError: true });
    expect(r.content[0].text).toContain("too long");
    expect(CALL_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000);
  });
  it("a very long result is cut, and says so", async () => {
    const s = session([read("big", { run: async () => ({ ok: true, summary: "big", data: "x".repeat(MAX_RESULT_CHARS * 2) }) })]);
    const t = (await s.call("big", {})).content[0].text;
    expect(t.length).toBeLessThan(MAX_RESULT_CHARS + 200);
    expect(t).toContain("(cut:");
  });
  it("a runaway client is slowed: past the per-minute cap calls are refused, then allowed again a minute later", async () => {
    const s = session([read("get_lead")]);
    for (let i = 0; i < MAX_CALLS_PER_MINUTE; i++) expect((await s.call("get_lead", {})).isError).toBeUndefined();
    expect((await s.call("get_lead", {})).content[0].text).toContain("Too many calls");
    s.tick(61_000);
    expect((await s.call("get_lead", {})).isError).toBeUndefined();
  });
});

describe("Social Intent over MCP", () => {
  const tools = socialTools({
    overview: async (u: any) => ({ ok: true, overview: { for: u.organizationId, stats: { total: 2 } } }),
    list: async (_u: any, q: any) => ({ ok: true, total: 1, page: 1, pageCount: 1, opportunities: [{ id: 1, title: "Looking to hire", q }] }),
  });
  it("reads the overview and the list for the connected workspace, passing only the filters that were given", async () => {
    const s = session(tools);
    expect((await s.call("social_intent_overview", {})).content[0].text).toContain('"for": "org-a"');
    const t = (await s.call("list_social_opportunities", { intent: "hiring", minScore: 60 })).content[0].text;
    expect(t).toContain("1 opportunity");
    expect(t).toContain('"intent": "hiring"');
    expect(t).not.toContain('"status"');
  });
  it("reads one pasted post by the rules, storing and fetching nothing", async () => {
    const s = session(tools);
    const t = (await s.call("analyze_post", { text: "We're looking to hire a web design freelancer for our bakery, budget $1,500.", services: ["web design"] })).content[0].text;
    expect(t).toContain("Wants to hire");
    expect(t).toContain('"qualifies": true');
    expect(t).toContain("$1,500");
  });
  it("there is no tool to scan, save or change an opportunity", () => {
    expect(tools.map((t) => t.name).sort()).toEqual(["analyze_post", "list_social_opportunities", "social_intent_overview"]);
    for (const t of tools) expect(t.risk).toBe("READ_ONLY");
  });
  it("someone without a workspace is refused", async () => {
    const audit: any[] = [];
    const call = createCaller({ tools, user: { id: "x", organizationId: null } as any, audit: (e) => audit.push(e) });
    expect(await call("social_intent_overview", {})).toMatchObject({ isError: true });
  });
});
