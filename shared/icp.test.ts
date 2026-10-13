import { describe, expect, it } from "vitest";
import { countryFromDomain, describeIcp, isSeniorDecisionMaker, icpSchema, industryMatched, marketWord, mergeIcp, parseHeadcount, parseIcpFallback, prospectFit, queryKey, roleRank, searchStrategies, singular, withSavedExclusions, MAX_QUANTITY, type Icp } from "./icp";
import { sanitizeQuery } from "./discovery";

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
  // The plan the code built before market-led phrasings, for an ICP with no market (that behaviour must not change).
  const NO_MARKET_BEFORE = ["digital marketing agency United States", "SEO agency United States", "boutique digital marketing agency United States", "growth marketing agency United States", "PPC agency United States"];
  it("with a market, every phrasing names it: the two phrasings that left it out are now market-led (A, B and C)", () => {
    const qs = searchStrategies(icp({ targetMarket: ["SaaS companies"], keywords: ["SEO agency", "growth marketing agency", "PPC agency"] }));
    expect(qs).toEqual([
      "digital marketing agency for SaaS companies United States",  // A
      "SaaS digital marketing agency United States",                // C (was "digital marketing agency United States")
      "SEO agency for SaaS companies United States",                // A
      "SaaS SEO agency United States",                              // C (was "SEO agency United States")
      "digital marketing agency SaaS companies clients case study", // B, unchanged
      "boutique SaaS digital marketing agency United States",
      "growth marketing agency SaaS companies United States",
      "PPC agency SaaS companies United States",
    ]);
    expect(qs.every((q) => /\bSaaS\b/.test(q))).toBe(true);
  });
  it("another market is named the same way, by the word a company would put in front ('healthcare brands' -> 'healthcare')", () => {
    expect(marketWord("healthcare brands")).toBe("healthcare");
    expect(marketWord("SaaS companies")).toBe("SaaS");
    expect(marketWord("SaaS")).toBe("SaaS");
    expect(marketWord("early stage B2B fintech software companies")).toBe(""); // too long to lead a phrase: the whole market is used
    const qs = searchStrategies(icp({ industry: "SEO agency", targetMarket: ["healthcare brands"], keywords: ["content marketing agency"] }));
    expect(qs.slice(0, 4)).toEqual(["SEO agency for healthcare brands United States", "healthcare SEO agency United States", "content marketing agency for healthcare brands United States", "healthcare content marketing agency United States"]);
    expect(qs.every((q) => /healthcare/.test(q))).toBe(true);
    expect(searchStrategies(icp({ targetMarket: ["early stage B2B fintech software companies"] })).every((q) => /fintech/.test(q))).toBe(true);
  });
  it("a keyword that already names the market is never doubled ('SaaS marketing agency SaaS case studies' can't happen)", () => {
    const qs = searchStrategies(icp({ industry: "SaaS marketing agency", targetMarket: ["SaaS companies"], keywords: ["SaaS SEO agency", "growth marketing agency"] }));
    for (const q of qs) expect(q.match(/\bsaas\b/gi)?.length ?? 0).toBeLessThanOrEqual(1);
    expect(qs).toContain("SaaS marketing agency United States");
    expect(qs).toContain("SaaS marketing agency clients case study");
    expect(qs).not.toContain("SaaS marketing agency for SaaS companies United States");
  });
  it("no market stated: exactly the plain phrasings it built before", () => {
    expect(searchStrategies(icp({ targetMarket: [], keywords: ["SEO agency", "growth marketing agency", "PPC agency"] }))).toEqual(NO_MARKET_BEFORE);
  });
  it("model phrasings keep up to 3 slots, but one that repeats a template in other words doesn't take one", () => {
    const base = icp({ targetMarket: ["SaaS companies"], keywords: ["SEO agency", "growth marketing agency", "PPC agency"] });
    const qs = searchStrategies(base, ["Digital Marketing Agencies for SaaS companies US", "SaaS-focused marketing studio", "B2B SaaS demand generation agency", "SaaS fractional CMO firm"]);
    expect(qs).toHaveLength(8);
    expect(qs.filter((q) => ["SaaS-focused marketing studio", "B2B SaaS demand generation agency", "SaaS fractional CMO firm"].includes(q))).toHaveLength(2); // 3 slots, one used by the duplicate
    expect(qs).not.toContain("Digital Marketing Agencies for SaaS companies US"); // the same search as template A
    expect(qs.slice(0, 5)).toEqual(searchStrategies(base).slice(0, 5)); // the templates keep the first slots
    expect(searchStrategies(base, ["SaaS digital marketing agency United States"])).toEqual(searchStrategies(base)); // an exact repeat changes nothing
  });
  it("at most 8 queries (and the smaller cap a run asks for), every one accepted by the existing sanitiser", () => {
    const many = icp({ targetMarket: ["SaaS companies"], keywords: ["SEO agency", "growth marketing agency", "PPC agency"] });
    const qs = searchStrategies(many, ["one SaaS agency", "two SaaS agency", "three SaaS agency", "four SaaS agency", "five SaaS agency"]);
    expect(qs.length).toBe(8);
    expect(searchStrategies(many, [], 3)).toHaveLength(3);
    for (const q of qs) expect(sanitizeQuery(q)).toEqual({ ok: true, query: q });
  });
  it("one search per meaning: case, plurals, little words, US/USA/United States and word order don't make a new query", () => {
    expect(queryKey("Digital Marketing Agencies for SaaS companies US")).toBe(queryKey("digital marketing agency for SaaS company United States"));
    expect(queryKey("SaaS SEO agency USA")).toBe(queryKey("SEO agency SaaS united states"));
    expect(queryKey("SaaS SEO agency")).not.toBe(queryKey("SaaS SEO agency United States")); // a place is a different search
    expect(queryKey("SaaS SEO agency")).not.toBe(queryKey("SaaS PPC agency"));
    expect(queryKey("SaaS businesses")).toBe(queryKey("saas business")); // "SaaS" is not a plural
    const qs = searchStrategies(icp({ targetMarket: ["SaaS"], keywords: ["SaaS agency", "SaaS agencies"] }));
    expect(new Set(qs.map(queryKey)).size).toBe(qs.length);
  });
  it("a kind that says PART of the market gets only the missing words ('B2B SaaS SaaS marketing agency' can't happen)", () => {
    const qs = searchStrategies(icp({ targetMarket: ["B2B SaaS companies"], keywords: ["SaaS marketing agency", "SEO agency"] }));
    expect(qs).toContain("B2B SaaS marketing agency United States");
    expect(qs).not.toContain("B2B SaaS SaaS marketing agency United States");
    expect(qs).not.toContain("SaaS marketing agency for B2B SaaS companies United States");
    for (const q of qs) {
      expect(q.match(/\bsaas\b/gi)?.length ?? 0, q).toBe(1);
      expect(q.match(/\bb2b\b/gi)?.length ?? 0, q).toBe(1);
    }
  });
  it("a market that already names the place doesn't get the place again ('US healthcare … United States' can't happen)", () => {
    const qs = searchStrategies(icp({ targetMarket: ["US healthcare brands"], keywords: ["PPC agency"] }));
    expect(qs).toContain("US healthcare PPC agency");
    for (const q of qs) expect(/\bUS\b/.test(q) && /United States/.test(q), q).toBe(false);
    expect(qs.every((q) => /healthcare/.test(q))).toBe(true);
    // A place the market doesn't name is still added.
    expect(searchStrategies(icp({ targetMarket: ["UK healthcare brands"], keywords: ["PPC agency"] }))).toContain("UK healthcare PPC agency United States");
  });
  it("no place at all: well-formed phrasings that still name the market (no trailing or doubled spaces)", () => {
    const qs = searchStrategies(icp({ countries: [], locations: [], targetMarket: ["SaaS companies"], keywords: ["SEO agency"] }));
    expect(qs.length).toBeGreaterThan(0);
    for (const q of qs) { expect(q).toBe(q.trim()); expect(q).not.toMatch(/\s{2,}/); expect(q).toMatch(/\bSaaS\b/); }
  });
  it("with a market, every phrasing names each market word exactly once (several shapes of ICP)", () => {
    const shapes: [string[], string, string[]][] = [
      [["SaaS companies"], "digital marketing agency", ["SEO agency", "growth marketing agency", "PPC agency"]],
      [["B2B SaaS companies"], "SaaS marketing agency", ["SEO agency", "B2B content agency"]],
      [["healthcare brands"], "SEO agency", ["healthcare PR agency"]],
      [["ecommerce brands"], "ecommerce agency", ["Shopify agency"]],
    ];
    for (const [market, industry, keywords] of shapes) {
      const lead = marketWord(market[0]) || market[0];
      for (const q of searchStrategies(icp({ industry, targetMarket: market, keywords }))) {
        for (const w of lead.split(" ")) expect(q.match(new RegExp(`\\b${w}\\b`, "gi"))?.length ?? 0, `${q} / ${w}`).toBe(1);
      }
    }
  });
  it("matches the 30-credit experiment: the phrasings that found target agencies stay; the market-less ones never come back", () => {
    // Queries as run in the experiment (same ICP shape). Case study (q5) found target agencies as company sites in BOTH
    // baseline runs; the market-led q1 found them in some runs; the market-less q2/q4 found none in any variant.
    const qs = searchStrategies(icp({ targetMarket: ["SaaS companies"], keywords: ["SEO agency", "growth marketing agency"], employeeMax: 30 }));
    expect(qs).toContain("digital marketing agency for SaaS companies United States");   // q1
    expect(qs).toContain("SEO agency for SaaS companies United States");                 // q3
    expect(qs).toContain("digital marketing agency SaaS companies clients case study");  // q5
    expect(qs).not.toContain("digital marketing agency United States");                  // q2
    expect(qs).not.toContain("SEO agency United States");                                // q4
    // Nothing here adds search operators or exclusions: the experiment's exclusion variant lost every target.
    for (const q of qs) expect(q).not.toMatch(/(^|\s)-|site:|\bOR\b|"/);
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

describe("the ICP's keywords", () => {
  it("up to eight are kept (the specialist kinds of the same company), a ninth is refused", () => {
    const kw = (n: number) => Array.from({ length: n }, (_, i) => `kind ${i}`);
    expect(icpSchema.parse({ industry: "digital marketing agency", keywords: kw(8) }).keywords).toHaveLength(8);
    expect(icpSchema.safeParse({ industry: "digital marketing agency", keywords: kw(9) }).success).toBe(false);
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
  it("a country the person named is a requirement: a company stated to be elsewhere is a WEAK fit however well the rest matches", () => {
    const uk = prospectFit(icp(), { ...p, country: "GB", location: "London" });
    expect(uk.signals.find((s) => s.key === "location")!.status).toBe("mismatch");
    expect(uk.signals.filter((s) => s.status === "match").map((s) => s.key)).toEqual(["industry", "size", "market"]); // everything else matched
    expect(uk.verdict).toBe("weak");
    expect(uk.headline).toMatch(/outside the country you asked for/);
    // its web address alone is evidence too
    expect(prospectFit(icp(), { ...p, country: null, location: null, domain: "examplemarketing.co.uk" } as any).verdict).toBe("weak");
    // …but a city with no country, an unknown place, or the right country is not
    expect(prospectFit(icp(), { ...p, country: null, location: "London" }).verdict).not.toBe("weak");
    expect(prospectFit(icp(), { ...p, country: null, location: null }).verdict).not.toBe("weak");
    expect(prospectFit(icp(), p).verdict).toBe("strong");
    // no country asked for: where it is makes no difference
    expect(prospectFit(icp({ countries: [] }), { ...p, country: "GB" }).verdict).not.toBe("weak");
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
    expect(f.verdict).toBe("weak"); // was "partial": a country the person named is a requirement (the benchmark showed UK/India agencies becoming "ready")
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

/* ── Phase 2 policy: Canada evidence (F1) and an explicit B2C-only market (F2) ─────────────────────────────── */
describe("F1: a Canadian city or province is evidence of Canada", () => {
  const p = { name: "Maple Growth", industry: "Digital marketing agency", targetCustomers: "B2B SaaS companies" };
  it("Montréal, QC / Toronto, ON / Calgary / British Columbia: Canada, so a US-only ICP is a confirmed mismatch (weak)", () => {
    for (const location of ["Montréal, QC", "Montreal, Quebec", "Toronto, ON", "Toronto, Ontario", "Calgary", "Vancouver, BC", "Halifax, Nova Scotia", "Ottawa"]) {
      const f = prospectFit(icp(), { ...p, location, country: null });
      expect(f.signals.find((s) => s.key === "location")!.status, location).toBe("mismatch");
      expect(f.verdict, location).toBe("weak");
    }
  });
  it("genuinely unknown stays unknown: no location, a city that exists in both countries, or a US state code", () => {
    for (const location of [null, "London", "Vancouver", "Hamilton", "Kingston", "Vancouver, WA", "Portland, OR", "Austin, TX", "Remote", "Toronto, ON and Austin, TX", "Toronto and New York, USA"]) {
      const f = prospectFit(icp(), { ...p, location: location as any, country: null });
      expect(f.signals.find((s) => s.key === "location")!.status, String(location)).toBe("unknown");
    }
  });
  it("a stated country still wins over a city, and a Canadian ICP matches Canadian evidence", () => {
    expect(prospectFit(icp(), { ...p, location: "Toronto, ON", country: "US" }).signals.find((s) => s.key === "location")!.status).toBe("match");
    expect(prospectFit(icp({ countries: ["CA"] }), { ...p, location: "Montréal, QC", country: null }).signals.find((s) => s.key === "location")!.status).toBe("match");
  });
});

describe("F2: an explicit B2C-only market is a mismatch for a B2B/SaaS ICP", () => {
  const p = { name: "Consumer Co", industry: "Digital marketing agency", location: "Leesburg, VA", country: "US" };
  it("'for B2C brands', 'consumer brands', 'DTC' with no B2B/SaaS/software/tech wording: market mismatch, weak fit", () => {
    for (const targetCustomers of ["Media, measurement and SEO for $100M+ B2C brands", "We grow consumer brands", "DTC and e-commerce brands", "direct-to-consumer brands"]) {
      const f = prospectFit(icp(), { ...p, targetCustomers });
      expect(f.signals.find((s) => s.key === "market")!.status, targetCustomers).toBe("mismatch");
      expect(f.verdict, targetCustomers).toBe("weak");
    }
  });
  it("missing SaaS wording alone is NOT a mismatch; B2B and B2C together is not B2C-only", () => {
    for (const targetCustomers of ["small businesses", "local restaurants", "healthcare organizations", "both B2B and B2C businesses", "B2C and B2B SaaS brands", "consumer tech and SaaS companies"])
      expect(prospectFit(icp(), { ...p, targetCustomers }).signals.find((s) => s.key === "market")!.status, targetCustomers).not.toBe("mismatch");
  });
  it("an ICP that does not target B2B/SaaS is never mismatched by a B2C statement", () => {
    expect(prospectFit(icp({ targetMarket: ["restaurants"] }), { ...p, targetCustomers: "B2C brands" }).signals.find((s) => s.key === "market")!.status).not.toBe("mismatch");
  });
});

/* ── who counts as a decision-maker: senior titles only (measured: 4 of 9 "decision makers" on ready cards were delivery staff) ── */
describe("senior decision-maker titles", () => {
  it("owners, executives and the heads of the buying function are senior", () => {
    for (const t of ["Founder", "Co-Founder & CEO", "Founder and Growth Manager", "Owner", "President", "CEO", "Managing Director", "Managing Partner", "Partner", "Senior Partner",
      "General Manager", "CMO", "Chief Marketing Officer", "Chief Revenue Officer", "Head of Growth", "Head of Sales", "VP of Marketing", "VP, Sales", "Vice President of Growth",
      "Director of Growth", "Marketing Director", "Sales Director", "Head of Business Development", "Director of Demand Generation"])
      expect(isSeniorDecisionMaker(t), t).toBe(true);
  });
  it("other real employees are not: delivery directors, managers, strategists, assistants, a VP of another function, a partnerships role", () => {
    for (const t of ["SEO Director", "Growth Marketing Manager", "Growth Marketing Analyst", "Content Strategist", "VP, Tech Enablement and Apps", "Assistant to the CEO",
      "Associate Director of Marketing", "Marketing Coordinator", "Partnerships Manager", "Partner Success Lead", "Product Owner", "Creative Director", "Account Executive",
      "Head of Design", "Growth Strategist", "Senior Designer", "Vice President, Engineering", "", "Team"])
      expect(isSeniorDecisionMaker(t), t).toBe(false);
    expect(isSeniorDecisionMaker(null)).toBe(false);
  });
});
