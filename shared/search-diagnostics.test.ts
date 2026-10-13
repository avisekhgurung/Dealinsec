import { describe, expect, it } from "vitest";
import { collectCandidates, rankCandidates, runBudget, type SearchHit } from "./prospect";
import { queryRecord, rankRecord, safeDomain, summarizeQueries } from "./search-diagnostics";
import type { Icp } from "./icp";

const icp: Icp = { industry: "digital marketing agency", keywords: ["SEO agency"], countries: ["US"], locations: [], employeeMin: 5, employeeMax: 30, targetMarket: ["SaaS companies"], roles: ["Founder"], exclusions: [], quantity: 3 } as any;
const hit = (url: string, title: string, snippet = "", query = "SaaS marketing agency United States"): SearchHit => ({ url, title, snippet, provider: "tavily", query, at: "2026-10-12T00:00:00.000Z" });

/** Runs results through the real filters and ranking, the way a run does, and returns the diagnostic records. */
function trace(perQuery: SearchHit[][], verify = runBudget(icp.quantity).verify) {
  const plan = perQuery.map((h, i) => ({ q: h[0]?.query ?? `query ${i}` }));
  const records = [], merged = new Map<string, any>();
  perQuery.forEach((hits, i) => {
    const { candidates, decisions } = collectCandidates(hits, icp);
    records.push(queryRecord(i, plan[i].q, "tavily", hits, decisions));
    for (const c of candidates) { const prev = merged.get(c.domain); if (prev) prev.sources.push(...c.sources); else merged.set(c.domain, { ...c, sources: [...c.sources] }); }
  });
  const ranked = rankCandidates(Array.from(merged.values()).map((candidate, order) => ({ candidate, order, isLead: false })), icp, verify);
  return { records, rank: rankRecord(ranked.map((r) => ({ domain: r.candidate.domain, sources: r.candidate.sources, score: r.score, rel: r.rel, outcome: r.outcome })), plan) };
}
const decisionOf = (r: ReturnType<typeof trace>, domain: string) => r.records.flatMap((q) => q.results).filter((x) => x.domain === domain).map((x) => x.decision);
const outcomeOf = (r: ReturnType<typeof trace>, domain: string) => r.rank.candidates.find((c) => c.domain === domain);

describe("search diagnostics: where results are thrown away", () => {
  it("directory-heavy results: listings, directories and platforms are recorded with their reason; the agency among them is a candidate", () => {
    const r = trace([[
      hit("https://clutch.co/agencies/saas", "Clutch: SaaS marketing agencies", "directory"),
      hit("https://www.linkedin.com/company/northwind", "Northwind Digital | LinkedIn"),
      hit("https://bestlists.com/top-saas-agencies", "Top 10 SaaS marketing agencies in 2026", "a list"),
      hit("https://agencyfinder.com/directory/seo", "SEO agencies near you", "directory of agencies"),
      hit("https://northwind.com/", "Northwind Digital | SaaS marketing agency", "Digital marketing agency for SaaS companies in the United States"),
    ]]);
    expect(r.records[0].results.map((x) => x.decision)).toEqual(["blocked_site", "blocked_site", "listing_page", "listing_page", "candidate"]);
    expect(summarizeQueries(r.records).byDecision).toEqual({ blocked_site: 2, listing_page: 2, candidate: 1 });
    expect(r.records[0].results.filter((x) => x.decision === "listing_page").map((x) => x.rule)).toEqual(["title", "path"]); // which rule, never the text
    expect(outcomeOf(r, "northwind.com")).toMatchObject({ outcome: "keep", checkOrder: 1, queries: ["q1"] });
  });
  it("irrelevant domains: a result that says too little about the ICP is found but set aside as off topic before any fetch", () => {
    const r = trace([[hit("https://ipinfo.io/", "103.207.43.0", "IP address lookup"), hit("https://northwind.com/", "Northwind Digital | SaaS marketing agency", "Digital marketing agency for SaaS companies")]]);
    expect(decisionOf(r, "ipinfo.io")).toEqual(["candidate"]);
    expect(outcomeOf(r, "ipinfo.io")).toMatchObject({ outcome: "off_topic", checkOrder: null });
    expect(r.rank.summary).toEqual({ candidates: 2, keep: 1, off_topic: 1 });
  });
  it("duplicates: the same page twice is a duplicate, another page of the same company is merged; the company is one candidate found by both queries", () => {
    const q2 = "B2B SaaS SEO agency";
    const r = trace([
      [hit("https://northwind.com/", "Northwind Digital", "SaaS marketing agency in the United States"), hit("https://www.northwind.com/?utm_source=x", "Northwind Digital", "SaaS marketing agency"), hit("https://northwind.com/services/ppc", "PPC for SaaS | Northwind", "digital marketing agency")],
      [hit("https://northwind.com/services/seo", "SEO for SaaS | Northwind", "SEO agency for SaaS companies", q2)],
    ]);
    expect(r.records[0].results.map((x) => [x.decision, x.page])).toEqual([["candidate", "home"], ["duplicate", "home"], ["merged", "inner"]]);
    expect(r.rank.candidates).toHaveLength(1);
    expect(outcomeOf(r, "northwind.com")).toMatchObject({ queries: ["q1", "q2"], outcome: "keep" });
  });
  it("target agencies: kept in score order up to the run's check budget; the rest are recorded as budget, with their score", () => {
    const agencies = ["acme", "brightpath", "cedar", "dunmore"].map((n, i) => hit(`https://${n}agency.com/`, `${n} | SaaS marketing agency`, i === 0 ? "Digital marketing agency for SaaS companies in the United States, SEO agency" : "digital marketing agency for SaaS companies"));
    const r = trace([agencies], 2);
    expect(r.rank.candidates.map((c) => [c.domain, c.outcome, c.checkOrder])).toEqual([["acmeagency.com", "keep", 1], ["brightpathagency.com", "keep", 2], ["cedaragency.com", "budget", null], ["dunmoreagency.com", "budget", null]]);
    expect(r.rank.candidates[0].score).toBeGreaterThan(r.rank.candidates[2].score);
  });
  it("redaction: no title, snippet, path, query string, query text, email, phone number, key or personal host is ever recorded", () => {
    process.env.TAVILY_API_KEY = "tvly-SECRET-KEY-123";
    try {
      const q = "agencies like my client Jane Roe at jane.roe@example.com";
      const hits = [
        hit("https://northwind.com/team/jane-roe?email=jane.roe%40example.com&token=sk-live-abc", "Jane Roe, CEO | call +1 512 555 0142", "Email jane.roe@example.com or call (512) 555-0142", q),
        hit("https://janeroe.github.io/portfolio", "Jane Roe portfolio", "personal site", q),
        hit("mailto:jane.roe@example.com", "Email Jane", "", q),
        hit("https://jane.roe@evil.example.com/", "x", "", q),
      ];
      const { decisions } = collectCandidates(hits, icp);
      const rec = queryRecord(0, q, "tavily", hits, decisions);
      const out = JSON.stringify(rec);
      for (const bad of ["@", "Jane", "jane", "Roe", "555", "0142", "token", "sk-live", "tvly", "SECRET", "/team", "portfolio", "client", "email", "call"]) expect(out).not.toContain(bad);
      expect(rec.query).toBe("q1");
      expect(rec.results.map((x) => x.domain)).toEqual(["northwind.com", "github.io", null, null]); // a free host is its platform, never the personal subdomain
      expect(safeDomain("https://Northwind.COM/x", "candidate")).toBe("northwind.com");
    } finally { delete process.env.TAVILY_API_KEY; }
  });
  it("a failed query is recorded by its code only", () => {
    const rec = queryRecord(2, "SaaS agency", "tavily", [], [], "rate_limited: provider said <html>Too many requests from 1.2.3.4</html>");
    expect(rec).toMatchObject({ query: "q3", ok: false, results: [] });
    expect(rec.error).toBe("rate_limited");
    expect(JSON.stringify(rec)).not.toMatch(/html|1\.2\.3\.4/);
  });
});
