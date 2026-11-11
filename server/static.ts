import express, { type Express, type Response } from "express";
import fs from "fs";
import path from "path";
import { injectLandingSeo } from "./landing-seo";
import { SPA_PAGE_HEADS, withHomeHead, withPageHead } from "./site-head";
import { precompressed } from "./precompressed";

/**
 * Something built from a file, kept in memory and rebuilt when the file on disk changes.
 *
 * Why: a deploy uploads a new build while the old server is still running. The old page names script files by their
 * content hash, and an upload may remove those. A server that only read the page at boot would keep handing out the
 * old page, every fresh visit would ask for a script that is gone, and the site would be blank until the restart
 * (10 Nov 2026: about five minutes). Reading the page again when it changes means the page and the scripts on disk
 * always belong to the same build, whenever the restart comes.
 *
 * The file is looked at (one stat) at most once every `everyMs`. If it is missing or half-written at that moment, or
 * `build` throws on it, the last good value keeps being served and it is looked at again next time.
 */
export function freshFromFile<T>(file: string, build: (text: string) => T, opts: { everyMs?: number; now?: () => number } = {}): () => T {
  const everyMs = opts.everyMs ?? 1000, now = opts.now ?? Date.now;
  const stamp = () => { const st = fs.statSync(file); return `${st.mtimeMs}:${st.size}`; };
  let seen = stamp();
  let value = build(fs.readFileSync(file, "utf-8")); // at boot a missing page is fatal, as it always was
  let checkedAt = now();
  return () => {
    const t = now();
    if (t - checkedAt < everyMs) return value;
    checkedAt = t;
    try {
      const s = stamp();
      if (s !== seen) {
        const text = fs.readFileSync(file, "utf-8");
        if (text.trim()) { value = build(text); seen = s; } // an empty file is one caught mid-write: look again next time
      }
    } catch { /* gone or unreadable for a moment: keep the last good page */ }
    return value;
  };
}

export function serveStatic(app: Express, distPath: string = path.resolve(__dirname, "public")) {
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // Hashed assets cache forever; everything that DECIDES freshness (sw.js,
  // the manifest, index.html) must never be cached, or devices keep serving
  // yesterday's build no matter what we deploy.
  const cacheHeaders = (res: Response, filePath: string) => {
    if (filePath.includes(`${path.sep}assets${path.sep}`)) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    } else if (/\.(js|json|webmanifest|html)$/.test(filePath)) {
      res.setHeader("Cache-Control", "no-cache");
    }
  };
  // The squeezed copy the build left beside a script or style file, for a browser that can read it (precompressed.ts);
  // everything else, and every browser that cannot, gets the file itself from the ordinary handler below.
  app.use(precompressed(distPath, cacheHeaders));
  app.use(express.static(distPath, { index: false, setHeaders: cacheHeaders }));

  const indexPath = path.resolve(distPath, "index.html");
  // Built at boot, and again whenever index.html changes on disk (freshFromFile): the marketing routes get a crawlable
  // copy of the page inside #root (React replaces it on mount), every other route gets the bare shell. See landing-seo.ts.
  // The public SPA pages each get their own title, description and canonical (site-head.ts).
  const pages = freshFromFile(indexPath, (shell) => ({
    shell,
    landingHtml: injectLandingSeo(withHomeHead(shell)),
    pageHtml: new Map(Object.entries(SPA_PAGE_HEADS).map(([p, head]) => [p, withPageHead(shell, p, head)])),
  }));
  const CRAWLABLE = new Set(["/", "/index.html"]);

  app.use("*", (req, res) => {
    const url = req.originalUrl.split("?")[0].replace(/\/+$/, "") || "/";
    res.setHeader("Cache-Control", "no-cache");
    // A build file that isn't there is "not found", never the page: a script tag handed HTML with a 200 fails
    // silently and leaves a blank screen, where a 404 is at least an honest answer the browser can act on.
    if (url === "/assets" || url.startsWith("/assets/")) { res.setHeader("X-Robots-Tag", "noindex, nofollow"); return res.status(404).type("text").send("Not found"); }
    const { shell, landingHtml, pageHtml } = pages();
    // Everything else here is the app (dashboards, settings, auth), a client's private document link (/q/…, signing
    // links) or a mistyped URL: all of them get the homepage's shell, so they are kept out of search rather than
    // indexed as copies of the homepage. Public marketing pages are server-rendered elsewhere with their own head.
    if (!CRAWLABLE.has(url) && !pageHtml.has(url)) res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.type("html").send(CRAWLABLE.has(url) ? landingHtml : pageHtml.get(url) ?? shell);
  });
}
