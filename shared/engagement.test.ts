import { describe, expect, it } from "vitest";
import {
  DEAL_PRESETS, ENGAGEMENT_MODEL_IDS, ENGAGEMENT_MODELS, SERVICE_GROUPS, dealTypeForService, engagementLabel, isServiceCategory,
  periodsBetween, searchPresets, serviceLabel, suggestDealTitle, suggestedValueMinor, validateEngagement,
} from "./engagement";
import { TAXONOMY } from "./dealTypeTaxonomy";

describe("the catalogue", () => {
  it("has all 55 named deal types as presets, each a known model (and a known service when it names one)", () => {
    expect(DEAL_PRESETS).toHaveLength(55);
    expect(new Set(DEAL_PRESETS.map((p) => p.label)).size).toBe(55);
    for (const p of DEAL_PRESETS) {
      expect(ENGAGEMENT_MODEL_IDS, p.label).toContain(p.model);
      if (p.service) expect(isServiceCategory(p.service), p.label).toBe(true);
    }
  });
  it("offers the 11 engagement models and 9 service groups; ids are unique and every service maps to a real deal-type domain", () => {
    expect(ENGAGEMENT_MODELS.map((m) => m.id)).toEqual([...ENGAGEMENT_MODEL_IDS]);
    expect(SERVICE_GROUPS.map((g) => g.label)).toEqual(["Marketing and SEO", "Advertising and Growth", "Web and Software Development", "AI and Automation", "Design and Creative", "Content and Media", "Consulting and Professional Services", "IT and Technical Services", "Other"]);
    const ids = SERVICE_GROUPS.flatMap((g) => g.services.map((s) => s.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const g of SERVICE_GROUPS) for (const s of g.services) expect(TAXONOMY[s.domain], s.id).toBeTruthy();
  });
  it("maps a service to its deal-type domain; no service (or an unknown one) is Custom", () => {
    expect(dealTypeForService("seo_services")).toBe("Marketing");
    expect(dealTypeForService("web_design_dev")).toBe("Development");
    expect(dealTypeForService("copywriting")).toBe("Writing");
    expect(dealTypeForService(null)).toBe("Custom");
    expect(dealTypeForService("retired_id")).toBe("Custom");
  });
  it("search finds presets by name and by what people type", () => {
    expect(searchPresets("quarterly")[0].label).toBe("Quarterly Retainer");
    expect(searchPresets("seo").map((p) => p.label)).toContain("Recurring SEO Services");
    expect(searchPresets("chatbot")[0].label).toBe("AI Chatbot Development");
    expect(searchPresets("google ads")[0].label).toBe("Paid Advertising / PPC");
    expect(searchPresets("")).toEqual([]);
    expect(searchPresets("zzzz")).toEqual([]);
  });
});

describe("validateEngagement", () => {
  const ok = (r: ReturnType<typeof validateEngagement>) => { if (!r.ok) throw new Error(r.message); return r; };

  it("no model: no details, service still optional; an empty service is none", () => {
    expect(ok(validateEngagement({}))).toMatchObject({ engagementModel: null, serviceCategory: null, engagementTerms: null });
    expect(ok(validateEngagement({ serviceCategory: "seo_services" }))).toMatchObject({ engagementModel: null, serviceCategory: "seo_services" });
    expect(ok(validateEngagement({ engagementModel: "fixed_price", serviceCategory: "" })).serviceCategory).toBeNull();
  });

  it("refuses unknown ids and stray detail fields", () => {
    expect(validateEngagement({ engagementModel: "barter" })).toMatchObject({ ok: false, field: "engagementModel" });
    expect(validateEngagement({ serviceCategory: "astrology" })).toMatchObject({ ok: false, field: "serviceCategory" });
    expect(validateEngagement({ engagementModel: "custom", engagementTerms: { hack: 1 } })).toMatchObject({ ok: false });
  });

  it("each model asks for its own essentials", () => {
    expect(validateEngagement({ engagementModel: "retainer", engagementTerms: { billingFrequency: "monthly" } })).toMatchObject({ ok: false, field: "recurringAmountMinor" });
    expect(validateEngagement({ engagementModel: "hourly", engagementTerms: {} })).toMatchObject({ ok: false, field: "hourlyRateMinor" });
    expect(validateEngagement({ engagementModel: "milestone", engagementTerms: {} })).toMatchObject({ ok: false, field: "milestones" });
    expect(validateEngagement({ engagementModel: "commission", engagementTerms: { commissionKind: "percent", commissionPercent: 10 } })).toMatchObject({ ok: false, field: "calculationBasis" });
    expect(validateEngagement({ engagementModel: "usage_based", engagementTerms: { unitLabel: "lead", unitPriceMinor: 5000 } })).toMatchObject({ ok: false, field: "billingFrequency" });
    expect(validateEngagement({ engagementModel: "consulting", engagementTerms: { consultingBilling: "hourly" } })).toMatchObject({ ok: false, field: "hourlyRateMinor" });
    for (const m of ["fixed_price", "one_time", "custom"]) expect(validateEngagement({ engagementModel: m }).ok, m).toBe(true);
  });

  it("milestones must add up to the project total (and never exceed a fixed price)", () => {
    const ms = [{ title: "Design", amountMinor: 40_000 }, { title: "Build", amountMinor: 60_000 }];
    expect(ok(validateEngagement({ engagementModel: "milestone", engagementTerms: { milestones: ms }, dealAmountMinor: 100_000 })).engagementTerms?.milestones).toHaveLength(2);
    expect(validateEngagement({ engagementModel: "milestone", engagementTerms: { milestones: ms }, dealAmountMinor: 90_000 })).toMatchObject({ ok: false, field: "milestones" });
    expect(validateEngagement({ engagementModel: "fixed_price", engagementTerms: { milestones: ms }, dealAmountMinor: 90_000 })).toMatchObject({ ok: false });
    expect(ok(validateEngagement({ engagementModel: "fixed_price", engagementTerms: { milestones: ms }, dealAmountMinor: 120_000 })).engagementTerms?.milestones).toHaveLength(2);
  });

  it("keeps only the chosen model's details (switching models leaves nothing stale)", () => {
    const r = ok(validateEngagement({ engagementModel: "one_time", engagementTerms: { paymentDueDate: "2026-11-01", hourlyRateMinor: 5000, milestones: [] } }));
    expect(r.engagementTerms).toEqual({ paymentDueDate: "2026-11-01" });
    const c = ok(validateEngagement({ engagementModel: "commission", engagementTerms: { commissionKind: "percent", commissionPercent: 12.5, commissionAmountMinor: 999, calculationBasis: "Closed revenue" } }));
    expect(c.engagementTerms).toEqual({ commissionKind: "percent", commissionPercent: 12.5, calculationBasis: "Closed revenue" });
    const f = ok(validateEngagement({ engagementModel: "consulting", engagementTerms: { consultingBilling: "fixed", hourlyRateMinor: 5000 } }));
    expect(f.engagementTerms).toEqual({ consultingBilling: "fixed" });
  });
});

describe("helpers", () => {
  it("counts billing periods in an inclusive term", () => {
    expect(periodsBetween("2026-01-15", "2026-02-14", "monthly")).toBe(1);
    expect(periodsBetween("2026-01-01", "2026-03-31", "monthly")).toBe(3);
    expect(periodsBetween("2026-01-01", "2026-12-31", "quarterly")).toBe(4);
    expect(periodsBetween("2026-01-01", "2026-12-31", "annually")).toBe(1);
    expect(periodsBetween("2026-01-01", "2026-01-14", "weekly")).toBe(2);
    expect(periodsBetween("2026-03-01", "2026-01-01", "monthly")).toBeNull();
  });
  it("suggests a value from the details, never from nothing", () => {
    expect(suggestedValueMinor("retainer", { billingFrequency: "monthly", recurringAmountMinor: 50_000 }, { start: "2026-01-01", end: "2026-06-30" })).toBe(300_000);
    expect(suggestedValueMinor("retainer", { billingFrequency: "monthly", recurringAmountMinor: 50_000 })).toBeNull();
    expect(suggestedValueMinor("hourly", { hourlyRateMinor: 7_500, estimatedHours: 20 })).toBe(150_000);
    expect(suggestedValueMinor("usage_based", { unitPriceMinor: 2_500, estimatedUsage: 40 })).toBe(100_000);
    expect(suggestedValueMinor("fixed_price", {})).toBeNull();
    expect(suggestedValueMinor(null, {})).toBeNull();
  });
  it("labels a deal's model as it's used, and reads unknown ids as unrecognised (never guessed)", () => {
    expect(engagementLabel("retainer", { billingFrequency: "quarterly" })).toBe("Quarterly Retainer");
    expect(engagementLabel("retainer", { billingFrequency: "monthly" })).toBe("Monthly Retainer");
    expect(engagementLabel(null)).toBeNull();
    expect(engagementLabel("future_model")).toBe("Unrecognised engagement model");
    expect(serviceLabel("future_service")).toBe("Unrecognised service");
  });
  it("suggests a deal name like \"Acme — Monthly SEO Retainer\"", () => {
    expect(suggestDealTitle("Acme", "retainer", "seo_services", { billingFrequency: "monthly" })).toBe("Acme — Monthly SEO Retainer");
    expect(suggestDealTitle("Acme", "fixed_price", "web_design_dev")).toBe("Acme — Website Design and Development");
    expect(suggestDealTitle("Acme", "hourly", null)).toBe("Acme — Hourly Engagement");
    expect(suggestDealTitle("", "custom", null)).toBe("");
  });
});
