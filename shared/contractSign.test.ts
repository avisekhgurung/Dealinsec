import { describe, expect, it } from "vitest";
import { buildAgreementShareSnapshot, computeDocumentHash, verifyDocumentHash } from "./contractSign";
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
    dealType: "Development",
    exclusive: true,
    deliverables: [{ contentType: "Landing page design", platform: "Design", quantity: 1, frequency: "One-time" }],
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

  it("carries the fields the client's own official document needs to render", () => {
    expect(snap.country).toBe("IN");
    expect(snap.dealType).toBe("Development");
    expect(snap.exclusive).toBe(true);
    expect(snap.deliverables).toEqual([{ category: "Design", output: "Landing page design", quantity: 1, frequency: "One-time" }]);
    expect(snap.hasOwnPaymentTerms).toBe(true); // "advance_50" is a payment term
  });
});

describe("document integrity hash", () => {
  const record = {
    clientSignShareSnapshot: { v: 1, clientName: "Acme" },
    clientSignerName: "Jordan Lee",
    clientSignerEmail: "jordan@acme.example",
    clientSignatureDataUrl: "data:image/png;base64,AAAA",
    clientSignedAt: "2026-09-22T19:36:19.853Z",
  };

  it("is deterministic for identical fields", () => {
    expect(computeDocumentHash(record)).toBe(computeDocumentHash({ ...record }));
  });

  it("changes if any signed field changes", () => {
    const h = computeDocumentHash(record);
    expect(computeDocumentHash({ ...record, clientSignerName: "Someone Else" })).not.toBe(h);
    expect(computeDocumentHash({ ...record, clientSignerEmail: null })).not.toBe(h);
    expect(computeDocumentHash({ ...record, clientSignatureDataUrl: "data:image/png;base64,BBBB" })).not.toBe(h);
  });

  it("verifyDocumentHash: unavailable, verified, mismatch", () => {
    expect(verifyDocumentHash(record, null)).toBe("unavailable");
    expect(verifyDocumentHash(record, computeDocumentHash(record))).toBe("verified");
    expect(verifyDocumentHash(record, "not-a-real-hash")).toBe("mismatch");
  });
});


describe("brand terms in the agreement snapshot", () => {
  const build = (dealType: string, dealBrandTerms?: unknown) =>
    buildAgreementShareSnapshot({
      issuerName: "Lena Ortiz",
      contract,
      dealType,
      exclusive: true,
      deliverables: [{ contentType: "Reel", platform: "Instagram", quantity: 2, frequency: "One-time" }],
      dealStandardTermIds: ["advance_50"],
      dealCustomTerms: "",
      dealBrandTerms,
      settings,
    });
  const KEYS_BEFORE = [
    "v", "issuerName", "clientName", "contractName", "startDate", "endDate", "amountMinor", "currency",
    "amountLabel", "terms", "country", "locale", "timezone", "dealType", "exclusive", "deliverables", "hasOwnPaymentTerms",
  ];

  it("leaves every existing snapshot exactly as it was: same keys, same order, so its hash is unchanged", () => {
    expect(Object.keys(build("Development"))).toEqual(KEYS_BEFORE);
    expect(Object.keys(build("Development", { usageRights: "x" }))).toEqual(KEYS_BEFORE);
    expect(Object.keys(build("Creator", { usageRights: "x" }))).toEqual(KEYS_BEFORE);
    expect(Object.keys(build("Brand Collaboration"))).toEqual(KEYS_BEFORE);
    expect(Object.keys(build("Brand Collaboration", { usageRights: "  " }))).toEqual(KEYS_BEFORE);
  });

  it("carries the terms of a brand collaboration when the deal states any", () => {
    const snap = build("Brand Collaboration", { usageRights: "Organic posts", usageDuration: "3 months", junk: "x" });
    expect(snap.brandTerms).toEqual({ usageRights: "Organic posts", usageDuration: "3 months" });
    expect(Object.keys(snap)).toEqual([...KEYS_BEFORE, "brandTerms"]);
  });

  it("changes the document hash only for a snapshot that carries brand terms", () => {
    const hashOf = (snapshot: unknown) =>
      computeDocumentHash({
        clientSignShareSnapshot: snapshot,
        clientSignerName: "Jordan Lee",
        clientSignerEmail: null,
        clientSignatureDataUrl: null,
        clientSignedAt: "2026-09-22T19:36:19.853Z",
      });
    expect(hashOf(build("Development"))).toBe(hashOf(build("Development", { usageRights: "x" })));
    expect(hashOf(build("Brand Collaboration", { usageRights: "Organic" }))).not.toBe(hashOf(build("Brand Collaboration")));
  });
});
