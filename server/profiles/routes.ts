/**
 * Client profiles: HTTP surface (all under /api/client-profiles, all authenticated). Thin: parse, call the service,
 * map the Result to HTTP. A profile in another workspace answers 404.
 *
 *   GET    /api/client-profiles                 the workspace's saved profiles, and the built-in starting points
 *   POST   /api/client-profiles                 create
 *   POST   /api/client-profiles/from-template   create from a starting point ({ kind })
 *   PATCH  /api/client-profiles/:id             edit (any fields), or { isDefault }
 *   POST   /api/client-profiles/:id/duplicate   copy
 *   POST   /api/client-profiles/:id/search      the search it would start ({ industry? }); nothing is searched or spent
 *   DELETE /api/client-profiles/:id             delete
 */
import type { Express, Response } from "express";
import { PROFILE_TEMPLATES } from "@shared/acquisition-profile";
import { isAuthenticated } from "../auth";
import { agentLog } from "../agent/log";
import * as svc from "./service";

export function registerClientProfileRoutes(app: Express) {
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
  const nf = (res: Response) => res.status(404).json({ code: "not_found", error: "That profile isn't in your workspace." });
  const one = (r: any) => ({ profile: r.profile });

  app.get("/api/client-profiles", isAuthenticated, guarded("profiles_list", async (req, res) => send(res, await svc.listProfiles(req.user), (r) => ({ profiles: r.profiles, max: r.max, templates: PROFILE_TEMPLATES.map((t) => ({ kind: t.kind, label: t.label, note: t.note })) }))));
  app.post("/api/client-profiles", isAuthenticated, guarded("profiles_create", async (req, res) => send(res, await svc.createProfile(req.user, req.body), one, 201)));
  app.post("/api/client-profiles/from-template", isAuthenticated, guarded("profiles_template", async (req, res) => send(res, await svc.createFromTemplate(req.user, req.body), one, 201)));
  app.patch("/api/client-profiles/:id", isAuthenticated, guarded("profiles_update", async (req, res) => { const id = num(req.params.id); if (!id) return nf(res); send(res, await svc.updateProfile(req.user, id, req.body), one); }));
  app.post("/api/client-profiles/:id/duplicate", isAuthenticated, guarded("profiles_duplicate", async (req, res) => { const id = num(req.params.id); if (!id) return nf(res); send(res, await svc.duplicateProfile(req.user, id), one, 201); }));
  app.post("/api/client-profiles/:id/search", isAuthenticated, guarded("profiles_search", async (req, res) => { const id = num(req.params.id); if (!id) return nf(res); send(res, await svc.searchFromProfile(req.user, id, req.body), (r) => ({ icp: r.icp, searches: r.searches, description: r.description, source: r.source })); }));
  app.delete("/api/client-profiles/:id", isAuthenticated, guarded("profiles_delete", async (req, res) => { const id = num(req.params.id); if (!id) return nf(res); send(res, await svc.deleteProfile(req.user, id), () => ({ deleted: true })); }));
}
