import { describe, expect, it } from "vitest";
import {
  AUDIENCES,
  BRAND_TERM_LIMITS,
  DEFAULT_AUDIENCE,
  audienceForDealType,
  audienceLabels,
  brandTermsForDeal,
  brandTermsSchema,
  defaultExclusive,
  dealAudienceLabels,
  isAudience,
  normalizeAudience,
  normalizeBrandTerms,
  pickerDealTypes,
} from "./audience";
import {
  brandDealTypeOptions,
  dealTypeOptions,
  getAgreementCopy,
  getDeliverableLabels,
  legacyDealTypeOptions,
} from "./dealTypeTaxonomy";

describe("audience values", () => {
  it("has exactly the two audiences, client work by default", () => {
    expect([...AUDIENCES]).toEqual(["client_work", "brand_collaboration"]);
    expect(DEFAULT_AUDIENCE).toBe("client_work");
  });

  it("treats anything unrecognised as client work, so existing accounts are unchanged", () => {
    for (const v of [null, undefined, "", "creator", "BRAND_COLLABORATION", 3, {}]) {
      expect(isAudience(v)).toBe(false);
      expect(normalizeAudience(v)).toBe("client_work");
    }
    expect(normalizeAudience("brand_collaboration")).toBe("brand_collaboration");
  });
});

describe("a deal's audience follows its deal type", () => {
  it("brand collaboration and the retired Creator type are brand deals", () => {
    expect(audienceForDealType("Brand Collaboration")).toBe("brand_collaboration");
    expect(audienceForDealType("Creator")).toBe("brand_collaboration");
  });

  it("every client-work and other legacy type stays client work", () => {
    for (const t of [...dealTypeOptions, ...legacyDealTypeOptions.filter((x) => x !== "Creator")]) {
      expect(audienceForDealType(t), t).toBe("client_work");
    }
    expect(audienceForDealType(null)).toBe("client_work");
    expect(audienceForDealType(undefined)).toBe("client_work");
    expect(audienceForDealType("Something else")).toBe("client_work");
  });
});

describe("the new-deal picker", () => {
  it("leaves the client-work list exactly as it was", () => {
    expect(pickerDealTypes("client_work")).toBe(dealTypeOptions);
    expect([...dealTypeOptions]).toEqual([
      "Design", "Development", "Writing", "Marketing", "Video & Photo", "Consulting", "Custom",
    ]);
  });

  it("offers the brand type first for brand accounts, keeping the rest available", () => {
    const list = pickerDealTypes("brand_collaboration");
    expect(list[0]).toBe("Brand Collaboration");
    expect(list.slice(1)).toEqual([...dealTypeOptions]);
  });

  it("keeps the brand type out of the shared client-work list", () => {
    expect((dealTypeOptions as readonly string[]).includes("Brand Collaboration")).toBe(false);
    expect([...brandDealTypeOptions]).toEqual(["Brand Collaboration"]);
  });
});

describe("audience labels", () => {
  it("uses client wording for client work", () => {
    const l = audienceLabels("client_work");
    expect(l.party).toBe("Client");
    expect(l.dealNoun).toBe("client deal");
    expect(l.project).toBe("Project");
    expect(l.payment).toBe("Client payment");
    expect(l.newDealCta).toBe("Create a client deal");
    expect(l.emptyState).toBe("Start with a client conversation, project request, or scope of work.");
  });

  it("uses brand wording for brand collaborations", () => {
    const l = audienceLabels("brand_collaboration");
    expect(l.party).toBe("Brand");
    expect(l.dealNoun).toBe("brand deal");
    expect(l.project).toBe("Campaign");
    expect(l.payment).toBe("Brand payment");
    expect(l.newDealCta).toBe("Create a brand deal");
    expect(l.emptyState).toBe("Start with a brand offer, campaign brief, or collaboration message.");
  });

  it("falls back to client wording for a missing audience", () => {
    expect(audienceLabels(null)).toBe(audienceLabels("client_work"));
    expect(audienceLabels(undefined).party).toBe("Client");
  });

  it("labels a deal by its type, not the account", () => {
    expect(dealAudienceLabels("Brand Collaboration").party).toBe("Brand");
    expect(dealAudienceLabels("Design").party).toBe("Client");
  });
});

describe("the Brand Collaboration deal type", () => {
  it("has brand labels and the creator platform and content-type fields", () => {
    expect(getDeliverableLabels("Brand Collaboration")).toEqual({
      category: "Platform",
      type: "Content Type",
      who: "Brand Name",
    });
  });

  it("has its own agreement wording without the legacy platform-registration line", () => {
    const c = getAgreementCopy("Brand Collaboration");
    expect(c.title).toBe("Agreement");
    expect(c.providerNoun).toBe("Creator");
    expect(c.clientNoun).toBe("Brand");
    expect(c.exclusiveText).not.toMatch(/Dealinsec platform/i);
  });

  it("claims no legal outcome in its default wording", () => {
    const c = getAgreementCopy("Brand Collaboration");
    const all = [c.rightsText, c.exclusiveText, c.nonExclusiveText, c.complianceNote].join(" ");
    expect(all).not.toMatch(/\b(legally binding|guarantee|guaranteed|lawyer)\b/i);
  });

  it("leaves the retired Creator wording exactly as signed agreements were rendered", () => {
    const c = getAgreementCopy("Creator");
    expect(c.title).toBe("Influencer Marketing Agreement");
    expect(c.rightsText).toContain("for 12 months following the Agreement expiry");
    expect(c.exclusiveText).toContain("All brand deals during this period must be registered on the Dealinsec platform.");
  });
});

describe("brand terms", () => {
  it("drops blank fields, trims, and returns null when nothing is stated", () => {
    expect(normalizeBrandTerms({ campaign: "  ", usageRights: "" })).toBeNull();
    expect(normalizeBrandTerms({ campaign: "  Summer launch  " })).toEqual({ campaign: "Summer launch" });
    expect(normalizeBrandTerms(null)).toBeNull();
    expect(normalizeBrandTerms("text")).toBeNull();
    expect(normalizeBrandTerms([])).toBeNull();
  });

  it("discards unknown keys and non-string values", () => {
    expect(normalizeBrandTerms({ usageDuration: "6 months", secret: "x", approval: 5 })).toEqual({
      usageDuration: "6 months",
    });
  });

  it("caps every field at its limit", () => {
    const long = "x".repeat(2000);
    const out = normalizeBrandTerms({ campaign: long, usageRights: long })!;
    expect(out.campaign).toHaveLength(BRAND_TERM_LIMITS.campaign);
    expect(out.usageRights).toHaveLength(BRAND_TERM_LIMITS.usageRights);
  });

  it("rejects an over-long value at the schema instead of truncating it silently", () => {
    expect(brandTermsSchema.safeParse({ campaign: "x".repeat(BRAND_TERM_LIMITS.campaign + 1) }).success).toBe(false);
    expect(brandTermsSchema.safeParse({ campaign: "ok" }).success).toBe(true);
    expect(brandTermsSchema.safeParse({}).success).toBe(true);
  });

  it("treats an AI or form placeholder as not stated, so it can never count as a real term", () => {
    for (const v of ["Not specified", "not specified.", "Unknown", "N/A", "n/a", "TBD", "Not stated", "-", "Unspecified"]) {
      expect(normalizeBrandTerms({ usageRights: v }), v).toBeNull();
    }
    // A real answer that merely starts with the same words is kept.
    expect(normalizeBrandTerms({ usageRights: "Not specified in the brief, organic only" })).toEqual({
      usageRights: "Not specified in the brief, organic only",
    });
  });

  it("is stored only on brand deals", () => {
    const terms = { usageRights: "Organic posts only" };
    expect(brandTermsForDeal("Brand Collaboration", terms)).toEqual(terms);
    expect(brandTermsForDeal("Creator", terms)).toEqual(terms);
    expect(brandTermsForDeal("Design", terms)).toBeNull();
    expect(brandTermsForDeal(undefined, terms)).toBeNull();
  });
});


describe("defaultExclusive", () => {
  it("keeps the long-standing default (exclusive) for every deal type but Brand Collaboration", () => {
    for (const t of ["Design", "Development", "Writing", "Custom", "Creator", "Freelance", null, undefined]) {
      expect(defaultExclusive(t, null), String(t)).toBe(true);
      expect(defaultExclusive(t, { exclusivity: "None" }), String(t)).toBe(true);
    }
  });

  it("makes a brand collaboration exclusive only when an exclusivity term is stated", () => {
    expect(defaultExclusive("Brand Collaboration", null)).toBe(false);
    expect(defaultExclusive("Brand Collaboration", {})).toBe(false);
    expect(defaultExclusive("Brand Collaboration", { exclusivity: "No other skincare brands for 30 days" })).toBe(true);
  });

  it("reads 'no exclusivity' as not exclusive", () => {
    for (const v of ["No exclusivity", "None", "Non-exclusive", "not required", "no"]) {
      expect(defaultExclusive("Brand Collaboration", { exclusivity: v }), v).toBe(false);
    }
  });

  it("does not treat a placeholder as a stated exclusivity", () => {
    expect(defaultExclusive("Brand Collaboration", { exclusivity: "Not specified" })).toBe(false);
  });
});
