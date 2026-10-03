import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { LangSearchProvider } from "./langsearch";
import { DiscoveryError } from "./types";

const KEY = "ls-secret-key-456";
let server: http.Server | null = null;
afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

type Seen = { method?: string; url?: string; headers: http.IncomingHttpHeaders; body: string };
/** A real HTTP server on a random port, so the actual request on the wire is what is checked. */
async function serve(reply: (seen: Seen) => { status?: number; body: unknown; raw?: boolean }) {
  const seen: Seen[] = [];
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const s = { method: req.method, url: req.url, headers: req.headers, body };
      seen.push(s);
      const r = reply(s);
      res.writeHead(r.status ?? 200, { "content-type": "application/json" });
      res.end(r.raw ? String(r.body) : JSON.stringify(r.body));
    });
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server!.address() as AddressInfo).port}/v1/web-search`;
  return { seen, provider: new LangSearchProvider(KEY, url) };
}
const ok = (value: unknown) => ({ code: 200, msg: null, data: { webPages: { value } } });

describe("LangSearchProvider", () => {
  it("describes itself: free, no country filter", () => {
    const p = new LangSearchProvider(KEY);
    expect([p.name, p.label, p.paid, p.supportsCountry]).toEqual(["langsearch", "LangSearch", false, false]);
  });

  it("POSTs JSON with the key as a Bearer header, never in the URL or body", async () => {
    const { seen, provider } = await serve(() => ({ body: ok([]) }));
    await provider.search("small logistics companies in Pune", { count: 99, country: "IN" });
    const s = seen[0];
    expect(s.method).toBe("POST");
    expect(s.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(s.headers["content-type"]).toContain("application/json");
    expect(s.url).not.toContain(KEY);
    expect(s.body).not.toContain(KEY);
    expect(JSON.parse(s.body)).toEqual({ query: "small logistics companies in Pune", count: 50, freshness: "noLimit" });
  });

  it("never sends a country (it has no such filter)", async () => {
    const { seen, provider } = await serve(() => ({ body: ok([]) }));
    await provider.search("logistics", { country: "IN" });
    expect(JSON.parse(seen[0].body)).not.toHaveProperty("country");
  });

  it("reads name, url and snippet from data.webPages.value, and skips unusable rows", async () => {
    const { provider } = await serve(() => ({ body: ok([
      { name: "Northwind", url: "https://northwind.com", snippet: "Freight", text: "SECRET FULL TEXT", datePublished: "2026-01-01" },
      { name: "no url" }, { url: "https://x.example" }, null, "junk", { name: "T", url: "https://t.example", snippet: 5 },
    ]) }));
    expect(await provider.search("logistics")).toEqual([
      { title: "Northwind", url: "https://northwind.com", snippet: "Freight" },
      { title: "T", url: "https://t.example", snippet: undefined },
    ]);
  });

  it("also accepts the unwrapped shape, and an empty answer is an empty list", async () => {
    expect(await (await serve(() => ({ body: { webPages: { value: [{ name: "A", url: "https://a.example" }] } } }))).provider.search("x y z")).toHaveLength(1);
    await new Promise<void>((r) => server!.close(() => r())); server = null;
    expect(await (await serve(() => ({ body: { code: 200, data: {} } }))).provider.search("x y z")).toEqual([]);
  });

  it("maps HTTP failures to plain codes; no message contains the key", async () => {
    for (const [status, code] of [[401, "auth"], [403, "auth"], [402, "rate_limited"], [429, "rate_limited"], [500, "unavailable"], [502, "unavailable"]] as const) {
      const { provider } = await serve(() => ({ status, body: { error: `bad ${KEY}` } }));
      const e = await provider.search("logistics").catch((x) => x);
      expect(e, String(status)).toBeInstanceOf(DiscoveryError);
      expect((e as DiscoveryError).code).toBe(code);
      expect((e as DiscoveryError).message).not.toContain(KEY);
      await new Promise<void>((r) => server!.close(() => r())); server = null;
    }
  });

  it("an error wrapped in a 200 body is still an error", async () => {
    const { provider } = await serve(() => ({ body: { code: 429, msg: `slow down ${KEY}`, data: null } }));
    const e = await provider.search("logistics").catch((x) => x);
    expect((e as DiscoveryError).code).toBe("rate_limited");
    expect((e as DiscoveryError).message).not.toContain(KEY);
  });

  it("an unreadable body, an unreachable service and a cancelled search are plain errors", async () => {
    const bad = await (await serve(() => ({ body: "<html>", raw: true }))).provider.search("logistics").catch((x) => x);
    expect((bad as DiscoveryError).code).toBe("bad_response");
    await new Promise<void>((r) => server!.close(() => r())); server = null;
    const down = await new LangSearchProvider(KEY, "http://127.0.0.1:1/v1/web-search").search("logistics").catch((x) => x);
    expect((down as DiscoveryError).code).toBe("unavailable");
    expect((down as DiscoveryError).message).not.toContain(KEY);
    const ctrl = new AbortController();
    const hang = new LangSearchProvider(KEY, "http://x.test/", ((_u: unknown, init?: RequestInit) => new Promise((_r, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("a", "AbortError"))))) as typeof fetch);
    const p = hang.search("logistics", { signal: ctrl.signal }).catch((x) => x);
    ctrl.abort();
    expect(((await p) as DiscoveryError).code).toBe("aborted");
  });

  it("one request per search: no retries", async () => {
    const { seen, provider } = await serve(() => ({ status: 500, body: {} }));
    await provider.search("logistics").catch(() => {});
    expect(seen).toHaveLength(1);
  });
});
