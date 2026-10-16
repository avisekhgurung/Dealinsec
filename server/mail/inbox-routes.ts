/**
 * Outreach inbox: HTTP surface (service: inbox.ts). Organization and person come from the session only.
 *
 *   GET  /api/outreach/inbox                       conversations (?filter=&q=&before=), with counts per filter
 *   GET  /api/outreach/inbox/review                my address-only matches waiting for review
 *   GET  /api/outreach/inbox/:threadId             one conversation, its messages and follow-ups
 *   POST /api/outreach/inbox/messages/:id/review   { decision: "confirm" | "dismiss" }
 *   POST /api/outreach/inbox/messages/:id/label    { label } a person's correction of the rules' label
 *
 * Changes are same-origin JSON (sameOriginJson). Responses are never cached (they hold message text).
 */
import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import { conversation, listInbox, relabelMessage, reviewMessage, reviewQueue } from "./inbox";
import type { ApplyDeps } from "./reply-apply";
import { sameOriginJson } from "./routes";

export function registerInboxRoutes(app: Express, deps: { auth: RequestHandler; apply: ApplyDeps; log(event: string, fields?: Record<string, string | number | boolean | null>): void }): void {
  const noStore = (_req: Request, res: Response, next: NextFunction) => { res.set("Cache-Control", "no-store"); next(); };
  const idOf = (v: unknown) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : 0; };
  const send = (res: Response, where: string) => (r: { ok: boolean; status?: number; code?: string; message?: string }) => {
    if (r.ok) return res.json(r);
    res.status(r.status ?? 500).json({ code: r.code, error: r.message });
  };
  const fail = (res: Response, where: string) => (err: unknown) => {
    deps.log("inbox_route_error", { where, errorType: (err as Error)?.name ?? "Error" });
    if (!res.headersSent) res.status(500).json({ code: "internal", error: "Something went wrong on our side." });
  };

  app.get("/api/outreach/inbox", noStore, deps.auth, (req: any, res) => {
    listInbox(req.user, { filter: req.query.filter, q: req.query.q, before: req.query.before }).then(send(res, "list"), fail(res, "list"));
  });
  app.get("/api/outreach/inbox/review", noStore, deps.auth, (req: any, res) => {
    reviewQueue(req.user).then(send(res, "review_list"), fail(res, "review_list"));
  });
  app.get("/api/outreach/inbox/:threadId", noStore, deps.auth, (req: any, res) => {
    conversation(req.user, idOf(req.params.threadId)).then(send(res, "conversation"), fail(res, "conversation"));
  });
  app.post("/api/outreach/inbox/messages/:id/review", noStore, deps.auth, sameOriginJson, (req: any, res) => {
    reviewMessage(req.user, idOf(req.params.id), req.body, deps.apply).then(send(res, "review"), fail(res, "review"));
  });
  app.post("/api/outreach/inbox/messages/:id/label", noStore, deps.auth, sameOriginJson, (req: any, res) => {
    relabelMessage(req.user, idOf(req.params.id), req.body, deps.apply).then(send(res, "label"), fail(res, "label"));
  });
}
