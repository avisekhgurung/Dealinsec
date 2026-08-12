import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { injectLandingSeo } from "./landing-seo";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // Hashed assets cache forever; everything that DECIDES freshness (sw.js,
  // the manifest, index.html) must never be cached, or devices keep serving
  // yesterday's build no matter what we deploy.
  app.use(express.static(distPath, {
    index: false,
    setHeaders(res, filePath) {
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else if (/\.(js|json|webmanifest|html)$/.test(filePath)) {
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  }));

  const indexPath = path.resolve(distPath, "index.html");
  // Built once at boot: the marketing routes get a crawlable copy of the page
  // inside #root (React replaces it on mount), every other route gets the bare
  // shell. See landing-seo.ts.
  const shell = fs.readFileSync(indexPath, "utf-8");
  const landingHtml = injectLandingSeo(shell);
  const CRAWLABLE = new Set(["/", "/index.html"]);

  app.use("*", (req, res) => {
    const url = req.originalUrl.split("?")[0];
    res.setHeader("Cache-Control", "no-cache");
    res.type("html").send(CRAWLABLE.has(url) ? landingHtml : shell);
  });
}
