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

describe("what a home page's markup shows (siteMarkup + siteSignals): observations, never a judgement", async () => {
  const { siteMarkup, readHtml } = await import("./providers");
  const { siteSignals, OLD_COPYRIGHT_YEARS } = await import("@shared/site-signals");
  const NOW = new Date("2026-10-18T00:00:00Z");
  it("reads the viewport tag and the LATEST copyright year, in its usual spellings", () => {
    expect(siteMarkup('<head><meta name="viewport" content="width=device-width"></head><footer>© 2015–2019 Acme</footer>', NOW)).toMatchObject({ viewport: true, copyrightYear: 2019, copyrightText: "© 2015–2019" });
    expect(siteMarkup("<footer>Copyright &copy; 2021 Acme. Copyright 2024</footer>", NOW)).toMatchObject({ viewport: false, copyrightYear: 2024 });
    expect(siteMarkup("<footer>&#169; 2018 Acme</footer>", NOW).copyrightYear).toBe(2018);
    expect(siteMarkup("<p>Founded in 2009. Call 2019 2020.</p>", NOW).copyrightYear).toBeNull(); // a year that isn't in a copyright notice isn't one
    expect(siteMarkup("<footer>© 2099 Acme</footer>", NOW).copyrightYear).toBeNull();            // a future year is not trusted
  });
  it("says only what was observed: no viewport tag; a copyright year at least OLD_COPYRIGHT_YEARS old; nothing for a current site", () => {
    expect(siteSignals({ viewport: true, copyrightYear: 2026 }, NOW)).toEqual([]);
    expect(siteSignals({ viewport: true, copyrightYear: 2026 - OLD_COPYRIGHT_YEARS + 1 }, NOW)).toEqual([]);
    expect(siteSignals({ viewport: false, copyrightYear: 2019, copyrightText: "© 2019" }, NOW)).toEqual([
      { signal: "no_viewport", value: "The home page has no mobile viewport tag" },
      { signal: "old_copyright", value: "The home page's copyright notice reads 2019", year: 2019, quote: "© 2019" },
    ]);
    expect(siteSignals(undefined, NOW)).toEqual([]); // a paid reader's markdown has no markup: nothing is claimed
    for (const s of siteSignals({ viewport: false, copyrightYear: 2010 }, NOW)) expect(s.value).not.toMatch(/needs?|outdated|bad|broken|should/i);
  });
  it("the built-in reader attaches what it saw", async () => {
    const r = await readHtml(new TextEncoder().encode('<html><head><title>Acme</title></head><body><main><h1>Acme</h1><p>Acme builds things for people. '.repeat(10) + '</p></main><footer>© 2020 Acme</footer></body></html>'), new URL("https://acme.com/"), NOW);
    expect(r.ok && r.site).toMatchObject({ viewport: false, copyrightYear: 2020 });
  });
});

describe("the paid page reader is a fallback only (FallbackReader)", async () => {
  const { FallbackReader, MAX_PAID_READS_PER_DOMAIN } = await import("./providers");
  const okPage = (url: string) => ({ ok: true as const, url, title: "t", text: "x", links: [], hash: "h" });
  const reader = (code: "unreachable" | "blocked" | "not_html" | "bad_response" | null) => {
    const paid: string[] = [];
    const r = new FallbackReader(
      { name: "builtin", read: async (u) => (code ? { ok: false, code } : okPage(u)) },
      { name: "firecrawl", read: async (u) => { paid.push(u); return okPage(u); } },
      () => 1_000,
    );
    return { r, paid };
  };
  it("the free reader's success never reaches the paid one", async () => {
    const t = reader(null);
    expect(await t.r.read("https://a.com/")).toMatchObject({ ok: true });
    expect(t.paid).toEqual([]);
  });
  it("a page the free reader couldn't read is tried once with the paid one, and says so (for its cost)", async () => {
    const t = reader("unreachable");
    expect(await t.r.read("https://a.com/")).toMatchObject({ ok: true, via: "firecrawl" });
    expect(t.paid).toEqual(["https://a.com/"]);
  });
  it("never for an address the safety guard refused, or a file that isn't a page", async () => {
    for (const code of ["blocked", "not_html"] as const) {
      const t = reader(code);
      expect(await t.r.read("https://a.com/")).toEqual({ ok: false, code });
      expect(t.paid).toEqual([]);
    }
  });
  it(`at most ${MAX_PAID_READS_PER_DOMAIN} paid reads per site in a day; other sites have their own`, async () => {
    const t = reader("bad_response");
    for (let i = 0; i < 5; i++) await t.r.read(`https://www.a.com/p${i}`);
    await t.r.read("https://b.com/");
    expect(t.paid.filter((u) => u.includes("a.com"))).toHaveLength(MAX_PAID_READS_PER_DOMAIN);
    expect(t.paid.filter((u) => u.includes("b.com"))).toHaveLength(1);
  });
  it("pageReader: no Firecrawl key, no paid reader at all", async () => {
    const { pageReader } = await import("./providers");
    expect(pageReader({}).name).toBe("builtin");
    expect(pageReader({ FIRECRAWL_API_KEY: "k" }).name).toBe("builtin+firecrawl");
  });
});

describe("robots.txt is asked first (RobotsReader)", async () => {
  const { RobotsReader } = await import("./providers");
  it("a disallowed page reaches no reader (free or paid); robots.txt is fetched once per site; none means allowed", async () => {
    const reads: string[] = [], fetched: string[] = [];
    const inner = { name: "builtin+firecrawl", read: async (u: string) => { reads.push(u); return { ok: true as const, url: u, title: "", text: "", links: [], hash: "h" }; } };
    const r = new RobotsReader(inner, async (origin) => { fetched.push(origin); return origin.includes("closed.com") ? "User-agent: *\nDisallow: /team" : null; }, () => 0);
    expect(await r.read("https://closed.com/team")).toEqual({ ok: false, code: "robots" });
    expect(await r.read("https://closed.com/")).toMatchObject({ ok: true });
    expect(await r.read("https://open.com/team")).toMatchObject({ ok: true });
    expect(reads).toEqual(["https://closed.com/", "https://open.com/team"]);
    expect(fetched).toEqual(["https://closed.com", "https://open.com"]);
    expect(r.name).toBe("builtin+firecrawl");
  });
});
