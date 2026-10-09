import { describe, expect, it } from "vitest";
import { MIN_RELEVANCE, relevance, canonicalUrl, checkSite, collectCandidates, domainOf, findingsAsClaims, freshness, junkReason, parseEvidenceDate, preRank, readiness, runBudget, type FindingLike, type SearchHit } from "./prospect";
import { icpSchema } from "./icp";
import { scoreLead } from "./lead-score";

const NOW = new Date("2026-10-08T12:00:00Z");
const icp = icpSchema.parse({ industry: "digital marketing agency", countries: ["US"], targetMarket: ["SaaS"], keywords: ["growth agency"], quantity: 30 });
const hit = (url: string, title = "Northwind Digital | Marketing for SaaS", snippet = "A digital marketing agency for SaaS companies in the United States", query = "q1"): SearchHit => ({ url, title, snippet, provider: "fake", query, at: NOW.toISOString() });

describe("canonical URLs and domains", () => {
  it("one spelling per page", () => {
    expect(canonicalUrl("HTTP://WWW.Northwind.com/About/?utm_source=x&gclid=1&b=2&a=1#team")).toBe("https://northwind.com/About?a=1&b=2");
    expect(canonicalUrl("https://northwind.com/")).toBe("https://northwind.com");
    expect(canonicalUrl("https://northwind.com//services//")).toBe("https://northwind.com/services");
  });
  it("refuses what is not a web address", () => {
    for (const bad of ["ftp://x.com", "javascript:alert(1)", "https://user:pw@x.com", "not a url", "https://localhost"]) expect(canonicalUrl(bad), bad).toBeNull();
  });
  it("the registrable domain groups subdomains and country suffixes", () => {
    expect(domainOf("https://blog.northwind.co.uk/x")).toBe("northwind.co.uk");
    expect(domainOf("https://www.northwind.com")).toBe("northwind.com");
  });
});

describe("what real search results taught us", () => {
  it("review directories and freelancer marketplaces are not companies", () => {
    for (const u of ["https://crowdreviews.com/agency/alter", "https://www.twine.net/hire/saas", "https://www.bark.com/x", "https://www.themanifest.com/seo"]) expect(junkReason(hit(u, "Alter SaaS Marketing Agency")), u).toBe("blocked_site");
  });
  it("a result that says nothing about the ICP is not worth fetching: relevance is below the bar", () => {
    const [off] = collectCandidates([hit("https://ipinfo.io", "103.207.43.0", "IP address lookup")], icp).candidates;
    const [on] = collectCandidates([hit("https://koozai.com", "Koozai | B2B Digital Marketing Agency", "digital marketing for SaaS in the United States")], icp).candidates;
    expect(relevance(off, icp)).toBeLessThan(MIN_RELEVANCE);
    expect(relevance(on, icp)).toBeGreaterThanOrEqual(MIN_RELEVANCE);
    // Showing up under many queries orders results, but never makes an irrelevant one relevant.
    const many = { ...off, sources: Array.from({ length: 8 }, (_, i) => ({ ...off.sources[0], query: `q${i}` })) };
    expect(relevance(many, icp)).toBeLessThan(MIN_RELEVANCE);
    expect(preRank(many, icp)).toBeGreaterThan(relevance(many, icp));
  });
});

describe("the junk filter", () => {
  it("rejects directories, social sites, listicles, government and files with a reason", () => {
    expect(junkReason(hit("https://clutch.co/agencies/seo"))).toBe("blocked_site");
    expect(junkReason(hit("https://www.linkedin.com/company/northwind"))).toBe("blocked_site");
    expect(junkReason(hit("https://northwind.com/x", "Top 10 SaaS marketing agencies in 2026"))).toBe("listing_page");
    expect(junkReason(hit("https://northwind.com/blog/post-1", "Our thoughts"))).toBe("listing_page");
    expect(junkReason(hit("https://agency.gov/x", "Agency"))).toBe("non_business_host");
    expect(junkReason(hit("https://northwind.com/deck.pdf", "Deck"))).toBe("file");
    expect(junkReason(hit("mailto:x@y.com"))).toBe("not_a_url");
  });
  it("an exclusion word in the result rejects it", () => {
    expect(junkReason(hit("https://cryptogrowth.com", "CryptoGrowth", "marketing for crypto exchanges"), ["crypto"])).toBe("excluded_word");
  });
  it("a company's own page passes", () => {
    expect(junkReason(hit("https://northwind.com"))).toBeNull();
    expect(junkReason(hit("https://northwind.com/services/saas-seo", "SaaS SEO | Northwind"))).toBeNull();
  });
});

describe("one candidate per company, with provenance", () => {
  it("merges every result for a domain, keeps every source, and names it from the home page", () => {
    const { candidates, rejected } = collectCandidates([
      hit("https://northwind.com/services/ppc?utm_source=g", "PPC services | Northwind", "PPC", "q1"),
      hit("https://www.northwind.com/", "Northwind Digital | Home", "agency", "q2"),
      hit("https://blog.northwind.com/", "Northwind blog", "", "q3"),
      hit("https://clutch.co/x", "Clutch", "", "q1"),
      hit("https://acme.io", "Acme Growth", "growth agency", "q1"),
    ], icp);
    expect(candidates.map((c) => c.domain).sort()).toEqual(["acme.io", "northwind.com"]);
    const n = candidates.find((c) => c.domain === "northwind.com")!;
    expect(n.sources).toHaveLength(2);
    expect(n.name).toBe("Northwind Digital");
    expect(n.website).toBe("https://northwind.com");
    expect(rejected.map((r) => r.reason).sort()).toEqual(["blocked_site", "non_business_host"]); // a blog.* host is not the company's own site
  });
  it("the same page from the same query twice is a duplicate, not two sources", () => {
    const { candidates, rejected } = collectCandidates([hit("https://acme.io"), hit("https://www.acme.io/")], icp);
    expect(candidates[0].sources).toHaveLength(1);
    expect(rejected).toEqual([{ url: "https://acme.io", reason: "duplicate" }]);
  });
});

describe("pre-rank", () => {
  it("a result that says the industry and the market ranks above one that says neither", () => {
    const [good] = collectCandidates([hit("https://good.com", "Good | Digital marketing agency for SaaS", "growth agency in the United States")], icp).candidates;
    const [bad] = collectCandidates([hit("https://bad.com", "Bad Bakery", "fresh bread")], icp).candidates;
    expect(preRank(good, icp)).toBeGreaterThan(preRank(bad, icp));
    expect(preRank(bad, icp)).toBeLessThanOrEqual(1);
  });
});

describe("is it the company's own site", () => {
  const c = { name: "Northwind Digital", domain: "northwind.com" };
  const text = "Northwind Digital is a digital marketing agency. ".repeat(10);
  it("needs the name or domain on the page, enough text, and not parked", () => {
    expect(checkSite(c, { title: "Northwind Digital | Home", text })).toEqual({ ok: true, identity: "title" });
    expect(checkSite(c, { title: "Home", text: "Welcome. ".repeat(50) + "northwind" })).toEqual({ ok: true, identity: "domain" });
    expect(checkSite(c, { title: "x", text: "short" }).reason).toBe("thin_site");
    // the site shows the brand without the domain's corporate tail
    const cb = { name: "Callboxinc", domain: "callboxinc.com" };
    expect(checkSite(cb, { title: "Callbox - Leading B2B Lead Generation Agency", text: "Callbox helps software companies grow. ".repeat(12) })).toEqual({ ok: true, identity: "domain" });
    // …but only the tail is dropped: an unrelated page, or one that shares only a short stem, is still no match
    expect(checkSite(cb, { title: "A page about gardening", text: "Tomatoes and basil grow well in pots. ".repeat(12) }).reason).toBe("no_identity");
    expect(checkSite({ name: "Abcinc", domain: "abcinc.com" }, { title: "ABC Rentals", text: "We rent chairs and tables for events. ".repeat(12) }).reason).toBe("no_identity"); // brand "abc" is under 4 letters
    expect(checkSite(cb, { title: "callbox", text: "This domain is for sale. Buy this domain today! ".repeat(10) }).reason).toBe("parked");
    // an accent on the brand is the same brand
    expect(checkSite({ name: "Roketto", domain: "sovyn.com" }, { title: "Sōvyn l healthcare tech marketing + PR agency", text: "Sōvyn helps health tech companies grow. ".repeat(12) })).toEqual({ ok: true, identity: "domain" });
    expect(checkSite(c, { title: "northwind.com", text: "This domain is for sale. Buy this domain today! ".repeat(10) }).reason).toBe("parked");
    expect(checkSite(c, { title: "Bakery", text: "Fresh bread every morning in our shop. ".repeat(10) }).reason).toBe("no_identity");
  });
});

describe("dates and freshness", () => {
  const read = new Date("2026-10-08T00:00:00Z");
  it("reads stated dates conservatively", () => {
    expect(parseEvidenceDate("Posted on 2026-09-30", read)!.toISOString().slice(0, 10)).toBe("2026-09-30");
    expect(parseEvidenceDate("September 14, 2026 — we launched PPC", read)!.toISOString().slice(0, 10)).toBe("2026-09-14");
    expect(parseEvidenceDate("14 Sept 2026", read)!.toISOString().slice(0, 10)).toBe("2026-09-14");
    expect(parseEvidenceDate("In March 2026 we opened Austin", read)!.toISOString().slice(0, 10)).toBe("2026-03-01");
    expect(parseEvidenceDate("posted 3 days ago", read)!.toISOString().slice(0, 10)).toBe("2026-10-05");
    expect(parseEvidenceDate("Since 2019 we have helped", read)!.toISOString().slice(0, 10)).toBe("2019-01-01");
    expect(parseEvidenceDate("We are hiring a strategist", read)).toBeNull();
    expect(parseEvidenceDate("February 30, 2026", read)).toBeNull();
  });
  it("bands", () => {
    expect(freshness("2026-10-05T00:00:00Z", NOW).band).toBe("strong");
    expect(freshness("2026-08-01T00:00:00Z", NOW).band).toBe("medium");
    expect(freshness("2026-01-01T00:00:00Z", NOW).band).toBe("weak");
    expect(freshness("2025-01-01T00:00:00Z", NOW).band).toBe("stale");
    expect(freshness(null, NOW)).toEqual({ band: "unknown", days: null });
    expect(freshness("2027-01-01T00:00:00Z", NOW).band).toBe("unknown");
  });
});

describe("scoring a prospect with the lead score", () => {
  const f = (over: Partial<FindingLike>): FindingLike => ({ id: 1, kind: "fact", type: "description", value: "x", status: "confirmed", sourceUrl: "https://n.com", retrievedAt: NOW, ...over });
  it("a fresh confirmed signal scores as activity and as inferred timing; a stale one scores nothing", () => {
    const claims = findingsAsClaims([f({ id: 2, kind: "signal", type: "HIRING", value: "Hiring an SEO strategist", observedAt: "2026-10-01T00:00:00Z" })], NOW);
    expect(claims.map((c) => [c.field, c.status])).toEqual([["hiring", "confirmed"], ["timing", "inferred"]]);
    expect(findingsAsClaims([f({ kind: "signal", type: "HIRING", observedAt: "2024-01-01T00:00:00Z" })], NOW)).toEqual([]);
    const undated = findingsAsClaims([f({ kind: "signal", type: "NEW_SERVICE", observedAt: null })], NOW);
    expect(undated.map((c) => c.field)).toEqual(["launch"]); // no timing from an undated signal
  });
  it("opportunities are always inferred, whatever was stored; people count as a named contact", () => {
    const claims = findingsAsClaims([f({ id: 3, kind: "opportunity", type: "opportunity", status: "confirmed" }), f({ id: 4, kind: "decision_maker", type: "Founder" })], NOW);
    expect(claims).toEqual(expect.arrayContaining([expect.objectContaining({ field: "opportunity", status: "inferred" }), expect.objectContaining({ field: "decision_maker", status: "confirmed" })]));
  });
  it("end to end through scoreLead: unknown earns nothing and is listed as missing", () => {
    const s = scoreLead(null, {}, findingsAsClaims([f({ id: 2, kind: "signal", type: "HIRING", observedAt: "2026-10-01T00:00:00Z" })], NOW));
    expect(s.components.find((c) => c.key === "signal")!.points).toBe(10);
    expect(s.components.find((c) => c.key === "timing")!.points).toBe(5);
    expect(s.components.find((c) => c.key === "budget")!.points).toBeNull();
    expect(s.missing.length).toBeGreaterThan(0);
  });
});

describe("outreach-ready is a rule", () => {
  const sig = { id: 1, kind: "signal", type: "HIRING", value: "x", status: "confirmed", observedAt: "2026-10-01T00:00:00Z" };
  const dm = { id: 2, kind: "decision_maker", type: "Founder", value: "Ana Silva, Founder", status: "confirmed" };
  it("needs all four: verified, a fit, a current reason, a way in", () => {
    expect(readiness({ verified: true, fitVerdict: "strong", findings: [sig, dm], now: NOW })).toEqual({ ready: true, missing: [] });
    expect(readiness({ verified: false, fitVerdict: "strong", findings: [sig, dm], now: NOW }).ready).toBe(false);
    expect(readiness({ verified: true, fitVerdict: "weak", findings: [sig, dm], now: NOW }).ready).toBe(false);
    expect(readiness({ verified: true, fitVerdict: "strong", findings: [dm], now: NOW }).missing).toContain("a dated reason to reach out now (a recent signal)");
    expect(readiness({ verified: true, fitVerdict: "strong", findings: [{ ...sig, observedAt: "2023-01-01T00:00:00Z" }, dm], now: NOW }).ready).toBe(false);
    expect(readiness({ verified: true, fitVerdict: "strong", findings: [sig], now: NOW }).ready).toBe(false);
    expect(readiness({ verified: true, fitVerdict: "strong", findings: [sig, dm], doNotContact: true, now: NOW }).ready).toBe(false);
  });
  it("an UNDATED signal still scores but is not a reason to call a prospect outreach-ready (a why-now needs a date)", () => {
    const undated = { ...sig, observedAt: null };
    expect(readiness({ verified: true, fitVerdict: "strong", findings: [undated, dm], now: NOW })).toMatchObject({ ready: false, missing: ["a dated reason to reach out now (a recent signal)"] });
    expect(findingsAsClaims([{ ...undated, id: 5, sourceUrl: "https://n.com", retrievedAt: NOW } as FindingLike], NOW).map((c) => c.field)).toEqual(["hiring"]);
  });
  it("an inferred signal is not a reason to reach out", () => {
    expect(readiness({ verified: true, fitVerdict: "strong", findings: [{ ...sig, status: "inferred" }, dm], now: NOW }).ready).toBe(false);
  });
});

describe("run budget", () => {
  it("grows with quantity and has ceilings", () => {
    expect(runBudget(30)).toEqual({ queries: 8, resultsPerQuery: 20, verify: 100, enrich: 70, research: 50, llmCalls: 122 });
    expect(runBudget(500).verify).toBe(120);
    expect(runBudget(0).verify).toBe(13);
  });
});
