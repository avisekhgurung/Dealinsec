import { describe, expect, it } from "vitest";
import { EMPTY_IDEAL_CLIENT, IDEAL_ABOUT_MAX, IDEAL_ITEM_MAX, MAX_LIST, assessFit, exclusionHits, hasCriteria, idealClientInputSchema, sizeSignal, textMatches, tidyList, type IdealClient } from "./fit";

const P = (over: Partial<IdealClient> = {}): IdealClient => ({ ...EMPTY_IDEAL_CLIENT, targetIndustries: ["logistics", "e-commerce"], targetLocations: ["India"], minDealMinor: 5_000_000, currency: "INR", ...over });
const money = (m: number, c: string) => `${c} ${m / 100}`;

describe("textMatches", () => {
  it("matches containment either way and shared whole words, not fragments", () => {
    expect(textMatches("logistics", "Freight & Logistics")).toBe(true);
    expect(textMatches("Freight and Logistics services", "logistics")).toBe(true);
    expect(textMatches("e-commerce", "Retail E-Commerce")).toBe(true);
    expect(textMatches("health", "Healthcare")).toBe(true);
    expect(textMatches("india", "Pune, India")).toBe(true);
    expect(textMatches("art", "Smart cities")).toBe(true); // 3+ letter containment is allowed; documented limit
    expect(textMatches("law", "Biotech")).toBe(false);
    expect(textMatches("", "x")).toBe(false);
  });
});

describe("assessFit", () => {
  it("no criteria -> says to set them, and nothing is judged", () => {
    expect(hasCriteria(EMPTY_IDEAL_CLIENT)).toBe(false);
    expect(assessFit(EMPTY_IDEAL_CLIENT, { companyName: "X" }).verdict).toBe("no_profile");
    expect(assessFit(null, { companyName: "X" }).verdict).toBe("no_profile");
  });
  it("strong: every checkable signal matches, each with its basis", () => {
    const r = assessFit(P(), { companyName: "Northwind", industry: "Freight & Logistics", location: "Pune, India", estValueMinor: 6_000_000, currency: "INR" }, money);
    expect(r.verdict).toBe("strong");
    expect(r.signals.map((s) => s.status)).toEqual(["match", "match", "match"]);
    expect(r.signals[0].detail).toContain('matches your target "logistics"');
    expect(r.signals[2].detail).toBe("Estimated INR 60000 meets your minimum of INR 50000.");
  });
  it("a missing field is UNKNOWN, never a mismatch, and the result says what to add", () => {
    const r = assessFit(P(), { companyName: "Orchid", industry: "Logistics" }, money);
    expect(r.signals.map((s) => [s.key, s.status])).toEqual([["industry", "match"], ["location", "unknown"], ["value", "unknown"]]);
    expect(r.verdict).toBe("partial");
    expect(r.missing).toEqual(["a location", "an estimated value"]);
  });
  it("two matches with something still unknown is partial, never strong", () => {
    const r = assessFit(P(), { companyName: "A", industry: "Logistics", location: "Pune, India" }, money);
    expect(r.signals.map((x) => x.status)).toEqual(["match", "match", "unknown"]);
    expect(r.verdict).toBe("partial");
    expect(r.headline).toContain("2 things so far");
  });
  it("weak when it checks and fails; partial when mixed", () => {
    expect(assessFit(P(), { companyName: "A", industry: "Biotech", location: "Germany", estValueMinor: 100_000, currency: "INR" }, money).verdict).toBe("weak");
    const mixed = assessFit(P(), { companyName: "A", industry: "Logistics", location: "Germany" }, money);
    expect(mixed.verdict).toBe("partial");
    expect(mixed.signals.find((s) => s.key === "location")!.status).toBe("mismatch");
  });
  it("a value in another currency is not compared (and says so)", () => {
    const r = assessFit(P(), { companyName: "A", industry: "Logistics", estValueMinor: 900_000_000, currency: "USD" }, money);
    const v = r.signals.find((s) => s.key === "value")!;
    expect(v.status).toBe("unknown");
    expect(v.detail).toContain("USD");
  });
  it("an exclusion wins over everything else, and names what hit it", () => {
    const r = assessFit(P({ exclusions: ["gambling"] }), { companyName: "Lucky Spin", industry: "Online Gambling", location: "India", estValueMinor: 9_000_000, currency: "INR" }, money);
    expect(r.verdict).toBe("excluded");
    expect(r.excludedBy).toEqual(["gambling"]);
  });
  it("an exclusion does not fire on an unrelated lead", () => {
    expect(assessFit(P({ exclusions: ["gambling"] }), { companyName: "Northwind", industry: "Logistics", location: "India" }, money).verdict).not.toBe("excluded");
  });
  it("an exclusion is an exact phrase: a shared word does not exclude", () => {
    const p = P({ exclusions: ["online gambling"] });
    expect(assessFit(p, { companyName: "ShopNow", industry: "Online retail", location: "India" }, money).verdict).not.toBe("excluded");
    expect(assessFit(p, { companyName: "Lucky", industry: "Online gambling", location: "India" }, money).verdict).toBe("excluded");
    expect(assessFit(P({ exclusions: ["gambling"] }), { companyName: "Lucky", fitSummary: "runs an online gambling site" }, money).verdict).toBe("excluded");
  });
  it("only an exclusion set: nothing to compare means unclear, not fit", () => {
    const r = assessFit({ ...EMPTY_IDEAL_CLIENT, exclusions: ["gambling"] }, { companyName: "Northwind", industry: "Logistics" }, money);
    expect(r.verdict).toBe("unclear");
  });
  it("one match with the rest unknown is partial, never 'strong'", () => {
    const r = assessFit(P({ minDealMinor: null, currency: null }), { companyName: "A", industry: "Logistics" }, money);
    expect(r.verdict).toBe("partial");
  });
});

describe("input schema", () => {
  it("trims, de-duplicates and caps the lists", () => {
    const r = idealClientInputSchema.parse({ targetIndustries: [" Logistics ", "logistics", "Logistics", "Retail"], minDealMajor: 50000 });
    expect(r.targetIndustries).toEqual(["Logistics", "Retail"]); // the same word in another case is the same industry
    // More than the list holds is cut to MAX_LIST, never refused.
    expect(idealClientInputSchema.parse({ services: Array.from({ length: MAX_LIST + 5 }, (_, i) => `s${i}`) }).services).toHaveLength(MAX_LIST);
    expect(idealClientInputSchema.safeParse({ minDealMajor: -1 }).success).toBe(false);
    expect(idealClientInputSchema.safeParse({ about: "x".repeat(601) }).success).toBe(true); // a long description is kept, not refused
  });
});

describe("the ideal client takes whatever a person types or pastes", () => {
  it("a column of lines pasted into a one-line box (line breaks turned into double spaces) is read as the list it was", () => {
    // Exactly what was refused on the live site with "String must contain at most 60 character(s)".
    const pasted = "Custom AI applications and LLM integrations  AI agents and AI assistants  Workflow automation for agencies  Custom web applications";
    expect(idealClientInputSchema.parse({ services: [pasted] }).services).toEqual(["Custom AI applications and LLM integrations", "AI agents and AI assistants", "Workflow automation for agencies", "Custom web applications"]);
    expect(idealClientInputSchema.parse({ exclusions: ["Clients expecting free development or unpaid trials  Clients with no budget"] }).exclusions).toEqual(["Clients expecting free development or unpaid trials", "Clients with no budget"]);
  });
  it("splits on commas, semicolons, lines and bullets, drops a leading dash, and leaves a dash inside a phrase alone", () => {
    expect(tidyList("SEO, Paid ads; Web design\n- Shopify builds\n• Email marketing\n* B2B SaaS - mid-market", 30)).toEqual(["SEO", "Paid ads", "Web design", "Shopify builds", "Email marketing", "B2B SaaS - mid-market"]);
    expect(tidyList(["United States, United Kingdom", "Canada", " canada "], 30)).toEqual(["United States", "United Kingdom", "Canada"]);
    expect(tidyList("", 30)).toEqual([]);
    expect(tidyList([null, 5, "  ", "ok"], 30)).toEqual(["ok"]);
  });
  it("nothing is refused for being long: one long entry is kept (cut at the limit), a long description too", () => {
    const sentence = "We build custom web applications, AI-powered products".repeat(1).replace(",", "") + " " + "x".repeat(400);
    const r = idealClientInputSchema.safeParse({ about: "a".repeat(IDEAL_ABOUT_MAX + 500), services: [sentence], targetIndustries: ["y".repeat(1000)] });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.about).toHaveLength(IDEAL_ABOUT_MAX);
    expect(r.data.services![0]).toHaveLength(IDEAL_ITEM_MAX);
    expect(r.data.targetIndustries![0]).toHaveLength(IDEAL_ITEM_MAX);
  });
  it("a whole field sent as one string, not a list, is read the same way; a field left out stays left out", () => {
    const r = idealClientInputSchema.parse({ services: "SEO, Paid ads" });
    expect(r.services).toEqual(["SEO", "Paid ads"]);
    expect("targetIndustries" in r).toBe(false);
    expect(idealClientInputSchema.parse({ services: [] }).services).toEqual([]);
  });
  it("still refuses what was never a length problem: a negative minimum deal", () => {
    expect(idealClientInputSchema.safeParse({ minDealMajor: -1 }).success).toBe(false);
  });
});

describe("company size: compared only with what a company says about itself", () => {
  const SMALL = (over: Partial<IdealClient> = {}): IdealClient => ({ ...EMPTY_IDEAL_CLIENT, minEmployees: 1, maxEmployees: 10, ...over });

  it("a stated headcount inside the range matches, outside it mismatches, and none is unknown", () => {
    const of = (employees: string | null) => assessFit(SMALL(), { companyName: "X", employees }).signals.find((x) => x.key === "size")!;
    expect(of("a team of 8")).toMatchObject({ status: "match" });
    expect(of("11-50 employees")).toMatchObject({ status: "mismatch" });
    expect(of("over 400 employees")).toMatchObject({ status: "mismatch" });
    expect(of(null)).toMatchObject({ status: "unknown" });
    expect(of("we are a growing team")).toMatchObject({ status: "unknown" }); // words with no number say nothing
  });

  it("a range that straddles the wanted size is a match, not a mismatch: it may be either", () => {
    expect(sizeSignal(1, 10, "5-20 people")).toMatchObject({ status: "match" });
  });

  it("the headcount comes from the team_size fact when it isn't passed directly", () => {
    const r = assessFit(SMALL(), { companyName: "X", claims: [{ field: "team_size", value: "400+ employees" }] });
    expect(r.signals.find((x) => x.key === "size")).toMatchObject({ status: "mismatch" });
    expect(r.verdict).toBe("weak"); // nothing else was set to match on
  });

  it("no size set means no size signal at all, and an unknown size is listed as missing, never as a mismatch", () => {
    expect(assessFit({ ...EMPTY_IDEAL_CLIENT, targetIndustries: ["retail"] }, { companyName: "X", employees: "4000 staff" }).signals.find((x) => x.key === "size")).toBeUndefined();
    const r = assessFit(SMALL(), { companyName: "X" });
    expect(r.missing).toContain("how many people it has");
    expect(r.verdict).not.toBe("weak");
  });

  it("a size on its own is criteria enough to compare against", () => {
    expect(hasCriteria({ ...EMPTY_IDEAL_CLIENT, maxEmployees: 10 })).toBe(true);
    expect(hasCriteria({ ...EMPTY_IDEAL_CLIENT, minEmployees: 50 })).toBe(true);
  });

  it("the form refuses a smallest bigger than the largest, and takes either end on its own", () => {
    expect(idealClientInputSchema.safeParse({ minEmployees: 50, maxEmployees: 10 }).success).toBe(false);
    expect(idealClientInputSchema.safeParse({ maxEmployees: 10 }).success).toBe(true);
    expect(idealClientInputSchema.safeParse({ minEmployees: 2 }).success).toBe(true);
    expect(idealClientInputSchema.safeParse({ maxEmployees: 0 }).success).toBe(false);
    expect(idealClientInputSchema.safeParse({ maxEmployees: 2.5 }).success).toBe(false);
    expect(idealClientInputSchema.parse({ maxEmployees: null }).maxEmployees).toBeNull();
  });
});

describe("exclusions: hit on the company's own words, never on a guess", () => {
  it("a whole phrase hits, and a phrase inside another word does not", () => {
    expect(exclusionHits(["online gambling"], "online gambling operator").hits).toEqual(["online gambling"]);
    expect(exclusionHits(["online gambling"], "online retail and homeware").hits).toEqual([]);
  });

  it("a short exclusion hits when its words are reordered or split up", () => {
    expect(exclusionHits(["bulk spam email"], "we send bulk email, including spam campaigns").hits).toEqual(["bulk spam email"]);
  });

  it("one common word is never enough on its own", () => {
    expect(exclusionHits(["enterprise"], "we build software").hits).toEqual([]);
    expect(exclusionHits(["students"], "we work with student unions").hits).toEqual([]); // "students" is not "student"
  });

  it("an exclusion written as a sentence is reported as not compared, never guessed at", () => {
    const wordy = "large enterprises requiring complex enterprise procurement or custom integrations";
    const r = exclusionHits([wordy, "gambling"], "a large marketing enterprise with 400 employees");
    expect(r.hits).toEqual([]);
    expect(r.notCompared).toEqual([wordy]);
    const fit = assessFit({ ...EMPTY_IDEAL_CLIENT, exclusions: [wordy], targetIndustries: ["marketing"] }, { companyName: "Big Co", industry: "Marketing" });
    expect(fit.verdict).not.toBe("excluded");
    expect(fit.exclusionsNotCompared).toEqual([wordy]);
  });

  it("the facts recorded about a company are its own words too", () => {
    const r = assessFit({ ...EMPTY_IDEAL_CLIENT, exclusions: ["tobacco"] }, { companyName: "Ridge Co", industry: "Retail", claims: [{ field: "description", value: "Distributes tobacco across three states" }] });
    expect(r.verdict).toBe("excluded");
    expect(r.excludedBy).toEqual(["tobacco"]);
  });

  it("nothing is reported as uncomparable when every exclusion could be compared", () => {
    expect(assessFit({ ...EMPTY_IDEAL_CLIENT, exclusions: ["gambling"] }, { companyName: "X", industry: "Retail" }).exclusionsNotCompared).toBeUndefined();
  });
});
