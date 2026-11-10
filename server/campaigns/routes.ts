/**
 * Campaigns: HTTP surface (all under /api/campaigns, all authenticated). Thin: parse, call the service, map the
 * Result to HTTP. A campaign in another workspace answers 404. Reading, editing and approving a member's message
 * is done through the existing outreach routes (/api/sales/...), not here.
 *
 *   GET    /api/campaigns                     the workspace's campaigns with their numbers
 *   GET    /api/campaigns/audience            leads that can be picked (?status=&source=&q=)
 *   POST   /api/campaigns                     create ({ name, leadIds, profileId?, dailyLimit?, gapSeconds?, footerNote? })
 *   GET    /api/campaigns/:id                 one campaign with every member
 *   PATCH  /api/campaigns/:id                 name, pace, footer note
 *   POST   /api/campaigns/:id/members         add leads ({ leadIds })
 *   DELETE /api/campaigns/:id/members/:leadId take a lead out (not once its message was sent)
 *   POST   /api/campaigns/:id/prepare         start (or resume) drafting      POST .../prepare/stop
 *   POST   /api/campaigns/:id/send            start the paced queue           POST .../send/pause
 *   POST   /api/campaigns/:id/archive
 */
import type { Express, Response } from "express";
import { isAuthenticated } from "../auth";
import { agentLog } from "../agent/log";
import * as svc from "./service";
import { campaignRunner } from "./runner";

export function registerCampaignRoutes(app: Express) {
  const send = (res: Response, r: any, ok: (r: any) => Record<string, unknown>, status = 200) => {
    if (r.ok) return res.status(status).json(ok(r));
    return res.status(r.status).json({ code: r.code, error: r.message });
  };
  const guarded = (where: string, fn: (req: any, res: Response) => Promise<unknown>) => async (req: any, res: Response) => {
    if (!req.user?.organizationId) return res.status(403).json({ code: "no_organization", error: "Finish setting up your workspace first." });
    res.setHeader("Cache-Control", "no-store");
    try { await fn(req, res); }
    catch (err) {
      agentLog("error", { errorType: (err as Error)?.name ?? "Error", where });
      res.status(500).json({ code: "internal", error: "Something went wrong on our side." });
    }
  };
  const num = (v: unknown): number | null => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
  const nf = (res: Response) => res.status(404).json({ code: "not_found", error: "That campaign isn't in your workspace." });
  const withId = (where: string, fn: (req: any, res: Response, id: number) => Promise<unknown>) => guarded(where, async (req, res) => { const id = num(req.params.id); if (!id) return nf(res); await fn(req, res, id); });
  const one = (r: any) => ({ campaign: r.campaign });

  app.get("/api/campaigns", isAuthenticated, guarded("campaigns_list", async (req, res) => send(res, await svc.listCampaigns(req.user), (r) => ({ campaigns: r.campaigns, queueEnabled: r.queueEnabled, limits: r.limits }))));
  app.get("/api/campaigns/audience", isAuthenticated, guarded("campaigns_audience", async (req, res) => send(res, await svc.audience(req.user, req.query ?? {}), (r) => ({ leads: r.leads, limit: r.limit }))));
  app.post("/api/campaigns", isAuthenticated, guarded("campaigns_create", async (req, res) => send(res, await svc.createCampaign(req.user, req.body), (r) => ({ campaign: r.campaign, added: r.added, left: r.left }), 201)));
  app.get("/api/campaigns/:id", isAuthenticated, withId("campaigns_get", async (req, res, id) => send(res, await svc.getCampaign(req.user, id), (r) => ({ campaign: r.campaign, members: r.members, queueEnabled: r.queueEnabled }))));
  app.patch("/api/campaigns/:id", isAuthenticated, withId("campaigns_update", async (req, res, id) => send(res, await svc.updateCampaign(req.user, id, req.body), one)));
  app.post("/api/campaigns/:id/members", isAuthenticated, withId("campaigns_add", async (req, res, id) => send(res, await svc.addMembers(req.user, id, req.body), (r) => ({ added: r.added }))));
  app.delete("/api/campaigns/:id/members/:leadId", isAuthenticated, withId("campaigns_remove", async (req, res, id) => { const leadId = num(req.params.leadId); if (!leadId) return nf(res); send(res, await svc.removeMember(req.user, id, leadId), () => ({ removed: true })); }));
  app.post("/api/campaigns/:id/prepare", isAuthenticated, withId("campaigns_prepare", async (req, res, id) => send(res, await svc.startPreparing(req.user, id), (r) => ({ campaign: r.campaign, waiting: r.waiting }))));
  app.post("/api/campaigns/:id/prepare/stop", isAuthenticated, withId("campaigns_prepare_stop", async (req, res, id) => send(res, await svc.stopPreparing(req.user, id), one)));
  app.post("/api/campaigns/:id/send", isAuthenticated, withId("campaigns_send", async (req, res, id) => send(res, await svc.startSending(req.user, id), one)));
  app.post("/api/campaigns/:id/send/pause", isAuthenticated, withId("campaigns_send_pause", async (req, res, id) => send(res, await svc.pauseSending(req.user, id), one)));
  app.post("/api/campaigns/:id/archive", isAuthenticated, withId("campaigns_archive", async (req, res, id) => send(res, await svc.archiveCampaign(req.user, id), one)));

  campaignRunner.start();
}
