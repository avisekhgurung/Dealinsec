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
