import { describe, expect, it } from "vitest";
import { EVENT_SIGNAL_TYPES, MIN_RELEVANCE, MISSING_CONTACT, isContactFormRoute, MISSING_REASON, hasVerifiedEmail, isDecisionMaker, relevance, canonicalUrl, checkSite, collectCandidates, dateLabel, domainOf, evidenceDate, findingsAsClaims, freshness, junkReason, parseEvidenceDate, pickResearchLinks, preRank, readiness, runBudget, signalDating, timingOf, type FindingLike, type SearchHit } from "./prospect";
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
    // platforms seen in real results and on real list pages are not companies, in any country ending
    for (const u of ["https://dribbble.com/someagency", "https://vimeo.com/123", "https://www.pinterest.co.uk/x", "https://pinterest.de", "https://searchengineland.com/x", "https://acme.applytojob.com/apply", "https://amazon.co.uk/x", "https://www.behance.net/studio"])
      expect(junkReason(hit(u, "Some Agency")), u).toBe("blocked_site");
    // …while a company whose name merely contains a platform word is not blocked
    expect(junkReason(hit("https://pinterestmarketingpros.com", "Pinterest Marketing Pros"))).toBeNull();
    expect(junkReason(hit("https://googleadsagency.com", "Google Ads Agency"))).toBeNull();
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
  it("a bare 'today' or 'yesterday' in marketing copy is not a date: only a posting is (found: a newsletter page dated with the time it was read)", () => {
    for (const t of ["Subscribe today", "Book a call today and grow", "Get started today!", "Join 10,000 marketers today", "Yesterday's tactics won't work"]) expect(parseEvidenceDate(t, read), t).toBeNull();
    expect(parseEvidenceDate("Posted today", read)!.toISOString().slice(0, 10)).toBe("2026-10-08");
    expect(parseEvidenceDate("Published yesterday by Ana", read)!.toISOString().slice(0, 10)).toBe("2026-10-07");
    expect(parseEvidenceDate("Just posted: our PPC practice", read)!.toISOString().slice(0, 10)).toBe("2026-10-08");
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
    expect(readiness({ verified: true, fitVerdict: "strong", findings: [sig, dm], now: NOW })).toMatchObject({ ready: true, missing: [] });
    expect(readiness({ verified: false, fitVerdict: "strong", findings: [sig, dm], now: NOW }).ready).toBe(false);
    expect(readiness({ verified: true, fitVerdict: "weak", findings: [sig, dm], now: NOW }).ready).toBe(false);
    expect(readiness({ verified: true, fitVerdict: "strong", findings: [dm], now: NOW }).missing).toContain(MISSING_REASON);
    expect(readiness({ verified: true, fitVerdict: "strong", findings: [{ ...sig, observedAt: "2023-01-01T00:00:00Z" }, dm], now: NOW }).ready).toBe(false);
    expect(readiness({ verified: true, fitVerdict: "strong", findings: [sig], now: NOW }).ready).toBe(false);
    expect(readiness({ verified: true, fitVerdict: "strong", findings: [sig, dm], doNotContact: true, now: NOW }).ready).toBe(false);
  });
  it("an UNDATED signal still scores but is not a reason to call a prospect outreach-ready (a why-now needs a date)", () => {
    const undated = { ...sig, observedAt: null };
    expect(readiness({ verified: true, fitVerdict: "strong", findings: [undated, dm], now: NOW })).toMatchObject({ ready: false, missing: [MISSING_REASON] });
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

/* ── Phase 2 readiness: tests written before the fixes (relative dates: they never expire) ───────────────── */
const DAY_MS = 86_400_000;
const today = () => new Date();
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS).toISOString();

describe("dates carry their precision, and only an event's own date counts", () => {
  it("a year in a blog title is a YEAR, never a day (found: 'In The US In 2026' became 1 Jan 2026 and made a prospect ready)", () => {
    const year = new Date().getUTCFullYear();
    for (const t of [`Top Automotive Digital Marketing Agencies In The US In ${year}`, `The Best SaaS SEO Tools of ${year}`, `What changed during ${year}`, `Since ${year} we have helped B2B brands`])
      expect(evidenceDate(t, today())?.precision, t).toBe("year");
  });
  it("a month and year is a MONTH; a full date, an ISO date or a stated 'N days ago' is a DAY", () => {
    expect(evidenceDate("Top Lead Generation Agencies - Sep 2026 Rankings", today())).toMatchObject({ precision: "month" });
    expect(evidenceDate("In March 2026 we opened our Austin office", today())).toMatchObject({ precision: "month" });
    expect(evidenceDate("September 14, 2026 — we launched PPC", today())).toMatchObject({ precision: "day" });
    expect(evidenceDate("Posted on 2026-09-30", today())).toMatchObject({ precision: "day" });
    expect(evidenceDate("posted 3 days ago", today())!.at.toISOString().slice(0, 10)).toBe(daysAgo(3).slice(0, 10));
    expect(evidenceDate("posted 3 days ago", today())).toMatchObject({ precision: "day" });
  });
  it("'Subscribe today' is no date; 'published today' and 'announced yesterday' are, relative to now", () => {
    for (const t of ["Subscribe today", "Book a call today and grow", "Get started today!"]) expect(evidenceDate(t, today()), t).toBeNull();
    expect(evidenceDate("Published today", today())).toMatchObject({ precision: "day" });
    expect(evidenceDate("Published today", today())!.at.toISOString().slice(0, 10)).toBe(daysAgo(0).slice(0, 10));
    expect(evidenceDate("Announced yesterday: our new office", today())!.at.toISOString().slice(0, 10)).toBe(daysAgo(1).slice(0, 10));
  });
  it("an update stamp dates an edit, not an event: it is never the evidence date", () => {
    for (const t of ["Updated: March 17th, 2026", "Last updated September 30, 2026", "Last modified 2026-09-30", "Page updated on Oct 1, 2026"]) {
      expect(evidenceDate(t, today()), t).toBeNull();
      expect(parseEvidenceDate(t, today()), t).toBeNull();
    }
    expect(evidenceDate("Published September 30, 2026", today())).toMatchObject({ precision: "day" }); // a publication date is still one
  });
  it("parseEvidenceDate stays the date of evidenceDate (one rule)", () => {
    for (const t of ["Posted on 2026-09-30", "In March 2026 we opened Austin", "Since 2019 we have helped", "We are hiring"])
      expect(parseEvidenceDate(t, today())?.toISOString() ?? null, t).toBe(evidenceDate(t, today())?.at.toISOString() ?? null);
  });
});

describe("revised policy: qualified, ready, strong timing and insufficient evidence are separate", () => {
  const dm = { id: 2, kind: "decision_maker", type: "Founder", value: "Ana Silva, Founder", status: "confirmed" };
  const sig = (type: string, days: number, precision?: string, id = 1) => ({ id, kind: "signal", type, value: `${type} value`, status: "confirmed", observedAt: daysAgo(days), meta: precision ? { datePrecision: precision } : {} });
  const judge = (fs: any[], fitVerdict: string | null = "strong", verified = true) => readiness({ verified, fitVerdict, findings: fs, now: today() });

  it("a qualified company with no recent event: still qualified (not discarded); ready only when a dated reason from the last 12 months exists; never strong timing", () => {
    const none = judge([dm]); // fits, a person to contact, no signal at all
    expect(none).toMatchObject({ ready: false, classification: "qualified", timing: "none", strongTiming: false });
    expect(none.missing).toEqual([MISSING_REASON]);
    const older = judge([sig("HIRING", 200, "day"), dm]); // a real event, 200 days old: a reason to get in touch, not a timing signal
    expect(older).toMatchObject({ ready: true, classification: "ready", timing: "context", strongTiming: false });
    const undated = judge([{ ...sig("HIRING", 5, "day"), observedAt: null, meta: {} }, dm]);
    expect(undated).toMatchObject({ ready: false, classification: "qualified", timing: "undated" });
  });

  it("a generic blog post without corroborating evidence is context only: never strong timing, never a timing claim in the score", () => {
    const blog = judge([sig("CONTENT_ACTIVITY", 2, "day"), dm]);
    expect(blog).toMatchObject({ timing: "context", strongTiming: false });
    expect(blog.ready).toBe(true); // a correctly dated post may support a message as context; it is not urgency
    expect(findingsAsClaims([{ ...sig("CONTENT_ACTIVITY", 2, "day"), sourceUrl: "https://n.com/blog", retrievedAt: today() } as FindingLike], today()).map((c) => c.field)).not.toContain("timing");
    expect(judge([sig("OTHER", 2, "day"), dm]).timing).toBe("context"); // an unclassified statement is not an event either
    // Corroborated by an independent concrete event: that event is the strong timing signal, and the blog post is not chosen over it.
    const both = judge([sig("CONTENT_ACTIVITY", 2, "day", 1), sig("NEW_SERVICE", 20, "day", 3), dm]);
    expect(both).toMatchObject({ timing: "strong", strongTiming: true, ready: true });
    expect(timingOf([sig("CONTENT_ACTIVITY", 2, "day", 1), sig("NEW_SERVICE", 20, "day", 3)] as FindingLike[], today()).best!.id).toBe(3);
  });

  it("a recent concrete event (dated to the day or month, at most 90 days old) is a strong timing signal", () => {
    for (const t of EVENT_SIGNAL_TYPES) expect(judge([sig(t, 10, "day"), dm]), t).toMatchObject({ ready: true, timing: "strong", strongTiming: true });
    expect(judge([sig("HIRING", 80, "month"), dm]).timing).toBe("strong");
    expect(judge([sig("HIRING", 89, "day"), dm]).timing).toBe("strong");
    expect(judge([sig("HIRING", 91, "day"), dm]).timing).toBe("context");
    expect(findingsAsClaims([{ ...sig("HIRING", 20, "day"), sourceUrl: "https://n.com/careers", retrievedAt: today() } as FindingLike], today()).map((c) => c.field)).toContain("timing");
  });

  it("stale, year-only and update-stamped evidence is never described as recent", () => {
    // Over a year old: not a reason, not timing, not scored as timing, and it is labelled with its real date.
    const stale = judge([sig("HIRING", 400, "day"), dm]);
    expect(stale).toMatchObject({ ready: false, classification: "qualified", timing: "stale", strongTiming: false });
    expect(timingOf([sig("HIRING", 400, "day")] as FindingLike[], today()).best).toBeNull();
    expect(findingsAsClaims([{ ...sig("HIRING", 120, "day"), sourceUrl: "https://n.com", retrievedAt: today() } as FindingLike], today()).map((c) => c.field)).not.toContain("timing");
    // A year alone (stored with its date set only so it sorts) is not a date: even this year's never counts as recent.
    expect(judge([sig("HIRING", 10, "year"), dm])).toMatchObject({ ready: false, timing: "undated" });
    expect(signalDating(sig("HIRING", 10, "year"), today())).toMatchObject({ usable: false, precision: "year", days: null });
    expect(dateLabel({ observedAt: null, meta: { datePrecision: "year", dateYear: 2026 } })).toBe("2026 (year only)");
    expect(dateLabel({ observedAt: "2026-09-01T00:00:00.000Z", meta: { datePrecision: "month" } })).toBe("Sep 2026");
    expect(dateLabel({ observedAt: "2026-09-14T00:00:00.000Z", meta: { datePrecision: "day" } })).toBe("14 Sep 2026");
    // An old post whose page was "updated" last week is not dated last week.
    const d = new Date(Date.now() - 7 * DAY_MS).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
    expect(evidenceDate(`Updated: ${d}`, today())).toBeNull();
    expect(evidenceDate(`Published March 3, 2024 · Updated: ${d}`, today())).toMatchObject({ precision: "day" });
    expect(evidenceDate(`Published March 3, 2024 · Updated: ${d}`, today())!.at.toISOString().slice(0, 10)).toBe("2024-03-03");
  });

  it("not a fit, insufficient evidence, qualified and ready never collapse into each other", () => {
    expect(judge([sig("HIRING", 10, "day"), dm], "weak").classification).toBe("not_a_fit");
    expect(judge([sig("HIRING", 10, "day"), dm], "excluded").classification).toBe("not_a_fit");
    expect(judge([sig("HIRING", 10, "day"), dm], "unclear").classification).toBe("insufficient_evidence");
    expect(judge([sig("HIRING", 10, "day"), dm], null).classification).toBe("insufficient_evidence");
    expect(judge([sig("HIRING", 10, "day"), dm], "strong", false).classification).toBe("insufficient_evidence");
    expect(judge([sig("HIRING", 10, "day")], "partial")).toMatchObject({ classification: "qualified", ready: false, strongTiming: true }); // strong timing, but no way in
    expect(judge([sig("HIRING", 10, "day"), dm], "partial")).toMatchObject({ classification: "ready", ready: true });
  });

  it("missing or ambiguous evidence keeps a prospect from ready: no date, inferred, no contact, a weak fit", () => {
    expect(judge([{ ...sig("HIRING", 5, "day"), observedAt: null }, dm]).ready).toBe(false);
    expect(judge([{ ...sig("HIRING", 5, "day"), status: "inferred" }, dm]).ready).toBe(false);
    expect(judge([sig("HIRING", 5, "day")]).ready).toBe(false);
    expect(judge([sig("HIRING", 5, "day"), dm], "weak").ready).toBe(false);
  });

  it("older signals still score as context (not hidden), they just are not timing", () => {
    const old = { ...sig("HIRING", 200, "day"), sourceUrl: "https://n.com", retrievedAt: today() } as FindingLike;
    expect(findingsAsClaims([old], today()).map((c) => c.field)).toContain("hiring");
  });
});

describe("research reads a dedicated team page before a generic about page", () => {
  it("DM-2: /about/meet-our-team or /our-team beats /about (found: two companies' named leaders were on a team page never read)", () => {
    const home = new URL("https://acme.com/");
    expect(pickResearchLinks(["/about", "/about/meet-our-team", "/careers"], home, 4)).toContain("https://acme.com/about/meet-our-team");
    expect(pickResearchLinks(["/about", "/about/meet-our-team", "/careers"], home, 4)).not.toContain("https://acme.com/about");
    expect(pickResearchLinks(["/about", "/our-team"], home, 4)).toEqual(["https://acme.com/our-team"]);
    expect(pickResearchLinks(["/about", "/blog"], home, 4)).toContain("https://acme.com/about"); // no team page: about is still read
  });
});

describe("only a senior decision-maker is one; email and form routes do not depend on seniority", () => {
  const sig = { id: 1, kind: "signal", type: "HIRING", value: "x", status: "confirmed", observedAt: daysAgo(10), meta: { datePrecision: "day" } };
  const person = (id: number, title: string, meta: Record<string, unknown> = {}) => ({ id, kind: "decision_maker", type: title.slice(0, 40), value: `Dana Ortiz, ${title}`, status: "confirmed", meta: { name: "Dana Ortiz", title, ...meta } });
  const fact = (id: number, type: string) => ({ id, kind: "fact", type, value: "v", status: "confirmed", meta: type === "contact_form" ? { detectedBy: "form" } : {} }); // a form the reader confirmed (R1)
  const judge = (...fs: any[]) => readiness({ verified: true, fitVerdict: "strong", findings: [sig, ...fs], now: today() });
  it("a senior person named on the site is a way in and a decision-maker", () => {
    expect(judge(person(2, "Founder & CEO"))).toMatchObject({ ready: true, classification: "ready" });
    expect(isDecisionMaker(person(2, "Head of Growth"))).toBe(true);
  });
  it("a non-senior employee alone is NOT a decision-maker and NOT a way in: the prospect stays qualified, with what is missing", () => {
    const r = judge(person(2, "Growth Marketing Manager"));
    expect(r).toMatchObject({ ready: false, classification: "qualified" });
    expect(r.missing).toEqual([MISSING_CONTACT]);
    expect(isDecisionMaker(person(2, "SEO Director"))).toBe(false);
  });
  it("a business email or a real contact form is a way in whoever the people are", () => {
    expect(judge(person(2, "Content Strategist"), fact(3, "business_email")).ready).toBe(true);
    expect(judge(person(2, "Content Strategist"), fact(3, "contact_form")).ready).toBe(true);
    expect(judge(fact(3, "contact_form")).ready).toBe(true);
    // A provider-verified email on an employee is an email route: it counts, though the employee is still not a decision-maker.
    const withEmail = { ...person(4, "Content Strategist", { email: "dana@acme.com", emailStatus: "verified" }), status: "inferred" };
    expect(judge(withEmail).ready).toBe(true);
    expect(isDecisionMaker(withEmail)).toBe(false);
    expect(judge({ ...withEmail, meta: { ...withEmail.meta, emailStatus: "accept_all" } }).ready).toBe(false); // unverified: no route
    expect(hasVerifiedEmail(withEmail)).toBe(true);
  });
  it("the score counts only senior people as decision-makers; a verified email still counts as an email", () => {
    const fields = (f: any) => findingsAsClaims([{ ...f, sourceUrl: "https://acme.com/team", retrievedAt: today() } as FindingLike], today()).map((c) => c.field);
    expect(fields(person(2, "Managing Partner"))).toEqual(["decision_maker"]);
    expect(fields(person(2, "Growth Strategist"))).toEqual([]);
    expect(fields({ ...person(2, "Growth Strategist", { email: "dana@acme.com", emailStatus: "verified" }) })).toEqual(["business_email"]);
  });
  it("a title stored before this rule is judged by the same rule (read from the stored title, not a saved flag)", () => {
    expect(isDecisionMaker({ kind: "decision_maker", type: "Content Strategist", value: "x", meta: { title: "Content Strategist", senior: true } })).toBe(false);
    expect(isDecisionMaker({ kind: "decision_maker", type: "Founder", value: "x", meta: {} })).toBe(true);
  });
});

describe("R1: a contact form is a way in only when the page reader confirmed a real form on that page", () => {
  const sig = { id: 1, kind: "signal", type: "HIRING", value: "x", status: "confirmed", observedAt: daysAgo(10), meta: { datePrecision: "day" } };
  const form = (meta: Record<string, unknown>, status = "confirmed") => ({ id: 3, kind: "fact", type: "contact_form", value: "https://acme.com/contact", status, meta });
  const judge = (...fs: any[]) => readiness({ verified: true, fitVerdict: "strong", findings: [sig, ...fs], now: today() });
  it("confirmed by the reader (found by code, or reported by the model and then confirmed): a route", () => {
    expect(judge(form({ detectedBy: "form" })).ready).toBe(true);
    expect(judge(form({ formConfirmed: true })).ready).toBe(true);
    expect(isContactFormRoute(form({ formConfirmed: true }))).toBe(true);
  });
  it("a model-reported form with no confirmation (stored before this rule, or the reader found none) is not a route", () => {
    expect(judge(form({})).ready).toBe(false);
    expect(judge(form({}, "confirmed")).missing).toEqual([MISSING_CONTACT]);
    expect(judge(form({ formConfirmed: false }, "inferred")).ready).toBe(false);
    expect(judge(form({ formConfirmed: true }, "inferred")).ready).toBe(false); // never a route unless confirmed
  });
  it("email, verified-email and senior-person routes stand on their own, whatever the form", () => {
    expect(judge(form({ formConfirmed: false }, "inferred"), { id: 4, kind: "fact", type: "business_email", value: "hello@acme.com", status: "confirmed" }).ready).toBe(true);
    expect(judge(form({}), { id: 5, kind: "decision_maker", type: "Founder", value: "Dana Ortiz, Founder", status: "confirmed", meta: { title: "Founder" } }).ready).toBe(true);
    expect(judge(form({}), { id: 6, kind: "decision_maker", type: "Content Strategist", value: "x", status: "inferred", meta: { title: "Content Strategist", email: "d@acme.com", emailStatus: "verified" } }).ready).toBe(true);
  });
  it("the score counts an unconfirmed form as a guess, not as a confirmed way in", () => {
    const claim = (f: any) => findingsAsClaims([{ ...f, sourceUrl: "https://acme.com/contact", retrievedAt: today() } as FindingLike], today())[0];
    expect(claim(form({ detectedBy: "form" }))).toMatchObject({ field: "contact_form", status: "confirmed" });
    expect(claim(form({}))).toMatchObject({ field: "contact_form", status: "inferred" });
  });
});
