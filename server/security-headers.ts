/**
 * The few response headers every answer should carry.
 *
 * Why here and not on the web server: the site moved hosts once already and lost things the old host did quietly
 * (the squeezing of script files, a key locked to an address). Whatever the app sets itself travels with the build.
 *
 *  - X-Content-Type-Options: nosniff, everywhere. A file is only ever what its type says it is.
 *  - No "X-Powered-By": there is no reason to tell a stranger what the server is built with.
 *  - In production only (a local preview may sit inside a tool's frame, and has no certificate):
 *      X-Frame-Options and frame-ancestors: only DealInSec itself may show a DealInSec page inside a frame. The app
 *      approves messages and holds billing; another site must not be able to lay it invisibly under its own buttons.
 *      The agreement preview frames our own export route, which "same origin" allows.
 *      Strict-Transport-Security, on answers that arrived over HTTPS: the browser stops trying plain HTTP for this
 *      host for the next 180 days. No includeSubDomains (other names under the domain are not ours to promise for)
 *      and no preload.
 *
 * A route that sets a stricter policy of its own afterwards (the knowledge file viewer) simply replaces ours.
 * No script policy here: the page loads payments and analytics from outside, and a wrong one blanks the site.
 */
import type { Express, NextFunction, Request, Response } from "express";

export const HSTS = "max-age=15552000"; // 180 days
export const FRAME_POLICY = "frame-ancestors 'self'";

const viaHttps = (req: Request) => (String(req.headers["x-forwarded-proto"] ?? "") || req.protocol || "").split(",")[0].trim().toLowerCase() === "https";

export function securityHeaders(env: NodeJS.ProcessEnv = process.env) {
  const production = env.NODE_ENV === "production";
  return (req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (production) {
      res.setHeader("X-Frame-Options", "SAMEORIGIN");
      res.setHeader("Content-Security-Policy", FRAME_POLICY);
      if (viaHttps(req)) res.setHeader("Strict-Transport-Security", HSTS);
    }
    next();
  };
}

/** First thing on the app, so redirects, files, pages, API answers and errors all carry them. */
export function useSecurityHeaders(app: Express, env: NodeJS.ProcessEnv = process.env) {
  app.disable("x-powered-by");
  app.use(securityHeaders(env));
}
