/**
 * Social Intent: HTTP surface (all under /api/social, all authenticated). Thin: parse, call the service, map the
 * Result to HTTP. An opportunity or saved search in another workspace answers 404.
 *
 *   GET    /api/social/overview                  connected sources, what can't be searched, the allowance, counts
 *   POST   /api/social/scan                      one scan ({ services, keywords, platforms } or { profileId })
 *   GET    /api/social/opportunities             a page of opportunities (?status=&intent=&source=&minScore=&page=)
 *   POST   /api/social/opportunities             add a post by hand ({ url, text })
 *   POST   /api/social/opportunities/:id/status  { status: new | ignored | contacted }
 *   POST   /api/social/opportunities/:id/lead    save to Leads ({ name? })
 *   DELETE /api/social/opportunities/:id         remove it for good
 *   GET    /api/social/profiles                  saved searches
 *   POST   /api/social/profiles                  create
 *   PATCH  /api/social/profiles/:id              edit, pause, resume, schedule
 *   POST   /api/social/profiles/:id/duplicate    copy
 *   DELETE /api/social/profiles/:id              delete
 */
import type { Express, Response } from "express";
import { isAuthenticated } from "../auth";
import { agentLog } from "../agent/log";
import * as svc from "./service";

export function registerSocialRoutes(app: Express) {
  const send = (res: Response, r: any, ok: (r: any) => Record<string, unknown>, status = 200) => {
    if (r.ok) return res.status(status).json(ok(r));
    return res.status(r.status).json({ code: r.code, error: r.message, ...(r.feature ? { feature: r.feature } : {}) });
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
  const nf = (res: Response) => res.status(404).json({ code: "not_found", error: "That isn't in your workspace." });

  app.get("/api/social/overview", isAuthenticated, guarded("social_overview", async (req, res) => send(res, await svc.overview(req.user), (r) => ({ overview: r.overview }))));
  app.post("/api/social/scan", isAuthenticated, guarded("social_scan", async (req, res) => send(res, await svc.scan(req.user, req.body), (r) => ({ scan: r.scan }), 201)));
  app.get("/api/social/opportunities", isAuthenticated, guarded("social_list", async (req, res) => send(res, await svc.list(req.user, req.query ?? {}), (r) => ({ opportunities: r.opportunities, total: r.total, page: r.page, pageCount: r.pageCount }))));
  app.post("/api/social/opportunities", isAuthenticated, guarded("social_add", async (req, res) => send(res, await svc.addManual(req.user, req.body), (r) => ({ opportunity: r.opportunity, existing: r.existing }), 201)));
  app.post("/api/social/opportunities/:id/status", isAuthenticated, guarded("social_status", async (req, res) => { const id = num(req.params.id); if (!id) return nf(res); send(res, await svc.setStatus(req.user, id, req.body?.status), (r) => ({ opportunity: r.opportunity })); }));
  app.post("/api/social/opportunities/:id/lead", isAuthenticated, guarded("social_lead", async (req, res) => { const id = num(req.params.id); if (!id) return nf(res); send(res, await svc.saveToLeads(req.user, id, req.body), (r) => ({ leadId: r.leadId, existing: r.existing, opportunity: r.opportunity }), 201); }));
  app.delete("/api/social/opportunities/:id", isAuthenticated, guarded("social_delete", async (req, res) => { const id = num(req.params.id); if (!id) return nf(res); send(res, await svc.remove(req.user, id), () => ({ deleted: true })); }));
  app.get("/api/social/profiles", isAuthenticated, guarded("social_profiles", async (req, res) => send(res, await svc.listProfiles(req.user), (r) => ({ profiles: r.profiles }))));
  app.post("/api/social/profiles", isAuthenticated, guarded("social_profile_create", async (req, res) => send(res, await svc.createProfile(req.user, req.body), (r) => ({ profile: r.profile }), 201)));
  app.patch("/api/social/profiles/:id", isAuthenticated, guarded("social_profile_update", async (req, res) => { const id = num(req.params.id); if (!id) return nf(res); send(res, await svc.updateProfile(req.user, id, req.body), (r) => ({ profile: r.profile })); }));
  app.post("/api/social/profiles/:id/duplicate", isAuthenticated, guarded("social_profile_duplicate", async (req, res) => { const id = num(req.params.id); if (!id) return nf(res); send(res, await svc.duplicateProfile(req.user, id), (r) => ({ profile: r.profile }), 201); }));
  app.delete("/api/social/profiles/:id", isAuthenticated, guarded("social_profile_delete", async (req, res) => { const id = num(req.params.id); if (!id) return nf(res); send(res, await svc.deleteProfile(req.user, id), () => ({ deleted: true })); }));
}
