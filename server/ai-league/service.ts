/**
 * AI League: what the routes and the coworkers' chat tools call. Every function takes the signed-in person; the
 * organization and user always come from them, never from the request or a model.
 *
 *   startLeagueRun    validate the task's input, check the plan's limits, create the run once per idempotency key, kick
 *   roster            each coworker's real state (working, waiting for you, needs attention, available) from rows
 *   runs / run        activity and one run with its milestones and report
 *   cancel / retry    stop a run at its next step; start the same task again (a new run)
 *   approvals         what waits for the person: chat requests (agent approvals) and Mika's drafts (the outreach queue)
 *   schedules         recurring tasks in the person's timezone; run now
 *   usage, memory     allowances used; preferences the coworkers read, which the person can correct or delete
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  BOTS, BOT_IDENTITY, RUN_STATUS_LABEL, TASK_INPUT, botForTask, TASK_LABEL, isBot, isTask, nextRunAt, scheduleInput, validTimeZone,
  type Bot, type BotStatus, type LeagueReport, type LeagueRunStatus, type LeagueTask,
} from "@shared/ai-league";
import { approvalStatusFromServer } from "@shared/agent";
import type { LeagueRunEventRow, LeagueRunRow, LeagueScheduleRow } from "@shared/schema";
import { fail, readGate, writeGate, type Result, type Who } from "../services/leads";
import { outboundTier } from "../outbound/plan";
import { leagueAllowance, LEAGUE_WINDOW_DAYS } from "./limits";
import { campaignTimesProblem } from "@shared/league-campaign";
import { leagueStore, leagueTablesReady, RunLimit, type LeagueStore } from "./store";

const DAY = 86_400_000;
export interface LeagueDeps { store: LeagueStore; now: () => Date; ready: () => Promise<boolean>; kick: () => void; tier: (u: Who) => Promise<"free" | "trial" | "pro"> }
const defaults = (): LeagueDeps => ({
  store: leagueStore, now: () => new Date(),
  ready: async () => { try { return await leagueTablesReady(); } catch { return false; } },
  kick: () => { void import("./runtime").then((m) => m.kickLeague()); },
  tier: outboundTier,
});
const NOT_SETUP = () => fail(503, "LEAGUE_NOT_SETUP", "The Nest isn't set up on this server yet.");
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

/* ── views ───────────────────────────────────────────────────────────────── */

export interface RunView {
  id: string; bot: Bot; task: LeagueTask; taskLabel: string; status: LeagueRunStatus; statusLabel: string; stage: string;
  request: string | null; source: string; report: LeagueReport | null; errorCode: string | null; unread: boolean; cancelRequested: boolean;
  scheduleId: number | null; createdAt: string; startedAt: string | null; finishedAt: string | null; tokens: number;
  /** A campaign's own clock (start, report due, the timezone they were given in); null for other tasks. */
  timing: { startAt: string | null; deliverAt: string | null; timezone: string } | null;
}
/** A waiting campaign says what it waits for: its start, or its delivery time (the report is already saved). */
const statusLabelOf = (r: LeagueRunRow): string =>
  r.status === "waiting" && r.stage === "start" ? "Scheduled"
    : r.status === "waiting" && r.stage === "deliver" ? "Report scheduled"
      : RUN_STATUS_LABEL[r.status as LeagueRunStatus] ?? r.status;

/** What the person asked for: a search request, or a huddle's topic. */
const requestOf = (input: unknown): string | null => {
  const i = (input ?? {}) as { request?: unknown; topic?: unknown };
  return typeof i.request === "string" ? i.request : typeof i.topic === "string" ? i.topic : null;
};
export const runView = (r: LeagueRunRow): RunView => ({
  id: r.id, bot: r.bot as Bot, task: r.task as LeagueTask, taskLabel: TASK_LABEL[r.task as LeagueTask] ?? r.task,
  status: r.status as LeagueRunStatus, statusLabel: statusLabelOf(r), stage: r.stage,
  request: requestOf(r.input),
  source: r.source, report: (r.report as LeagueReport | null) ?? null, errorCode: r.errorCode,
  unread: !r.readAt && ["completed", "partial", "failed"].includes(r.status), cancelRequested: r.cancelRequested,
  scheduleId: r.scheduleId, createdAt: iso(r.createdAt)!, startedAt: iso(r.startedAt), finishedAt: iso(r.finishedAt), tokens: r.tokensIn + r.tokensOut,
  timing: r.task === "nibo.campaign" ? timingOf(r.input) : null,
});
const timingOf = (input: unknown) => {
  const i = (input ?? {}) as { startAt?: unknown; deliverAt?: unknown; timezone?: unknown };
  return { startAt: typeof i.startAt === "string" ? i.startAt : null, deliverAt: typeof i.deliverAt === "string" ? i.deliverAt : null, timezone: typeof i.timezone === "string" ? i.timezone : "Asia/Kolkata" };
};
export interface EventView { id: number; kind: string; message: string; href: string | null; at: string }
const SAFE_HREF = /^\/[A-Za-z0-9/_\-?=&%.]{0,200}$/;
export const eventView = (e: LeagueRunEventRow): EventView => {
  const href = typeof (e.data as { href?: unknown } | null)?.href === "string" ? String((e.data as { href: string }).href) : null;
  return { id: e.id, kind: e.kind, message: e.message, href: href && SAFE_HREF.test(href) ? href : null, at: iso(e.createdAt)! };
};
export interface ScheduleView { id: number; bot: Bot; task: LeagueTask; taskLabel: string; input: Record<string, unknown>; frequency: string; timeOfDay: string; weekday: number | null; timezone: string; status: string; nextRunAt: string | null; lastRunId: string | null; lastRunAt: string | null }
const scheduleView = (s: LeagueScheduleRow): ScheduleView => ({
  id: s.id, bot: s.bot as Bot, task: s.task as LeagueTask, taskLabel: TASK_LABEL[s.task as LeagueTask] ?? s.task, input: s.input, frequency: s.frequency, timeOfDay: s.timeOfDay,
  weekday: s.weekday, timezone: s.timezone, status: s.status, nextRunAt: iso(s.nextRunAt), lastRunId: s.lastRunId, lastRunAt: iso(s.lastRunAt),
});

/* ── starting a task ─────────────────────────────────────────────────────── */

export async function startLeagueRun(user: Who, task: unknown, rawInput: unknown, opts: { source: "chat" | "page" | "schedule"; idemKey?: string; scheduleId?: number | null } , d: Partial<LeagueDeps> = {}): Promise<Result<{ run: RunView; existing: boolean }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await deps.ready())) return NOT_SETUP();
  if (!isTask(task)) return fail(400, "invalid", "That isn't a task a coworker can do.");
  const parsed = (TASK_INPUT[task] as z.ZodTypeAny).safeParse(rawInput ?? {});
  if (!parsed.success) return fail(400, "invalid", parsed.error.issues[0]?.message ?? "That task's details aren't valid.");
  // A campaign's times are checked here, before anything is stored: the person is told now, not at midnight.
  if (task === "nibo.campaign") {
    const problem = campaignTimesProblem(parsed.data, deps.now());
    if (problem) return fail(400, "invalid_times", problem);
  }
  const now = deps.now(), orgId = user.organizationId!;
  const tier = await deps.tier(user).catch(() => "free" as const);
  const allowance = leagueAllowance(tier);
  try {
    const { run, existing } = await deps.store.createRun({
      id: `lr_${randomUUID().replace(/-/g, "").slice(0, 24)}`, orgId, userId: user.id, bot: botForTask(task, parsed.data), task, input: parsed.data, now,
      idemKey: (opts.idemKey ?? `once:${randomUUID()}`).slice(0, 80), source: opts.source, scheduleId: opts.scheduleId ?? null,
      limits: { monthly: { since: new Date(now.getTime() - LEAGUE_WINDOW_DAYS * DAY), max: allowance.monthlyRuns }, concurrent: allowance.concurrent },
    });
    deps.kick();
    return { ok: true, run: runView(run), existing };
  } catch (e) {
    if (e instanceof RunLimit) {
      return e.kind === "concurrent"
        ? fail(429, "busy", `Your coworkers are already working on ${e.max} task${e.max === 1 ? "" : "s"}. This one can start when ${e.max === 1 ? "it finishes" : "one finishes"}.`)
        : tier === "free"
          ? fail(402, "NO_CREDITS", `You've used the free plan's ${e.max} AI team tasks for this 30-day period. Upgrade to Pro for more.`, { feature: "outbound" })
          : fail(429, "monthly_limit", `You've used the ${e.max} AI team tasks included in your plan for this 30-day period. More become available as earlier tasks pass 30 days.`);
    }
    throw e;
  }
}

/* ── roster, runs, a run ─────────────────────────────────────────────────── */

export interface BotCard { bot: Bot; status: BotStatus; activeRun: RunView | null; lastRun: RunView | null; unread: number; nextSchedule: string | null; waiting: number }

export async function roster(user: Who, d: Partial<LeagueDeps> & { pendingApprovals?: (user: Who) => Promise<Record<Bot, number>> } = {}): Promise<Result<{ bots: BotCard[]; ready: boolean }>> {
  const deps = { ...defaults(), ...d };
  const gate = readGate(user);
  if (gate) return gate;
  if (!(await deps.ready())) return { ok: true, ready: false, bots: BOTS.map((bot) => ({ bot, status: "available" as BotStatus, activeRun: null, lastRun: null, unread: 0, nextSchedule: null, waiting: 0 })) };
  const orgId = user.organizationId!;
  const [recent, schedules, waiting] = await Promise.all([
    deps.store.listRuns(orgId, user.id, { limit: 60, since: new Date(deps.now().getTime() - 60 * DAY) }),
    deps.store.schedules(orgId, user.id),
    (d.pendingApprovals ?? pendingByBot)(user).catch(() => ({ nibo: 0, mika: 0, zee: 0 })),
  ]);
  const bots = BOTS.map((bot): BotCard => {
    const mine = recent.filter((r) => r.bot === bot);
    const active = mine.find((r) => ["queued", "running", "waiting"].includes(r.status)) ?? null;
    const last = mine.find((r) => ["completed", "partial", "failed", "cancelled"].includes(r.status)) ?? null;
    const unread = mine.filter((r) => !r.readAt && ["completed", "partial", "failed"].includes(r.status)).length;
    const next = schedules.filter((s) => s.bot === bot && s.status === "active" && s.nextRunAt).map((s) => new Date(s.nextRunAt!)).sort((a, b) => +a - +b)[0] ?? null;
    const status: BotStatus = active ? "working" : waiting[bot] > 0 ? "needs_you" : last && last.status === "failed" && !last.readAt ? "attention" : "available";
    return { bot, status, activeRun: active ? runView(active) : null, lastRun: last ? runView(last) : null, unread, nextSchedule: next ? next.toISOString() : null, waiting: waiting[bot] };
  });
  return { ok: true, ready: true, bots };
}

const RUN_FILTER = z.object({ bot: z.enum(BOTS).optional(), status: z.string().max(80).optional(), task: z.string().max(40).optional(), days: z.coerce.number().int().min(1).max(365).optional() });
export async function listRuns(user: Who, raw: unknown, d: Partial<LeagueDeps> = {}): Promise<Result<{ runs: RunView[] }>> {
  const deps = { ...defaults(), ...d };
  const gate = readGate(user);
  if (gate) return gate;
  if (!(await deps.ready())) return NOT_SETUP();
  const f = RUN_FILTER.safeParse(raw ?? {});
  if (!f.success) return fail(400, "invalid", "Those filters aren't valid.");
  const status = f.data.status?.split(",").filter((s) => ["queued", "running", "waiting", "completed", "partial", "failed", "cancelled"].includes(s));
  const rows = await deps.store.listRuns(user.organizationId!, user.id, { bot: f.data.bot, task: f.data.task && isTask(f.data.task) ? f.data.task : undefined, status, since: f.data.days ? new Date(deps.now().getTime() - f.data.days * DAY) : undefined, limit: 100 });
  return { ok: true, runs: rows.map(runView) };
}

export async function getRun(user: Who, id: string, d: Partial<LeagueDeps> = {}): Promise<Result<{ run: RunView; events: EventView[] }>> {
  const deps = { ...defaults(), ...d };
  const gate = readGate(user);
  if (gate) return gate;
  if (!(await deps.ready())) return NOT_SETUP();
  const run = await deps.store.getRun(user.organizationId!, user.id, id);
  if (!run) return fail(404, "not_found", "That task isn't in your workspace.");
  if (["queued", "running", "waiting"].includes(run.status)) deps.kick(); // someone is looking: make sure it's being worked
  const events = await deps.store.events(user.organizationId!, id);
  return { ok: true, run: runView(run), events: events.map(eventView) };
}

export async function markRunRead(user: Who, id: string, d: Partial<LeagueDeps> = {}): Promise<Result<{ ok: true }>> {
  const deps = { ...defaults(), ...d };
  const gate = readGate(user);
  if (gate) return gate;
  if (!(await deps.ready())) return NOT_SETUP();
  await deps.store.markRunRead(user.organizationId!, user.id, id, deps.now());
  return { ok: true };
}

export async function cancelRun(user: Who, id: string, d: Partial<LeagueDeps> = {}): Promise<Result<{ run: RunView }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await deps.ready())) return NOT_SETUP();
  const run = await deps.store.requestCancel(user.organizationId!, user.id, id, deps.now());
  if (!run) return fail(404, "not_found", "That task isn't in your workspace.");
  if (!["queued", "running", "waiting", "cancelled"].includes(run.status)) return fail(409, "finished", "That task has already finished.");
  deps.kick();
  return { ok: true, run: runView(run) };
}

export async function retryRun(user: Who, id: string, d: Partial<LeagueDeps> = {}): Promise<Result<{ run: RunView; existing: boolean }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await deps.ready())) return NOT_SETUP();
  const run = await deps.store.getRun(user.organizationId!, user.id, id);
  if (!run) return fail(404, "not_found", "That task isn't in your workspace.");
  if (!["failed", "partial", "cancelled"].includes(run.status)) return fail(409, "not_retryable", "Only a task that didn't finish can be tried again.");
  return startLeagueRun(user, run.task, run.input, { source: "page", idemKey: `retry:${run.id}:${run.attempts}` }, d);
}

/* ── approvals: what waits for the person ────────────────────────────────── */

export interface ApprovalItem {
  kind: "chat" | "draft"; id: string; bot: Bot; title: string; lines: { label: string; value: string }[]; createdAt: string;
  expiresAt: string | null; href: string | null; bodyHash?: string; body?: string; subject?: string; to?: string | null;
}

/** Pending chat approvals in the coworkers' conversations, and Mika's drafts waiting in the outreach queue. */
export async function listApprovals(user: Who, d: Partial<LeagueDeps> = {}): Promise<Result<{ items: ApprovalItem[] }>> {
  const deps = { ...defaults(), ...d };
  const gate = readGate(user);
  if (gate) return gate;
  if (!(await deps.ready())) return NOT_SETUP();
  const items: ApprovalItem[] = [];
  const threads = await deps.store.threads(user.organizationId!, user.id);
  if (threads.length) {
    const { db } = await import("../db");
    const { agentApprovals } = await import("@shared/schema");
    const rows = await db.select().from(agentApprovals).where(and(eq(agentApprovals.organizationId, user.organizationId!), eq(agentApprovals.userId, user.id), inArray(agentApprovals.sessionId, threads.map((t) => t.sessionId)), eq(agentApprovals.status, "pending"))).orderBy(desc(agentApprovals.createdAt)).limit(50);
    for (const a of rows) {
      if (approvalStatusFromServer(a.status, a.expiresAt) !== "pending") continue;
      const bot = threads.find((t) => t.sessionId === a.sessionId)?.bot as Bot;
      const p = (a.preview ?? {}) as { title?: string; lines?: { label: string; value: string }[] };
      items.push({ kind: "chat", id: a.id, bot, title: p.title ?? a.tool, lines: Array.isArray(p.lines) ? p.lines.slice(0, 8) : [], createdAt: iso(a.createdAt)!, expiresAt: iso(a.expiresAt), href: `/ai-league/${bot}` });
    }
  }
  try {
    const { listOutreachQueue } = await import("../sales/outreach");
    const q = await listOutreachQueue(user, { status: "waiting" });
    if (q.ok) for (const it of q.items) {
      if (it.message.createdBy !== "agent" || it.message.status !== "draft") continue;
      items.push({ kind: "draft", id: String(it.message.id), bot: "mika", title: `Message to ${it.lead.companyName}`, lines: [{ label: "To", value: it.message.to ?? "no address" }], createdAt: it.message.createdAt, expiresAt: null, href: `/leads/${it.lead.id}`, bodyHash: it.message.bodyHash, body: it.message.body, subject: it.message.subject, to: it.message.to });
    }
  } catch { /* outreach not set up: no drafts to list */ }
  return { ok: true, items };
}

async function pendingByBot(user: Who): Promise<Record<Bot, number>> {
  const r = await listApprovals(user);
  const out: Record<Bot, number> = { nibo: 0, mika: 0, zee: 0 };
  if (r.ok) for (const i of r.items) out[i.bot]++;
  return out;
}

/* ── schedules ───────────────────────────────────────────────────────────── */

export async function listSchedules(user: Who, d: Partial<LeagueDeps> = {}): Promise<Result<{ schedules: ScheduleView[] }>> {
  const deps = { ...defaults(), ...d };
  const gate = readGate(user);
  if (gate) return gate;
  if (!(await deps.ready())) return NOT_SETUP();
  return { ok: true, schedules: (await deps.store.schedules(user.organizationId!, user.id)).map(scheduleView) };
}

export async function createSchedule(user: Who, raw: unknown, d: Partial<LeagueDeps> = {}): Promise<Result<{ schedule: ScheduleView }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await deps.ready())) return NOT_SETUP();
  const p = scheduleInput.safeParse(raw ?? {});
  if (!p.success) return fail(400, "invalid", p.error.issues[0]?.message ?? "That schedule isn't valid.");
  if (!validTimeZone(p.data.timezone)) return fail(400, "invalid", "That timezone isn't recognized.");
  const input = (TASK_INPUT[p.data.task] as z.ZodTypeAny).safeParse(p.data.input);
  if (!input.success) return fail(400, "invalid", input.error.issues[0]?.message ?? "That task's details aren't valid.");
  const tier = await deps.tier(user).catch(() => "free" as const);
  const allowance = leagueAllowance(tier);
  if ((await deps.store.countSchedules(user.organizationId!)) >= allowance.schedules) {
    return tier === "free" ? fail(402, "NO_CREDITS", `The free plan includes ${allowance.schedules} recurring task. Upgrade to Pro for more.`, { feature: "outbound" }) : fail(429, "schedule_limit", `Your plan includes ${allowance.schedules} recurring tasks. Delete one to add another.`);
  }
  const weekday = p.data.frequency === "weekly" ? (p.data.weekday ?? 1) : null;
  const now = deps.now();
  const row = await deps.store.createSchedule({
    organizationId: user.organizationId!, userId: user.id, bot: botForTask(p.data.task, input.data), task: p.data.task, input: input.data, frequency: p.data.frequency,
    timeOfDay: p.data.timeOfDay, weekday, timezone: p.data.timezone, status: "active",
    nextRunAt: nextRunAt({ frequency: p.data.frequency, timeOfDay: p.data.timeOfDay, weekday, timezone: p.data.timezone }, now), now,
  });
  deps.kick();
  return { ok: true, schedule: scheduleView(row) };
}

const schedulePatch = z.object({ status: z.enum(["active", "paused"]).optional(), timeOfDay: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(), frequency: z.enum(["daily", "weekdays", "weekly"]).optional(), weekday: z.number().int().min(0).max(6).nullable().optional(), timezone: z.string().min(3).max(64).optional() }).strict();
export async function updateSchedule(user: Who, id: number, raw: unknown, d: Partial<LeagueDeps> = {}): Promise<Result<{ schedule: ScheduleView }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await deps.ready())) return NOT_SETUP();
  const p = schedulePatch.safeParse(raw ?? {});
  if (!p.success) return fail(400, "invalid", p.error.issues[0]?.message ?? "That change isn't valid.");
  const cur = await deps.store.getSchedule(user.organizationId!, user.id, id);
  if (!cur) return fail(404, "not_found", "That schedule isn't in your workspace.");
  const next = { frequency: (p.data.frequency ?? cur.frequency) as "daily" | "weekdays" | "weekly", timeOfDay: p.data.timeOfDay ?? cur.timeOfDay, weekday: p.data.weekday !== undefined ? p.data.weekday : cur.weekday, timezone: p.data.timezone ?? cur.timezone };
  if (!validTimeZone(next.timezone)) return fail(400, "invalid", "That timezone isn't recognized.");
  const status = p.data.status ?? cur.status;
  const row = await deps.store.updateSchedule(user.organizationId!, user.id, id, { ...next, weekday: next.frequency === "weekly" ? (next.weekday ?? 1) : null, status, nextRunAt: status === "active" ? nextRunAt(next, deps.now()) : null });
  deps.kick();
  return { ok: true, schedule: scheduleView(row!) };
}

export async function deleteSchedule(user: Who, id: number, d: Partial<LeagueDeps> = {}): Promise<Result<{ deleted: boolean }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await deps.ready())) return NOT_SETUP();
  return { ok: true, deleted: await deps.store.deleteSchedule(user.organizationId!, user.id, id) };
}

export async function runScheduleNow(user: Who, id: number, d: Partial<LeagueDeps> = {}): Promise<Result<{ run: RunView; existing: boolean }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await deps.ready())) return NOT_SETUP();
  const s = await deps.store.getSchedule(user.organizationId!, user.id, id);
  if (!s) return fail(404, "not_found", "That schedule isn't in your workspace.");
  // One "run now" per schedule per minute: a double click starts it once.
  return startLeagueRun(user, s.task, s.input, { source: "page", scheduleId: s.id, idemKey: `now:${s.id}:${deps.now().toISOString().slice(0, 16)}` }, d);
}

/* ── usage ───────────────────────────────────────────────────────────────── */

export async function usage(user: Who, d: Partial<LeagueDeps> = {}): Promise<Result<{ usage: { tier: string; windowDays: number; runs: { used: number; limit: number }; concurrent: number; schedules: { used: number; limit: number }; byBot: Record<string, number>; tokens: number; failed: number } }>> {
  const deps = { ...defaults(), ...d };
  const gate = readGate(user);
  if (gate) return gate;
  if (!(await deps.ready())) return NOT_SETUP();
  const tier = await deps.tier(user).catch(() => "free" as const);
  const allowance = leagueAllowance(tier);
  const [u, schedules] = await Promise.all([deps.store.usage(user.organizationId!, new Date(deps.now().getTime() - LEAGUE_WINDOW_DAYS * DAY)), deps.store.countSchedules(user.organizationId!)]);
  return { ok: true, usage: { tier, windowDays: LEAGUE_WINDOW_DAYS, runs: { used: u.runs, limit: allowance.monthlyRuns }, concurrent: allowance.concurrent, schedules: { used: schedules, limit: allowance.schedules }, byBot: u.byBot, tokens: u.tokensIn + u.tokensOut, failed: u.failed } };
}

/* ── memory ──────────────────────────────────────────────────────────────── */

/** What a coworker may remember: explicit, named preferences only. Never credentials (refused), never anything sent to it as a secret. */
export const MEMORY_KEYS: Record<string, { label: string; bots: (Bot | "all")[] }> = {
  target_market: { label: "Who you want as clients", bots: ["nibo"] },
  target_places: { label: "Where to look", bots: ["nibo"] },
  avoid: { label: "Companies or kinds of work to avoid", bots: ["nibo", "mika"] },
  tone: { label: "How your messages should sound", bots: ["mika"] },
  sign_off: { label: "How you sign off", bots: ["mika"] },
  briefing_focus: { label: "What your briefing should lead with", bots: ["zee"] },
};
const SECRETISH = /\b(sk-|rzp_|EAA[A-Za-z0-9]|password|passwd|api[_ -]?key|token|secret|otp)\b/i;
const memoryInput = z.object({ bot: z.enum([...BOTS, "all"] as [string, ...string[]]), key: z.string().refine((k) => k in MEMORY_KEYS, "Unknown preference"), value: z.string().trim().min(1).max(500) }).strict();

export async function listMemory(user: Who, d: Partial<LeagueDeps> = {}) {
  const deps = { ...defaults(), ...d };
  const gate = readGate(user);
  if (gate) return gate;
  if (!(await deps.ready())) return NOT_SETUP();
  const rows = await deps.store.memory(user.organizationId!, user.id);
  return { ok: true as const, memory: rows.map((m) => ({ id: m.id, bot: m.bot, key: m.key, label: MEMORY_KEYS[m.key]?.label ?? m.key, value: m.value, source: m.source, updatedAt: iso(m.updatedAt) })), keys: MEMORY_KEYS };
}
export async function setMemory(user: Who, raw: unknown, d: Partial<LeagueDeps> = {}) {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await deps.ready())) return NOT_SETUP();
  const p = memoryInput.safeParse(raw ?? {});
  if (!p.success) return fail(400, "invalid", p.error.issues[0]?.message ?? "That preference isn't valid.");
  if (SECRETISH.test(p.data.value)) return fail(422, "secret_like", "That looks like a password or a key. Coworkers don't remember credentials.");
  const row = await deps.store.setMemory({ orgId: user.organizationId!, userId: user.id, bot: p.data.bot, key: p.data.key, value: p.data.value, source: "you", now: deps.now() });
  return { ok: true as const, memory: { id: row.id, bot: row.bot, key: row.key, value: row.value } };
}
export async function deleteMemory(user: Who, id: number, d: Partial<LeagueDeps> = {}) {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await deps.ready())) return NOT_SETUP();
  return { ok: true as const, deleted: await deps.store.deleteMemory(user.organizationId!, user.id, id) };
}

/** The remembered preferences a coworker reads into its chat context (labelled as the person's preferences, not instructions). */
export async function memoryFor(user: Who, bot: Bot, d: Partial<LeagueDeps> = {}): Promise<{ label: string; value: string }[]> {
  const deps = { ...defaults(), ...d };
  try {
    const rows = await deps.store.memory(user.organizationId!, user.id);
    return rows.filter((m) => m.bot === bot || m.bot === "all").map((m) => ({ label: MEMORY_KEYS[m.key]?.label ?? m.key, value: m.value }));
  } catch { return []; }
}

export { isBot, BOT_IDENTITY };
