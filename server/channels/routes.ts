/**
 * Outreach on WhatsApp, LinkedIn and X: HTTP surface (server/channels/service.ts). Everything is the signed-in person's
 * own workspace; a lead or message in another workspace answers 404. State-changing calls are same-origin JSON (as Gmail's).
 *
 *   GET    /api/channels/status                         each channel's real state for this workspace
 *   GET    /api/channels/leads/:id/messages             the lead's channel messages and WhatsApp opt-ins
 *   POST   /api/channels/leads/:id/draft                { channel, kind, to?, write: "ai"|"own", text?, template? }
 *   POST   /api/channels/leads/:id/whatsapp/opt-in      { phone, source }  record how they agreed
 *   POST   /api/channels/leads/:id/whatsapp/opt-out     { phone }
 *   PATCH  /api/channels/messages/:id                   { text?, to?, params? }  back to draft
 *   POST   /api/channels/messages/:id/approve           { bodyHash }
 *   POST   /api/channels/messages/:id/send              { bodyHash }  WhatsApp through the connected number
 *   POST   /api/channels/messages/:id/sent              { bodyHash }  "I sent it" (LinkedIn, X, own WhatsApp)
 *   POST   /api/channels/messages/:id/resolve           { outcome: "sent"|"not_sent" }  an uncertain WhatsApp send
 *   POST   /api/channels/messages/:id/reply             "They replied" (where replies don't reach DealInSec)
 *   POST   /api/channels/messages/:id/cancel
 *   GET    /api/integrations/whatsapp                   connection status (never a token)
 *   POST   /api/integrations/whatsapp                   { phoneNumberId, wabaId, accessToken }  owners and admins
 *   DELETE /api/integrations/whatsapp                   disconnect (the sealed token is deleted)
 *   GET    /api/integrations/whatsapp/templates         the business account's approved templates
 *   GET    /api/webhooks/whatsapp                       Meta's subscription handshake
 *   POST   /api/webhooks/whatsapp                       Meta's signed notifications (no session; the signature is the auth)
 */
import type { Express, Request, Response } from "express";
import { isAuthenticated } from "../auth";
import { agentLog } from "../agent/log";
import { sameOriginJson } from "../mail/routes";
import * as svc from "./service";
import { verifyChallenge } from "./whatsapp-webhook";

export function registerChannelRoutes(app: Express) {
  const send = (res: Response, r: any, ok: (r: any) => Record<string, unknown>, status = 200) => {
    if (r.ok) return res.status(status).json(ok(r));
    const extra: Record<string, unknown> = {};
    for (const k of ["issues", "feature"]) if (r[k]) extra[k] = r[k];
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
  const withId = (where: string, fn: (req: any, res: Response, id: number) => Promise<unknown>) => guarded(where, async (req, res) => { const id = num(req.params.id); if (!id) return nf(res); await fn(req, res, id); });
  const message = (r: any) => ({ message: r.message });

  app.get("/api/channels/status", isAuthenticated, guarded("channels_status", async (req, res) => { res.setHeader("Cache-Control", "no-store"); send(res, await svc.channelStatuses(req.user), (r) => ({ channels: r.channels })); }));
  app.get("/api/channels/leads/:id/messages", isAuthenticated, withId("channels_list", async (req, res, id) => send(res, await svc.listChannelMessages(req.user, id), (r) => ({ messages: r.messages, whatsappContacts: r.whatsappContacts }))));
  app.post("/api/channels/leads/:id/draft", isAuthenticated, sameOriginJson, withId("channels_draft", async (req, res, id) => send(res, await svc.draftChannelMessage(req.user, id, req.body), (r) => ({ message: r.message, retried: r.retried }), 201)));
  app.post("/api/channels/leads/:id/whatsapp/opt-in", isAuthenticated, sameOriginJson, withId("channels_opt_in", async (req, res, id) => send(res, await svc.recordWhatsappOptIn(req.user, id, req.body), (r) => ({ contact: r.contact }))));
  app.post("/api/channels/leads/:id/whatsapp/opt-out", isAuthenticated, sameOriginJson, withId("channels_opt_out", async (req, res, id) => send(res, await svc.recordWhatsappOptOut(req.user, id, req.body), () => ({ ok: true }))));
  app.patch("/api/channels/messages/:id", isAuthenticated, sameOriginJson, withId("channels_edit", async (req, res, id) => send(res, await svc.editChannelMessage(req.user, id, req.body), message)));
  app.post("/api/channels/messages/:id/approve", isAuthenticated, sameOriginJson, withId("channels_approve", async (req, res, id) => send(res, await svc.approveChannelMessage(req.user, id, req.body?.bodyHash), message)));
  app.post("/api/channels/messages/:id/send", isAuthenticated, sameOriginJson, withId("channels_send", async (req, res, id) => send(res, await svc.sendWhatsapp(req.user, id, req.body?.bodyHash), message)));
  app.post("/api/channels/messages/:id/sent", isAuthenticated, sameOriginJson, withId("channels_mark_sent", async (req, res, id) => send(res, await svc.markChannelSent(req.user, id, req.body?.bodyHash), (r) => ({ message: r.message, already: r.already }))));
  app.post("/api/channels/messages/:id/resolve", isAuthenticated, sameOriginJson, withId("channels_resolve", async (req, res, id) => send(res, await svc.resolveUncertain(req.user, id, req.body), message)));
  app.post("/api/channels/messages/:id/reply", isAuthenticated, sameOriginJson, withId("channels_reply", async (req, res, id) => send(res, await svc.recordChannelReply(req.user, id), (r) => ({ message: r.message, already: r.already }))));
  app.post("/api/channels/messages/:id/cancel", isAuthenticated, sameOriginJson, withId("channels_cancel", async (req, res, id) => send(res, await svc.cancelChannelMessage(req.user, id), message)));

  app.get("/api/integrations/whatsapp", isAuthenticated, guarded("whatsapp_status", async (req, res) => { res.setHeader("Cache-Control", "no-store"); send(res, await svc.whatsappConnectionStatus(req.user), (r) => ({ configured: r.configured, reason: r.reason, canManage: r.canManage, connection: r.connection, webhookPath: r.webhookPath })); }));
  app.post("/api/integrations/whatsapp", isAuthenticated, sameOriginJson, guarded("whatsapp_connect", async (req, res) => send(res, await svc.connectWhatsapp(req.user, req.body), (r) => ({ connection: r.connection }), 201)));
  app.delete("/api/integrations/whatsapp", isAuthenticated, guarded("whatsapp_disconnect", async (req, res) => send(res, await svc.disconnectWhatsapp(req.user), (r) => ({ disconnected: r.disconnected }))));
  app.get("/api/integrations/whatsapp/templates", isAuthenticated, guarded("whatsapp_templates", async (req, res) => send(res, await svc.listWhatsappTemplates(req.user), (r) => ({ templates: r.templates }))));

  // Meta's webhook: no session. The GET answers only our verify token; a POST is applied only with a valid signature.
  app.get("/api/webhooks/whatsapp", (req: Request, res: Response) => {
    const challenge = verifyChallenge(req.query as Record<string, unknown>, svc.whatsappConfig().verifyToken ?? undefined);
    if (!challenge) return res.status(403).send("forbidden");
    res.type("text/plain").send(challenge);
  });
  app.post("/api/webhooks/whatsapp", async (req: any, res: Response) => {
    try {
      const out = await svc.handleWhatsappWebhook(req.rawBody, req.get("x-hub-signature-256"));
      // 2xx only when applied: anything else makes Meta deliver it again, and every effect is idempotent.
      res.status(out.status).json({ ok: out.status === 200 });
    } catch (err) {
      agentLog("error", { errorType: (err as Error)?.name ?? "Error", where: "whatsapp_webhook" });
      res.status(500).json({ ok: false });
    }
  });
}
