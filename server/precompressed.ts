/**
 * Built files, sent small.
 *
 * Why: the first visit downloads the app's script and style files. The old host's network squeezed them on the way
 * out; the server we moved to on 10 Nov 2026 only does that for pages, so the same files went out at full size
 * (about 770 KB for the first screen instead of about 180 KB). Rather than depend on a server setting again, the build
 * writes a squeezed copy beside each text file (`app.js.br`, `app.js.gz`) and the app hands out that copy to any
 * browser that says it can read it. It travels inside the build, so one deploy command is still all it takes, and
 * nothing is squeezed while a visitor waits.
 *
 * Only text the browser can use squeezed: scripts, styles, SVG, JSON and the like. Images, fonts and office files are
 * already squeezed. Pages are not touched here: they are made per request, and the web server squeezes those.
 */
import fs from "fs";
import path from "path";
import zlib from "zlib";
import type { NextFunction, Request, Response } from "express";

/** File endings worth a squeezed copy. */
export const COMPRESSIBLE = new Set([".js", ".mjs", ".css", ".svg", ".json", ".webmanifest", ".txt", ".xml", ".map"]);
/** Below this a copy saves nothing worth a second file. */
export const MIN_BYTES = 1024;
/** The encodings we keep, best first, and the ending each copy carries. */
export const VARIANTS = [{ encoding: "br", ending: ".br" }, { encoding: "gzip", ending: ".gz" }] as const;

/** What the browser said it can read (the Accept-Encoding header), leaving out anything it refused with q=0. */
export function acceptedEncodings(header: unknown): Set<string> {
  const out = new Set<string>();
  if (typeof header !== "string") return out;
  for (const part of header.split(",")) {
    const [name, ...params] = part.trim().toLowerCase().split(";");
    if (!name) continue;
    const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    if (q !== undefined && !(Number(q.slice(2)) > 0)) continue;
    out.add(name.trim());
  }
  return out;
}

/* ── at build time ──────────────────────────────────────────────────────── */

export interface PrecompressReport { files: number; rawBytes: number; brBytes: number; gzBytes: number }

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

/**
 * Write the squeezed copies for every text file under `dir`. A copy is kept only when it is really smaller. Copies
 * from an earlier pass are replaced, and the copies themselves are never squeezed again.
 */
export function precompressDir(dir: string): PrecompressReport {
  const report: PrecompressReport = { files: 0, rawBytes: 0, brBytes: 0, gzBytes: 0 };
  for (const file of walk(dir)) {
    if (!COMPRESSIBLE.has(path.extname(file).toLowerCase())) continue;
    const raw = fs.readFileSync(file);
    for (const v of VARIANTS) fs.rmSync(file + v.ending, { force: true });
    if (raw.length < MIN_BYTES) continue;
    const br = zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length } });
    const gz = zlib.gzipSync(raw, { level: 9 });
    const keepBr = br.length < raw.length * 0.95, keepGz = gz.length < raw.length * 0.95;
    if (keepBr) fs.writeFileSync(file + ".br", br);
    if (keepGz) fs.writeFileSync(file + ".gz", gz);
    if (keepBr || keepGz) { report.files += 1; report.rawBytes += raw.length; report.brBytes += keepBr ? br.length : raw.length; report.gzBytes += keepGz ? gz.length : raw.length; }
  }
  return report;
}

/* ── at request time ────────────────────────────────────────────────────── */

const statOf = (p: string): Promise<fs.Stats | null> => fs.promises.stat(p).then((s) => (s.isFile() ? s : null), () => null);

/**
 * Hand out the squeezed copy of a built file when there is one and the browser can read it; otherwise step aside and
 * let the ordinary file handler answer exactly as before.
 *
 * A copy is used only when the file it was made from is there too and the copy is not older than it. A deploy keeps
 * old files on the server, so a copy left behind by an earlier build must never be served in place of a newer file
 * with the same name (the service worker, the manifest).
 *
 * `cacheHeaders` is the same rule the ordinary handler uses, so a file is cached the same way either way it is sent.
 */
export function precompressed(distPath: string, cacheHeaders: (res: Response, filePath: string) => void) {
  const root = path.resolve(distPath) + path.sep;
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    let rel: string;
    try { rel = decodeURIComponent(req.path); } catch { return next(); }
    const ext = path.extname(rel).toLowerCase();
    if (!COMPRESSIBLE.has(ext) || rel.includes("\0")) return next();
    // No dot-files or dot-folders, as the ordinary handler: nothing hidden is ever served.
    if (rel.split("/").some((seg) => seg.startsWith("."))) return next();
    const file = path.resolve(root, "." + path.posix.normalize("/" + rel));
    if (!file.startsWith(root)) return next();
    // The answer for this address depends on what the browser can read, whichever copy goes out.
    res.vary("Accept-Encoding");
    const accepts = acceptedEncodings(req.headers["accept-encoding"]);
    const wanted = VARIANTS.filter((v) => accepts.has(v.encoding));
    if (!wanted.length || req.headers.range) return next(); // a part of a file is cut from the plain one
    const original = await statOf(file);
    if (!original) return next();
    for (const v of wanted) {
      const copy = await statOf(file + v.ending);
      if (!copy || copy.mtimeMs < original.mtimeMs) continue;
      res.type(ext);
      res.setHeader("Content-Encoding", v.encoding);
      cacheHeaders(res, file);
      return res.sendFile(file + v.ending, (err) => {
        if (!err || res.headersSent) return;
        // It went missing between the look and the send: answer with the plain file instead.
        res.removeHeader("Content-Encoding"); res.removeHeader("Content-Type"); res.removeHeader("Cache-Control");
        next();
      });
    }
    return next();
  };
}
