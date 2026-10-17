/**
 * AI Outbound: HTTP surface (all under /api/outbound, all authenticated). Thin: parse, call the service, map the
 * Result to HTTP. A run or prospect in another workspace answers 404.
 *
 *   POST /api/outbound/icp                       read a sentence into a structured ICP (the person confirms it)
 *   POST /api/outbound/runs                      start a discovery run (or get the one already running for that ICP)
 *   GET  /api/outbound/runs                      recent runs
 *   GET  /api/outbound/usage                     this workspace's allowances and the platform's state, before a search
 *   GET  /api/outbound/runs/:id                  a run's funnel and its prospect cards
 *   POST /api/outbound/runs/:id/cancel           stop a run
 *   GET  /api/outbound/prospects                 the workspace table: one page of the organization's prospects (filters, sort, page in the query)
 *   POST /api/outbound/prospects/export          a CSV or XLSX file of selected or filter-matched prospects
 *   POST /api/outbound/outreach/prepare          add selected Ready prospects to Leads and write one draft each, for review ({ prospectIds })
 *   GET  /api/outbound/prospects/:id             the brief: facts, signals, people, inferences, opportunities, angle
 *   POST /api/outbound/prospects/:id/research    research again now   ({ runId })
 *   POST /api/outbound/prospects/:id/contacts    named people from the connected contact provider ({ runId })
 *   POST /api/outbound/prospects/:id/angle       the outreach angle
 *   POST /api/outbound/prospects/:id/lead        add to Leads ({ contactFindingId? })
 */
import type { Express, Response } from "express";
import { isAuthenticated } from "../auth";
import { agentLog } from "../agent/log";
import * as svc from "./service";
import { exportProspects, listWorkspace } from "./workspace";
import { prepareOutreach } from "./outreach-prepare";
import { outboundUsage } from "./usage";

export function registerOutboundRoutes(app: Express) {
  const send = (res: Response, r: any, ok: (r: any) => Record<string, unknown>, status = 200) => {
    if (r.ok) return res.status(status).json(ok(r));
    const extra: Record<string, unknown> = {};
    if (r.why) extra.why = r.why;
    return res.status(r.status).json({ code: r.code, error: r.message, ...extra });
  };
  const guarded = (where: string, fn: (req: any, res: Response) => Promise<unknown>) => async (req: any, res: Response) => {
    if (!req.user?.organizationId) return res.status(403).json({ code: "no_organization", error: "Finish setting up your workspace first." });
    try { await fn(req, res); }
    catch (err) {
      agentLog("error", { errorType: (err as Error)?.name ?? "Error", where });
      res.status(500).json({ code: "internal", error: "Something went wrong on our side." });
    }
  };
  const num = (v: unknown): number | null => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
  const nf = (res: Response) => res.status(404).json({ code: "not_found", error: "That isn't in your workspace." });

  app.post("/api/outbound/icp", isAuthenticated, guarded("outbound_icp", async (req, res) => send(res, await svc.parseIcp(req.user, req.body?.request), (r) => ({ icp: r.icp, searches: r.searches, description: r.description, source: r.source }))));
  app.post("/api/outbound/runs", isAuthenticated, guarded("outbound_start", async (req, res) => send(res, await svc.startRun(req.user, { request: req.body?.request, icp: req.body?.icp, searches: req.body?.searches }), (r) => ({ run: r.run, existing: r.existing }), 201)));
  app.get("/api/outbound/usage", isAuthenticated, guarded("outbound_usage", async (req, res) => { res.setHeader("Cache-Control", "no-store"); send(res, await outboundUsage(req.user), (r) => ({ usage: r.usage })); }));
  app.get("/api/outbound/runs", isAuthenticated, guarded("outbound_runs", async (req, res) => send(res, await svc.listRuns(req.user), (r) => ({ runs: r.runs }))));
  app.get("/api/outbound/runs/:id", isAuthenticated, guarded("outbound_run", async (req, res) => send(res, await svc.getRun(req.user, String(req.params.id).slice(0, 40)), (r) => ({ run: r.run, prospects: r.prospects }))));
  app.post("/api/outbound/runs/:id/cancel", isAuthenticated, guarded("outbound_cancel", async (req, res) => send(res, await svc.cancelRun(req.user, String(req.params.id).slice(0, 40)), (r) => ({ run: r.run }))));
  app.get("/api/outbound/prospects", isAuthenticated, guarded("outbound_workspace", async (req, res) => send(res, await listWorkspace(req.user, req.query ?? {}), (r) => ({ rows: r.rows, page: r.page, pageCount: r.pageCount, pageSize: r.pageSize, sort: r.sort, dir: r.dir, summary: r.summary, facets: r.facets, asOf: r.asOf, truncated: r.truncated }))));
  app.post("/api/outbound/prospects/export", isAuthenticated, guarded("outbound_export", async (req, res) => {
    const r = await exportProspects(req.user, req.body);
    if (!r.ok) return res.status(r.status).json({ code: r.code, error: r.message, ...(typeof (r as any).count === "number" ? { count: (r as any).count } : {}) });
    res.setHeader("Content-Type", r.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${r.filename}"`);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Export-Count", String(r.count));
    res.status(200).end(r.body);
  }));
  app.post("/api/outbound/outreach/prepare", isAuthenticated, guarded("outbound_outreach_prepare", async (req, res) => send(res, await prepareOutreach(req.user, req.body), (r) => ({ results: r.results }))));
  app.get("/api/outbound/prospects/:id", isAuthenticated, guarded("outbound_prospect", async (req, res) => { const id = num(req.params.id); if (!id) return nf(res); send(res, await svc.getProspect(req.user, id), (r) => ({ brief: r.brief })); }));
  app.post("/api/outbound/prospects/:id/research", isAuthenticated, guarded("outbound_research", async (req, res) => { const id = num(req.params.id); if (!id) return nf(res); send(res, await svc.researchProspect(req.user, id, req.body?.runId), (r) => ({ brief: r.brief })); }));
  app.post("/api/outbound/prospects/:id/contacts", isAuthenticated, guarded("outbound_contacts", async (req, res) => { const id = num(req.params.id); if (!id) return nf(res); send(res, await svc.findContacts(req.user, id, req.body?.runId), (r) => ({ brief: r.brief, found: r.found })); }));
  app.post("/api/outbound/prospects/:id/angle", isAuthenticated, guarded("outbound_angle", async (req, res) => { const id = num(req.params.id); if (!id) return nf(res); send(res, await svc.generateAngle(req.user, id), (r) => ({ brief: r.brief })); }));
  app.post("/api/outbound/prospects/:id/feedback", isAuthenticated, guarded("outbound_feedback", async (req, res) => { const id = num(req.params.id); if (!id) return nf(res); send(res, await svc.setProspectFeedback(req.user, id, req.body?.value ?? null), (r) => ({ feedback: r.feedback })); }));
  app.post("/api/outbound/prospects/:id/lead", isAuthenticated, guarded("outbound_lead", async (req, res) => { const id = num(req.params.id); if (!id) return nf(res); send(res, await svc.addToLeads(req.user, id, { contactFindingId: req.body?.contactFindingId }), (r) => ({ leadId: r.leadId, existing: r.existing }), 201); }));
}
