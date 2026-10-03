/**
 * Lead pipeline: HTTP surface (all under /api/leads, all authenticated).
 *
 *   GET    /api/leads                      list (status, q, limit, offset) with per-stage counts
 *   POST   /api/leads                      add a lead
 *   POST   /api/leads/batch                add several (a pasted list); duplicates are skipped and reported
 *   GET    /api/leads/:id                  the lead with its timeline, tickets, evidence and allowed moves
 *   PATCH  /api/leads/:id                  edit fields
 *   POST   /api/leads/:id/move             change stage (never to "won")
 *   POST   /api/leads/:id/notes            add a note to the timeline
 *   POST   /api/leads/:id/tickets          add a next-action ticket
 *   PATCH  /api/leads/:id/tickets/:tid     mark a ticket done or cancelled
 *   POST   /api/leads/:id/claims           record a fact about the company (confirmed ones need evidence)
 *   POST   /api/leads/:id/convert          close as WON by creating the deal
 *   POST   /api/leads/:id/archive          archive
 *
 * Every rule lives in server/services/leads.ts; a route only parses the request
 * and maps the result to HTTP. Organization and user come from the session, and
 * a lead in another organization answers 404, exactly like one that doesn't exist.
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { isAuthenticated } from "../auth";
import * as leads from "../services/leads";
import { leadsTablesReady } from "./store";
import { agentLog } from "../agent/log";

const idParam = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export function registerLeadRoutes(app: Express) {
  /** Auth, an organization, and the lead tables. Without the tables only leads are off. */
  const gate = async (req: Request, res: Response, next: () => void) => {
    if (!(req as any).user?.organizationId) return res.status(403).json({ code: "no_organization", error: "Finish setting up your workspace first." });
    try {
      if (!(await leadsTablesReady())) return res.status(503).json({ code: "LEADS_NOT_SETUP", error: "Leads aren't set up on this server yet." });
    } catch (err) {
      agentLog("error", { errorType: (err as Error)?.name ?? "Error", where: "leads_tables" });
      return res.status(503).json({ code: "LEADS_NOT_SETUP", error: "Leads aren't available right now." });
    }
    next();
  };
  const guard = [isAuthenticated, gate] as const;

  const send = (res: Response, r: leads.Result<any>, okStatus = 200, pick?: (r: any) => unknown) => {
    if (r.ok) {
      const { ok: _ok, ...rest } = r;
      return res.status(okStatus).json(pick ? pick(r) : rest);
    }
    const { ok: _ok, status, message, code, ...extra } = r;
    return res.status(status).json({ code, error: message, ...extra });
  };
  const withId = (handler: (req: any, res: Response, id: number) => Promise<unknown>) => async (req: any, res: Response) => {
    const id = idParam(req.params.id);
    if (!id) return res.status(404).json({ code: "not_found", error: "That lead isn't in your organization." });
    try {
      await handler(req, res, id);
    } catch (err) {
      agentLog("error", { errorType: (err as Error)?.name ?? "Error", where: "leads_route" });
      res.status(500).json({ code: "internal", error: "Something went wrong on our side. Nothing was changed." });
    }
  };

  app.get("/api/leads", ...guard, async (req: any, res) => {
    try {
      const q = z.object({
        status: z.string().optional(), q: z.string().max(100).optional(),
        limit: z.coerce.number().int().optional(), offset: z.coerce.number().int().optional(),
        archived: z.enum(["1", "true"]).optional(),
      }).safeParse(req.query);
      if (!q.success) return res.status(400).json({ code: "invalid", error: "Invalid filter." });
      send(res, await leads.listLeads(req.user, { ...q.data, includeArchived: !!q.data.archived }));
    } catch (err) {
      agentLog("error", { errorType: (err as Error)?.name ?? "Error", where: "leads_list" });
      res.status(500).json({ code: "internal", error: "Couldn't load your leads." });
    }
  });

  app.post("/api/leads", ...guard, withId2(async (req, res) => send(res, await leads.createLead(req.user, req.body, { source: "manual" }), 201)));

  app.post("/api/leads/batch", ...guard, withId2(async (req, res) => {
    const items = Array.isArray(req.body?.leads) ? req.body.leads : null;
    if (!items) return res.status(400).json({ code: "invalid", error: "Send { leads: [...] }." });
    send(res, await leads.createLeads(req.user, items, { source: "import" }), 201);
  }));

  app.get("/api/leads/:id", ...guard, withId(async (req, res, id) => {
    const r = await leads.getLead(req.user, id);
    send(res, r, 200, (x) => ({ ...x.detail, moves: x.moves, canConvert: x.canConvert }));
  }));

  app.patch("/api/leads/:id", ...guard, withId(async (req, res, id) => send(res, await leads.updateLead(req.user, id, req.body))));

  app.post("/api/leads/:id/move", ...guard, withId(async (req, res, id) =>
    send(res, await leads.moveLead(req.user, id, req.body?.status, { lostReason: typeof req.body?.lostReason === "string" ? req.body.lostReason : undefined }))));

  app.post("/api/leads/:id/notes", ...guard, withId(async (req, res, id) => send(res, await leads.addNote(req.user, id, req.body?.text), 201)));

  app.post("/api/leads/:id/tickets", ...guard, withId(async (req, res, id) => send(res, await leads.createTicket(req.user, id, req.body), 201)));

  app.patch("/api/leads/:id/tickets/:tid", ...guard, withId(async (req, res, id) => {
    const tid = idParam(req.params.tid);
    const status = req.body?.status === "cancelled" ? "cancelled" : req.body?.status === "done" ? "done" : null;
    if (!tid || !status) return res.status(400).json({ code: "invalid", error: "Send { status: \"done\" | \"cancelled\" }." });
    send(res, await leads.closeTicket(req.user, id, tid, status));
  }));

  app.post("/api/leads/:id/claims", ...guard, withId(async (req, res, id) => send(res, await leads.addClaim(req.user, id, req.body), 201)));

  app.post("/api/leads/:id/convert", ...guard, withId(async (req, res, id) => send(res, await leads.convertToDeal(req.user, id, req.body))));

  app.post("/api/leads/:id/archive", ...guard, withId(async (req, res, id) => send(res, await leads.archiveLead(req.user, id))));

  // A route with no :id still needs the same last-resort handling.
  function withId2(handler: (req: any, res: Response) => Promise<unknown>) {
    return async (req: any, res: Response) => {
      try {
        await handler(req, res);
      } catch (err) {
        agentLog("error", { errorType: (err as Error)?.name ?? "Error", where: "leads_route" });
        res.status(500).json({ code: "internal", error: "Something went wrong on our side. Nothing was changed." });
      }
    };
  }
}
