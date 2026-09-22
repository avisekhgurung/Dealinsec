import { describe, expect, it } from "vitest";
import { buildQuoteShareSnapshot } from "./quoteShare";
import { resolveLocaleSettings } from "./schema";

const settings = resolveLocaleSettings({ country: "IN" } as any);

const deal = {
  brandName: "Acme",
  dealTitle: "Landing Page",
  dealType: "Development",
  deliverables: [{ id: "1", platform: "Design", contentType: "Landing page design", quantity: 1, frequency: "One-time", notes: "" }],
  startDate: "2026-09-22",
  endDate: "2026-10-06",
  dealAmountMinor: 150000,
  standardTermIds: ["advance_50"],
  customTerms: "Up to 2 rounds of revisions are included.",
};

describe("buildQuoteShareSnapshot — the public-page contract", () => {
  const snap = buildQuoteShareSnapshot({
    issuerName: "Lena Ortiz",
    deal,
    quoteId: 42,
    version: 1,
    settings,
    now: new Date("2026-09-22T00:00:00Z"),
  });

  it("carries only the fields a client should see", () => {
    expect(Object.keys(snap).sort()).toEqual(
      ["v", "issuerName", "clientName", "dealTitle", "dealType", "deliverables", "startDate", "endDate", "amountMinor", "currency", "amountLabel", "terms", "quoteNumber", "version", "validUntil"].sort(),
    );
  });

  it("never contains a PAN, GSTIN, bank field or private key name", () => {
    const s = JSON.stringify(snap);
    for (const forbidden of ["pan", "gst", "ifsc", "bank", "account", "signature", "seal", "userId", "organizationId", "phone", "address"]) {
      expect(s.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("resolves standard + custom terms into plain text", () => {
    expect(snap.terms).toContain("Up to 2 rounds of revisions are included.");
    expect(snap.terms.some((t) => /advance/i.test(t))).toBe(true);
  });

  it("prints the real deal money, formatted", () => {
    expect(snap.amountMinor).toBe(150000);
    expect(snap.amountLabel).toContain("1,500");
  });

  it("is deterministic for the same inputs", () => {
    const again = buildQuoteShareSnapshot({ issuerName: "Lena Ortiz", deal, quoteId: 42, version: 1, settings, now: new Date("2026-09-22T00:00:00Z") });
    expect(again).toEqual(snap);
  });
});
