import { describe, expect, it } from "vitest";
import { bankRoutingLabel, taxIdLabel } from "./invoice-tax";

describe("taxIdLabel — the single source for the agreement and the profile form", () => {
  it("matches the label each country expects", () => {
    expect(taxIdLabel("GB")).toBe("VAT number");
    expect(taxIdLabel("DE")).toBe("VAT number");
    expect(taxIdLabel("US")).toBe("EIN / Tax ID");
    expect(taxIdLabel("AU")).toBe("ABN");
    expect(taxIdLabel("CA")).toBe("GST/HST number");
  });

  it("falls back to a generic label for an unconfigured country, never a guess", () => {
    expect(taxIdLabel("JP")).toBe("Tax registration number");
    expect(taxIdLabel("AE")).toBe("Tax registration number");
  });

  it("India has no entry here — its tax fields (PAN/GSTIN) are asked for by name, not this generic label", () => {
    expect(taxIdLabel("IN")).toBe("Tax registration number");
  });
});

describe("bankRoutingLabel — unaffected by the tax-ID consolidation", () => {
  it("still resolves per country as before", () => {
    expect(bankRoutingLabel("IN")).toBe("IFSC");
    expect(bankRoutingLabel("GB")).toBe("Sort code");
    expect(bankRoutingLabel("AE")).toBe("IBAN");
  });
});
