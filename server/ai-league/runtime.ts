/**
 * AI League's runtime: league runs driven by the existing durable Postgres workflow runner (server/workflow/runner.ts),
 * the same one AI Outbound's prospect runs use. The job IS the league_runs row:
 *
 *   claim    one atomic UPDATE takes a queued/running/waiting run whose lease is free (FOR UPDATE SKIP LOCKED)
 *   step     the task's next deterministic step (tasks/*.ts) runs as the person, and its checkpoint is saved fenced by the
 *            claim number; a worker that lost the run writes nothing
 *   wait     a run that waits on something (Nibo on its AI Outbound search) is parked: its lease is held until the next
 *            check, so nothing polls in between and a restart picks it up from the database, not from memory
 *   finish   one terminal status and the report, then ONE notification (it happens only if that fenced write won)
 *
 * Safety rails: a cancel request stops the run at its next step; a run longer than LEAGUE_RUN_MAX_MINUTES stops with
 * what it has; a step that throws is retried twice with backoff (2 and 4 minutes), then the run fails with the reason;
 * a run claimed more than MAX_CLAIMS times is failed as stuck. No database transaction is held across a model call,
 * a web request or a wait.
 *
 * Schedules have their own small workflow over league_schedules: a due slot is claimed (lease), its run is created with
 * the slot as the idempotency key (so a restart can't create it twice), and the schedule moves to its next slot.
 */
import { BOT_IDENTITY, TASK_LABEL, isTask, nextRunAt, type Bot, type LeagueReport, type LeagueTask } from "@shared/ai-league";
import type { LeagueRunRow, LeagueScheduleRow, User } from "@shared/schema";
import { createRunner, type StepResult, type Workflow } from "../workflow/runner";
import { leagueStore, leagueTablesReady, RunLimit, type ClaimedLeagueRun, type LeagueStore } from "./store";
import { runMaxMs } from "./limits";
import type { TaskCtx, TaskHandler } from "./tasks/types";

/** LEAGUE_EMAIL_REPORTS=true: email campaign and scheduled-task reports (needs RESEND_API_KEY, server/emails.ts). */
export const emailReports = (env: NodeJS.ProcessEnv = process.env) => env.LEAGUE_EMAIL_REPORTS === "true";
export const LEASE_MS = 90_000;
export const MAX_CLAIMS = 400;
/** A research campaign follows searches for hours (a check every 30 s): it may be claimed far more often. */
export const MAX_CLAIMS_CAMPAIGN = 4000;
/** Tasks that keep their own clock (start, work-until, delivery and a hard stop: shared/league-campaign.ts). */
const OWN_CLOCK = new Set(["nibo.campaign"]);
const MAX_ERRORS = 3;

export interface RuntimeDeps {
  store: LeagueStore;
  handlers: Record<LeagueTask, TaskHandler>;
  loadUser(id: string): Promise<User | undefined>;
  notify(run: LeagueRunRow, status: string, report: LeagueReport): Promise<void>;
  /** Creates a scheduled slot's run (limits applied as for any run). */
  startScheduled?(s: LeagueScheduleRow, slot: Date): Promise<{ runId: string | null; reason?: string }>;
  now(): Date;
  maxMs: number;
  ready(): Promise<boolean>;
  log(kind: string, fields: Record<string, unknown>): void;
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function leagueWorkflow(deps: () => RuntimeDeps): Workflow<ClaimedLeagueRun> {
  const finish = async (d: RuntimeDeps, run: ClaimedLeagueRun, status: "completed" | "partial" | "failed" | "cancelled", report: LeagueReport, errorCode: string | null, usage = { i: 0, o: 0 }) => {
    const now = d.now();
    const won = await d.store.save(run.id, run.fence, { status, stage: "done", report: report as unknown as Record<string, unknown>, errorCode, finishedAt: now, tokensIn: usage.i, tokensOut: usage.o }, now);
    if (!won) return;
    await d.store.addEvent({ runId: run.id, orgId: run.organizationId, kind: status, message: truncate(report.headline, 300), now });
    await d.notify(run, status, report).catch((e) => d.log("league_notify_failed", { runId: run.id, errorType: (e as Error)?.name }));
  };

  return {
    name: "league_runs",
    async claim(now) {
      const d = deps();
      if (!(await d.ready().catch(() => false))) return null;
      const run = await d.store.claim(now, LEASE_MS);
      if (run && run.attempts > (OWN_CLOCK.has(run.task) ? MAX_CLAIMS_CAMPAIGN : MAX_CLAIMS)) {
        await finish(d, run, "failed", { headline: "This task got stuck and was stopped. Nothing more will happen on it.", counts: [], items: [] }, "stuck");
        return null;
      }
      return run;
    },
    async step(run, _deadline): Promise<StepResult> {
      const d = deps();
      let lost = false;
      const timer = setInterval(() => { d.store.setLease(run.id, run.fence, new Date(Date.now() + LEASE_MS)).then((ok) => { if (!ok) lost = true; }).catch(() => {}); }, LEASE_MS / 3);
      timer.unref?.();
      try {
        const fresh = await d.store.peek(run.id);
        if (!fresh || !["queued", "running", "waiting"].includes(fresh.status)) return "done";
        Object.assign(run, fresh, { fence: run.fence });
        const now = d.now();
        if (fresh.cancelRequested) {
          await finish(d, run, "cancelled", { headline: "Cancelled. Anything already saved stays; nothing more will happen.", counts: [], items: [], next: null }, null);
          return "done";
        }
        if (!OWN_CLOCK.has(fresh.task) && fresh.startedAt && now.getTime() - new Date(fresh.startedAt).getTime() > d.maxMs) {
          await finish(d, run, "partial", { headline: "Stopped: this task ran past its time limit. What was done so far is kept.", counts: [], items: [], next: null }, "time_limit");
          return "done";
        }
        if (!isTask(fresh.task)) { await finish(d, run, "failed", { headline: "This kind of task isn't supported.", counts: [], items: [] }, "unknown_task"); return "done"; }
        const user = await d.loadUser(fresh.userId);
        if (!user || user.organizationId !== fresh.organizationId || (user as { memberStatus?: string }).memberStatus === "removed") {
          await finish(d, run, "failed", { headline: "Stopped: the person who started this task is no longer in this workspace.", counts: [], items: [] }, "member_left");
          return "done";
        }
        if (fresh.status !== "running") await d.store.save(run.id, run.fence, { status: "running" }, now);
        const usage = { i: 0, o: 0 };
        const ctx: TaskCtx = {
          run: fresh, user, checkpoint: { ...(fresh.checkpoint ?? {}) }, now: d.now,
          event: (kind, message, data) => (lost ? Promise.resolve() : d.store.addEvent({ runId: run.id, orgId: run.organizationId, kind, message, data: data ?? null, now: d.now() })),
          addUsage: (i, o) => { usage.i += i; usage.o += o; },
        };
        const out = await d.handlers[fresh.task].step(ctx, fresh.stage === "start" || !fresh.stage ? "start" : fresh.stage);
        if (lost) return "done";
        if (out.kind === "finish") { await finish(d, run, out.status, out.report, out.errorCode ?? null, usage); return "done"; }
        // A step that worked ends any run of errors: retries count consecutive failures, not a night's worth of blips.
        const { errors: _cleared, ...checkpoint } = (out.checkpoint ?? ctx.checkpoint) as Record<string, unknown>;
        const ok = await d.store.save(run.id, run.fence, { status: out.kind === "wait" ? "waiting" : "running", stage: out.stage, checkpoint, tokensIn: usage.i, tokensOut: usage.o }, d.now());
        if (!ok) return "done";
        return out.kind === "wait" ? { wait: out.until } : "more";
      } finally {
        clearInterval(timer);
      }
    },
    park: async (run, until) => { await deps().store.setLease(run.id, run.fence, until); },
    release: async (run) => { await deps().store.setLease(run.id, run.fence, null); },
    nextWake: (now) => deps().store.nextWake(now),
    async failed(run, err) {
      const d = deps();
      d.log("league_step_error", { runId: run.id, task: run.task, errorType: (err as Error)?.name ?? "Error" }); // never the message
      const fresh = await d.store.peek(run.id);
      const errors = Number((fresh?.checkpoint as { errors?: unknown } | undefined)?.errors ?? 0) + 1;
      if (errors >= MAX_ERRORS) {
        await finish(d, run, "failed", { headline: "This task kept hitting an error and was stopped. Anything already saved stays.", counts: [], items: [], notes: ["Try it again later; if it keeps failing, tell support@dealinsec.com."] }, "error");
        return;
      }
      await d.store.save(run.id, run.fence, { checkpoint: { ...(fresh?.checkpoint ?? {}), errors } }, d.now());
      await d.store.setLease(run.id, run.fence, new Date(d.now().getTime() + 60_000 * 2 ** errors)); // 2, then 4 minutes
    },
  };
}

/** The scheduler: one due slot at a time, idempotent per slot. */
export function scheduleWorkflow(deps: () => RuntimeDeps): Workflow<LeagueScheduleRow> {
  return {
    name: "league_schedules",
    async claim(now) {
      const d = deps();
      if (!(await d.ready().catch(() => false))) return null;
      return d.store.claimDueSchedule(now, 60_000);
    },
    async step(s): Promise<StepResult> {
      const d = deps();
      const slot = s.nextRunAt ? new Date(s.nextRunAt) : d.now();
      const made = d.startScheduled ? await d.startScheduled(s, slot) : { runId: null, reason: "not_wired" };
      // A missed slot runs once and the next one is computed from now: no backlog of past runs after downtime.
      await d.store.advanceSchedule(s.id, slot, { nextRunAt: nextRunAt({ frequency: s.frequency as "daily", timeOfDay: s.timeOfDay, weekday: s.weekday, timezone: s.timezone }, d.now()), lastRunId: made.runId, now: d.now() });
      if (!made.runId) d.log("league_schedule_skipped", { scheduleId: s.id, reason: made.reason ?? "unknown" });
      return "done";
    },
    release: async () => {},
    nextWake: (now) => deps().store.nextScheduleWake(now),
    async failed(s, err) { deps().log("league_schedule_error", { scheduleId: s.id, errorType: (err as Error)?.name ?? "Error" }); },
  };
}

/* ── the real wiring ─────────────────────────────────────────────────────── */

let real: RuntimeDeps | null = null;
export function realRuntimeDeps(): RuntimeDeps {
  if (real) return real;
  real = {
    store: leagueStore,
    handlers: null as unknown as Record<LeagueTask, TaskHandler>, // filled lazily below (the services import the database)
    loadUser: async (id) => (await import("../storage")).storage.getUser(id),
    notify: async (run, status, report) => {
      const { storage } = await import("../storage");
      const bot = BOT_IDENTITY[run.bot as Bot];
      // Email, when switched on, for the work people walk away from (campaigns, scheduled tasks): to the account's own
      // address, counts and a link only. Tracked as its own event; a failed email never re-runs the work.
      if (emailReports() && (OWN_CLOCK.has(run.task) || run.source === "schedule")) {
        const user = await storage.getUser(run.userId).catch(() => undefined);
        const { sendEmail, leagueReportEmail } = await import("../emails");
        const mail = leagueReportEmail({ coworker: bot?.name ?? "AI League", taskLabel: TASK_LABEL[run.task as LeagueTask] ?? run.task, headline: report.headline, counts: report.counts, runId: run.id, partial: status !== "completed" });
        let sent = false;
        for (let attempt = 0; attempt < 3 && !sent && user?.email; attempt++) {
          sent = await sendEmail({ to: user.email, ...mail });
          if (!sent && attempt < 2) await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        }
        await leagueStore.addEvent({ runId: run.id, orgId: run.organizationId, kind: sent ? "emailed" : "email_failed", message: sent ? "Report emailed to you" : "The report email couldn't be sent; the report is here in the app", now: new Date() }).catch(() => {});
      }
      await storage.logActivity({
        organizationId: run.organizationId, userId: run.userId, userName: bot?.name ?? "AI League",
        action: status === "completed" ? "finished a task" : status === "partial" ? "partly finished a task" : status === "cancelled" ? "cancelled a task" : "couldn't finish a task",
        entityType: "ai_league_run", entityId: run.id, detail: truncate(`${TASK_LABEL[run.task as LeagueTask] ?? run.task}: ${report.headline}`, 250),
      });
      await leagueStore.addEvent({ runId: run.id, orgId: run.organizationId, kind: "notified", message: "You were notified in the app", now: new Date() }).catch(() => {});
    },
    now: () => new Date(),
    maxMs: runMaxMs(),
    ready: async () => { try { return await leagueTablesReady(); } catch { return false; } },
    log: (kind, fields) => console.log(JSON.stringify({ kind, ...fields })),
  };
  return real;
}

export async function wireHandlers(): Promise<void> {
  const d = realRuntimeDeps();
  if (d.handlers) return;
  const { buildHandlers, startScheduledRun } = await import("./wiring");
  d.handlers = buildHandlers();
  d.startScheduled = startScheduledRun;
}

export const leagueRunner = createRunner(leagueWorkflow(realRuntimeDeps));
export const scheduleRunner = createRunner(scheduleWorkflow(realRuntimeDeps));

/** Kicked at boot and whenever a run or schedule changes. */
export function kickLeague(): void {
  void wireHandlers().then(() => { leagueRunner.kick(); scheduleRunner.kick(); }).catch((e) => console.log(JSON.stringify({ kind: "league_wire_failed", errorType: (e as Error)?.name })));
}

export { RunLimit };
