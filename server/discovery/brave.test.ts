import { describe, expect, it } from "vitest";
import { BraveProvider } from "./brave";
import { DiscoveryError } from "./types";

const KEY = "BSA-super-secret-key-123";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
type Call = { url: URL; headers: Record<string, string> };
const fake = (respond: () => Response | Promise<Response>) => {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: new URL(String(input)), headers: init?.headers as Record<string, string> });
    return respond();
  }) as typeof fetch;
  return { calls, provider: new BraveProvider(KEY, "https://brave.test/res/v1/web/search", impl) };
};

describe("BraveProvider", () => {
  it("sends the key in the header (never in the URL) and a tidy, bounded query", async () => {
    const f = fake(() => json({ web: { results: [] } }));
    await f.provider.search("small logistics companies in Pune", { country: "in", count: 50 });
    const c = f.calls[0];
    expect(c.headers["X-Subscription-Token"]).toBe(KEY);
    expect(c.url.toString()).not.toContain(KEY);
    expect(c.url.searchParams.get("q")).toBe("small logistics companies in Pune");
    expect(c.url.searchParams.get("count")).toBe("20");
    expect(c.url.searchParams.get("country")).toBe("IN");
    expect(c.url.searchParams.get("safesearch")).toBe("moderate");
    expect(c.url.searchParams.get("text_decorations")).toBe("false");
  });

  it("ignores a malformed country instead of sending it", async () => {
    const f = fake(() => json({ web: { results: [] } }));
    await f.provider.search("logistics", { country: "India" });
    expect(f.calls[0].url.searchParams.has("country")).toBe(false);
  });

  it("reads title, url and description only; skips rows that aren't usable", async () => {
    const f = fake(() => json({ web: { results: [
      { title: "Northwind", url: "https://northwind.com", description: "Freight", age: "2 days", profile: { name: "x" }, extra_snippets: ["a"] },
      { title: "no url" }, { url: "https://x.example" }, null, "junk", { title: "T", url: "https://t.example", description: 5 },
    ] } }));
    expect(await f.provider.search("logistics")).toEqual([
      { title: "Northwind", url: "https://northwind.com", snippet: "Freight" },
      { title: "T", url: "https://t.example", snippet: undefined },
    ]);
  });

  it("no web results is an empty list, not an error", async () => {
    expect(await fake(() => json({})).provider.search("x y z")).toEqual([]);
    expect(await fake(() => json({ web: {} })).provider.search("x y z")).toEqual([]);
  });

  it("maps failures to plain codes, and no message ever contains the key", async () => {
    const cases: [number, string][] = [[401, "auth"], [403, "auth"], [429, "rate_limited"], [500, "unavailable"], [503, "unavailable"]];
    for (const [status, code] of cases) {
      const e = await fake(() => new Response(`oops ${KEY}`, { status })).provider.search("logistics").catch((x) => x);
      expect(e).toBeInstanceOf(DiscoveryError);
      expect((e as DiscoveryError).code).toBe(code);
      expect((e as DiscoveryError).message).not.toContain(KEY);
    }
  });

  it("an unreadable body and a network failure are plain errors too", async () => {
    const bad = await fake(() => new Response("<html>", { status: 200 })).provider.search("logistics").catch((x) => x);
    expect((bad as DiscoveryError).code).toBe("bad_response");
    const net = new BraveProvider(KEY, "https://brave.test/x", (async () => { throw new TypeError(`fetch failed for ${KEY}`); }) as typeof fetch);
    const e = await net.search("logistics").catch((x) => x);
    expect((e as DiscoveryError).code).toBe("unavailable");
    expect((e as DiscoveryError).message).not.toContain(KEY);
  });

  it("a cancelled search stops and says so", async () => {
    const ctrl = new AbortController();
    const hang = new BraveProvider(KEY, "https://brave.test/x", ((_u: unknown, init?: RequestInit) => new Promise((_res, rej) => {
      init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
    })) as typeof fetch);
    const p = hang.search("logistics", { signal: ctrl.signal }).catch((x) => x);
    ctrl.abort();
    expect(((await p) as DiscoveryError).code).toBe("aborted");
  });

  it("makes exactly one request per search (every request is billed): no retries", async () => {
    const f = fake(() => new Response("", { status: 500 }));
    await f.provider.search("logistics").catch(() => {});
    expect(f.calls).toHaveLength(1);
  });
});
