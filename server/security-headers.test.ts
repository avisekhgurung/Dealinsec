/**
 * The headers every answer carries. A real Express app on a real port, asked the way the web server in front of it
 * asks (the scheme arrives in X-Forwarded-Proto). No database, no network beyond localhost.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { FRAME_POLICY, HSTS, useSecurityHeaders } from "./security-headers";
import { serveStatic } from "./static";

const dirs: string[] = [];
const servers: { close: () => void }[] = [];
afterEach(() => { servers.splice(0).forEach((s) => s.close()); dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })); });

async function serve(env: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dis-headers-")); dirs.push(dir);
  fs.mkdirSync(path.join(dir, "assets"));
  fs.writeFileSync(path.join(dir, "assets", "index-A.js"), "console.log(1)");
  fs.writeFileSync(path.join(dir, "index.html"), `<!doctype html><html><head><title>DealInSec</title></head><body><div id="root"></div><script type="module" src="/assets/index-A.js"></script></body></html>`);
  const app = express();
  useSecurityHeaders(app, env as NodeJS.ProcessEnv);
  app.get("/old", (_req, res) => res.redirect(301, "/new"));
  app.get("/api/thing", (_req, res) => res.json({ ok: true }));
  app.get("/api/refused", (_req, res) => res.status(403).json({ error: "no" }));
  app.get("/api/boom", () => { throw new Error("boom"); });
  app.get("/file-viewer", (_req, res) => res.set({ "Content-Security-Policy": "default-src 'none'; sandbox" }).send("x"));
  serveStatic(app, dir);
  app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(500).json({ error: "Something went wrong" }); });
  const server = app.listen(0); servers.push(server);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return async (p: string, proto: "https" | "http" | null = "https") => {
    const r = await fetch(base + p, { redirect: "manual", headers: proto ? { "x-forwarded-proto": proto } : {} });
    return { status: r.status, sniff: r.headers.get("x-content-type-options"), frame: r.headers.get("x-frame-options"), csp: r.headers.get("content-security-policy"), hsts: r.headers.get("strict-transport-security"), powered: r.headers.get("x-powered-by") };
  };
}
const EVERYTHING = ["/", "/dashboard", "/assets/index-A.js", "/assets/missing.js", "/old", "/api/thing", "/api/refused", "/api/boom"];

describe("on the live site", () => {
  it("every kind of answer carries them: pages, files, a missing file, a redirect, API answers, a refusal, a crash", async () => {
    const get = await serve({ NODE_ENV: "production" });
    const statuses: number[] = [];
    for (const p of EVERYTHING) {
      const r = await get(p);
      statuses.push(r.status);
      expect([p, r.sniff, r.frame, r.csp, r.hsts, r.powered]).toEqual([p, "nosniff", "SAMEORIGIN", FRAME_POLICY, HSTS, null]);
    }
    expect(statuses).toEqual([200, 200, 200, 404, 301, 200, 403, 500]);
  });

  it("the promise to use HTTPS is made only on an answer that arrived over HTTPS, for 180 days, for this host alone", async () => {
    const get = await serve({ NODE_ENV: "production" });
    expect((await get("/", "https")).hsts).toBe("max-age=15552000");
    expect((await get("/", "http")).hsts).toBeNull();
    expect((await get("/", null)).hsts).toBeNull(); // asked directly, with no web server in front
    expect(HSTS).not.toMatch(/includeSubDomains|preload/i);
  });

  it("only DealInSec may show a DealInSec page in a frame, and that policy restricts nothing else", async () => {
    const get = await serve({ NODE_ENV: "production" });
    const r = await get("/dashboard");
    expect([r.frame, r.csp]).toEqual(["SAMEORIGIN", "frame-ancestors 'self'"]);
    expect(r.csp).not.toMatch(/script-src|default-src|style-src|connect-src/);
  });

  it("a route with a stricter policy of its own keeps it", async () => {
    const get = await serve({ NODE_ENV: "production" });
    const r = await get("/file-viewer");
    expect([r.csp, r.frame, r.sniff]).toEqual(["default-src 'none'; sandbox", "SAMEORIGIN", "nosniff"]);
  });
});

describe("on a local copy", () => {
  it("no frame rule and no HTTPS promise (a preview may sit in a tool's frame and has no certificate); the rest still holds", async () => {
    for (const env of [{ NODE_ENV: "development" }, {}]) {
      const get = await serve(env as Record<string, string>);
      for (const p of ["/", "/api/thing", "/assets/index-A.js"]) {
        const r = await get(p);
        expect([p, r.sniff, r.frame, r.csp, r.hsts, r.powered]).toEqual([p, "nosniff", null, null, null, null]);
      }
    }
  });
});
