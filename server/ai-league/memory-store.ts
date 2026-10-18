/**
 * An in-memory LeagueStore for tests, with the Postgres store's guarantees: idempotent run creation, limits checked
 * with the insert, one claimer per run (lease), fenced writes, a schedule slot claimed once and advanced fenced.
 */
import type { LeagueMemoryRow, LeagueRunEventRow, LeagueRunRow, LeagueScheduleRow, LeagueThreadRow } from "@shared/schema";
import { RunLimit, type LeagueStore } from "./store";

const ACTIVE = ["queued", "running", "waiting"];
const counts = (r: LeagueRunRow) => !(r.status === "cancelled" && !r.startedAt) && !(r.status === "failed" && (r.errorCode === "not_started" || r.errorCode === "limit"));

export function memoryLeagueStore() {
  const runs: LeagueRunRow[] = [], events: LeagueRunEventRow[] = [], schedules: LeagueScheduleRow[] = [], memory: LeagueMemoryRow[] = [], threads: LeagueThreadRow[] = [];
  let eid = 0, sid = 0, mid = 0, tid = 0;
  const copy = <T>(x: T): T => (x ? structuredClone(x) : x);
  const store: LeagueStore = {
    async thread(o, u, b) { return copy(threads.find((t) => t.organizationId === o && t.userId === u && t.bot === b) ?? null); },
    async createThread(t) {
      const cur = threads.find((x) => x.organizationId === t.orgId && x.userId === t.userId && x.bot === t.bot);
      if (cur) return copy(cur);
      const row: LeagueThreadRow = { id: ++tid, organizationId: t.orgId, userId: t.userId, bot: t.bot, sessionId: t.sessionId, lastReadAt: null, createdAt: t.now };
      threads.push(row); return copy(row);
    },
    async threads(o, u) { return threads.filter((t) => t.organizationId === o && t.userId === u).map(copy); },
    async markThreadRead(o, u, b, now) { const t = threads.find((x) => x.organizationId === o && x.userId === u && x.bot === b); if (t) t.lastReadAt = now; },
    async sessionIds(o, u) { return threads.filter((t) => t.organizationId === o && t.userId === u).map((t) => t.sessionId); },

    async createRun(r) {
      const prior = runs.find((x) => x.organizationId === r.orgId && x.idemKey === r.idemKey);
      if (prior) return { run: copy(prior), existing: true };
      if (runs.filter((x) => x.organizationId === r.orgId && ACTIVE.includes(x.status)).length >= r.limits.concurrent) throw new RunLimit("concurrent", r.limits.concurrent);
      if (runs.filter((x) => x.organizationId === r.orgId && x.createdAt >= r.limits.monthly.since && counts(x)).length >= r.limits.monthly.max) throw new RunLimit("monthly", r.limits.monthly.max);
      const row: LeagueRunRow = {
        id: r.id, organizationId: r.orgId, userId: r.userId, bot: r.bot, task: r.task, input: r.input, status: "queued", stage: "start", checkpoint: {}, report: null, errorCode: null,
        idemKey: r.idemKey, scheduleId: r.scheduleId ?? null, source: r.source, cancelRequested: false, attempts: 0, leaseUntil: null, tokensIn: 0, tokensOut: 0, readAt: null,
        createdAt: r.now, startedAt: null, finishedAt: null, updatedAt: r.now,
      };
      runs.push(row);
      events.push({ id: ++eid, runId: r.id, organizationId: r.orgId, kind: "queued", message: "Task queued", data: null, createdAt: r.now });
      return { run: copy(row), existing: false };
    },
    async getRun(o, u, id) { return copy(runs.find((r) => r.organizationId === o && r.userId === u && r.id === id) ?? null); },
    async listRuns(o, u, f) {
      return runs.filter((r) => r.organizationId === o && r.userId === u && (!f.bot || r.bot === f.bot) && (!f.task || r.task === f.task) && (!f.status?.length || f.status.includes(r.status)) && (!f.since || r.createdAt >= f.since))
        .sort((a, b) => +b.createdAt - +a.createdAt).slice(0, f.limit).map(copy);
    },
    async events(o, runId) { return events.filter((e) => e.organizationId === o && e.runId === runId).map(copy); },
    async addEvent(e) { events.push({ id: ++eid, runId: e.runId, organizationId: e.orgId, kind: e.kind, message: e.message, data: e.data ?? null, createdAt: e.now }); },
    async requestCancel(o, u, id, now) {
      const r = runs.find((x) => x.organizationId === o && x.userId === u && x.id === id);
      if (!r) return null;
      if (r.status === "queued" && (!r.leaseUntil || r.leaseUntil < now)) { Object.assign(r, { status: "cancelled", finishedAt: now, leaseUntil: null }); await store.addEvent({ runId: id, orgId: o, kind: "cancelled", message: "Cancelled before it started", now }); }
      else if (ACTIVE.includes(r.status)) r.cancelRequested = true;
      return copy(r);
    },
    async markRunRead(o, u, id, now) { const r = runs.find((x) => x.organizationId === o && x.userId === u && x.id === id); if (r && !r.readAt) r.readAt = now; },
    async usage(o, since) {
      const rs = runs.filter((r) => r.organizationId === o && r.createdAt >= since);
      const c = rs.filter(counts);
      const byBot: Record<string, number> = { nibo: 0, mika: 0, zee: 0 };
      for (const r of c) byBot[r.bot]++;
      return { runs: c.length, byBot, tokensIn: rs.reduce((a, r) => a + r.tokensIn, 0), tokensOut: rs.reduce((a, r) => a + r.tokensOut, 0), failed: rs.filter((r) => r.status === "failed").length };
    },

    async claim(now, leaseMs) {
      const r = runs.filter((x) => ACTIVE.includes(x.status) && (!x.leaseUntil || x.leaseUntil < now)).sort((a, b) => +a.updatedAt - +b.updatedAt)[0];
      if (!r) return null;
      Object.assign(r, { leaseUntil: new Date(now.getTime() + leaseMs), attempts: r.attempts + 1, updatedAt: now, status: r.status === "queued" ? "running" : r.status, startedAt: r.startedAt ?? now });
      return { ...copy(r), fence: r.attempts };
    },
    async save(id, fence, p, now) {
      const r = runs.find((x) => x.id === id && x.attempts === fence && ACTIVE.includes(x.status));
      if (!r) return false;
      const { tokensIn, tokensOut, ...rest } = p;
      Object.assign(r, Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)), { updatedAt: now });
      if (tokensIn) r.tokensIn += tokensIn;
      if (tokensOut) r.tokensOut += tokensOut;
      if (p.status && !ACTIVE.includes(p.status)) r.leaseUntil = null;
      return true;
    },
    async setLease(id, fence, until) { const r = runs.find((x) => x.id === id && x.attempts === fence && ACTIVE.includes(x.status)); if (!r) return false; r.leaseUntil = until; return true; },
    async nextWake(now) { const t = runs.filter((r) => ACTIVE.includes(r.status) && r.leaseUntil && r.leaseUntil > now).map((r) => +r.leaseUntil!); return t.length ? new Date(Math.min(...t)) : null; },
    async peek(id) { return copy(runs.find((r) => r.id === id) ?? null); },

    async schedules(o, u) { return schedules.filter((s) => s.organizationId === o && s.userId === u).map(copy); },
    async getSchedule(o, u, id) { return copy(schedules.find((s) => s.organizationId === o && s.userId === u && s.id === id) ?? null); },
    async createSchedule(s) { const { now, ...rest } = s; const row = { ...rest, id: ++sid, leaseUntil: null, lastRunId: null, lastRunAt: null, createdAt: now, updatedAt: now } as LeagueScheduleRow; schedules.push(row); return copy(row); },
    async updateSchedule(o, u, id, set) { const s = schedules.find((x) => x.organizationId === o && x.userId === u && x.id === id); if (!s) return null; Object.assign(s, set, { updatedAt: new Date() }); return copy(s); },
    async deleteSchedule(o, u, id) { const i = schedules.findIndex((x) => x.organizationId === o && x.userId === u && x.id === id); if (i < 0) return false; schedules.splice(i, 1); return true; },
    async countSchedules(o) { return schedules.filter((s) => s.organizationId === o).length; },
    async claimDueSchedule(now, leaseMs) {
      const s = schedules.filter((x) => x.status === "active" && x.nextRunAt && x.nextRunAt <= now && (!x.leaseUntil || x.leaseUntil < now)).sort((a, b) => +a.nextRunAt! - +b.nextRunAt!)[0];
      if (!s) return null;
      s.leaseUntil = new Date(now.getTime() + leaseMs);
      return copy(s);
    },
    async advanceSchedule(id, slot, set) {
      const s = schedules.find((x) => x.id === id && x.nextRunAt && +x.nextRunAt === +slot);
      if (s) Object.assign(s, { nextRunAt: set.nextRunAt, lastRunId: set.lastRunId, lastRunAt: set.lastRunId ? set.now : s.lastRunAt, leaseUntil: null, updatedAt: set.now });
    },
    async nextScheduleWake(now) { const t = schedules.filter((s) => s.status === "active" && s.nextRunAt).map((s) => +s.nextRunAt!); return t.length ? new Date(Math.max(+now, Math.min(...t))) : null; },

    async memory(o, u) { return memory.filter((m) => m.organizationId === o && m.userId === u).map(copy); },
    async setMemory(m) {
      const cur = memory.find((x) => x.organizationId === m.orgId && x.userId === m.userId && x.bot === m.bot && x.key === m.key);
      if (cur) { Object.assign(cur, { value: m.value, source: m.source, updatedAt: m.now }); return copy(cur); }
      const row: LeagueMemoryRow = { id: ++mid, organizationId: m.orgId, userId: m.userId, bot: m.bot, key: m.key, value: m.value, source: m.source, updatedAt: m.now };
      memory.push(row); return copy(row);
    },
    async deleteMemory(o, u, id) { const i = memory.findIndex((x) => x.organizationId === o && x.userId === u && x.id === id); if (i < 0) return false; memory.splice(i, 1); return true; },
  };
  return { store, runs, events, schedules, memory, threads };
}
