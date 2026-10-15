/**
 * Gmail connection: HTTP surface. Everything is the signed-in person's own mailbox; no route takes a user,
 * organization, email or connection id from the request.
 *
 *   GET  /api/integrations/gmail             status: available?, may I connect?, my connection and its problem
 *   POST /api/integrations/gmail/connect     { url } to send the browser to (Google's consent screen)
 *   GET  /api/integrations/gmail/callback    Google comes back here; redirects to /settings?gmail=<outcome>
 *   POST /api/integrations/gmail/verify      check the stored access still works
 *   POST /api/integrations/gmail/disconnect  revoke at Google, delete the credentials, keep the audit row
 *   POST /api/integrations/gmail/messages/:id/send     send an approved message from my mailbox ({ bodyHash })
 *   GET  /api/integrations/gmail/messages/:id/send     its send state (null when never handed to a mailbox)
 *   POST /api/integrations/gmail/messages/:id/resolve  settle an uncertain send after checking my Sent folder ({ decision })
 *
 * State-changing calls must be same-origin JSON (Sec-Fetch-Site / Origin checked, JSON content type required), on
 * top of the session cookie's SameSite=Lax. The callback is a cross-site navigation by design; it is protected by
 * the single-use state bound to this session, and it only ever redirects to one fixed path.
 */
import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import type { ConnectOutcome } from "@shared/gmail-connect";
import { completeConnect, disconnectMailboxes, startConnect, statusFor, UsedStates, verifyConnection, type MailServiceDeps, type Member, type PendingConnect } from "./connect-service";
import { resolveSend, sendApproved, sendStateFor, type SendDeps } from "./send-service";

export const SESSION_KEY = "gmailConnect";
export const SETTINGS_RETURN = "/settings";

export interface GmailRouteDeps extends MailServiceDeps {
  /** Rejects with 401 unless signed in; sets req.user (the app's isAuthenticated). */
  auth: RequestHandler;
  /** The session's person for the callback, without answering 401 (it must redirect instead). */
  currentUser(req: Request): Promise<Member | null>;
  /** Sending approved messages (Milestone 2). */
  send: SendDeps;
}

/**
 * Same-origin JSON only. Browsers send Sec-Fetch-Site; Origin is checked when present (against the Host, or the public
 * host a proxy forwards in X-Forwarded-Host, as the canonical-host redirect reads it: a cross-site page can't set that
 * header without a CORS preflight the browser refuses); a form post can't be JSON.
 */
export const sameOriginJson: RequestHandler = (req, res, next) => {
  const site = req.get("sec-fetch-site");
  if (site && site !== "same-origin") return res.status(403).json({ code: "cross_site", error: "That request didn't come from DealInSec." });
  const origin = req.get("origin");
  if (origin) {
    let host = "";
    try { host = new URL(origin).host.toLowerCase(); } catch { host = ""; }
    const ours = [req.get("host"), (req.get("x-forwarded-host") ?? "").split(",")[0]].map((h) => (h ?? "").trim().toLowerCase()).filter(Boolean);
    if (!host || !ours.includes(host)) return res.status(403).json({ code: "cross_site", error: "That request didn't come from DealInSec." });
  }
  if (!req.is("application/json")) return res.status(415).json({ code: "json_required", error: "Send this as JSON." });
  next();
};

/** A small per-person budget per action (in memory: a throttle, not an authorization control). */
function limiter(perHour: number) {
  const hits = new Map<string, number[]>();
  return (key: string, now: number): boolean => {
    const recent = (hits.get(key) ?? []).filter((t) => now - t < 3_600_000);
    if (recent.length >= perHour) { hits.set(key, recent); return false; }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 10_000) hits.clear();
    return true;
  };
}

export function registerGmailRoutes(app: Express, deps: GmailRouteDeps): void {
  const used = new UsedStates();
  const connectLimit = limiter(10), verifyLimit = limiter(30), disconnectLimit = limiter(20), sendLimit = limiter(60), resolveLimit = limiter(30);
  const idOf = (v: unknown) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : 0; };
  const noStore = (_req: Request, res: Response, next: NextFunction) => { res.set("Cache-Control", "no-store"); next(); };
  const fail = (res: Response, where: string) => (err: unknown) => {
    deps.log("gmail_route_error", { where, errorType: (err as Error)?.name ?? "Error" });
    if (!res.headersSent) res.status(500).json({ code: "internal", error: "Something went wrong on our side." });
  };
  const limited = (res: Response) => res.status(429).json({ code: "rate_limited", error: "Too many tries. Wait a little and try again." });

  app.get("/api/integrations/gmail", noStore, deps.auth, (req: any, res) => {
    statusFor(req.user, deps).then((s) => res.json(s), fail(res, "status"));
  });

  app.post("/api/integrations/gmail/connect", noStore, deps.auth, sameOriginJson, (req: any, res) => {
    if (!connectLimit(req.user.id, deps.now().getTime())) return limited(res);
    startConnect(req.user, deps).then((r) => {
      if (!r.ok) return res.status(r.status).json({ code: r.code, error: r.message });
      (req.session as any)[SESSION_KEY] = r.pending; // one pending connect per session: a new one replaces the old
      req.session.save((err: unknown) => (err ? fail(res, "connect_session")(err) : res.json({ url: r.url })));
    }, fail(res, "connect"));
  });

  app.get("/api/integrations/gmail/callback", noStore, (req: any, res) => {
    res.set("Referrer-Policy", "no-referrer");
    const back = (outcome: ConnectOutcome) => res.redirect(303, `${SETTINGS_RETURN}?gmail=${outcome}`);
    const pending: PendingConnect | null = req.session?.[SESSION_KEY] ?? null;
    if (req.session) delete req.session[SESSION_KEY]; // single use, whatever happens next
    (async () => {
      const user = await deps.currentUser(req);
      const r = await completeConnect({ user, pending, query: req.query ?? {}, used }, deps);
      if (req.session) await new Promise<void>((ok) => req.session.save(() => ok()));
      back(r.outcome);
    })().catch((err) => { deps.log("gmail_route_error", { where: "callback", errorType: (err as Error)?.name ?? "Error" }); if (!res.headersSent) back("failed"); });
  });

  app.post("/api/integrations/gmail/verify", noStore, deps.auth, sameOriginJson, (req: any, res) => {
    if (!verifyLimit(req.user.id, deps.now().getTime())) return limited(res);
    verifyConnection(req.user, deps).then((r) => res.json(r), fail(res, "verify"));
  });

  app.post("/api/integrations/gmail/messages/:id/send", noStore, deps.auth, sameOriginJson, (req: any, res) => {
    if (!sendLimit(req.user.id, deps.now().getTime())) return limited(res);
    sendApproved(req.user, idOf(req.params.id), req.body?.bodyHash, deps.send).then((r) => {
      if (!r.ok) return res.status(r.status).json({ code: r.code, error: r.message });
      res.status(r.outcome === "uncertain" ? 202 : 200).json({ outcome: r.outcome, send: r.send, reconnect: !!r.reconnect });
    }, fail(res, "send"));
  });

  app.get("/api/integrations/gmail/messages/:id/send", noStore, deps.auth, (req: any, res) => {
    sendStateFor(req.user, idOf(req.params.id), deps.send).then((r) => (r.ok ? res.json({ send: r.send }) : res.status(r.status).json({ code: r.code, error: r.message })), fail(res, "send_state"));
  });

  app.post("/api/integrations/gmail/messages/:id/resolve", noStore, deps.auth, sameOriginJson, (req: any, res) => {
    if (!resolveLimit(req.user.id, deps.now().getTime())) return limited(res);
    resolveSend(req.user, idOf(req.params.id), req.body, deps.send).then((r) => (r.ok ? res.json({ send: r.send, messageStatus: r.messageStatus }) : res.status(r.status).json({ code: r.code, error: r.message })), fail(res, "resolve"));
  });

  app.post("/api/integrations/gmail/disconnect", noStore, deps.auth, sameOriginJson, (req: any, res) => {
    if (!req.user.organizationId) return res.status(403).json({ code: "no_organization", error: "Finish setting up your workspace first." });
    if (!disconnectLimit(req.user.id, deps.now().getTime())) return limited(res);
    disconnectMailboxes({ actor: req.user, orgId: req.user.organizationId, userId: req.user.id, reason: "user" }, deps)
      .then(async (r) => res.json({ ...r, status: await statusFor(req.user, deps) }), fail(res, "disconnect"));
  });
}
