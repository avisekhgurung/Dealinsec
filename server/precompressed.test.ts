/**
 * Built files sent small: the squeezed copies the build writes, and when the app hands one out. A real Express app
 * on a real port over a build folder in a temp directory, asked with plain HTTP so the bytes on the wire are what is
 * measured (nothing unpacks them on the way). No database, no network beyond localhost.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { acceptedEncodings, precompressDir } from "./precompressed";
import { serveStatic } from "./static";

const dirs: string[] = [];
const servers: { close: () => void }[] = [];
afterEach(() => { servers.splice(0).forEach((s) => s.close()); dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })); });

const SCRIPT = "export const words = [" + Array.from({ length: 4000 }, (_, i) => `"client ${i} wants a website"`).join(",") + "];";
const STYLE = Array.from({ length: 800 }, (_, i) => `.card-${i}{display:flex;padding:12px;color:#0f766e}`).join("\n");
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${'<path d="M0 0h10v10H0z"/>'.repeat(200)}</svg>`;
const NOISE = crypto.randomBytes(6000); // does not squeeze, like a picture or a font

/** A build folder as the build leaves it: page, scripts, styles, pictures, with the squeezed copies written. */
function build(opts: { squeeze?: boolean } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dis-small-")); dirs.push(dir);
  fs.mkdirSync(path.join(dir, "assets")); fs.mkdirSync(path.join(dir, "brand"));
  const put = (rel: string, body: string | Buffer) => fs.writeFileSync(path.join(dir, rel), body);
  put("index.html", `<!doctype html><html><head><title>DealInSec</title></head><body><div id="root"></div><script type="module" src="/assets/index-AAA.js"></script></body></html>`);
  put("assets/index-AAA.js", SCRIPT);
  put("assets/index-AAA.css", STYLE);
  put("assets/tiny-BBB.js", "export default 1;");
  put("assets/photo-CCC.webp", NOISE);
  put("assets/font-DDD.woff2", NOISE);
  put("brand/logo.svg", SVG);
  put("sw.js", "self.addEventListener('fetch', () => {});" + "// service worker ".repeat(200));
  put("manifest.webmanifest", JSON.stringify({ name: "DealInSec", icons: Array.from({ length: 60 }, (_, i) => ({ src: `/icon-${i}.png`, sizes: "192x192" })) }));
  const report = opts.squeeze === false ? null : precompressDir(dir);
  return { dir, report, put, has: (rel: string) => fs.existsSync(path.join(dir, rel)) };
}

async function serve(dir: string) {
  const app = express();
  serveStatic(app, dir);
  const server = app.listen(0); servers.push(server);
  await new Promise((r) => server.once("listening", r));
  const port = (server.address() as AddressInfo).port;
  /** One plain request; the body comes back exactly as sent. */
  const get = (p: string, headers: Record<string, string> = {}, method = "GET") => new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: p, method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject); req.end();
  });
  return { get };
}
const BROWSER = { "accept-encoding": "gzip, deflate, br, zstd" };

describe("what the browser says it can read", () => {
  it("reads the list, and leaves out what was refused", () => {
    expect([...acceptedEncodings("gzip, deflate, br, zstd")]).toEqual(["gzip", "deflate", "br", "zstd"]);
    expect([...acceptedEncodings("BR;q=1.0, gzip;q=0.8, deflate;q=0")]).toEqual(["br", "gzip"]);
    expect([...acceptedEncodings("br;q=0, gzip; q=0.0, identity")]).toEqual(["identity"]);
    expect([...acceptedEncodings("gzip;q=abc")]).toEqual([]);
    for (const none of [undefined, null, "", " , ", 7, ["br"]]) expect(acceptedEncodings(none).size).toBe(0);
  });
});

describe("the build writes a squeezed copy beside each text file", () => {
  it("scripts, styles, SVG and the like get both copies; pictures, fonts, pages and tiny files get none", () => {
    const b = build();
    for (const f of ["assets/index-AAA.js", "assets/index-AAA.css", "brand/logo.svg", "sw.js", "manifest.webmanifest"]) expect([f, b.has(f + ".br"), b.has(f + ".gz")]).toEqual([f, true, true]);
    for (const f of ["assets/tiny-BBB.js", "assets/photo-CCC.webp", "assets/font-DDD.woff2", "index.html"]) expect([f, b.has(f + ".br"), b.has(f + ".gz")]).toEqual([f, false, false]);
    expect(b.report!.files).toBe(5);
    expect(b.report!.brBytes).toBeLessThan(b.report!.rawBytes / 3);
    expect(b.report!.gzBytes).toBeLessThan(b.report!.rawBytes / 3);
  });

  it("each copy unpacks to exactly the file it was made from, and the file itself is untouched", () => {
    const b = build();
    const raw = fs.readFileSync(path.join(b.dir, "assets/index-AAA.js"));
    expect(raw.toString()).toBe(SCRIPT);
    expect(zlib.brotliDecompressSync(fs.readFileSync(path.join(b.dir, "assets/index-AAA.js.br"))).equals(raw)).toBe(true);
    expect(zlib.gunzipSync(fs.readFileSync(path.join(b.dir, "assets/index-AAA.js.gz"))).equals(raw)).toBe(true);
  });

  it("run again, it replaces its copies and never squeezes a copy; a file that shrank below the line loses its copies", () => {
    const b = build();
    b.put("assets/index-AAA.css", "a{b:c}");
    const again = precompressDir(b.dir);
    expect(again.files).toBe(4);
    expect([b.has("assets/index-AAA.css.br"), b.has("assets/index-AAA.css.gz")]).toEqual([false, false]);
    expect(fs.readdirSync(path.join(b.dir, "assets")).filter((f) => /\.(br|gz)\.(br|gz)$/.test(f))).toEqual([]);
  });

  it("a file that does not get smaller keeps no copy", () => {
    const b = build({ squeeze: false });
    b.put("assets/noise-EEE.js", NOISE);
    precompressDir(b.dir);
    expect([b.has("assets/noise-EEE.js.br"), b.has("assets/noise-EEE.js.gz")]).toEqual([false, false]);
  });
});

describe("the app hands out the squeezed copy to a browser that can read it", () => {
  it("the script and style arrive small, labelled, cached as before, and unpack to the real file", async () => {
    const b = build(); const s = await serve(b.dir);
    const js = await s.get("/assets/index-AAA.js", BROWSER);
    expect([js.status, js.headers["content-encoding"], js.headers["cache-control"]]).toEqual([200, "br", "public, max-age=31536000, immutable"]);
    expect(js.headers["content-type"]).toMatch(/^application\/javascript/);
    expect(js.headers.vary).toMatch(/accept-encoding/i);
    expect(js.body.length).toBeLessThan(SCRIPT.length / 3);
    expect(zlib.brotliDecompressSync(js.body).toString()).toBe(SCRIPT);
    const css = await s.get("/assets/index-AAA.css?v=2", BROWSER);
    expect([css.status, css.headers["content-encoding"]]).toEqual([200, "br"]);
    expect(css.headers["content-type"]).toMatch(/^text\/css/);
    expect(zlib.brotliDecompressSync(css.body).toString()).toBe(STYLE);
  });

  it("gzip for a browser that reads only gzip; the plain file for one that reads neither or refused both", async () => {
    const b = build(); const s = await serve(b.dir);
    const gz = await s.get("/assets/index-AAA.js", { "accept-encoding": "gzip, deflate" });
    expect(gz.headers["content-encoding"]).toBe("gzip");
    expect(zlib.gunzipSync(gz.body).toString()).toBe(SCRIPT);
    for (const h of [{}, { "accept-encoding": "identity" }, { "accept-encoding": "br;q=0, gzip;q=0" }, { "accept-encoding": "zstd" }]) {
      const plain = await s.get("/assets/index-AAA.js", h);
      expect([plain.status, plain.headers["content-encoding"], plain.body.toString() === SCRIPT, plain.headers["cache-control"]]).toEqual([200, undefined, true, "public, max-age=31536000, immutable"]);
      expect(plain.headers["content-type"]).toMatch(/javascript/);
      expect(plain.headers.vary).toMatch(/accept-encoding/i); // a cache in between must not hand the wrong copy to the next browser
    }
  });

  it("files that decide freshness stay uncached when sent small: the service worker and the manifest", async () => {
    const b = build(); const s = await serve(b.dir);
    for (const p of ["/sw.js", "/manifest.webmanifest"]) {
      const r = await s.get(p, BROWSER);
      expect([p, r.status, r.headers["content-encoding"], r.headers["cache-control"]]).toEqual([p, 200, "br", "no-cache"]);
    }
    const svg = await s.get("/brand/logo.svg", BROWSER);
    expect([svg.headers["content-encoding"], svg.headers["content-type"]]).toEqual(["br", "image/svg+xml"]);
    expect(zlib.brotliDecompressSync(svg.body).toString()).toBe(SVG);
  });

  it("pictures, fonts, tiny scripts and pages go out exactly as before", async () => {
    const b = build(); const s = await serve(b.dir);
    for (const p of ["/assets/photo-CCC.webp", "/assets/font-DDD.woff2"]) {
      const r = await s.get(p, BROWSER);
      expect([p, r.status, r.headers["content-encoding"], r.body.equals(NOISE)]).toEqual([p, 200, undefined, true]);
    }
    const tiny = await s.get("/assets/tiny-BBB.js", BROWSER);
    expect([tiny.headers["content-encoding"], tiny.body.toString()]).toEqual([undefined, "export default 1;"]);
    const page = await s.get("/dashboard", BROWSER);
    expect([page.status, page.headers["content-encoding"], page.headers["cache-control"]]).toEqual([200, undefined, "no-cache"]);
    expect(page.body.toString()).toContain("/assets/index-AAA.js");
  });

  it("a second visit with the copy already held gets 'not changed', and a HEAD request gets the headers with no body", async () => {
    const b = build(); const s = await serve(b.dir);
    const first = await s.get("/assets/index-AAA.js", BROWSER);
    const again = await s.get("/assets/index-AAA.js", { ...BROWSER, "if-none-match": String(first.headers.etag) });
    expect([again.status, again.body.length]).toEqual([304, 0]);
    const head = await s.get("/assets/index-AAA.js", BROWSER, "HEAD");
    expect([head.status, head.headers["content-encoding"], head.body.length]).toEqual([200, "br", 0]);
    expect(Number(head.headers["content-length"])).toBe(first.body.length);
  });

  it("a part of a file is cut from the plain file, never from a copy", async () => {
    const b = build(); const s = await serve(b.dir);
    const part = await s.get("/assets/index-AAA.js", { ...BROWSER, range: "bytes=0-9" });
    expect([part.status, part.headers["content-encoding"], part.body.toString()]).toEqual([206, undefined, SCRIPT.slice(0, 10)]);
  });
});

describe("a deploy keeps old files on the server, and none of them is ever served as something newer", () => {
  it("a copy left by an earlier build is not served in place of a newer file with the same name", async () => {
    const b = build(); const s = await serve(b.dir);
    // The next build's service worker arrives without copies (say it got too small to bother); the old copies stay.
    const NEW = "self.addEventListener('fetch', () => { /* new build */ });";
    b.put("sw.js", NEW);
    const later = new Date(Date.now() + 60_000);
    fs.utimesSync(path.join(b.dir, "sw.js"), later, later);
    const r = await s.get("/sw.js", BROWSER);
    expect([r.status, r.headers["content-encoding"], r.body.toString(), r.headers["cache-control"]]).toEqual([200, undefined, NEW, "no-cache"]);
  });

  it("a copy with no file beside it is not served, and a missing build file is still 'not found', never the page", async () => {
    const b = build(); const s = await serve(b.dir);
    fs.rmSync(path.join(b.dir, "assets/index-AAA.js"));
    const r = await s.get("/assets/index-AAA.js", BROWSER);
    expect([r.status, r.headers["content-encoding"], r.body.toString()]).toEqual([404, undefined, "Not found"]);
    const never = await s.get("/assets/never-was.js", BROWSER);
    expect([never.status, never.headers["content-type"]]).toEqual([404, "text/plain; charset=utf-8"]);
  });

  it("the copies cannot be reached around: no path outside the build, no copy of anything hidden, no trick addresses", async () => {
    const b = build(); const s = await serve(b.dir);
    fs.writeFileSync(path.join(b.dir, "..", "outside-secret.js"), "x".repeat(5000));
    dirs.push(path.join(b.dir, "..", "outside-secret.js"));
    fs.mkdirSync(path.join(b.dir, ".hidden")); b.put(".hidden/keys.json", JSON.stringify({ k: "v".repeat(3000) }));
    precompressDir(b.dir);
    for (const p of ["/assets/..%2f..%2foutside-secret.js", "/%2e%2e/outside-secret.js", "/assets/%2e%2e/%2e%2e/outside-secret.js", "/.hidden/keys.json", "/assets/index-AAA.js%00.css", "/assets/%E0%A4%A.js"]) {
      const r = await s.get(p, BROWSER);
      expect([p, r.headers["content-encoding"]]).toEqual([p, undefined]);
      expect(r.body.toString()).not.toContain("xxxxx");
    }
  });

  it("asking for a copy by its own name gives the file as it is, with nothing pretending it is a script", async () => {
    const b = build(); const s = await serve(b.dir);
    const r = await s.get("/assets/index-AAA.js.br", BROWSER);
    expect(r.headers["content-encoding"]).toBeUndefined();
    expect(String(r.headers["content-type"])).not.toMatch(/javascript|html/);
  });
});
