/**
 * The coworkers as a team, with a fake model and fake read tools: who reads what (and as whom), what a teammate may
 * say, the huddle's turns and summary, and the chat tools that let them talk (bounded) and hand work over (always asked).
 */
import { describe, expect, it, vi } from "vitest";
vi.mock("../db", () => ({ db: {} }));
import { z } from "zod";
import { BOTS, LEAGUE_LIMITS, TASK_INPUT, botForTask, type Bot } from "@shared/ai-league";
import type { LeagueRunRow } from "@shared/schema";
import type { AgentTool, ToolContext } from "../agent/types";
import { FACT_READS, consultTeammate, huddleOrder, huddleTask, teamFacts, type TeamDeps } from "./team";
import { BOT_TOOLS, askTeammateTool, handoffTool, huddleTool, personaPrompt } from "./chat";
import type { StepOutcome, TaskCtx } from "./tasks/types";

const USER = { id: "u1", organizationId: "org-1", orgRole: "OWNER" } as any;

/** A read tool that returns fixed records, refusing when `deny` says so. */
const readTool = (name: string, data: unknown, deny: string | null = null, fail = false): AgentTool => ({
  name, description: name, risk: "READ_ONLY", input: z.object({}).passthrough(),
  authorize: () => deny,
  async run() { if (fail) throw new Error("db down"); return { ok: true, summary: `${name} read`, data }; },
});
const TOOLS: AgentTool[] = [
  readTool("get_ideal_client", { industry: "dental clinics", where: "Siliguri" }),
  readTool("get_discovery_run", { status: "done", found: 12 }),
  readTool("list_leads", { rows: [{ company: "Bluebird Dental", stage: "new" }, { company: "Harbor Logistics", stage: "contacted" }] }),
  readTool("get_lead_followups", { due: 2 }),
  readTool("get_pending_work", { overdueInvoices: 1 }),
  readTool("get_money_radar", { overdueTotal: 45000 }, "You don't have permission to view invoices."),
];

/** A fake model: answers from a script, records every prompt. */
function model(answers: (string | Error)[]) {
  const calls: { task: string; system: string; user: string }[] = [];
  const chat: TeamDeps["chat"] = async (ctx, messages) => {
    calls.push({ task: ctx.task, system: messages[0].content, user: messages[1].content });
    const a = answers.shift() ?? "Fine.";
    if (a instanceof Error) throw a;
    return { content: a, usage: { inputTokens: 100, outputTokens: 20 } };
  };
  return { deps: { chat, tools: async () => TOOLS } as TeamDeps, calls };
}

describe("what a coworker reads before speaking", () => {
  it("only its own read tools, all of them in its chat allowlist", () => {
    for (const b of BOTS) for (const r of FACT_READS[b]) expect(BOT_TOOLS[b]).toContain(r.tool);
  });

  it("reads as the person: a denied read says so, a failed read says so; nothing is guessed", async () => {
    const zee = await teamFacts(USER, "zee", TOOLS);
    expect(zee).toContain("Pending work: get_pending_work read");
    expect(zee).toContain("Money radar: not available to this person (You don't have permission to view invoices.)");
    expect(zee).not.toContain("45000");
    const broken = await teamFacts(USER, "mika", [readTool("list_leads", {}, null, true)]);
    expect(broken).toContain("Leads: couldn't be read");
    expect(broken).toContain("Follow-ups due in the next 7 days: not available");
  });
});

describe("asking a teammate", () => {
  it("the teammate answers from its own records, fenced, on the team allowance", async () => {
    const { deps, calls } = model(["Bluebird Dental is new; I'd open with their booking page."]);
    const r = await consultTeammate(deps, USER, "nibo", "mika", "How would you open with Bluebird Dental?");
    expect(r).toMatchObject({ text: expect.stringContaining("Bluebird Dental"), dropped: false, tokensIn: 100, tokensOut: 20 });
    expect(calls[0].task).toBe("team");
    expect(calls[0].system).toContain("You are Mika");
    expect(calls[0].user).toMatch(/<untrusted[^>]*records[\s\S]*Bluebird Dental/);
    expect(calls[0].user).toMatch(/<untrusted[^>]*question/);
  });

  it("an answer with a figure that isn't in the records is left out, not shown", async () => {
    const { deps } = model(["You have 7 overdue invoices worth 90000."]);
    const r = await consultTeammate(deps, USER, "mika", "zee", "Who owes us money?");
    expect(r).toMatchObject({ text: null, dropped: true });
  });
});

/* ── the huddle ── */

const NOW = new Date("2026-10-18T10:00:00Z");
function huddleCtx(input: Record<string, unknown>, checkpoint: Record<string, unknown> = {}) {
  const events: { kind: string; message: string }[] = [];
  const c: TaskCtx = {
    run: { id: "lr_h", organizationId: "org-1", userId: "u1", bot: "zee", task: "team.huddle", input, status: "running", stage: "start", checkpoint } as unknown as LeagueRunRow,
    user: USER, checkpoint, now: () => NOW, event: async (kind, message) => { events.push({ kind, message }); }, addUsage: () => {},
  };
  return { c, events };
}
async function runHuddle(task: ReturnType<typeof huddleTask>, input: Record<string, unknown>) {
  let cp: Record<string, unknown> = {}, stage = "start";
  const events: { kind: string; message: string }[] = [];
  for (let i = 0; i < 20; i++) {
    const { c, events: ev } = huddleCtx(input, cp);
    const out: StepOutcome = await task.step(c, stage);
    events.push(...ev);
    if (out.kind === "finish") return { out, events };
    if (out.kind !== "continue") throw new Error("a huddle never waits");
    cp = out.checkpoint ?? cp; stage = out.stage;
  }
  throw new Error("huddle never finished");
}

describe("the team huddle", () => {
  it("the lead opens, everyone speaks once per round, then the lead sums up with owned next steps", async () => {
    const turns = ["Lead: Bluebird Dental is new.", "Nibo: dental clinics in Siliguri fit.", "Mika: Harbor Logistics was contacted.", "Lead again: agree.", "Nibo: I'd search again.", "Mika: I'd draft for Bluebird Dental."];
    const summary = JSON.stringify({ summary: "Focus on dental clinics in Siliguri.", steps: [{ bot: "nibo", step: "Search for dental clinics in Siliguri" }, { bot: "mika", step: "Draft a first message to Bluebird Dental" }, { bot: "robot", step: "Hack the planet" }] });
    const { deps, calls } = model([...turns, summary]);
    const { out, events } = await runHuddle(huddleTask({ ...deps, isLimit: () => false }), { topic: "How do we land new dental clients?", lead: "zee" });
    expect(huddleOrder("zee")).toEqual(["zee", "nibo", "mika"]);
    expect(calls.map((c) => c.system.match(/You are (\w+)/)?.[1])).toEqual(["Zee", "Nibo", "Mika", "Zee", "Nibo", "Mika", "Zee"]);
    expect(calls.every((c) => c.task === "team")).toBe(true);
    expect(calls[1].user).toContain("Lead: Bluebird Dental is new."); // later turns hear what was said, fenced
    expect(events.filter((e) => e.kind === "said")).toHaveLength(6);
    if (out.kind !== "finish") throw new Error();
    expect(out.status).toBe("completed");
    expect(out.report.summary).toBe("Focus on dental clinics in Siliguri.");
    const steps = out.report.items.filter((i) => i.status === "needs_you");
    expect(steps.map((s) => s.bot)).toEqual(["nibo", "mika"]); // an unknown owner is dropped
    expect(steps[0].href).toBe("/ai-league/nibo");
    expect(out.report.items.filter((i) => i.status === "info")).toHaveLength(6);
    expect(out.report.notes?.[0]).toMatch(/nothing was changed or sent/);
  });

  it("a turn with an invented figure is left out and marked; a garbled summary leaves no steps", async () => {
    const { deps } = model(["We have 99 overdue invoices.", "Fine.", "Fine.", "Fine.", "Fine.", "Fine.", "not json at all"]);
    const { out } = await runHuddle(huddleTask({ ...deps, isLimit: () => false }), { topic: "What should we focus on?", lead: "zee" });
    if (out.kind !== "finish") throw new Error();
    const first = out.report.items.find((i) => i.title === "Zee · round 1");
    expect(first).toMatchObject({ status: "skipped", detail: expect.stringContaining("figure") });
    expect(out.report.summary ?? null).toBeNull();
    expect(out.report.items.filter((i) => i.status === "needs_you")).toHaveLength(0);
  });

  it("an allowance refusal mid-huddle stops with what was said (partial); other errors are left to the runner's retry", async () => {
    const limit = new Error("cap");
    const { deps } = model(["Zee speaks.", "Nibo speaks.", limit]);
    const { out } = await runHuddle(huddleTask({ ...deps, isLimit: (e) => e === limit }), { topic: "What should we focus on?", lead: "zee" });
    if (out.kind !== "finish") throw new Error();
    expect(out.status).toBe("partial");
    expect(out.report.notes?.join(" ")).toMatch(/allowance/);
    const boom = model([new Error("provider 500")]);
    const t = huddleTask({ ...boom.deps, isLimit: () => false });
    const { c } = huddleCtx({ topic: "What should we focus on?", lead: "nibo" }, { facts: {}, turns: [] });
    await expect(t.step(c, "turn")).rejects.toThrow("provider 500");
  });

  it("belongs to its lead; its input is strict", () => {
    expect(botForTask("team.huddle", { lead: "mika", topic: "x" })).toBe("mika");
    expect(botForTask("team.huddle", { lead: "robot" })).toBe("zee");
    expect(botForTask("nibo.find_clients", { lead: "mika" })).toBe("nibo");
    expect(TASK_INPUT["team.huddle"].safeParse({ topic: "Plan the week ahead", lead: "nibo", send: true }).success).toBe(false);
    expect(TASK_INPUT["team.huddle"].safeParse({ topic: "short" }).success).toBe(false);
  });
});

/* ── the chat tools ── */

const toolCtx = (runId: string): ToolContext => ({ user: USER, sessionId: "s1", runId, userText: "", userMessages: [], progress: () => {}, addUsage: () => {} });

describe("talking in a chat", () => {
  it("a coworker can ask only its teammates, at most twice per reply; the answer comes back as a card and fenced", async () => {
    const asked: string[] = [];
    const tool = askTeammateTool("nibo", async (_u, from, to, q) => { asked.push(`${from}->${to}:${q}`); return { text: "Open with their booking page.", tokensIn: 1, tokensOut: 1, dropped: false }; });
    expect(tool.risk).toBe("READ_ONLY");
    expect(tool.input.safeParse({ teammate: "nibo", question: "ask myself?" }).success).toBe(false);
    expect(tool.input.safeParse({ teammate: "mika", question: "How would you open?", extra: 1 }).success).toBe(false);
    const ctx = toolCtx("run-cap");
    const results = [];
    for (let i = 0; i < LEAGUE_LIMITS.consultsPerReply + 1; i++) results.push(await tool.run!(ctx, { teammate: "mika", question: "How would you open?" }));
    expect(results.slice(0, -1).every((r) => r.ok)).toBe(true);
    expect(results.at(-1)).toMatchObject({ ok: false, code: "consult_limit" });
    expect(asked).toHaveLength(LEAGUE_LIMITS.consultsPerReply);
    const first = results[0] as { ok: true; summary: string; cards?: any[] };
    expect(first.summary).toMatch(/<untrusted/);
    expect(first.cards?.[0]).toMatchObject({ kind: "teammate", data: { from: "nibo", to: "mika", answer: "Open with their booking page." } });
    // a new reply gets its own allowance
    expect((await tool.run!(toolCtx("run-next"), { teammate: "zee", question: "Who owes us money?" })).ok).toBe(true);
  });

  it("a teammate that can't answer doesn't break the reply", async () => {
    const tool = askTeammateTool("mika", async () => { throw new Error("cap"); });
    expect(await tool.run!(toolCtx("run-x"), { teammate: "zee", question: "Who owes us money?" })).toMatchObject({ ok: false, code: "teammate_unavailable" });
  });

  it("handing work to a teammate ALWAYS asks first, says who handed it over, and starts the teammate's task", async () => {
    const starts: unknown[] = [];
    const tool = handoffTool("nibo", "mika", async (_u, task, input, idemKey) => { starts.push({ task, input, idemKey }); return { ok: true, run: { id: "lr_1" }, existing: false }; });
    expect(tool.name).toBe("handoff_nibo_to_mika");
    const prep = await tool.prepare!(toolCtx("r1"), { leadIds: [], max: 2 });
    if (!prep.ok) throw new Error();
    expect(prep.forceApproval).toBe(true);
    expect(prep.changesNothing).toBeUndefined();
    expect(prep.preview.title).toBe("Nibo asks Mika: Draft first messages");
    expect(prep.preview.lines[0]).toEqual({ label: "Handed over by", value: "Nibo" });
    const zee = await handoffTool("mika", "zee", async () => ({ ok: true, run: { id: "lr_2" }, existing: false })).prepare!(toolCtx("r1"), {});
    expect(zee.ok && zee.forceApproval).toBe(true); // even a briefing: it spends a task
    const done = await tool.execute!(toolCtx("r1"), { leadIds: [], max: 2 });
    expect(done).toMatchObject({ ok: true, route: "/ai-league/mika?run=lr_1" });
    expect(starts).toEqual([{ task: "mika.first_messages", input: { leadIds: [], max: 2 }, idemKey: "handoff:r1:mika.first_messages" }]);
  });

  it("a huddle from the chat is led by that coworker (the model can't pick another) and changes nothing", async () => {
    const starts: unknown[] = [];
    const tool = huddleTool("mika", async (_u, task, input) => { starts.push({ task, input }); return { ok: true, run: { id: "lr_3" }, existing: false }; });
    expect(tool.input.safeParse({ topic: "How do we land 3 new clients?", lead: "nibo" }).success).toBe(false);
    const prep = await tool.prepare!(toolCtx("r2"), { topic: "How do we land 3 new clients?" });
    if (!prep.ok) throw new Error();
    expect(prep.changesNothing).toBe(true);
    expect(prep.args).toEqual({ topic: "How do we land 3 new clients?", lead: "mika" });
    await tool.execute!(toolCtx("r2"), prep.args);
    expect(starts).toEqual([{ task: "team.huddle", input: { topic: "How do we land 3 new clients?", lead: "mika" } }]);
  });

  it("each coworker is told about its teammates and the teamwork tools", () => {
    for (const b of BOTS as readonly Bot[]) {
      const p = personaPrompt(b, []);
      expect(p).toContain("ask_teammate");
      expect(p).toContain(`handoff_${b}_to_`);
      expect(p).toContain(`league_${b}_huddle`);
    }
  });
});
