/**
 * DealInSec agent — HTTP surface (all under /api/agent, all authenticated).
 *
 *   GET    /api/agent/status                    enabled? + the org's autonomy level
 *   GET    /api/agent/settings                  { autonomyLevel }
 *   PATCH  /api/agent/settings                  owner only; level 0 or 1
 *   POST   /api/agent/sessions                  start a conversation
 *   GET    /api/agent/sessions                  the caller's conversations
 *   GET    /api/agent/sessions/:id              transcript + live approval statuses
 *   DELETE /api/agent/sessions/:id              delete a conversation
 *   POST   /api/agent/sessions/:id/messages     one run, streamed as Server-Sent Events
 *   POST   /api/agent/approvals/:id/approve     execute an approved action (streamed)
 *   POST   /api/agent/approvals/:id/reject      decline it
 *
 * Organization and user always come from the session; a conversation or an
 * approval that belongs to someone else behaves exactly like one that doesn't
 * exist (404). The route is the channel adapter for the web: it turns an HTTP
 * request into { channel, text } for the loop and the loop's events into SSE —
 * a voice or email adapter would do the same without touching the loop.
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { isAuthenticated } from "../auth";
import { copilotConfigured } from "../copilot/provider";
import { storage } from "../storage";
import { executeApproval } from "./approvals";
import { converse, MAX_TEXT, type ChannelAdapter, type ConverseFailure } from "./conversation";
import { agentLog } from "./log";
import { agentStore, agentTablesReady } from "./store";
import { AGENT_TOOLS } from "./tools";
import type { AgentEvent } from "./types";
import { conversationDeps } from "./wiring";

const messageBody = z.object({
  text: z.string().trim().min(1, "Type a message").max(MAX_TEXT, "That message is too long"),
  // "voice" is a spoken call made from the web app: same session, same approvals (never given by voice), a spoken style.
  channel: z.enum(["web", "voice"]).default("web"),
  context: z.object({
    page: z.string().max(60).optional(),
    route: z.string().max(100).optional(),
    dealId: z.number().int().positive().optional(),
  }).default({}),
});

const sessionBody = z.object({ dealId: z.number().int().positive().optional() });

/** Open a Server-Sent Events response. The heartbeat keeps proxies from
 *  closing an idle stream. */
function openStream(res: Response) {
  res.status(200).set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  const heartbeat = setInterval(() => { if (!res.writableEnded) res.write(": keep-alive\n\n"); }, 15_000);
  res.on("close", () => clearInterval(heartbeat));
  return {
    send(e: AgentEvent) {
      if (!res.writableEnded && !res.destroyed) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    },
    end() {
      clearInterval(heartbeat);
      if (!res.writableEnded) res.end();
    },
  };
}

/** The HTTP status for a refusal that happened before the agent started. */
const REFUSAL_STATUS: Record<ConverseFailure["code"], number> = {
  unavailable: 503, not_found: 404, busy: 409, quota: 429, empty: 400, too_long: 400,
};

export function registerAgentRoutes(app: Express) {
  /** Auth, an organization, and the agent's tables. Without the tables (the
   *  migration hasn't been run) only the agent is off — the rest of the app is
   *  unaffected. */
  const gate = async (req: Request, res: Response, next: () => void) => {
    const user = (req as any).user;
    if (!user?.organizationId) return res.status(403).json({ error: "Finish setting up your workspace first." });
    try {
      if (!(await agentTablesReady())) {
        return res.status(503).json({ code: "AGENT_NOT_SETUP", error: "The agent isn't set up on this server yet." });
      }
    } catch (err) {
      agentLog("error", { errorType: (err as Error)?.name ?? "Error", where: "tables" });
      return res.status(503).json({ code: "AGENT_NOT_SETUP", error: "The agent isn't available right now." });
    }
    next();
  };
  const guard = [isAuthenticated, gate] as const;

  app.get("/api/agent/status", isAuthenticated, async (req: any, res) => {
    let ready = false;
    try { ready = !!req.user.organizationId && (await agentTablesReady()); } catch { /* reported as not ready */ }
    const enabled = ready && copilotConfigured();
    res.json({ enabled, tablesReady: ready, providerConfigured: copilotConfigured(), autonomyLevel: enabled ? await agentStore.getAutonomy(req.user.organizationId) : 0 });
  });

  app.get("/api/agent/settings", ...guard, async (req: any, res) => {
    res.json({ autonomyLevel: await agentStore.getAutonomy(req.user.organizationId), maxAutonomyLevel: 1 });
  });

  app.patch("/api/agent/settings", ...guard, async (req: any, res) => {
    if (req.user.orgRole !== "OWNER") return res.status(403).json({ error: "Only the workspace owner can change this." });
    const level = Number(req.body?.autonomyLevel);
    // Levels 2 and 3 (external actions, predefined workflows) are not built.
    if (level !== 0 && level !== 1) return res.status(400).json({ field: "autonomyLevel", error: "Choose 0 (ask before every change) or 1 (allow safe internal changes)." });
    await agentStore.setAutonomy(req.user.organizationId, level);
    res.json({ autonomyLevel: level });
  });

  app.post("/api/agent/sessions", ...guard, async (req: any, res) => {
    const body = sessionBody.safeParse(req.body ?? {});
    if (!body.success) return res.status(400).json({ error: "Invalid request." });
    if (body.data.dealId) {
      const deal = await storage.getDeal(body.data.dealId);
      const owns = deal && (deal.organizationId ? deal.organizationId === req.user.organizationId : deal.userId === req.user.id);
      if (!owns) return res.status(404).json({ error: "Deal not found" });
    }
    const s = await agentStore.createSession(req.user, { dealId: body.data.dealId ?? null });
    res.status(201).json({ id: s.id });
  });

  app.get("/api/agent/sessions", ...guard, async (req: any, res) => {
    res.json(await agentStore.listSessions(req.user));
  });

  app.get("/api/agent/sessions/:id", ...guard, async (req: any, res) => {
    const s = await agentStore.getSession(req.user, req.params.id);
    if (!s) return res.status(404).json({ error: "Conversation not found" });
    res.json({ session: { id: s.id, title: s.title, state: s.state, dealId: s.dealId }, ...(await agentStore.transcript(s)) });
  });

  app.delete("/api/agent/sessions/:id", ...guard, async (req: any, res) => {
    const ok = await agentStore.deleteSession(req.user, req.params.id);
    if (!ok) return res.status(404).json({ error: "Conversation not found" });
    res.json({ ok: true });
  });

  // The web adapter: the browser's text in, the agent's events out as SSE. All
  // the real work is in converse() (conversation.ts), which knows nothing about
  // HTTP — a refusal before the agent starts comes back as JSON, and once it has
  // started everything is an event.
  app.post("/api/agent/sessions/:id/messages", ...guard, async (req: any, res) => {
    const body = messageBody.safeParse(req.body ?? {});
    if (!body.success) return res.status(400).json({ error: body.error.issues[0]?.message ?? "Invalid message" });

    const gone = new AbortController();
    res.on("close", () => { if (!res.writableEnded) gone.abort(); });
    let stream: ReturnType<typeof openStream> | null = null;
    const adapter: ChannelAdapter = {
      channel: body.data.channel,
      signal: gone.signal,
      // The stream opens with the first event, so a refusal can still be JSON.
      emit: (e) => { (stream ??= openStream(res)).send(e); },
    };
    try {
      const out = await converse(conversationDeps, { user: req.user, text: body.data.text, adapter, sessionId: req.params.id, context: body.data.context });
      if (!out.ok && !stream) return res.status(REFUSAL_STATUS[out.code]).json({ error: out.message });
    } catch (err) {
      agentLog("error", { errorType: (err as Error)?.name ?? "Error", where: "messages" });
      if (!stream) return res.status(500).json({ error: "Something went wrong on our side. Nothing was changed." });
    }
    (stream as ReturnType<typeof openStream> | null)?.end();
  });

  app.post("/api/agent/approvals/:id/approve", ...guard, async (req: any, res) => {
    const stream = openStream(res);
    try {
      await executeApproval({ store: agentStore, tools: AGENT_TOOLS }, req.user, req.params.id, stream.send);
    } catch (err) {
      agentLog("error", { errorType: (err as Error)?.name ?? "Error", where: "approve" });
      stream.send({ type: "agent.failed", runId: "", seq: 99, at: new Date().toISOString(), data: { final: true, ok: false, status: 500, message: "Something went wrong on our side. Nothing was changed." } });
    } finally {
      stream.end();
    }
  });

  app.post("/api/agent/approvals/:id/reject", ...guard, async (req: any, res) => {
    const ok = await agentStore.rejectApproval(req.params.id, req.user);
    if (!ok) return res.status(404).json({ error: "That request isn't available any more." });
    agentLog("approval", { approvalId: req.params.id, status: "rejected" });
    res.json({ ok: true });
  });
}
