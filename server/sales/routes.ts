/**
 * The sales agent: HTTP surface (all under /api/sales, all authenticated).
 *
 *   GET /api/sales/leads/:id/score         the score out of 100, each component with its reason, and what is missing
 *   GET /api/sales/leads/:id/next-action   the next best action and why
 *   POST /api/sales/leads/:id/research     start researching the lead's own website (202; the work continues, poll the GET)
 *   GET  /api/sales/leads/:id/research     the latest run: status, pages read, what was kept and what was thrown away
 *   GET  /api/sales/leads/:id/messages     the lead's outreach messages, newest first
 *   POST /api/sales/leads/:id/draft        write the first message (one model call; stored as a draft for review)
 *   PATCH /api/sales/messages/:id          edit the text (an approved message returns to draft)
 *   POST /api/sales/messages/:id/approve   approve the text the person read ({ bodyHash })
 *   POST /api/sales/messages/:id/sent      the person says they sent it from their own email app
 *   POST /api/sales/messages/:id/cancel    throw the draft away
 *
 * Every rule lives in server/services/sales.ts and the pure modules it calls; a route parses the request and
 * maps the result to HTTP. A lead in another workspace answers 404, like one that does not exist.
 */
import type { Express, Request, Response } from "express";
import { isAuthenticated } from "../auth";
import { agentLog } from "../agent/log";
import { leadsTablesReady } from "../leads/store";
import * as sales from "../services/sales";
import { getResearch, startResearch } from "./research";
import { approveMessage, cancelMessage, draftOutreach, editDraft, listMessages, markSent } from "./outreach";
import { messagesTablesReady } from "./message-store";
import { salesTablesReady } from "./research-store";

export function registerSalesRoutes(app: Express) {
  const gate = async (req: Request, res: Response, next: () => void) => {
    if (!(req as any).user?.organizationId) return res.status(403).json({ code: "no_organization", error: "Finish setting up your workspace first." });
    try {
      if (!(await leadsTablesReady())) return res.status(503).json({ code: "LEADS_NOT_SETUP", error: "Leads aren't set up on this server yet." });
    } catch (err) {
      agentLog("error", { errorType: (err as Error)?.name ?? "Error", where: "sales_tables" });
      return res.status(503).json({ code: "LEADS_NOT_SETUP", error: "Leads aren't available right now." });
    }
    next();
  };
  /** Research needs its own table and the model trace; without them only the sales agent is off. */
  const researchGate = async (req: Request, res: Response, next: () => void) => {
    try {
      if (!(await salesTablesReady())) return res.status(503).json({ code: "SALES_NOT_SETUP", error: "The sales agent isn't set up on this server yet." });
    } catch (err) {
      agentLog("error", { errorType: (err as Error)?.name ?? "Error", where: "sales_research_tables" });
      return res.status(503).json({ code: "SALES_NOT_SETUP", error: "The sales agent isn't available right now." });
    }
    next();
  };
  const idOf = (v: unknown): number | null => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
  const run = (pick: (a: sales.Assessment) => Record<string, unknown>, where: string) => async (req: any, res: Response) => {
    try {
      const id = idOf(req.params.id);
      if (!id) return res.status(404).json({ code: "not_found", error: "That lead isn't in your workspace." });
      const r = await sales.assessLead(req.user, id);
      if (!r.ok) return res.status(r.status).json({ code: r.code, error: r.message });
      return res.json(pick(r));
    } catch (err) {
      agentLog("error", { errorType: (err as Error)?.name ?? "Error", where });
      res.status(500).json({ code: "internal", error: "Something went wrong on our side." });
    }
  };
  app.get("/api/sales/leads/:id/score", isAuthenticated, gate, run((a) => ({ score: a.score, fit: a.fit, researched: a.researched }), "sales_score"));
  app.get("/api/sales/leads/:id/next-action", isAuthenticated, gate, run((a) => ({ next: a.next }), "sales_next_action"));
  app.post("/api/sales/leads/:id/research", isAuthenticated, gate, researchGate, async (req: any, res: Response) => {
    try {
      const id = idOf(req.params.id);
      if (!id) return res.status(404).json({ code: "not_found", error: "That lead isn't in your workspace." });
      const r = await startResearch(req.user, id);
      if (!r.ok) return res.status(r.status).json({ code: r.code, error: r.message });
      return res.status(202).json({ researchId: r.researchId, status: "running" });
    } catch (err) {
      agentLog("error", { errorType: (err as Error)?.name ?? "Error", where: "sales_research_start" });
      res.status(500).json({ code: "internal", error: "Something went wrong on our side." });
    }
  });
  app.get("/api/sales/leads/:id/research", isAuthenticated, gate, researchGate, async (req: any, res: Response) => {
    try {
      const id = idOf(req.params.id);
      if (!id) return res.status(404).json({ code: "not_found", error: "That lead isn't in your workspace." });
      const r = await getResearch(req.user, id);
      if (!r.ok) return res.status(r.status).json({ code: r.code, error: r.message });
      return res.json({ research: r.research });
    } catch (err) {
      agentLog("error", { errorType: (err as Error)?.name ?? "Error", where: "sales_research_get" });
      res.status(500).json({ code: "internal", error: "Something went wrong on our side." });
    }
  });

  /** Drafts need their own table and the model trace; without them only outreach is off. */
  const messagesGate = async (req: Request, res: Response, next: () => void) => {
    try {
      if (!(await messagesTablesReady())) return res.status(503).json({ code: "MESSAGES_NOT_SETUP", error: "Outreach drafts aren't set up on this server yet." });
    } catch (err) {
      agentLog("error", { errorType: (err as Error)?.name ?? "Error", where: "sales_message_tables" });
      return res.status(503).json({ code: "MESSAGES_NOT_SETUP", error: "Outreach drafts aren't available right now." });
    }
    next();
  };
  const notFound = (res: Response) => res.status(404).json({ code: "not_found", error: "That isn't in your workspace." });
  /** Maps a service result to HTTP: the failure's own status and code, plus the few fields a client acts on. */
  const reply = (res: Response, r: any, ok: (r: any) => Record<string, unknown>, status = 200) => {
    if (r.ok) return res.status(status).json(ok(r));
    const extra: Record<string, unknown> = {};
    if (r.issues) extra.issues = r.issues;
    if (r.messageId) extra.messageId = r.messageId;
    return res.status(r.status).json({ code: r.code, error: r.message, ...extra });
  };
  const guarded = (where: string, fn: (req: any, res: Response, id: number) => Promise<unknown>) => async (req: any, res: Response) => {
    try {
      const id = idOf(req.params.id);
      if (!id) return notFound(res);
      await fn(req, res, id);
    } catch (err) {
      agentLog("error", { errorType: (err as Error)?.name ?? "Error", where });
      res.status(500).json({ code: "internal", error: "Something went wrong on our side." });
    }
  };
  app.get("/api/sales/leads/:id/messages", isAuthenticated, gate, messagesGate, guarded("sales_messages", async (req, res, id) => reply(res, await listMessages(req.user, id), (r) => ({ messages: r.messages }))));
  app.post("/api/sales/leads/:id/draft", isAuthenticated, gate, messagesGate, guarded("sales_draft", async (req, res, id) => reply(res, await draftOutreach(req.user, id), (r) => ({ message: r.message, retried: r.retried }), 201)));
  app.patch("/api/sales/messages/:id", isAuthenticated, gate, messagesGate, guarded("sales_message_edit", async (req, res, id) => reply(res, await editDraft(req.user, id, req.body), (r) => ({ message: r.message }))));
  app.post("/api/sales/messages/:id/approve", isAuthenticated, gate, messagesGate, guarded("sales_message_approve", async (req, res, id) => reply(res, await approveMessage(req.user, id, req.body?.bodyHash), (r) => ({ message: r.message, already: r.already }))));
  app.post("/api/sales/messages/:id/sent", isAuthenticated, gate, messagesGate, guarded("sales_message_sent", async (req, res, id) => reply(res, await markSent(req.user, id), (r) => ({ message: r.message, already: r.already, movedTo: r.movedTo }))));
  app.post("/api/sales/messages/:id/cancel", isAuthenticated, gate, messagesGate, guarded("sales_message_cancel", async (req, res, id) => reply(res, await cancelMessage(req.user, id), (r) => ({ message: r.message }))));
}
