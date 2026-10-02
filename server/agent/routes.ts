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
import { normalizeAudience } from "@shared/audience";
import { isAuthenticated } from "../auth";
import { aiProvider, copilotConfigured } from "../copilot/provider";
import { retrieveKnowledge } from "../copilot/knowledge";
import { takeQuota } from "../copilot/quota";
import { readDenial } from "../copilot/readAccess";
import { copilotSettings, getDealJourney } from "../copilot/workflow";
import { storage } from "../storage";
import { executeApproval } from "./approvals";
import { agentLog } from "./log";
import { runAgent } from "./loop";
import { agentContextBlock, agentSystemPrompt } from "./prompt";
import { agentStore, agentTablesReady } from "./store";
import { AGENT_TOOLS } from "./tools";
import type { AgentEvent } from "./types";

const messageBody = z.object({
  text: z.string().trim().min(1, "Type a message").max(4000, "That message is too long"),
  channel: z.literal("web").default("web"),
  context: z.object({
    page: z.string().max(60).optional(),
    route: z.string().max(100).optional(),
    dealId: z.number().int().positive().optional(),
  }).default({}),
});

const sessionBody = z.object({ dealId: z.number().int().positive().optional() });

/** One run at a time per conversation. In memory is enough: it only prevents a
 *  double-submit, and a restart ends every run anyway. */
const activeSessions = new Set<string>();

/** Open a Server-Sent Events response. The heartbeat keeps proxies from closing
 *  an idle stream; closing the connection aborts the run. */
function openStream(res: Response) {
  res.status(200).set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  const ac = new AbortController();
  const heartbeat = setInterval(() => { if (!res.writableEnded) res.write(": keep-alive\n\n"); }, 15_000);
  res.on("close", () => {
    clearInterval(heartbeat);
    if (!res.writableEnded) ac.abort();
  });
  return {
    signal: ac.signal,
    send(e: AgentEvent) {
      if (!res.writableEnded && !res.destroyed) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    },
    end() {
      clearInterval(heartbeat);
      if (!res.writableEnded) res.end();
    },
  };
}

const titleFrom = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 60);

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

  app.post("/api/agent/sessions/:id/messages", ...guard, async (req: any, res) => {
    const body = messageBody.safeParse(req.body ?? {});
    if (!body.success) return res.status(400).json({ error: body.error.issues[0]?.message ?? "Invalid message" });
    if (!copilotConfigured()) return res.status(503).json({ error: "The agent isn't available right now." });
    const session = await agentStore.getSession(req.user, req.params.id);
    if (!session) return res.status(404).json({ error: "Conversation not found" });
    if (activeSessions.has(session.id)) return res.status(409).json({ error: "I'm still working on your last message." });
    if (!takeQuota(req.user.id)) return res.status(429).json({ error: "Daily AI limit reached — try again tomorrow." });

    activeSessions.add(session.id);
    const stream = openStream(res);
    try {
      const { text, context } = body.data;
      const [settings, org, autonomy] = await Promise.all([
        copilotSettings(req.user),
        req.user.organizationId ? storage.getOrganization(req.user.organizationId) : undefined,
        agentStore.getAutonomy(req.user.organizationId),
      ]);
      const audience = normalizeAudience(org?.audience);

      // The conversation's deal, or the page's: advisory, and re-authorised
      // here (the journey itself is organization-checked, and the member must
      // be allowed to read deals).
      const dealId = session.dealId ?? context.dealId;
      const journey = dealId && !readDenial("get_workflow_status", req.user)
        ? await getDealJourney(dealId, req.user, settings)
        : null;
      if (!session.title) await agentStore.setSessionState(session.id, "UNDERSTANDING", titleFrom(text));

      const systemMessages = [
        agentSystemPrompt(settings, audience),
        `PRODUCT KNOWLEDGE (authoritative):\n${retrieveKnowledge(text)}`,
        agentContextBlock({
          today: new Date().toISOString().slice(0, 10),
          firstName: req.user.firstName,
          role: req.user.orgRole,
          customRole: !!req.user.customPermissions,
          page: context.page, route: context.route, journey,
        }),
      ];

      await runAgent(
        { provider: aiProvider, store: agentStore, tools: AGENT_TOOLS, systemMessages, autonomy },
        { sessionId: session.id, user: req.user, text, channel: body.data.channel },
        stream.send,
        stream.signal,
      );
    } catch (err) {
      agentLog("error", { errorType: (err as Error)?.name ?? "Error", where: "messages" });
      stream.send({ type: "agent.failed", runId: "", seq: 0, at: new Date().toISOString(), data: { code: "internal", message: "Something went wrong on our side. Nothing was changed." } });
    } finally {
      activeSessions.delete(session.id);
      stream.end();
    }
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
