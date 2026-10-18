/**
 * The runtime over an in-memory store with the database's guarantees: a run survives a "restart" (the job is the row),
 * a wait parks it, cancellation and the time limit stop it, a failing step is retried twice with backoff and then
 * failed, each run notifies exactly once, and a schedule slot becomes exactly one run even if fired twice.
 */
import { describe, expect, it } from "vitest";
import { vi } from "vitest";
vi.mock("../db", () => ({ db: {} }));
import type { LeagueReport, LeagueTask } from "@shared/ai-league";
import { createRunner } from "../workflow/runner";
import { memoryLeagueStore } from "./memory-store";
import { leagueWorkflow, scheduleWorkflow, type RuntimeDeps } from "./runtime";
import type { TaskHandler } from "./tasks/types";

const T0 = new Date("2026-10-18T10:00:00Z");
const report = (headline: string): LeagueReport => ({ headline, counts: [], items: [] });

function setup(handlers: Partial<Record<LeagueTask, TaskHandler>>, over: Partial<RuntimeDeps> = {}) {
  const mem = memoryLeagueStore();
  let now = T0;
  const notified: { runId: string; status: string }[] = [];
  const users: Record<string, any> = { u1: { id: "u1", organizationId: "org-1" }, u2: { id: "u2", organizationId: "org-2" } };
  const deps: RuntimeDeps = {
    store: mem.store, handlers: handlers as Record<LeagueTask, TaskHandler>,
    loadUser: async (id) => users[id], notify: async (run, status) => { notified.push({ runId: run.id, status }); },
    now: () => now, maxMs: 45 * 60_000, ready: async () => true, log: () => {}, ...over,
  };
  const wf = leagueWorkflow(() => deps);
  const runner = createRunner(wf, { now: () => now.getTime(), log: () => {} });
  const start = (task: LeagueTask, idemKey = `k${Math.random()}`, orgId = "org-1", userId = "u1") => mem.store.createRun({ id: `lr_${Math.random().toString(16).slice(2, 14).padEnd(12, "0")}`, orgId, userId, bot: task.split(".")[0], task, input: {}, idemKey, source: "page", now, limits: { monthly: { since: new Date(0), max: 99 }, concurrent: 5 } });
  return { mem, deps, wf, runner, notified, start, users, advance: (ms: number) => { now = new Date(now.getTime() + ms); }, setNow: (d: Date) => { now = d; } };
}

describe("league runs on the durable runner", () => {
  it("runs a task to its report and notifies once", async () => {
    const t = setup({ "zee.briefing": { step: async (ctx) => { await ctx.event("records_read", "Read your records"); return { kind: "finish", status: "completed", report: report("All clear today") }; } } });
    const { run } = await t.start("zee.briefing");
    await t.runner.tickOnce();
    const r = t.mem.runs.find((x) => x.id === run.id)!;
    expect(r).toMatchObject({ status: "completed", stage: "done", leaseUntil: null });
    expect((r.report as any).headline).toBe("All clear today");
    expect(t.mem.events.filter((e) => e.runId === run.id).map((e) => e.kind)).toEqual(["queued", "records_read", "completed"]);
    expect(t.notified).toEqual([{ runId: run.id, status: "completed" }]);
    expect(await t.runner.tickOnce()).toBe(false); // nothing left
  });

  it("a wait parks the run (its lease held, no worker); a 'restart' resumes it from the database", async () => {
    let calls = 0;
    const t = setup({ "nibo.find_clients": { step: async (_ctx, stage) => { calls++; return stage === "start" ? { kind: "wait", stage: "researching", until: new Date(T0.getTime() + 20_000), checkpoint: { outboundRunId: "pr_1" } } : { kind: "finish", status: "completed", report: report("Saved 2") }; } } });
    const { run } = await t.start("nibo.find_clients");
    await t.runner.tickOnce();
    let r = t.mem.runs.find((x) => x.id === run.id)!;
    expect(r).toMatchObject({ status: "waiting", stage: "researching", checkpoint: { outboundRunId: "pr_1" } });
    expect(await t.runner.tickOnce()).toBe(false); // parked: nobody can claim it before its time
    // A new process (a fresh runner over the same rows) after the wait: it picks the run up where it was.
    t.advance(21_000);
    const fresh = createRunner(leagueWorkflow(() => t.deps), { now: () => T0.getTime() + 21_000, log: () => {} });
    await fresh.tickOnce();
    r = t.mem.runs.find((x) => x.id === run.id)!;
    expect(r.status).toBe("completed");
    expect(calls).toBe(2);
  });

  it("a worker that lost its lease writes nothing (fenced)", async () => {
    const t = setup({ "zee.briefing": { step: async () => ({ kind: "finish", status: "completed", report: report("x") }) } });
    const { run } = await t.start("zee.briefing");
    const claimed = (await t.mem.store.claim(T0, 90_000))!;
    t.advance(100_000);
    const stolen = (await t.mem.store.claim(new Date(T0.getTime() + 100_000), 90_000))!; // the lease expired; another worker takes it
    expect(stolen.fence).toBe(claimed.fence + 1);
    expect(await t.mem.store.save(run.id, claimed.fence, { status: "failed" }, new Date())).toBe(false);
    expect(t.mem.runs.find((x) => x.id === run.id)!.status).toBe("running");
  });

  it("cancel: a queued run is cancelled at once; a working one stops at its next step, nothing more runs", async () => {
    let steps = 0;
    const t = setup({ "nibo.find_clients": { step: async () => { steps++; return { kind: "wait", stage: "researching", until: new Date(T0.getTime() + 1000) }; } } });
    const queued = (await t.start("nibo.find_clients")).run;
    expect((await t.mem.store.requestCancel("org-1", "u1", queued.id, T0))!.status).toBe("cancelled");
    const working = (await t.start("nibo.find_clients")).run;
    await t.runner.tickOnce();
    await t.mem.store.requestCancel("org-1", "u1", working.id, T0);
    t.advance(2000);
    await t.runner.tickOnce();
    expect(t.mem.runs.find((x) => x.id === working.id)!.status).toBe("cancelled");
    expect(steps).toBe(1);
    expect(t.notified.map((n) => n.status)).toEqual(["cancelled"]);
  });

  it("stops a run past its time limit with what it has (partial), and fails one whose owner left the workspace", async () => {
    const t = setup({ "nibo.find_clients": { step: async () => ({ kind: "wait", stage: "researching", until: new Date(T0.getTime() + 1000) }) } }, { maxMs: 60_000 });
    const { run } = await t.start("nibo.find_clients");
    await t.runner.tickOnce();
    t.advance(120_000);
    await t.runner.tickOnce();
    expect(t.mem.runs.find((x) => x.id === run.id)).toMatchObject({ status: "partial", errorCode: "time_limit" });
    const gone = await t.start("nibo.find_clients");
    t.users.u1 = { id: "u1", organizationId: "another-org" };
    await t.runner.tickOnce();
    expect(t.mem.runs.find((x) => x.id === gone.run.id)).toMatchObject({ status: "failed", errorCode: "member_left" });
  });

  it("a step that throws is retried twice with backoff, then failed with the reason; never a tight loop", async () => {
    let calls = 0;
    const t = setup({ "zee.briefing": { step: async () => { calls++; throw new Error("db hiccup with secret page text"); } } });
    const { run } = await t.start("zee.briefing");
    await t.runner.tickOnce();
    let r = t.mem.runs.find((x) => x.id === run.id)!;
    expect(r.checkpoint).toMatchObject({ errors: 1 });
    expect(+r.leaseUntil! - +T0).toBe(120_000); // 2 minutes
    expect(await t.runner.tickOnce()).toBe(false);
    t.advance(121_000); await t.runner.tickOnce();
    r = t.mem.runs.find((x) => x.id === run.id)!;
    expect(r.checkpoint).toMatchObject({ errors: 2 });
    t.advance(241_000); await t.runner.tickOnce();
    r = t.mem.runs.find((x) => x.id === run.id)!;
    expect(r).toMatchObject({ status: "failed", errorCode: "error" });
    expect(calls).toBe(3);
    expect(JSON.stringify(r.report)).not.toContain("secret page text");
  });

  it("an unknown task is failed, never run", async () => {
    const t = setup({});
    const { run } = await t.mem.store.createRun({ id: "lr_unknowntask00", orgId: "org-1", userId: "u1", bot: "zee", task: "zee.wire_money", input: {}, idemKey: "x", source: "page", now: T0, limits: { monthly: { since: new Date(0), max: 9 }, concurrent: 9 } });
    await t.runner.tickOnce();
    expect(t.mem.runs.find((x) => x.id === run.id)).toMatchObject({ status: "failed", errorCode: "unknown_task" });
  });
});

describe("schedules", () => {
  it("a due slot becomes one run (idempotent per slot), and the schedule moves to its next time; a missed backlog runs once", async () => {
    const t = setup({});
    const started: string[] = [];
    t.deps.startScheduled = async (s, slot) => {
      const { run, existing } = await t.mem.store.createRun({ id: `lr_${started.length}abcdef01234`, orgId: s.organizationId, userId: s.userId, bot: s.bot, task: s.task, input: s.input, idemKey: `sched:${s.id}:${slot.toISOString()}`, source: "schedule", scheduleId: s.id, now: T0, limits: { monthly: { since: new Date(0), max: 99 }, concurrent: 9 } });
      if (!existing) started.push(run.id);
      return { runId: run.id };
    };
    const s = await t.mem.store.createSchedule({ organizationId: "org-1", userId: "u1", bot: "zee", task: "zee.briefing", input: {}, frequency: "daily", timeOfDay: "09:00", weekday: null, timezone: "Asia/Kolkata", status: "active", nextRunAt: new Date("2026-10-15T03:30:00Z"), now: T0 });
    const sched = createRunner(scheduleWorkflow(() => t.deps), { now: () => T0.getTime(), log: () => {} });
    await sched.tickOnce();
    expect(started).toHaveLength(1); // three days missed: one run, not three
    const after = t.mem.schedules.find((x) => x.id === s.id)!;
    expect(after.nextRunAt!.toISOString()).toBe("2026-10-19T03:30:00.000Z"); // computed from now, in India's time
    expect(after.lastRunId).toBe(started[0]);
    // The same slot fired again (a crash before advancing, a second process): still one run.
    await t.deps.startScheduled!(s, new Date("2026-10-15T03:30:00Z"));
    expect(started).toHaveLength(1);
    expect(await sched.tickOnce()).toBe(false); // not due again until tomorrow
  });

  it("a paused schedule never fires", async () => {
    const t = setup({});
    let fired = 0;
    t.deps.startScheduled = async () => { fired++; return { runId: null }; };
    await t.mem.store.createSchedule({ organizationId: "org-1", userId: "u1", bot: "zee", task: "zee.briefing", input: {}, frequency: "daily", timeOfDay: "09:00", weekday: null, timezone: "UTC", status: "paused", nextRunAt: new Date("2026-10-15T09:00:00Z"), now: T0 });
    await createRunner(scheduleWorkflow(() => t.deps), { now: () => T0.getTime(), log: () => {} }).tickOnce();
    expect(fired).toBe(0);
  });
});
