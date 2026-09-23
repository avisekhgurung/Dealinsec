import { describe, expect, it } from "vitest";
import { buildAgreementClauses, executionRecordDisclosure, legalCountryName, notADscPhrase } from "./agreementClauses";

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

describe("notADscPhrase — the public signing page's consent wording", () => {
  it("names Aadhaar and the IT Act only for India", () => {
    expect(notADscPhrase("IN")).toContain("Aadhaar");
  });

  it("never mentions Aadhaar or any India-specific term for a non-India signer", () => {
    for (const country of ["US", "GB", "DE", "AE", "SG", "JP", "FR", "CA", "AU"]) {
      const phrase = notADscPhrase(country);
      expect(phrase).not.toMatch(/aadhaar|information technology act|it act|india/i);
    }
  });
});

describe("executionRecordDisclosure — the agreement's own signing disclosure", () => {
  it("cites the IT Act and stamp duty for India", () => {
    const text = executionRecordDisclosure("IN");
    expect(text).toContain("Information Technology Act, 2000");
    expect(text).toContain("Stamp duty");
  });

  it("mentions neither the IT Act nor stamp duty for any non-India country", () => {
    for (const country of ["US", "GB", "DE", "AE", "SG", "JP", "FR", "CA", "AU"]) {
      const text = executionRecordDisclosure(country);
      expect(text).not.toMatch(/information technology act|stamp duty|aadhaar|gstin?|pan\b/i);
    }
  });

  it("still says what the acceptance is not, for every country", () => {
    for (const country of ["IN", "US", "DE"]) {
      expect(executionRecordDisclosure(country)).toMatch(/electronic acceptance with an audit record/i);
    }
  });
});
