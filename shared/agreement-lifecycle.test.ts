import { describe, expect, it } from "vitest";
import {
  PROTECTED_CONTRACT_FIELDS, ProtectedContractFieldError, assertNewAgreementRow, assertNoProtectedContractFields, assertRevisableOnly,
  canClaimSignature, canEditEstamp, canRecordProof, canRevise, canShare, invoiceEligibility, isAgreementSigned, newAgreementLifecycleFields,
  parseContractCreateBody, statusAfterRevoke, statusAfterShare,
} from "./agreement-lifecycle";

const terms = { dealId: 7, contractName: "Acme - Logo", brandName: "Acme", startDate: "2026-10-01", endDate: "2026-11-01", contractValueMinor: 1_500_000, exclusive: true };

describe("agreement create: a strict allowlist", () => {
  it("accepts exactly the agreement's terms", () => {
    expect(parseContractCreateBody(terms)).toEqual({ ok: true, data: terms });
  });
  it("the original exploit: a client-sent proof path, Signed status or client signature refuses the whole request", () => {
    const forged = { ...terms, proofFilePath: "/etc/passwd", signedByBrand: true, clientSignatureDataUrl: "https://evil.example/x.png" };
    const r = parseContractCreateBody(forged);
    expect(r).toMatchObject({ ok: false, code: "unexpected_field" });
    expect((r as any).fields.sort()).toEqual(["clientSignatureDataUrl", "proofFilePath", "signedByBrand"]);
  });
  it("every protected field is refused at create, one at a time", () => {
    for (const k of PROTECTED_CONTRACT_FIELDS) {
      if (k === "status" || k === "currency" || k === "dealId") continue; // dealId is a term; status and currency are dropped (below)
      expect(parseContractCreateBody({ ...terms, [k]: "x" }), k).toMatchObject({ ok: false, code: "unexpected_field", fields: [k] });
    }
  });
  it("an older web client's `status: \"Signed\"` and `currency` are dropped, never used", () => {
    const r = parseContractCreateBody({ ...terms, status: "Signed", currency: "USD" });
    expect(r).toEqual({ ok: true, data: terms });
  });
  it("an unknown key is refused too; bad types are invalid; odd bodies don't throw", () => {
    expect(parseContractCreateBody({ ...terms, notes: "hi" })).toMatchObject({ ok: false, code: "unexpected_field", fields: ["notes"] });
    expect(parseContractCreateBody({ ...terms, contractValueMinor: 1.5 })).toMatchObject({ ok: false, code: "invalid" });
    for (const odd of [null, undefined, "x", 7, [terms]]) expect(() => parseContractCreateBody(odd)).not.toThrow();
  });
});

describe("protected fields: only the dedicated writers change them", () => {
  it("a general update with any protected field throws, naming the fields; ordinary fields pass", () => {
    for (const k of PROTECTED_CONTRACT_FIELDS) expect(() => assertNoProtectedContractFields({ [k]: null }), k).toThrow(ProtectedContractFieldError);
    expect(() => assertNoProtectedContractFields({ clientShareViewCount: 3 })).not.toThrow();
    // The e-stamp reference changes only through its own writer (frozen once the client has signed).
    expect(() => assertNoProtectedContractFields({ estampCertificateNo: "IN-DL1" })).toThrow(ProtectedContractFieldError);
    try { assertNoProtectedContractFields({ status: "Signed", proofFilePath: "/x" }); } catch (e: any) { expect(e.fields).toEqual(["status", "proofFilePath"]); }
  });
  it("a revision may change only the terms", () => {
    expect(() => assertRevisableOnly({ contractName: "x", exclusive: false, contractValueMinor: 1, startDate: "a", endDate: "b" })).not.toThrow();
    for (const k of ["status", "signedByBrand", "proofFilePath", "clientShareToken", "signedByInfluencerDate"]) expect(() => assertRevisableOnly({ [k]: 1 }), k).toThrow();
  });
  it("a new row must be a blank Draft; the server's lifecycle fields are exactly that", () => {
    expect(() => assertNewAgreementRow({ ...terms, ...newAgreementLifecycleFields() })).not.toThrow();
    expect(() => assertNewAgreementRow({ ...terms })).toThrow(/status/); // a missing status is the column default (Pending): refused
    for (const [k, v] of [["status", "Signed"], ["signedByBrand", true], ["proofFilePath", "/etc/passwd"], ["clientShareToken", "a".repeat(32)], ["documentHash", "x"], ["clientSignatureDataUrl", "data:x"]] as const) {
      expect(() => assertNewAgreementRow({ ...terms, ...newAgreementLifecycleFields(), [k]: v }), k).toThrow(ProtectedContractFieldError);
    }
  });
});

describe("lifecycle: Draft → Pending → Signed, and nothing else reaches Signed", () => {
  const draft = { status: "Draft", signedByBrand: false, clientSignedAt: null, clientShareToken: null, clientShareRevokedAt: null };
  const pending = { ...draft, status: "Pending", clientShareToken: "tok-live" };
  const signedOnline = { ...pending, status: "Signed", signedByBrand: true, clientSignedAt: new Date() };
  const signedByProof = { ...draft, status: "Signed", signedByBrand: true };
  it("share: Draft becomes Pending; any other status is kept (older rows aren't rewritten); never once signed", () => {
    expect(statusAfterShare(draft)).toBe("Pending");
    expect(statusAfterShare(pending)).toBe("Pending");
    expect(statusAfterShare({ ...draft, status: "Signed" })).toBe("Signed"); // an older web row: kept as it was
    expect(statusAfterShare({ ...draft, status: "Active" })).toBe("Active");
    expect(canShare(draft) && canShare(pending)).toBe(true);
    expect(canShare(signedOnline) || canShare(signedByProof)).toBe(false);
  });
  it("revoke: an unsigned Pending goes back to Draft; signed agreements keep Signed", () => {
    expect(statusAfterRevoke(pending)).toBe("Draft");
    expect(statusAfterRevoke(draft)).toBe("Draft");
    expect(statusAfterRevoke(signedOnline)).toBe("Signed");
    expect(statusAfterRevoke(signedByProof)).toBe("Signed");
  });
  it("sign online: only with the live token, only once, never after a revoke", () => {
    expect(canClaimSignature(pending, "tok-live")).toBe(true);
    expect(canClaimSignature(pending, "tok-old")).toBe(false);
    expect(canClaimSignature(pending, "")).toBe(false);
    expect(canClaimSignature({ ...pending, clientShareRevokedAt: new Date() }, "tok-live")).toBe(false);
    expect(canClaimSignature(signedOnline, "tok-live")).toBe(false);
    expect(canClaimSignature({ ...pending, signedByBrand: true }, "tok-live")).toBe(false); // a proof was recorded first
  });
  it("owner-attested proof: allowed (and may replace an earlier proof) unless the client signed online", () => {
    expect(canRecordProof(draft) && canRecordProof(pending) && canRecordProof(signedByProof)).toBe(true);
    expect(canRecordProof(signedOnline)).toBe(false);
  });
  it("revisions: only while nobody has signed", () => {
    expect(canRevise(draft) && canRevise(pending)).toBe(true);
    expect(canRevise(signedOnline) || canRevise(signedByProof)).toBe(false);
  });
  it("e-stamp: editable until the client signs (online or by an uploaded copy); an older status-only Signed row stays editable", () => {
    expect(canEditEstamp(draft) && canEditEstamp(pending) && canEditEstamp({ ...draft, status: "Signed" })).toBe(true);
    expect(canEditEstamp(signedOnline) || canEditEstamp(signedByProof)).toBe(false);
  });
});

describe("invoice eligibility: decided on the server, from the agreement's signature", () => {
  const row = (over: object) => ({ dealId: 7, status: "Draft", signedByBrand: false, ...over });
  it("an unsigned agreement can't be invoiced, whatever its status", () => {
    for (const status of ["Draft", "Pending", "Active", "Completed", ""]) {
      expect(invoiceEligibility(row({ status }), 7), status).toMatchObject({ ok: false, code: "agreement_not_signed" });
    }
  });
  it("signed online or by an owner-attested proof: eligible", () => {
    expect(invoiceEligibility(row({ status: "Signed", signedByBrand: true }), 7)).toEqual({ ok: true });
  });
  it("existing rows are read as before: an older web agreement stored as Signed stays invoiceable", () => {
    expect(invoiceEligibility(row({ status: "Signed", signedByBrand: false }), 7)).toEqual({ ok: true });
    expect(isAgreementSigned({ status: "Signed" })).toBe(true);
    expect(isAgreementSigned({ status: "Active" })).toBe(false);
  });
  it("no agreement (a deal-only invoice) is not judged here; another deal's agreement is refused", () => {
    expect(invoiceEligibility(undefined, 7)).toEqual({ ok: true });
    expect(invoiceEligibility(row({ status: "Signed", signedByBrand: true, dealId: 8 }), 7)).toMatchObject({ ok: false, code: "agreement_other_deal" });
  });
});
