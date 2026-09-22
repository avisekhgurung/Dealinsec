import { describe, expect, it } from "vitest";
import { buildAgreementClauses, legalCountryName } from "./agreementClauses";

const base = {
  dealType: "Development",
  exclusive: true,
  dealTitle: "Website Redesign",
  amountLabel: "$5,000",
  amountWordsLabel: "five thousand US Dollars",
  startDateLabel: "23 Sep 2026",
  endDateLabel: "23 Oct 2026",
  hasOwnPaymentTerms: false,
};

describe("buildAgreementClauses", () => {
  it("produces exactly six numbered clauses", () => {
    const clauses = buildAgreementClauses({ ...base, country: "IN" });
    expect(clauses.map((c) => c.n)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("clause 1 names the deal title and clause 2 the dates", () => {
    const [c1, c2] = buildAgreementClauses({ ...base, country: "US" });
    expect(c1.body).toContain('"Website Redesign"');
    expect(c2.body).toContain("**23 Sep 2026**");
    expect(c2.body).toContain("**23 Oct 2026**");
  });

  it("clause 3 states the default payment schedule only when there are no deal-specific terms", () => {
    const withDefault = buildAgreementClauses({ ...base, country: "US", hasOwnPaymentTerms: false })[2];
    expect(withDefault.body).toContain("50% advance upon execution");
    const withOwn = buildAgreementClauses({ ...base, country: "US", hasOwnPaymentTerms: true })[2];
    expect(withOwn.body).toContain("Deal-Specific Terms (Section 7)");
    expect(withOwn.body).not.toContain("50% advance upon execution");
  });

  it("clause 5 switches on exclusivity", () => {
    const excl = buildAgreementClauses({ ...base, country: "US", exclusive: true })[4];
    const nonExcl = buildAgreementClauses({ ...base, country: "US", exclusive: false })[4];
    expect(excl.body).not.toBe(nonExcl.body);
  });

  it("clause 6 cites the Indian Contract Act only for India, and names no statute elsewhere", () => {
    const india = buildAgreementClauses({ ...base, country: "IN" })[5];
    expect(india.title).toContain("Indian Contract Act 1872");
    expect(india.body).toContain("Arbitration and Conciliation Act, 1996");

    const us = buildAgreementClauses({ ...base, country: "US" })[5];
    expect(us.title).toBe("Governing Law");
    expect(us.body).not.toContain("Act,");
    expect(us.body).toContain("the United States");
  });

  it("legalCountryName reads legal prose, not a CLDR display name", () => {
    expect(legalCountryName("GB")).toBe("England and Wales");
    expect(legalCountryName("US")).toBe("the United States");
    expect(legalCountryName("FR")).toBe("France");
  });
});
