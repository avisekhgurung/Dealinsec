import { describe, expect, it } from "vitest";
import { SEGMENTS, SEGMENT_LABEL, SEGMENT_PRESETS, offerLine, opportunityPhrasings } from "./opportunity-queries";
import { icpSchema, searchStrategies } from "./icp";
import { sanitizeQuery } from "./discovery";

describe("opportunity phrasings", () => {
  it("no services = no phrasings, whatever else is set", () => {
    expect(opportunityPhrasings({}, "India")).toEqual([]);
    expect(opportunityPhrasings({ services: [], segment: "agencies" }, "India")).toEqual([]);
    expect(opportunityPhrasings({ services: ["  "], segment: "saas" }, "")).toEqual([]);
  });
  it("without a segment: plain freelancer asks, the place appended only when there is one", () => {
    expect(opportunityPhrasings({ services: ["web development"] }, "India")).toEqual(["looking for freelance web development India", "hire web development freelancer India"]);
    expect(opportunityPhrasings({ services: ["web development"] }, "")).toEqual(["looking for freelance web development", "hire web development freelancer"]);
  });
  it("each segment speaks its own language, for every service", () => {
    expect(opportunityPhrasings({ services: ["web development"], segment: "agencies" }, "")).toEqual(["agency looking for freelance web development", "white label web development partner for agencies"]);
    expect(opportunityPhrasings({ services: ["automation"], segment: "saas" }, "")[0]).toBe("startup looking for freelance automation");
    expect(opportunityPhrasings({ services: ["SEO"], segment: "ecommerce" }, "")[0]).toBe("online store looking for SEO help");
    expect(opportunityPhrasings({ services: ["CRM setup"], segment: "consultants" }, "")[0]).toBe("consultant looking for CRM setup help");
    expect(opportunityPhrasings({ services: ["web design"], segment: "local" }, "")[0]).toBe("small business looking for web design");
    const two = opportunityPhrasings({ services: ["web development", "AI automation"], segment: "agencies" }, "");
    expect(two).toHaveLength(4);
    expect(two[2]).toBe("agency looking for freelance AI automation");
  });
  it("at most three services are searched, and every phrasing passes the query checks", () => {
    const many = opportunityPhrasings({ services: ["a11y audits", "web dev", "SEO", "copywriting", "ads"] }, "United States");
    expect(many).toHaveLength(6);
    for (const q of many) expect(sanitizeQuery(q).ok, q).toBe(true);
  });
});

describe("searchStrategies with services (the interleave)", () => {
  const base = { industry: "digital agency", countries: ["US"] };
  it("alternates company phrasings with opportunity phrasings, dedupes by meaning and stays within the budget", () => {
    const qs = searchStrategies(icpSchema.parse({ ...base, services: ["web development"], segment: "agencies" }));
    expect(qs[0]).toBe("digital agency United States");            // the company phrasing still leads
    expect(qs[1]).toBe("agency looking for freelance web development United States"); // then the opportunity ask
    expect(qs.length).toBeLessThanOrEqual(8);
    expect(new Set(qs).size).toBe(qs.length);
  });
  it("services without a segment still plan opportunity searches", () => {
    const qs = searchStrategies(icpSchema.parse({ ...base, services: ["web development"] }));
    expect(qs).toContain("looking for freelance web development United States");
  });
  it("every planned query passes sanitizeQuery", () => {
    const qs = searchStrategies(icpSchema.parse({ ...base, services: ["web development", "AI automation"], segment: "saas", targetMarket: ["SaaS companies"], locations: ["Austin"] }));
    for (const q of qs) expect(sanitizeQuery(q).ok, q).toBe(true);
  });
});

describe("segment presets", () => {
  it("there is one preset per segment and each builds a valid ICP", () => {
    expect(SEGMENT_PRESETS.map((p) => p.segment).sort()).toEqual([...SEGMENTS].sort());
    for (const p of SEGMENT_PRESETS) {
      const r = icpSchema.safeParse({ industry: p.industry, keywords: p.keywords, targetMarket: p.targetMarket, employeeMax: p.employeeMax, segment: p.segment, services: ["web development"] });
      expect(r.success, p.segment).toBe(true);
      expect(SEGMENT_LABEL[p.segment]).toBe(p.label);
    }
  });
  it("the size cap is small everywhere — exclude-when-known-bigger country, solo-first", () => {
    for (const p of SEGMENT_PRESETS) expect(p.employeeMax).toBeLessThanOrEqual(20);
    expect(SEGMENT_PRESETS.find((p) => p.segment === "saas")!.employeeMax).toBe(5);
  });
});

describe("the 'Searching as' line", () => {
  it("services + segment, services alone, segment alone, nothing", () => {
    expect(offerLine({ services: ["web development", "AI automation"], segment: "agencies" })).toBe("web development + AI automation → Small agencies");
    expect(offerLine({ services: ["web development"] })).toBe("web development");
    expect(offerLine({ segment: "local" })).toBe("Local businesses");
    expect(offerLine({})).toBe("");
  });
});
