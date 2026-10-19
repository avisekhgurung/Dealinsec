/**
 * AI League: HTTP surface (server/ai-league/service.ts, chat.ts). All authenticated; the organization and user come from
 * the session, never from the request. State-changing calls are same-origin JSON. A run, schedule, memory row or
 * approval of someone else answers 404.
 *
 *   GET    /api/ai-league/status                        tables ready, AI configured
 *   GET    /api/ai-league/roster                        Nibo, Mika, Zee with their real state
 *   GET    /api/ai-league/bots/:bot/conversation        this person's conversation with the coworker (created on first open)
 *   POST   /api/ai-league/bots/:bot/messages            { text } one chat turn, as Server-Sent Events (the agent's events)
 *   POST   /api/ai-league/bots/:bot/read                mark the conversation read
 *   GET    /api/ai-league/approvals                     chat requests and Mika's drafts waiting for the person
 *   POST   /api/ai-league/approvals/:id/approve         approve a chat request (SSE; runs the STORED arguments)
 *   POST   /api/ai-league/approvals/:id/reject
 *   POST   /api/ai-league/runs                          { task, input, clientKey } start a task from the page
 *   GET    /api/ai-league/runs                          activity (?bot, status, task, days)
 *   GET    /api/ai-league/runs/:id                      a run, its milestones and report
 *   POST   /api/ai-league/runs/:id/read | cancel | retry
 *   GET    /api/ai-league/runs/:id/report.csv | report.md   the stored report as a file (your own tasks only)
 *   GET    /api/ai-league/schedules · POST · PATCH /:id · DELETE /:id · POST /:id/run
 *   GET    /api/ai-league/usage
 *   GET    /api/ai-league/memory · PUT · DELETE /:id
 */
import type { Express, Response } from "express";
import { z } from "zod";
import { isAuthenticated } from "../auth";
import { agentLog } from "../agent/log";
import { sameOriginJson } from "../mail/routes";
import { isBot, type Bot } from "@shared/ai-league";
import type { AgentEvent } from "@shared/agent";
import * as svc from "./service";
import { leagueStore, leagueTablesReady } from "./store";

function openStream(res: Response) {
  res.status(200).set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  const heartbeat = setInterval(() => { if (!res.writableEnded) res.write(": keep-alive\n\n"); }, 15_000);
  res.on("close", () => clearInterval(heartbeat));
  return {
    send(e: AgentEvent) { if (!res.writableEnded && !res.destroyed) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`); },
    end() { clearInterval(heartbeat); if (!res.writableEnded) res.end(); },
  };
}
const REFUSAL: Record<string, number> = { unavailable: 503, not_found: 404, busy: 409, quota: 429, empty: 400, too_long: 400 };

export function registerAiLeagueRoutes(app: Express) {
  const send = (res: Response, r: any, ok: (r: any) => Record<string, unknown>, status = 200) => {
    if (r.ok) return res.status(status).json(ok(r));
    return res.status(r.status).json({ code: r.code, error: r.message, ...(r.feature ? { feature: r.feature } : {}) });
  };
  const guarded = (where: string, fn: (req: any, res: Response) => Promise<unknown>) => async (req: any, res: Response) => {
    if (!req.user?.organizationId) return res.status(403).json({ code: "no_organization", error: "Finish setting up your workspace first." });
    try { await fn(req, res); }
    catch (err) {
      agentLog("error", { errorType: (err as Error)?.name ?? "Error", where });
      if (!res.headersSent) res.status(500).json({ code: "internal", error: "Something went wrong on our side." });
    }
  };
  const botOf = (req: any, res: Response): Bot | null => { if (isBot(req.params.bot)) return req.params.bot; res.status(404).json({ code: "not_found", error: "That coworker doesn't exist." }); return null; };
  const num = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
  const runId = (v: unknown) => (typeof v === "string" && /^lr_[a-f0-9]{8,32}$/.test(v) ? v : null);

  app.get("/api/ai-league/status", isAuthenticated, guarded("league_status", async (_req, res) => {
    const { copilotConfigured } = await import("../copilot/provider");
    const { agentTablesReady } = await import("../agent/store");
    let ready = false, agent = false;
    try { ready = await leagueTablesReady(); agent = await agentTablesReady(); } catch { /* not ready */ }
    res.json({ ready: ready && agent, providerConfigured: copilotConfigured() });
  }));
  app.get("/api/ai-league/roster", isAuthenticated, guarded("league_roster", async (req, res) => { res.setHeader("Cache-Control", "no-store"); send(res, await svc.roster(req.user), (r) => ({ bots: r.bots, ready: r.ready })); }));

  /* ── conversations ── */
  async function thread(req: any, bot: Bot) {
    const { agentStore, agentTablesReady } = await import("../agent/store");
    if (!(await leagueTablesReady()) || !(await agentTablesReady())) return null;
    const existing = await leagueStore.thread(req.user.organizationId, req.user.id, bot);
    if (existing) {
      const session = await agentStore.getSession(req.user, existing.sessionId);
      if (session) return { thread: existing, session };
    }
    const session = await agentStore.createSession(req.user, { channel: "web" });
    const t = await leagueStore.createThread({ orgId: req.user.organizationId, userId: req.user.id, bot, sessionId: session.id, now: new Date() });
    const linked = t.sessionId === session.id ? session : await agentStore.getSession(req.user, t.sessionId);
    return linked ? { thread: t, session: linked } : null;
  }
  app.get("/api/ai-league/bots/:bot/conversation", isAuthenticated, guarded("league_conversation", async (req, res) => {
    const bot = botOf(req, res); if (!bot) return;
    const t = await thread(req, bot);
    if (!t) return res.status(503).json({ code: "LEAGUE_NOT_SETUP", error: "AI League isn't set up on this server yet." });
    const { agentStore } = await import("../agent/store");
    const transcript = await agentStore.transcript(t.session);
    res.setHeader("Cache-Control", "no-store");
    res.json({ sessionId: t.session.id, lastReadAt: t.thread.lastReadAt, ...transcript });
  }));
  const messageBody = z.object({ text: z.string().min(1).max(4000) });
  app.post("/api/ai-league/bots/:bot/messages", isAuthenticated, sameOriginJson, guarded("league_message", async (req, res) => {
    const bot = botOf(req, res); if (!bot) return;
    const body = messageBody.safeParse(req.body ?? {});
    if (!body.success) return res.status(400).json({ error: "Type a message (up to 4,000 characters)." });
    const t = await thread(req, bot);
    if (!t) return res.status(503).json({ code: "LEAGUE_NOT_SETUP", error: "AI League isn't set up on this server yet." });
    const { converse } = await import("../agent/conversation");
    const { leagueConversationDeps } = await import("./chat");
    const deps = await leagueConversationDeps(bot);
    const gone = new AbortController();
    res.on("close", () => { if (!res.writableEnded) gone.abort(); });
    let stream: ReturnType<typeof openStream> | null = null;
    const out = await converse(deps, { user: req.user, text: body.data.text, sessionId: t.session.id, adapter: { channel: "web", signal: gone.signal, emit: (e) => { (stream ??= openStream(res)).send(e); } } });
    if (!out.ok && !stream) return res.status(REFUSAL[out.code] ?? 400).json({ error: out.message, code: out.code });
    await leagueStore.markThreadRead(req.user.organizationId, req.user.id, bot, new Date()).catch(() => {});
    (stream as ReturnType<typeof openStream> | null)?.end();
  }));
  app.post("/api/ai-league/bots/:bot/read", isAuthenticated, sameOriginJson, guarded("league_read", async (req, res) => {
    const bot = botOf(req, res); if (!bot) return;
    if (await leagueTablesReady()) await leagueStore.markThreadRead(req.user.organizationId, req.user.id, bot, new Date());
    res.json({ ok: true });
  }));

  /* ── approvals ── */
  app.get("/api/ai-league/approvals", isAuthenticated, guarded("league_approvals", async (req, res) => { res.setHeader("Cache-Control", "no-store"); send(res, await svc.listApprovals(req.user), (r) => ({ items: r.items })); }));
  app.post("/api/ai-league/approvals/:id/approve", isAuthenticated, guarded("league_approve", async (req, res) => {
    const { executeApproval } = await import("../agent/approvals");
    const { agentStore } = await import("../agent/store");
    const { allLeagueTools } = await import("./chat");
    const stream = openStream(res);
    try { await executeApproval({ store: agentStore, tools: await allLeagueTools() }, req.user, String(req.params.id).slice(0, 64), stream.send); }
    finally { stream.end(); }
  }));
  app.post("/api/ai-league/approvals/:id/reject", isAuthenticated, guarded("league_reject", async (req, res) => {
    const { agentStore } = await import("../agent/store");
    const ok = await agentStore.rejectApproval(String(req.params.id).slice(0, 64), req.user);
    if (!ok) return res.status(404).json({ error: "That request isn't available any more." });
    res.json({ ok: true });
  }));

  /* ── runs ── */
  const startBody = z.object({ task: z.string(), input: z.record(z.unknown()).default({}), clientKey: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/) });
  app.post("/api/ai-league/runs", isAuthenticated, sameOriginJson, guarded("league_start", async (req, res) => {
    const b = startBody.safeParse(req.body ?? {});
    if (!b.success) return res.status(400).json({ code: "invalid", error: "That task request isn't valid." });
    send(res, await svc.startLeagueRun(req.user, b.data.task, b.data.input, { source: "page", idemKey: `page:${b.data.clientKey}` }), (r) => ({ run: r.run, existing: r.existing }), 201);
  }));
  app.get("/api/ai-league/runs", isAuthenticated, guarded("league_runs", async (req, res) => { res.setHeader("Cache-Control", "no-store"); send(res, await svc.listRuns(req.user, req.query), (r) => ({ runs: r.runs })); }));
  app.get("/api/ai-league/runs/:id", isAuthenticated, guarded("league_run", async (req, res) => {
    const id = runId(req.params.id); if (!id) return res.status(404).json({ code: "not_found", error: "That task isn't in your workspace." });
    res.setHeader("Cache-Control", "no-store");
    send(res, await svc.getRun(req.user, id), (r) => ({ run: r.run, events: r.events }));
  }));
  for (const fmt of ["csv", "md"] as const) {
    app.get(`/api/ai-league/runs/:id/report.${fmt}`, isAuthenticated, guarded(`league_report_${fmt}`, async (req, res) => {
      const id = runId(req.params.id); if (!id) return res.status(404).json({ code: "not_found", error: "That task isn't in your workspace." });
      const r = await svc.getRun(req.user, id);
      if (!r.ok) return res.status(r.status).json({ code: r.code, error: r.message });
      if (!r.run.report) return res.status(409).json({ code: "no_report", error: "This task has no report yet." });
      const { reportCsv, reportMarkdown } = await import("./report-files");
      const name = `${r.run.taskLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${id.slice(3, 11)}.${fmt}`;
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
      if (fmt === "csv") return res.type("text/csv; charset=utf-8").send(reportCsv(r.run.report));
      res.type("text/markdown; charset=utf-8").send(reportMarkdown(r.run.report, { title: r.run.taskLabel, coworker: r.run.bot, finishedAt: r.run.finishedAt }));
    }));
  }
  for (const action of ["read", "cancel", "retry"] as const) {
    app.post(`/api/ai-league/runs/:id/${action}`, isAuthenticated, sameOriginJson, guarded(`league_run_${action}`, async (req, res) => {
      const id = runId(req.params.id); if (!id) return res.status(404).json({ code: "not_found", error: "That task isn't in your workspace." });
      const r = action === "read" ? await svc.markRunRead(req.user, id) : action === "cancel" ? await svc.cancelRun(req.user, id) : await svc.retryRun(req.user, id);
      send(res, r, (x) => ({ ...(x.run ? { run: x.run } : {}), ok: true }));
    }));
  }

  /* ── schedules ── */
  app.get("/api/ai-league/schedules", isAuthenticated, guarded("league_schedules", async (req, res) => send(res, await svc.listSchedules(req.user), (r) => ({ schedules: r.schedules }))));
  app.post("/api/ai-league/schedules", isAuthenticated, sameOriginJson, guarded("league_schedule_create", async (req, res) => send(res, await svc.createSchedule(req.user, req.body), (r) => ({ schedule: r.schedule }), 201)));
  app.patch("/api/ai-league/schedules/:id", isAuthenticated, sameOriginJson, guarded("league_schedule_update", async (req, res) => {
    const id = num(req.params.id); if (!id) return res.status(404).json({ code: "not_found", error: "That schedule isn't in your workspace." });
    send(res, await svc.updateSchedule(req.user, id, req.body), (r) => ({ schedule: r.schedule }));
  }));
  app.delete("/api/ai-league/schedules/:id", isAuthenticated, guarded("league_schedule_delete", async (req, res) => {
    const id = num(req.params.id); if (!id) return res.status(404).json({ code: "not_found", error: "That schedule isn't in your workspace." });
    send(res, await svc.deleteSchedule(req.user, id), (r) => ({ deleted: r.deleted }));
  }));
  app.post("/api/ai-league/schedules/:id/run", isAuthenticated, sameOriginJson, guarded("league_schedule_run", async (req, res) => {
    const id = num(req.params.id); if (!id) return res.status(404).json({ code: "not_found", error: "That schedule isn't in your workspace." });
    send(res, await svc.runScheduleNow(req.user, id), (r) => ({ run: r.run, existing: r.existing }), 201);
  }));

  /* ── usage and memory ── */
  app.get("/api/ai-league/usage", isAuthenticated, guarded("league_usage", async (req, res) => { res.setHeader("Cache-Control", "no-store"); send(res, await svc.usage(req.user), (r) => ({ usage: r.usage })); }));
  app.get("/api/ai-league/memory", isAuthenticated, guarded("league_memory", async (req, res) => send(res, await svc.listMemory(req.user), (r) => ({ memory: r.memory, keys: r.keys }))));
  app.put("/api/ai-league/memory", isAuthenticated, sameOriginJson, guarded("league_memory_set", async (req, res) => send(res, await svc.setMemory(req.user, req.body), (r) => ({ memory: r.memory }))));
  app.delete("/api/ai-league/memory/:id", isAuthenticated, guarded("league_memory_delete", async (req, res) => {
    const id = num(req.params.id); if (!id) return res.status(404).json({ code: "not_found", error: "That memory isn't in your workspace." });
    send(res, await svc.deleteMemory(req.user, id), (r) => ({ deleted: r.deleted }));
  }));
}
