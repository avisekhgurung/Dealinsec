/** The outside-data adapters against fake HTTP: what they send, what they read, how they fail, and what they refuse. */
import { describe, expect, it } from "vitest";
import { TavilyProvider } from "../discovery/tavily";
import { SerperProvider } from "../discovery/serper";
import { DiscoveryError } from "../discovery/types";
import { outboundSearchProviders } from "../discovery/provider";
import { ApolloCompanyProvider, FirecrawlReader, HunterContactProvider, costMicroUsd } from "./providers";

type Seen = { url: string; init: RequestInit };
const fakeFetch = (status: number, body: unknown, seen: Seen[] = []): typeof fetch =>
  (async (url: any, init: any) => { seen.push({ url: String(url), init }); return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); }) as typeof fetch;

describe("Tavily", () => {
  it("sends the key as a bearer header, reads title/url/content, skips malformed rows", async () => {
    const seen: Seen[] = [];
    const p = new TavilyProvider("tv-secret", "https://tavily.test/search", fakeFetch(200, { results: [{ title: "Northwind", url: "https://northwind.com", content: "agency" }, { title: 5 }, { url: "https://x.com" }] }, seen));
    expect(await p.search("seo agency", { count: 50 })).toEqual([{ title: "Northwind", url: "https://northwind.com", snippet: "agency" }]);
    expect((seen[0].init.headers as Record<string, string>).Authorization).toBe("Bearer tv-secret");
    expect(JSON.parse(String(seen[0].init.body))).toMatchObject({ query: "seo agency", max_results: 20 });
  });
  it("maps failures to codes without echoing the key", async () => {
    for (const [status, code] of [[401, "auth"], [429, "rate_limited"], [500, "unavailable"]] as const) {
      const e = await new TavilyProvider("tv-secret", "https://t.test", fakeFetch(status, "x")).search("q").catch((x) => x);
      expect(e).toBeInstanceOf(DiscoveryError);
      expect(e.code).toBe(code);
      expect(String(e.message)).not.toContain("tv-secret");
    }
    expect((await new TavilyProvider("k", "https://t.test", fakeFetch(200, "not json")).search("q").catch((x) => x)).code).toBe("bad_response");
  });
});

describe("Serper", () => {
  it("sends the key as X-API-KEY, the country as gl, and reads organic results", async () => {
    const seen: Seen[] = [];
    const p = new SerperProvider("sp-secret", "https://serper.test", fakeFetch(200, { organic: [{ title: "Acme", link: "https://acme.io", snippet: "growth" }] }, seen));
    expect(await p.search("growth agency", { country: "us" })).toEqual([{ title: "Acme", url: "https://acme.io", snippet: "growth" }]);
    expect((seen[0].init.headers as Record<string, string>)["X-API-KEY"]).toBe("sp-secret");
    expect(JSON.parse(String(seen[0].init.body))).toMatchObject({ q: "growth agency", gl: "us" });
  });
  it("an answer without results is an empty list, not an error", async () => {
    expect(await new SerperProvider("k", "https://s.test", fakeFetch(200, {})).search("q")).toEqual([]);
  });
});

describe("choosing search providers", () => {
  it("uses the configured discovery provider by default, several when asked, and nothing without keys", async () => {
    expect((await outboundSearchProviders({ LANGSEARCH_API_KEY: "a" } as any)).map((p) => p.name)).toEqual(["langsearch"]);
    expect((await outboundSearchProviders({ LANGSEARCH_API_KEY: "a", TAVILY_API_KEY: "b", OUTBOUND_SEARCH_PROVIDERS: "tavily,langsearch,serper" } as any)).map((p) => p.name)).toEqual(["tavily", "langsearch"]);
    expect(await outboundSearchProviders({} as any)).toEqual([]);
    expect((await outboundSearchProviders({ SERPER_API_KEY: "s" } as any)).map((p) => p.name)).toEqual(["serper"]);
  });
});

describe("Apollo company enrichment", () => {
  it("reads structured firmographics only", async () => {
    const seen: Seen[] = [];
    const p = new ApolloCompanyProvider("ap-secret", "https://apollo.test/enrich", fakeFetch(200, { organization: { name: "Northwind", estimated_num_employees: 18, country: "US", city: "Austin", state: "Texas", industry: "marketing & advertising", keywords: ["seo", "ppc", 7] } }, seen));
    expect(await p.enrich("northwind.com")).toEqual({ name: "Northwind", employees: "18 employees", country: "US", location: "Austin, Texas", industry: "marketing & advertising", keywords: ["seo", "ppc"], sourceUrl: "https://www.apollo.io" });
    expect(seen[0].url).toBe("https://apollo.test/enrich?domain=northwind.com");
    expect((seen[0].init.headers as Record<string, string>)["X-Api-Key"]).toBe("ap-secret");
  });
  it("unknown company is null; an unknown headcount is left out, never guessed", async () => {
    expect(await new ApolloCompanyProvider("k", "https://a.test", fakeFetch(404, {})).enrich("x.com")).toBeNull();
    expect((await new ApolloCompanyProvider("k", "https://a.test", fakeFetch(200, { organization: { name: "X", estimated_num_employees: 0 } })).enrich("x.com"))!.employees).toBeUndefined();
  });
});

describe("Hunter contacts", () => {
  const body = { data: { emails: [
    { value: "Ben@Northwind.com", first_name: "Ben", last_name: "Okafor", position: "Head of Growth", confidence: 96, verification: { status: "valid" } },
    { value: "cara@northwind.com", first_name: "Cara", last_name: "Diaz", position: "Marketing Manager", confidence: 40, verification: { status: "accept_all" } },
    { value: "dan@gmail.com", first_name: "Dan", last_name: "Ng", position: "Founder", confidence: 90, verification: { status: "valid" } },
    { value: "info@northwind.com", first_name: null, last_name: null, position: null },
    { value: "eve@sub.northwind.com", first_name: "Eve", last_name: "Lo", position: "CEO", confidence: 70 },
  ] } };
  it("keeps named people with a role on the company's own domain, with Hunter's own verification word", async () => {
    const out = await new HunterContactProvider("hu-secret", "https://hunter.test", fakeFetch(200, body)).findPeople("northwind.com", { limit: 10 });
    expect(out).toEqual([
      { name: "Ben Okafor", title: "Head of Growth", email: "ben@northwind.com", emailStatus: "verified", confidence: 96, source: "hunter" },
      { name: "Cara Diaz", title: "Marketing Manager", email: "cara@northwind.com", emailStatus: "accept_all", confidence: 40, source: "hunter" },
      { name: "Eve Lo", title: "CEO", email: "eve@sub.northwind.com", emailStatus: "unknown", confidence: 70, source: "hunter" },
    ]);
  });
  it("an address off the company's domain is dropped, and 'verified' is only ever Hunter's 'valid'", async () => {
    const out = await new HunterContactProvider("k", "https://h.test", fakeFetch(200, body)).findPeople("northwind.com", { limit: 10 });
    expect(out.some((c) => c.email?.endsWith("gmail.com"))).toBe(false);
    expect(out.filter((c) => c.emailStatus === "verified").map((c) => c.name)).toEqual(["Ben Okafor"]);
  });
});

describe("Firecrawl reader", () => {
  it("never sends a private or non-https address to the service", async () => {
    const seen: Seen[] = [];
    const r = new FirecrawlReader("fc", "https://fc.test", fakeFetch(200, {}, seen));
    for (const u of ["http://northwind.com", "https://127.0.0.1/", "https://localhost/", "https://intranet.corp/"]) expect(await r.read(u)).toEqual({ ok: false, code: "blocked" });
    expect(seen).toHaveLength(0);
  });
  it("turns markdown into plain text and keeps the provider's link list", async () => {
    const r = new FirecrawlReader("fc", "https://fc.test", fakeFetch(200, { data: { markdown: "# Northwind\n\n![logo](x.png) We are a [digital marketing](https://northwind.com/s) agency.", links: ["https://northwind.com/careers"], metadata: { title: "Northwind", sourceURL: "https://northwind.com/" } } }));
    const p = await r.read("https://northwind.com/");
    expect(p).toMatchObject({ ok: true, url: "https://northwind.com/", title: "Northwind", text: "Northwind We are a digital marketing agency.", links: [{ href: "https://northwind.com/careers", text: "" }] });
  });
});

describe("cost estimates", () => {
  it("defaults per provider, overridable, never negative", () => {
    expect(costMicroUsd("brave", {} as any)).toBe(5000);
    expect(costMicroUsd("langsearch", {} as any)).toBe(0);
    expect(costMicroUsd("brave", { PROVIDER_COST_USD_BRAVE: "0.01" } as any)).toBe(10000);
    expect(costMicroUsd("brave", { PROVIDER_COST_USD_BRAVE: "-1" } as any)).toBe(5000);
    expect(costMicroUsd("unknown", {} as any)).toBe(0);
  });
});
