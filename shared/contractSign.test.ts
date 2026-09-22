import { describe, expect, it } from "vitest";
import { buildAgreementShareSnapshot } from "./contractSign";
import { resolveLocaleSettings } from "./schema";

const settings = resolveLocaleSettings({ country: "IN" } as any);

const contract = {
  brandName: "Acme",
  contractName: "Acme - Landing Page",
  startDate: "2026-09-22",
  endDate: "2026-10-06",
  contractValueMinor: 150000,
};

describe("buildAgreementShareSnapshot — the public sign-page contract", () => {
  const snap = buildAgreementShareSnapshot({
    issuerName: "Lena Ortiz",
    contract,
    dealStandardTermIds: ["validity_30", "advance_50"],
    dealCustomTerms: "Up to 2 rounds of revisions are included.",
    settings,
  });

  it("never contains a PAN, GSTIN, bank field, signature or private key name", () => {
    const s = JSON.stringify(snap).toLowerCase();
    for (const forbidden of ["pan", "gst", "ifsc", "bank", "account", "signature", "seal", "userid", "organizationid", "phone", "address"]) {
      expect(s).not.toContain(forbidden);
    }
  });

  it("excludes quotation-only terms (validity) but keeps agreement terms (advance)", () => {
    expect(snap.terms.some((t) => /valid for 30 days/i.test(t))).toBe(false);
    expect(snap.terms.some((t) => /advance/i.test(t))).toBe(true);
    expect(snap.terms).toContain("Up to 2 rounds of revisions are included.");
  });

  it("prints the real agreement money, formatted", () => {
    expect(snap.amountMinor).toBe(150000);
    expect(snap.amountLabel).toContain("1,500");
  });
});
