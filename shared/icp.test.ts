import { describe, expect, it } from "vitest";
import { countryFromDomain, describeIcp, icpSchema, industryMatched, mergeIcp, parseHeadcount, parseIcpFallback, prospectFit, roleRank, searchStrategies, singular, withSavedExclusions, MAX_QUANTITY, type Icp } from "./icp";

const DOD = "Find 30 US digital marketing agencies with 5–30 employees that serve SaaS companies.";
const icp = (over: Partial<Icp> = {}): Icp => icpSchema.parse({ industry: "digital marketing agency", countries: ["US"], employeeMin: 5, employeeMax: 30, targetMarket: ["SaaS"], quantity: 30, ...over });

describe("reading a request with plain rules", () => {
  it("reads the definition-of-done request completely", () => {
    expect(parseIcpFallback(DOD)).toMatchObject({ industry: "digital marketing agency", countries: ["US"], employeeMin: 5, employeeMax: 30, targetMarket: ["SaaS"], quantity: 30 });
  });
  it("reads other phrasings: work with, serving, a range written with 'to' or a hyphen, a country as a word", () => {
    expect(parseIcpFallback("Find 50 US SEO agencies with 5-30 employees that work with SaaS companies")).toMatchObject({ industry: "SEO agency", quantity: 50, employeeMin: 5, employeeMax: 30, targetMarket: ["SaaS"] });
    expect(parseIcpFallback("10 accounting firms in the United Kingdom serving restaurants")).toMatchObject({ industry: "accounting firm", countries: ["GB"], targetMarket: ["restaurants"], quantity: 10 });
    expect(parseIcpFallback("web design studios in India with 10 to 50 people")).toMatchObject({ countries: ["IN"], employeeMin: 10, employeeMax: 50 });
  });
  it("never asks for more than the cap, and a missing number is the default, not invented", () => {
    expect(parseIcpFallback("Find 900 SEO agencies")!.quantity).toBe(MAX_QUANTITY);
    expect(parseIcpFallback("SEO agencies in Canada")!.quantity).toBe(20);
  });
  it("a size number is not mistaken for the quantity", () => {
    expect(parseIcpFallback("SEO agencies with 5-30 employees")!.quantity).toBe(20);
  });
  it("'us' inside a word is not the United States", () => {
    expect(parseIcpFallback("Find 10 business consultants")!.countries).toEqual([]);
  });
  it("nonsense gives nothing rather than a guess", () => {
    expect(parseIcpFallback("")).toBeNull();
    expect(parseIcpFallback("  ?? ")).toBeNull();
  });
  it("singular only touches the last word", () => {
    expect(singular("digital marketing agencies")).toBe("digital marketing agency");
    expect(singular("accounting firms")).toBe("accounting firm");
    expect(singular("business")).toBe("business");
    expect(singular("coaches")).toBe("coach");
  });
});

describe("taking a model's ICP", () => {
  const fb = parseIcpFallback(DOD)!;
  it("keeps valid fields, drops invalid ones field by field, and fills the gaps from the rules", () => {
    const m = mergeIcp({ industry: "digital marketing agency", keywords: ["performance marketing", "growth agency"], countries: ["US", "nonsense"], employeeMin: "five", roles: ["Founder", "Head of Growth"] }, fb)!;
    expect(m.keywords).toEqual(["performance marketing", "growth agency"]);
    expect(m.countries).toEqual(["US"]); // the invalid list as a whole was rejected; the rules' list stands
    expect(m.employeeMin).toBe(5);
    expect(m.roles).toEqual(["Founder", "Head of Growth"]);
  });
  it("no model answer at all leaves exactly what the rules read (defaults never overwrite it); an empty list from the model doesn't erase it either", () => {
    expect(mergeIcp(null, fb)).toEqual(fb);
    expect(mergeIcp({}, fb)).toEqual(fb);
    expect(mergeIcp({ industry: "digital marketing agency", countries: [], targetMarket: [], roles: [] }, fb)).toEqual(fb);
  });
  it("a model can never raise the number the person asked for", () => {
    expect(mergeIcp({ industry: "x agency", quantity: 50 }, fb)!.quantity).toBe(30);
    expect(mergeIcp({ industry: "x agency", quantity: 10 }, fb)!.quantity).toBe(10);
  });
  it("an inconsistent size range is dropped, not the whole profile", () => {
    const m = mergeIcp({ industry: "agency", employeeMin: 50, employeeMax: 5 }, null)!;
    expect(m.employeeMin).toBeNull();
    expect(m.employeeMax).toBeNull();
  });
  it("no industry anywhere = no ICP", () => {
    expect(mergeIcp({ countries: ["US"] }, null)).toBeNull();
    expect(mergeIcp(null, null)).toBeNull();
  });
  it("adds the workspace's standing exclusions", () => {
    expect(withSavedExclusions(icp({ exclusions: ["crypto"] }), { exclusions: ["gambling", "crypto"] }).exclusions).toEqual(["crypto", "gambling"]);
  });
  it("describes itself in one line", () => {
    expect(describeIcp(icp())).toBe("digital marketing agency · United States · 5–30 people · serves SaaS");
  });
});

describe("search strategies", () => {
  it("several phrasings, never one giant search; all distinct and within the cap", () => {
    const qs = searchStrategies(icp({ keywords: ["growth marketing agency", "performance marketing agency", "PPC agency"] }));
    expect(qs.length).toBeGreaterThanOrEqual(5);
    expect(qs.length).toBeLessThanOrEqual(8);
    expect(new Set(qs.map((q) => q.toLowerCase())).size).toBe(qs.length);
    expect(qs.some((q) => /SaaS/.test(q))).toBe(true);
    expect(qs.some((q) => /United States/.test(q))).toBe(true);
  });
  it("model-proposed phrasings pass the same checks: no emails, phones or links reach a search engine", () => {
    const qs = searchStrategies(icp(), ["agency contact john@x.com", "call +1 415 555 0100 agencies", "https://evil.example agencies", "SaaS-focused marketing studio"]);
    expect(qs.join(" ")).not.toMatch(/@|https?:|555/);
    expect(qs).toContain("SaaS-focused marketing studio");
  });
});

describe("headcounts", () => {
  it("reads the ways pages state size", () => {
    expect(parseHeadcount("a team of 12 people")).toEqual({ min: 12, max: 12 });
    expect(parseHeadcount("11-50 employees")).toEqual({ min: 11, max: 50 });
    expect(parseHeadcount("over 40 staff")).toEqual({ min: 41, max: Number.MAX_SAFE_INTEGER });
    expect(parseHeadcount("50+ specialists")).toMatchObject({ min: 51 });
    expect(parseHeadcount("1,200 employees")).toEqual({ min: 1200, max: 1200 });
    expect(parseHeadcount("a small team")).toBeNull();
  });
});

describe("prospect fit", () => {
  const p = { name: "Northwind Digital", industry: "Digital marketing agency", location: "Austin, Texas", country: "US", employees: "a team of 18", targetCustomers: "B2B SaaS companies" };
  it("strong only when everything checkable matches", () => {
    const f = prospectFit(icp(), p);
    expect(f.verdict).toBe("strong");
    expect(f.signals.map((s) => [s.key, s.status])).toEqual([["industry", "match"], ["location", "match"], ["size", "match"], ["market", "match"]]);
  });
  it("an unknown size is unknown, never a mismatch, and keeps it from being 'strong'", () => {
    const f = prospectFit(icp(), { ...p, employees: null });
    expect(f.signals.find((s) => s.key === "size")!.status).toBe("unknown");
    expect(f.verdict).toBe("partial");
    expect(f.missing).toContain("company size");
  });
  it("a size outside the range is a mismatch", () => {
    expect(prospectFit(icp(), { ...p, employees: "250 employees" }).signals.find((s) => s.key === "size")!.status).toBe("mismatch");
    expect(prospectFit(icp(), { ...p, employees: "250 employees" }).verdict).toBe("partial");
  });
  it("not mentioning the target market is unknown, not a mismatch", () => {
    expect(prospectFit(icp(), { ...p, targetCustomers: "local restaurants" }).signals.find((s) => s.key === "market")!.status).toBe("unknown");
  });
  it("a city without a country is not compared with a country (unknown, never a mismatch)", () => {
    const f = prospectFit(icp(), { ...p, country: null, location: "Austin, Texas" });
    expect(f.signals.find((s) => s.key === "location")!.status).toBe("unknown");
  });
  it("a named region narrows it: inside the right country but another city is unknown, the named city is a match", () => {
    const i = icp({ locations: ["California"] });
    expect(prospectFit(i, p).signals.find((s) => s.key === "location")!.status).toBe("unknown");
    expect(prospectFit(i, { ...p, location: "San Diego, California" }).signals.find((s) => s.key === "location")!.status).toBe("match");
  });
  it("the wrong industry and the wrong country together are weak", () => {
    expect(prospectFit(icp(), { name: "Acme Plumbing", industry: "Plumbing", location: "Leeds", country: "GB" }).verdict).toBe("weak");
  });
  it("an exclusion wins over everything", () => {
    expect(prospectFit(icp({ exclusions: ["crypto"] }), { ...p, targetCustomers: "crypto exchanges and SaaS" }).verdict).toBe("excluded");
  });
});

describe("what real companies taught us", () => {
  const fed = { name: "Federal Reserve Bank of St. Louis", industry: "A trusted partner in conducting monetary policy, part of the Federal Reserve System", location: "St. Louis, Missouri", country: "US", targetCustomers: "Banks" };
  it("the wrong KIND of company is weak however well the place matches (a central bank in the US is not a US marketing agency)", () => {
    const f = prospectFit(icp(), fed);
    expect(f.signals.find((s) => s.key === "industry")!.status).toBe("mismatch");
    expect(f.signals.find((s) => s.key === "location")!.status).toBe("match");
    expect(f.verdict).toBe("weak");
    expect(industryMatched(f)).toBe(false);
  });
  it("what kind of company it is comes from the industry field; a description that merely contains the same words does not make it one", () => {
    const f = prospectFit(icp(), { name: "WriteCream", industry: "AI writing platform", description: "Create marketing copy and digital marketing content with AI", country: "US" });
    expect(f.signals.find((s) => s.key === "industry")!.status).toBe("mismatch");
  });
  it("without an industry field, the description decides", () => {
    expect(industryMatched(prospectFit(icp(), { name: "Koozai", description: "Koozai is a digital marketing agency helping SMBs grow", country: "US" }))).toBe(true);
  });
  it("a country-code web address is evidence of the country when the page doesn't say: a .uk agency is not in the US", () => {
    const f = prospectFit(icp(), { name: "Koozai", domain: "koozai.co.uk", industry: "Digital marketing agency", location: "Southampton" });
    expect(f.signals.find((s) => s.key === "location")).toMatchObject({ status: "mismatch" });
    expect(f.signals.find((s) => s.key === "location")!.detail).toMatch(/\.uk/);
    expect(f.verdict).toBe("partial");
  });
  it("a stated country beats the web address; .com and generic endings say nothing", () => {
    expect(prospectFit(icp(), { name: "X", domain: "x.co.uk", industry: "Digital marketing agency", country: "US" }).signals.find((s) => s.key === "location")!.status).toBe("match");
    for (const d of ["x.com", "x.io", "x.ai", "x.co", "x.me"]) expect(countryFromDomain(d), d).toBeNull();
    expect(countryFromDomain("koozai.co.uk")).toBe("GB");
    expect(prospectFit(icp(), { name: "X", domain: "x.io", industry: "Digital marketing agency", location: "Austin" }).signals.find((s) => s.key === "location")!.status).toBe("unknown");
  });
});

describe("decision-maker relevance", () => {
  it("follows the ICP's own order, and an unlisted title is last but kept", () => {
    const i = icp({ roles: ["Head of Growth", "Founder"] });
    expect(roleRank(i, "Head of Growth")).toBe(0);
    expect(roleRank(i, "Co-Founder & CEO")).toBe(1);
    expect(roleRank(i, "Office Manager")).toBe(2);
  });
});
