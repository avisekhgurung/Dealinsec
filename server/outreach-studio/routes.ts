/**
 * Outreach Studio routes (server/outreach-studio/service.ts). Messages themselves stay on the email and channel routes;
 * these are the records around them.
 *   POST /api/outreach/leads/:id/handoff                 { channel, action: copied|opened, messageId? }  never a send
 *   POST /api/outreach/leads/:id/follow-ups              { channel, dueOn: YYYY-MM-DD, note? }            a reminder ticket
 *   POST /api/outreach/leads/:id/follow-ups/:tid/done    the reminder is done
 *   POST /api/outreach/leads/:id/reply-note              { channel, outcome, note?, messageId? }          what their reply said
 *   GET  /api/outreach/leads/:id/intelligence            the research, ranked the way drafts use it
 *   GET  /api/outreach/overview?days=7|30|90             honest numbers: seen by DealInSec vs recorded by you
 *   POST /api/outreach/leads/:id/contact-links            read the company's own site once for its social profiles (free)
 */
import type { Express, Response } from "express";
import { isAuthenticated } from "../auth";
import { agentLog } from "../agent/log";
import { sameOriginJson } from "../mail/routes";
import * as svc from "./service";

export function registerOutreachStudioRoutes(app: Express) {
  const send = (res: Response, r: any, ok: (r: any) => Record<string, unknown>, status = 200) =>
    r.ok ? res.status(status).json(ok(r)) : res.status(r.status).json({ code: r.code, error: r.message, ...(r.topUp ? { topUp: r.topUp } : {}) });
  const guarded = (where: string, fn: (req: any, res: Response) => Promise<unknown>) => async (req: any, res: Response) => {
    if (!req.user?.organizationId) return res.status(403).json({ code: "no_organization", error: "Finish setting up your workspace first." });
    try { await fn(req, res); }
    catch (err) {
      agentLog("error", { errorType: (err as Error)?.name ?? "Error", where });
      res.status(500).json({ code: "internal", error: "Something went wrong on our side." });
    }
  };
  const num = (v: unknown): number | null => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
  const withId = (where: string, fn: (req: any, res: Response, id: number) => Promise<unknown>) => guarded(where, async (req, res) => {
    const id = num(req.params.id);
    if (!id) return res.status(404).json({ code: "not_found", error: "That isn't in your workspace." });
    await fn(req, res, id);
  });

  app.post("/api/outreach/leads/:id/handoff", isAuthenticated, sameOriginJson, withId("studio_handoff", async (req, res, id) => send(res, await svc.recordHandoff(req.user, id, req.body), () => ({ ok: true }))));
  app.post("/api/outreach/leads/:id/follow-ups", isAuthenticated, sameOriginJson, withId("studio_followup", async (req, res, id) => send(res, await svc.scheduleFollowUp(req.user, id, req.body), (r) => ({ ticketId: r.ticketId, dueOn: r.dueOn }), 201)));
  app.post("/api/outreach/leads/:id/follow-ups/:tid/done", isAuthenticated, sameOriginJson, withId("studio_followup_done", async (req, res, id) => {
    const tid = num(req.params.tid);
    if (!tid) return res.status(404).json({ code: "not_found", error: "That follow-up isn't on this lead." });
    send(res, await svc.completeFollowUp(req.user, id, tid), () => ({ ok: true }));
  }));
  app.post("/api/outreach/leads/:id/reply-note", isAuthenticated, sameOriginJson, withId("studio_reply_note", async (req, res, id) => send(res, await svc.recordReplyNote(req.user, id, req.body), () => ({ ok: true }), 201)));
  app.get("/api/outreach/leads/:id/intelligence", isAuthenticated, withId("studio_intelligence", async (req, res, id) => { res.setHeader("Cache-Control", "no-store"); send(res, await svc.leadIntelligence(req.user, id), (r) => ({ intelligence: r.intelligence })); }));
  app.post("/api/outreach/leads/:id/contact-links", isAuthenticated, sameOriginJson, withId("studio_contact_links", async (req, res, id) => send(res, await svc.findContactLinks(req.user, id), (r) => ({ socials: r.socials, checked: r.checked }))));
  app.get("/api/outreach/overview", isAuthenticated, guarded("studio_overview", async (req, res) => { res.setHeader("Cache-Control", "no-store"); send(res, await svc.outreachOverview(req.user, { days: req.query.days }), (r) => ({ overview: r.overview })); }));
}
