/**
 * The sales agent: HTTP surface (all under /api/sales, all authenticated).
 *
 *   GET /api/sales/leads/:id/score         the score out of 100, each component with its reason, and what is missing
 *   GET /api/sales/leads/:id/next-action   the next best action and why
 *   POST /api/sales/leads/:id/research     start researching the lead's own website (202; the work continues, poll the GET)
 *   GET  /api/sales/leads/:id/research     the latest run: status, pages read, what was kept and what was thrown away
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
}
