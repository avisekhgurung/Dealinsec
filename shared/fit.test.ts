import { describe, expect, it } from "vitest";
import { EMPTY_IDEAL_CLIENT, IDEAL_ABOUT_MAX, IDEAL_ITEM_MAX, MAX_LIST, assessFit, hasCriteria, idealClientInputSchema, textMatches, tidyList, type IdealClient } from "./fit";

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
