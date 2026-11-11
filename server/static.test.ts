/**
 * Serving the built app. What this guards is a deploy: a new build is uploaded while the old server is still running,
 * and the page it hands out must always belong to the same build as the script files on disk. A real Express app on a
 * real port, over a build folder made in a temp directory. No database, no network beyond localhost.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { freshFromFile, serveStatic } from "./static";

const dirs: string[] = [];
const servers: { close: () => void }[] = [];
afterEach(() => { servers.splice(0).forEach((s) => s.close()); dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })); });

const page = (script: string) => `<!doctype html><html><head><title>DealInSec</title></head><body><div id="root"></div><script type="module" src="/assets/${script}"></script></body></html>`;
/** A build folder holding one page and its one script, as a build leaves them. */
function build(script = "index-OLD.js") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dis-static-")); dirs.push(dir);
  fs.mkdirSync(path.join(dir, "assets"));
  fs.writeFileSync(path.join(dir, "assets", script), "console.log('old')");
  fs.writeFileSync(path.join(dir, "index.html"), page(script));
  return dir;
}
/** What a deploy does to the folder: the new script arrives, then the new page, written whole and moved into place. */
function upload(dir: string, script: string, opts: { removeOld?: string } = {}) {
  fs.writeFileSync(path.join(dir, "assets", script), "console.log('new')");
  if (opts.removeOld) fs.rmSync(path.join(dir, "assets", opts.removeOld));
  const tmp = path.join(dir, ".index.html.tmp");
  fs.writeFileSync(tmp, page(script));
  fs.renameSync(tmp, path.join(dir, "index.html"));
  // A new build always carries a new time; make sure this one differs even on a coarse clock.
  const later = new Date(Date.now() + 5_000);
  fs.utimesSync(path.join(dir, "index.html"), later, later);
}
async function serve(dir: string) {
  const app = express();
  serveStatic(app, dir);
  const server = app.listen(0); servers.push(server);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = async (p: string) => { const r = await fetch(base + p); return { status: r.status, type: r.headers.get("content-type") ?? "", robots: r.headers.get("x-robots-tag"), cache: r.headers.get("cache-control"), text: await r.text() }; };
  /** The script the page at `p` asks for, and what the server answers for it. */
  const scriptOf = async (p: string) => { const src = (await get(p)).text.match(/src="(\/assets\/[^"]+)"/)?.[1] ?? ""; return { src, ...(await get(src)) }; };
  return { get, scriptOf };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("the page and its scripts always belong to the same build", () => {
  it("serves the page for app routes and the built files as files", async () => {
    const s = await serve(build());
    for (const p of ["/", "/dashboard", "/outbound?view=inbox", "/leads/12"]) {
      const r = await s.get(p);
      expect([p, r.status, r.type.includes("text/html")]).toEqual([p, 200, true]);
      expect(r.cache).toBe("no-cache");
    }
    expect(await s.scriptOf("/dashboard")).toMatchObject({ src: "/assets/index-OLD.js", status: 200, text: "console.log('old')" });
    expect((await s.scriptOf("/dashboard")).type).toMatch(/javascript/);
  });

  it("after a new build is uploaded, WITHOUT a restart, the page names the new script, and that script is there", async () => {
    const dir = build();
    const s = await serve(dir);
    expect((await s.scriptOf("/auth")).src).toBe("/assets/index-OLD.js");
    // The upload removes the old script, as "rsync --delete" does. This is what blanked the site on 10 Nov 2026.
    upload(dir, "index-NEW.js", { removeOld: "index-OLD.js" });
    await wait(1100); // the server looks at the page at most once a second
    for (const p of ["/", "/auth", "/dashboard", "/pricing"]) {
      const r = await s.scriptOf(p);
      expect([p, r.src, r.status, /javascript/.test(r.type)]).toEqual([p, "/assets/index-NEW.js", 200, true]);
    }
  });

  it("a build file that isn't there is 404, never the page with a 200", async () => {
    const s = await serve(build());
    for (const p of ["/assets/index-GONE.js", "/assets/chunk-GONE.css", "/assets/"]) {
      const r = await s.get(p);
      expect([p, r.status]).toEqual([p, 404]);
      expect(r.type).not.toMatch(/html/);
      expect(r.text).not.toContain("<div id=\"root\">");
    }
    // Only build files: any other unknown address is still the app (it has its own "not found" screen).
    expect((await s.get("/some/unknown/page")).status).toBe(200);
  });

  it("app routes are kept out of search; the home page is not", async () => {
    const s = await serve(build());
    expect((await s.get("/dashboard")).robots).toBe("noindex, nofollow");
    expect((await s.get("/")).robots).toBeNull();
  });
});

describe("freshFromFile: rebuilt when the file changes, and never worse than the last good copy", () => {
  const file = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dis-fresh-")); dirs.push(dir); const f = path.join(dir, "page.html"); fs.writeFileSync(f, "one"); return f; };
  const touch = (f: string, text: string, at: number) => { fs.writeFileSync(f, text); const d = new Date(at); fs.utimesSync(f, d, d); };

  it("builds once at boot, and again only after the file has changed", () => {
    const f = file(); let clock = 0, builds = 0;
    const get = freshFromFile(f, (t) => { builds++; return t.toUpperCase(); }, { everyMs: 1000, now: () => clock });
    expect([get(), builds]).toEqual(["ONE", 1]);
    clock = 5000; expect([get(), builds]).toEqual(["ONE", 1]); // looked, unchanged: nothing rebuilt
    touch(f, "two", Date.now() + 10_000);
    clock = 5500; expect(get()).toBe("ONE");                   // within the same second: not looked at yet
    clock = 6100; expect([get(), builds]).toEqual(["TWO", 2]);
    clock = 9000; expect([get(), builds]).toEqual(["TWO", 2]);
  });
  it("looks at the file at most once per interval, however many requests arrive", () => {
    const f = file(); let clock = 0, builds = 0;
    const get = freshFromFile(f, (t) => { builds++; return t; }, { everyMs: 1000, now: () => clock });
    touch(f, "two", Date.now() + 10_000);
    for (let i = 0; i < 500; i++) { clock = 100 + i; get(); } // 500 requests inside one second
    expect(builds).toBe(1);
    clock = 2000; get();
    expect(builds).toBe(2);
  });
  it("a file that is gone, empty, or that the builder chokes on leaves the last good copy in place, and recovers later", () => {
    const f = file(); let clock = 0;
    const get = freshFromFile(f, (t) => { if (t === "broken") throw new Error("bad page"); return t; }, { everyMs: 1000, now: () => clock });
    fs.rmSync(f); clock = 2000; expect(get()).toBe("one");
    touch(f, "", Date.now() + 10_000); clock = 4000; expect(get()).toBe("one");
    touch(f, "broken", Date.now() + 20_000); clock = 6000; expect(get()).toBe("one");
    touch(f, "three", Date.now() + 30_000); clock = 8000; expect(get()).toBe("three");
  });
  it("a missing page at boot is still fatal: the server must not start without one", () => {
    expect(() => freshFromFile(path.join(os.tmpdir(), "dis-no-such-page.html"), (t) => t)).toThrow();
  });
});
