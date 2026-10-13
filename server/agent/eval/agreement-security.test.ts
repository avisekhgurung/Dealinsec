/**
 * Agreement security: the reported proofFilePath / signature-field vulnerability,
 * its fixes, and the races around signing — run against the REAL services
 * (signing links, proof upload and download, invoice eligibility, revisions,
 * Copilot) with only the edge replaced: the in-memory world for storage, and
 * fakes for billing, email and ImageKit. No database, no network.
 *
 * The world's dedicated writers apply the same shared predicates as the SQL
 * WHERE clauses in server/storage.ts; that the SQL itself matches them is a
 * code-review fact, not something this file can prove.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../storage", async () => (await import("./world-mocks")).storageMock());
vi.mock("../../entitlements", async () => (await import("./world-mocks")).entitlementsMock());
vi.mock("../../emails", async () => (await import("./world-mocks")).emailsMock());
vi.mock("../../leads/profile-store", async () => (await import("./world-mocks")).profileStoreMock());
vi.mock("../../discovery/provider", async () => (await import("./world-mocks")).discoveryProviderMock());
vi.mock("../../discovery/usage", async () => (await import("./world-mocks")).discoveryUsageMock());
vi.mock("../../documents/style-store", async () => (await import("./world-mocks")).documentStyleStoreMock());
vi.mock("../../knowledge/store", async () => (await import("./world-mocks")).knowledgeStoreMock());
vi.mock("../../knowledge/net-guard", async (orig) => (await import("./world-mocks")).netGuardMock(orig as () => Promise<any>));
vi.mock("../../leads/store", async () => (await import("./world-mocks")).leadsStoreMock());
vi.mock("../../sales/research-store", async () => (await import("./world-mocks")).researchStoreMock());
vi.mock("../../sales/message-store", async () => (await import("./world-mocks")).messageStoreMock());
vi.mock("../../outbound/store", async () => (await import("./world-mocks")).outboundStoreMock());
vi.mock("../../llm/trace-store", async () => (await import("./world-mocks")).traceStoreMock());
vi.mock("../../routes", async () => (await import("./world-mocks")).routesMock());
vi.mock("../../copilot/provider", async (orig) => (await import("./world-mocks")).scriptedProviderMock(orig as () => Promise<any>));
/** ImageKit, faked: off unless a test turns it on; uploads and deletes are recorded. */
const ik = vi.hoisted(() => ({ on: false, uploads: [] as string[], deleted: [] as string[] }));
vi.mock("../../imagekitClient", () => ({
  isImageKitConfigured: () => ik.on,
  uploadFileToImageKit: async (file: { path: string }, opts: { folder: string }) => {
    ik.uploads.push(opts.folder);
    fs.rmSync(file.path, { force: true }); // the real client removes the temp file after the transfer
    return { url: `https://ik.imagekit.io/acme/dealinsec/${opts.folder}/proof-${ik.uploads.length}.pdf`, fileId: `f${ik.uploads.length}`, name: "x", size: 1 };
  },
  deleteFromImageKit: async (fileId: string) => { ik.deleted.push(fileId); },
}));

import { computeDocumentHash, verifyDocumentHash } from "@shared/contractSign";
import { executeCreateAgreement, executeCreateInvoice } from "../../copilot/tools";
import { createAgreementSignLink } from "../../services/sharing";
import { applyAgreementRevision } from "../../services/revisions";
import { attachmentDownload, checkAttachmentUpload, checkProofUpload, invoiceAgreementFor, profileImageUpdateAllowed, proofDownload, recordAttachmentUpload, recordProofUpload, uploadAccess, uploadTagFor, UPLOAD_DIR } from "../../services/agreement-files";
import { useWorld } from "./world-mocks";
import { createWorld, seedContract, seedDeal, userRow, ORG2, type Row, type World } from "./world";

const world = () => (globalThis as any).__world as World;
const OWNER = () => world().users.get("u1")! as any;
const OTHER_ORG = () => world().users.get("u2")! as any;
/** Built-in roles keep their full read scope by design (shared/permissions.ts canReadModule); custom roles are narrowed. */
const CUSTOM_NO_AGREEMENTS = () => userRow({ id: "u3", orgRole: "CUSTOM", customPermissions: ["deals.create", "quotations.create"] }) as any;
const CUSTOM_INVOICES = () => userRow({ id: "u5", orgRole: "CUSTOM", customPermissions: ["invoices.create"] }) as any;
const ACCOUNTS = () => userRow({ id: "u4", orgRole: "ACCOUNTS" }) as any;

let tmp: string;
beforeEach(() => {
  useWorld(createWorld());
  ik.on = false; ik.uploads = []; ik.deleted = [];
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agreement-sec-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); vi.restoreAllMocks(); delete process.env.IMAGEKIT_URL_ENDPOINT; });

const PDF = "%PDF-1.7\n%signed copy\n";
function upload(name = "signed.pdf", content = PDF) {
  const p = path.join(tmp, `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.writeFileSync(p, content);
  return { path: p, originalname: name, size: content.length };
}
const draft = (over: Row = {}) => seedContract(world(), seedDeal(world()).id, { status: "Draft", signedByBrand: false, clientSignedAt: null, ...over });
/** The client signs through the public link exactly as server/agreementSign.ts does: hash, then the atomic claim. */
async function signOnline(id: number, token: string) {
  const c = world().contracts.find((x) => x.id === id)!;
  const now = new Date();
  const fields = { clientSignShareSnapshot: c.clientSignShareSnapshot, clientSignerName: "R. Client", clientSignerEmail: "client@example.test", clientSignatureDataUrl: `data:image/png;base64,${"A".repeat(120)}`, clientSignedAt: now };
  const documentHash = computeDocumentHash(fields);
  return world().storage.claimContractSignatureOnce(id, token, { status: "Signed", signedDate: now.toISOString().slice(0, 10), ...fields, clientSignerIp: "203.0.113.9", documentHash });
}
const integrity = (id: number) => { const c = world().contracts.find((x) => x.id === id)!; return verifyDocumentHash(c as any, c.documentHash); };
/** One stale read: the next getContract returns the row as it was BEFORE `mutate`, which then runs on the real row. */
function staleRead(id: number, mutate: () => Promise<unknown>) {
  const before = { ...world().contracts.find((x) => x.id === id)! };
  const real = world().storage.getContract;
  world().storage.getContract = async (x: number) => { world().storage.getContract = real; await mutate(); return x === id ? { ...before } : real(x); };
}

describe("the reported vulnerability, end to end", () => {
  it("a forged create can't reach storage: the world refuses a non-Draft row or any planted signature, proof or link field", async () => {
    const deal = seedDeal(world());
    for (const forged of [{ status: "Signed" }, { proofFilePath: "/etc/passwd" }, { signedByBrand: true }, { clientShareToken: "a".repeat(32) }, { clientSignatureDataUrl: "https://evil.example/x.png" }]) {
      await expect(world().storage.createContract({ dealId: deal.id, status: "Draft", ...forged }), JSON.stringify(forged)).rejects.toThrow(/protected agreement field/);
    }
    expect(world().contracts).toHaveLength(0);
  });
  it("a planted proof path is never served: an arbitrary server path or URL is refused (and the log carries no path)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const proofFilePath of ["/etc/passwd", "/proc/self/environ", path.join(UPLOAD_DIR, "..", ".env"), "https://evil.example/login", `${UPLOAD_DIR}/../package.json`]) {
      const c = draft({ proofFilePath, proofFileName: "x.pdf" });
      expect(await proofDownload(OWNER(), c.id), proofFilePath).toMatchObject({ ok: false, status: 404 });
    }
    expect(warn.mock.calls.flat().join(" ")).not.toMatch(/passwd|environ|\.env|evil|package/);
  });
  it("the app's own proofs still download: a local upload by name, an ImageKit proof by rebuilt redirect", async () => {
    const local = draft({ proofFilePath: path.join(UPLOAD_DIR, "1791849718123-48291.pdf"), proofFileName: "signed.pdf" });
    expect(await proofDownload(OWNER(), local.id)).toEqual({ ok: true, decision: { type: "local", name: "1791849718123-48291.pdf" }, downloadName: "signed.pdf" });
    process.env.IMAGEKIT_URL_ENDPOINT = "https://ik.imagekit.io/acme";
    const remote = draft({ proofFilePath: "https://ik.imagekit.io/acme/dealinsec/contracts/contract-1-proof.pdf", proofFileName: "signed.pdf" });
    expect(await proofDownload(OWNER(), remote.id)).toMatchObject({ ok: true, decision: { type: "redirect", url: "https://ik.imagekit.io/acme/dealinsec/contracts/contract-1-proof.pdf" } });
    const lookalike = draft({ proofFilePath: "https://ik.imagekit.io.evil.com/acme/dealinsec/contracts/a.pdf" });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await proofDownload(OWNER(), lookalike.id)).toMatchObject({ ok: false, status: 404 });
  });
  it("a planted general update of a protected field throws", async () => {
    const c = draft();
    for (const u of [{ proofFilePath: "/etc/passwd" }, { status: "Signed" }, { signedByBrand: true }, { documentHash: "x" }, { clientShareToken: "t" }]) {
      await expect(world().storage.updateContract(c.id, u), JSON.stringify(u)).rejects.toThrow(/protected agreement field/);
    }
    expect(world().contracts[0]).toMatchObject({ status: "Draft", signedByBrand: false });
    expect(world().contracts[0].proofFilePath).toBeUndefined();
    await expect(world().storage.updateContract(c.id, { clientShareViewCount: 2 })).resolves.toMatchObject({ clientShareViewCount: 2 });
    await expect(world().storage.updateContract(c.id, { estampCertificateNo: "IN-DL1" })).rejects.toThrow(/protected agreement field/);
  });
});

describe("lifecycle: a new agreement is a Draft; only signing or an owner-attested proof makes it Signed", () => {
  it("Copilot's agreement is a blank Draft", async () => {
    const deal = seedDeal(world());
    const r = await executeCreateAgreement({ dealId: deal.id }, OWNER());
    expect(r.ok).toBe(true);
    expect(world().contracts[0]).toMatchObject({ status: "Draft", signedByBrand: false, proofFilePath: null, clientShareToken: null, clientSignedAt: null, documentHash: null });
  });
  it("a signing link moves Draft to Pending; revoking moves it back; signing makes it Signed with a verified hash", async () => {
    const c = draft();
    const link = await createAgreementSignLink(OWNER(), c.id);
    expect(link.ok).toBe(true);
    expect(world().contracts[0].status).toBe("Pending");
    await world().storage.revokeContractShare(c.id);
    expect(world().contracts[0].status).toBe("Draft");
    const again = await createAgreementSignLink(OWNER(), c.id);
    const token = (again as any).url.slice(3);
    expect(await signOnline(c.id, token)).toBeTruthy();
    expect(world().contracts[0]).toMatchObject({ status: "Signed", signedByBrand: true });
    expect(integrity(c.id)).toBe("verified");
    await world().storage.revokeContractShare(c.id); // revoking after signing hides the link, never unsigns
    expect(world().contracts[0].status).toBe("Signed");
  });
  it("an older row keeps its status: sharing an agreement stored as \"Signed\" by the old web create doesn't rewrite it", async () => {
    const c = draft({ status: "Signed" });
    await createAgreementSignLink(OWNER(), c.id);
    expect(world().contracts[0].status).toBe("Signed");
  });
  it("an owner-attested proof makes it Signed, as an uploaded copy (no client signer is recorded)", async () => {
    const c = draft();
    const r = await recordProofUpload(OWNER(), c.id, upload());
    expect(r.ok).toBe(true);
    expect(world().contracts[0]).toMatchObject({ status: "Signed", signedByBrand: true, clientSignedAt: null, proofFileName: "signed.pdf" });
    expect(world().contracts[0].clientSignerName).toBeUndefined();
    expect(world().activity.at(-1)!.action).toMatch(/owner-attested/);
  });
});

describe("races: the decision is made by the row at write time", () => {
  it("two signers at once: exactly one claim wins", async () => {
    const c = draft();
    const token = ((await createAgreementSignLink(OWNER(), c.id)) as any).url.slice(3);
    const [a, b] = await Promise.all([signOnline(c.id, token), signOnline(c.id, token)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(integrity(c.id)).toBe("verified");
  });
  it("a new link made while the client signs can't replace the signed snapshot (the hash stays verified, the link stays)", async () => {
    const c = draft();
    const token = ((await createAgreementSignLink(OWNER(), c.id)) as any).url.slice(3);
    staleRead(c.id, () => signOnline(c.id, token)); // the owner's check reads the row just before the client signs
    const r = await createAgreementSignLink(OWNER(), c.id);
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(world().contracts[0].clientShareToken).toBe(token);
    expect(integrity(c.id)).toBe("verified");
  });
  it("a signer holding an old or revoked link can't sign what the agreement now shows", async () => {
    const c = draft();
    const old = ((await createAgreementSignLink(OWNER(), c.id)) as any).url.slice(3);
    await createAgreementSignLink(OWNER(), c.id); // re-made: new token, new snapshot
    expect(await signOnline(c.id, old)).toBeUndefined();
    const live = world().contracts[0].clientShareToken;
    await world().storage.revokeContractShare(c.id);
    expect(await signOnline(c.id, live)).toBeUndefined();
    expect(world().contracts[0]).toMatchObject({ signedByBrand: false, clientSignedAt: null });
  });
  it("a proof upload can't overwrite an online signature, even when it read the row before the client signed", async () => {
    const c = draft();
    const token = ((await createAgreementSignLink(OWNER(), c.id)) as any).url.slice(3);
    const file = upload();
    // Both of the upload's reads (precheck and recheck) see the unsigned row; the client signs in between.
    const before = { ...world().contracts[0] };
    const real = world().storage.getContract;
    let reads = 0;
    world().storage.getContract = async (x: number) => { if (++reads === 2) await signOnline(c.id, token); return x === c.id && reads <= 2 ? { ...before } : real(x); };
    expect(await checkProofUpload(OWNER(), c.id)).toMatchObject({ ok: true });
    const r = await recordProofUpload(OWNER(), c.id, file);
    expect(r).toMatchObject({ ok: false, status: 409, code: "signed_online" });
    expect(world().contracts[0]).toMatchObject({ status: "Signed", clientSignerName: "R. Client" });
    expect(world().contracts[0].proofFilePath).toBeUndefined();
    expect(integrity(c.id)).toBe("verified");
    expect(fs.existsSync(file.path)).toBe(false); // the temporary upload was removed
  });
  it("after an online signature, a proof upload is refused before the file is accepted", async () => {
    const c = draft();
    const token = ((await createAgreementSignLink(OWNER(), c.id)) as any).url.slice(3);
    await signOnline(c.id, token);
    expect(await checkProofUpload(OWNER(), c.id)).toMatchObject({ ok: false, status: 409, code: "signed_online" });
  });
  it("a revision that read the agreement before the client signed is refused, and nothing changes", async () => {
    const c = draft();
    const token = ((await createAgreementSignLink(OWNER(), c.id)) as any).url.slice(3);
    const before = { ...world().contracts[0] };
    const real = world().storage.getContractByDealId;
    world().storage.getContractByDealId = async (dealId: number) => { world().storage.getContractByDealId = real; await signOnline(c.id, token); return { ...before }; };
    const r = await applyAgreementRevision(OWNER(), c.dealId, { contractName: "Renamed after signing" });
    expect(r).toMatchObject({ ok: false, code: "locked" });
    expect(world().contracts[0].contractName).toBe(before.contractName);
    expect(integrity(c.id)).toBe("verified");
  });
  it("an ImageKit proof refused at the final write is deleted from ImageKit", async () => {
    ik.on = true;
    const c = draft();
    const token = ((await createAgreementSignLink(OWNER(), c.id)) as any).url.slice(3);
    const before = { ...world().contracts[0] };
    const real = world().storage.recordContractProof;
    world().storage.recordContractProof = async (...a: any[]) => { await signOnline(c.id, token); return real(...a); };
    world().storage.getContract = async () => ({ ...before });
    expect(await recordProofUpload(OWNER(), c.id, upload())).toMatchObject({ ok: false, status: 409 });
    expect(ik.deleted).toEqual(["f1"]);
  });
});

describe("proof upload: role, plan, organization, content, cleanup", () => {
  it("refused for another organization, a role without agreements.create, and a lapsed plan", async () => {
    const c = draft();
    expect(await checkProofUpload(OTHER_ORG(), c.id)).toMatchObject({ ok: false, status: 403 });
    expect(await checkProofUpload(ACCOUNTS(), c.id)).toMatchObject({ ok: false, status: 403, code: "FORBIDDEN" });
    world().billing.set("org-1", { id: "u1", plan: "free" });
    expect(await checkProofUpload(OWNER(), c.id)).toMatchObject({ ok: false, status: 403, code: "UPGRADE_REQUIRED" });
  });
  it("a file whose content isn't its extension is refused and removed; refusals remove the temporary file too", async () => {
    const c = draft();
    const fake = upload("signed.pdf", "<html>not a pdf</html>");
    expect(await recordProofUpload(OWNER(), c.id, fake)).toMatchObject({ ok: false, status: 400, code: "file_content" });
    expect(fs.existsSync(fake.path)).toBe(false);
    const foreign = upload();
    expect(await recordProofUpload(OTHER_ORG(), c.id, foreign)).toMatchObject({ ok: false, status: 403 });
    expect(fs.existsSync(foreign.path)).toBe(false);
    expect(world().contracts[0]).toMatchObject({ status: "Draft", signedByBrand: false });
  });
  it("a local upload is kept (it is the stored proof); an ImageKit one goes to the contracts folder", async () => {
    const a = draft();
    const kept = upload();
    expect((await recordProofUpload(OWNER(), a.id, kept)).ok).toBe(true);
    expect(fs.existsSync(kept.path)).toBe(true);
    ik.on = true;
    const b = draft();
    expect((await recordProofUpload(OWNER(), b.id, upload())).ok).toBe(true);
    expect(ik.uploads).toEqual(["contracts"]);
    expect(world().contracts.find((x) => x.id === b.id)!.proofFilePath).toMatch(/^https:\/\/ik\.imagekit\.io\/acme\/dealinsec\/contracts\//);
  });
  it("a client-sent file name is stored as a download name only", async () => {
    const c = draft();
    await recordProofUpload(OWNER(), c.id, upload("../../etc/sig\"ned.pdf"));
    expect(world().contracts[0].proofFileName).toBe("signed.pdf");
  });
});

describe("downloads: permissions and tenant isolation", () => {
  it("proof: a custom role without agreement access is refused; one that invoices (reads agreements) and ACCOUNTS may; another org may not", async () => {
    const c = draft({ proofFilePath: path.join(UPLOAD_DIR, "1791849718123-1.pdf") });
    expect(await proofDownload(CUSTOM_NO_AGREEMENTS(), c.id)).toMatchObject({ ok: false, status: 403 });
    expect(await proofDownload(CUSTOM_INVOICES(), c.id)).toMatchObject({ ok: true });
    expect(await proofDownload(ACCOUNTS(), c.id)).toMatchObject({ ok: true });
    expect(await proofDownload(OTHER_ORG(), c.id)).toMatchObject({ ok: false, status: 403 });
  });
  it("attachments: another org is refused; the stored /uploads/<name> form is served by name; a planted path is not", async () => {
    const deal = seedDeal(world());
    world().invoices.push({ id: 950, organizationId: "org-1", userId: "u1", dealId: deal.id });
    const rows: Row[] = [{ id: 1, brandInvoiceId: 950, fileUrl: "/uploads/1791849718123-7.png", fileName: "receipt.png" }, { id: 2, brandInvoiceId: 950, fileUrl: "/etc/passwd", fileName: "x" }];
    world().storage.getInvoiceAttachment = async (id: number) => rows.find((r) => r.id === id);
    expect(await attachmentDownload(OWNER(), 1)).toMatchObject({ ok: true, decision: { type: "local", name: "1791849718123-7.png" } });
    expect(await attachmentDownload(OTHER_ORG(), 1)).toMatchObject({ ok: false, status: 403 });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await attachmentDownload(OWNER(), 2)).toMatchObject({ ok: false, status: 404 });
  });
});

describe("invoice eligibility is enforced on the server", () => {
  it("an unsigned agreement can't be invoiced, named or not (leaving contractId out is no way around it)", async () => {
    const c = draft();
    expect(await invoiceAgreementFor(OWNER(), c.dealId, c.id)).toMatchObject({ ok: false, status: 409, code: "agreement_not_signed" });
    expect(await invoiceAgreementFor(OWNER(), c.dealId, undefined)).toMatchObject({ ok: false, status: 409, code: "agreement_not_signed" });
  });
  it("signed (online, by proof, or an older row stored as Signed): eligible, and the deal's agreement is used when none is named", async () => {
    const proof = draft();
    await recordProofUpload(OWNER(), proof.id, upload());
    expect(await invoiceAgreementFor(OWNER(), proof.dealId, undefined)).toMatchObject({ ok: true, contract: { id: proof.id } });
    const legacy = draft({ status: "Signed" });
    expect(await invoiceAgreementFor(OWNER(), legacy.dealId, legacy.id)).toMatchObject({ ok: true });
  });
  it("another org's agreement, or another deal's, is refused; a deal with no agreement keeps its deal-only invoice", async () => {
    const mine = seedDeal(world());
    const theirs = seedContract(world(), seedDeal(world(), { organizationId: ORG2, userId: "u2" }).id, { organizationId: ORG2, userId: "u2", status: "Signed", signedByBrand: true });
    expect(await invoiceAgreementFor(OWNER(), mine.id, theirs.id)).toMatchObject({ ok: false, status: 403 });
    const other = draft({ status: "Signed", signedByBrand: true });
    expect(await invoiceAgreementFor(OWNER(), mine.id, other.id)).toMatchObject({ ok: false, status: 400, code: "agreement_other_deal" });
    expect(await invoiceAgreementFor(OWNER(), mine.id, undefined)).toEqual({ ok: true, contract: undefined });
  });
  it("Copilot refuses to invoice an unsigned agreement and creates nothing", async () => {
    const c = draft();
    const r = await executeCreateInvoice({ dealId: c.dealId, contractId: c.id }, OWNER());
    expect(r).toMatchObject({ ok: false });
    expect((r as any).message).toMatch(/isn't signed yet/);
    expect(world().invoices).toHaveLength(0);
  });
});

describe("route wiring (source check: the routes call the guarded services)", () => {
  const src = fs.readFileSync(path.join(__dirname, "../../routes.ts"), "utf8");
  const line = (needle: string) => src.split("\n").find((l) => l.includes(needle)) ?? "";
  it("create uses the allowlist and the server's Draft fields; no request body is spread into the row", () => {
    const create = src.slice(src.indexOf('app.post("/api/contracts",'), src.indexOf('app.post("/api/contracts/:id/proof"'));
    expect(create).toContain("parseContractCreateBody(req.body)");
    expect(create).toContain("...newAgreementLifecycleFields()");
    expect(create).not.toMatch(/\.\.\.req\.body|\.\.\.contractBody/);
  });
  it("proof upload: Pro and permission, then the pre-check, BEFORE multer accepts the file", () => {
    expect(line('app.post("/api/contracts/:id/proof"')).toMatch(/requirePro\("agreements"\), requireOrgPermission\("agreements.create"\), proofUploadPrecheck, requireDurableUploads, uploadSingle\("proof"\)/);
  });
  it("downloads go through the stored-file check; the proof needs agreement access; nothing serves a stored path directly", () => {
    expect(line('app.get("/api/contracts/:id/proof"')).toContain('requireModuleRead("agreements")');
    expect(src).not.toMatch(/res\.download\((contract|attachment)\./);
    expect(src).not.toMatch(/res\.redirect\((contract|attachment)\./);
  });
  it("both invoice routes check eligibility on the server", () => {
    expect(src.match(/await invoiceAgreementFor\(/g)).toHaveLength(2);
  });
});

describe("existing records are read exactly as before (no migration)", () => {
  it("an older web agreement stored as \"Signed\" without a client signature: still invoiceable, still shareable, still signable online, stamp still editable", async () => {
    const c = draft({ status: "Signed" });
    expect(await invoiceAgreementFor(OWNER(), c.dealId, undefined)).toMatchObject({ ok: true });
    const token = ((await createAgreementSignLink(OWNER(), c.id)) as any).url.slice(3);
    expect(world().contracts[0].status).toBe("Signed"); // never rewritten to Pending
    expect(await world().storage.setContractEstamp(c.id, { estampCertificateNo: "IN-DL1", estampDate: null, estampAmountMinor: null, estampAuthority: null })).toBeTruthy();
    expect(await signOnline(c.id, token)).toBeTruthy();
    expect(integrity(c.id)).toBe("verified");
  });
  it("an older unsigned row (Active, or Copilot's Pending): not invoiceable until signed, and its status is kept when shared", async () => {
    for (const status of ["Active", "Pending"]) {
      useWorld(createWorld());
      const c = draft({ status });
      expect(await invoiceAgreementFor(OWNER(), c.dealId, c.id), status).toMatchObject({ ok: false, code: "agreement_not_signed" });
      await createAgreementSignLink(OWNER(), c.id);
      expect(world().contracts[0].status, status).toBe(status === "Active" ? "Active" : "Pending");
    }
  });
  it("an older proof-signed row: invoiceable, stamp frozen, its proof can be replaced by another owner-attested copy", async () => {
    const c = draft({ status: "Signed", signedByBrand: true, proofFilePath: path.join(UPLOAD_DIR, "1700000000000-1.pdf"), proofFileName: "old.pdf" });
    expect(await invoiceAgreementFor(OWNER(), c.dealId, undefined)).toMatchObject({ ok: true });
    expect(await world().storage.setContractEstamp(c.id, { estampCertificateNo: "X", estampDate: null, estampAmountMinor: null, estampAuthority: null })).toBeUndefined();
    expect((await recordProofUpload(OWNER(), c.id, upload("newer.pdf"))).ok).toBe(true);
    expect(world().contracts[0].proofFileName).toBe("newer.pdf");
  });
  it("an older online-signed row: invoiceable, verified, and nothing can overwrite it", async () => {
    const c = draft();
    const token = ((await createAgreementSignLink(OWNER(), c.id)) as any).url.slice(3);
    await signOnline(c.id, token);
    expect(await invoiceAgreementFor(OWNER(), c.dealId, undefined)).toMatchObject({ ok: true });
    expect(await checkProofUpload(OWNER(), c.id)).toMatchObject({ ok: false, code: "signed_online" });
    expect(await createAgreementSignLink(OWNER(), c.id)).toMatchObject({ ok: false, status: 409 });
    expect(await world().storage.setContractEstamp(c.id, { estampCertificateNo: "X", estampDate: null, estampAmountMinor: null, estampAuthority: null })).toBeUndefined();
    expect(integrity(c.id)).toBe("verified");
  });
});

describe("partial and split invoices, and invoices that name no agreement", () => {
  const signedAgreement = async () => { const c = draft(); await recordProofUpload(OWNER(), c.id, upload()); return c; };
  it("partial invoices on a signed agreement: each within what's left, then fully invoiced", async () => {
    const c = await signedAgreement();
    const half = c.contractValueMinor / 2;
    expect(await executeCreateInvoice({ dealId: c.dealId, contractId: c.id, amountPercent: 50, invoiceType: "advance" }, OWNER())).toMatchObject({ ok: true });
    expect(await executeCreateInvoice({ dealId: c.dealId, contractId: c.id, invoiceType: "final" }, OWNER())).toMatchObject({ ok: true });
    expect(world().invoices.map((i) => [i.invoiceType, i.dealAmountMinor, i.contractId])).toEqual([["advance", half, c.id], ["final", half, c.id]]);
    expect(await executeCreateInvoice({ dealId: c.dealId, contractId: c.id }, OWNER())).toMatchObject({ ok: false, message: expect.stringMatching(/fully invoiced/) });
  });
  it("a partial invoice on an unsigned agreement is refused; nothing is created", async () => {
    const c = draft();
    expect(await executeCreateInvoice({ dealId: c.dealId, contractId: c.id, amountPercent: 30 }, OWNER())).toMatchObject({ ok: false });
    expect(world().invoices).toHaveLength(0);
  });
  it("the split route's check (the deal's own agreement, none named): unsigned refused, signed allowed", async () => {
    const unsigned = draft();
    expect(await invoiceAgreementFor(OWNER(), unsigned.dealId, undefined)).toMatchObject({ ok: false, status: 409 });
    const signed = await signedAgreement();
    expect(await invoiceAgreementFor(OWNER(), signed.dealId, undefined)).toMatchObject({ ok: true, contract: { id: signed.id } });
  });
  it("no contractId: an unsigned agreement on the deal still blocks it; a signed one is attached (so its ceiling applies); no agreement keeps the deal-only invoice", async () => {
    const unsigned = draft();
    expect(await executeCreateInvoice({ dealId: unsigned.dealId }, OWNER())).toMatchObject({ ok: false });
    const signed = await signedAgreement();
    expect(await executeCreateInvoice({ dealId: signed.dealId }, OWNER())).toMatchObject({ ok: true });
    expect(world().invoices.at(-1)!.contractId).toBe(signed.id);
    const bare = seedDeal(world());
    expect(await executeCreateInvoice({ dealId: bare.id }, OWNER())).toMatchObject({ ok: true });
    expect(world().invoices.at(-1)!).toMatchObject({ dealId: bare.id, contractId: null });
  });
});

describe("proof upload versus online signature: whichever lands first wins, never both", () => {
  it("proof first: the client's later signature is refused and the uploaded copy stands", async () => {
    const c = draft();
    const token = ((await createAgreementSignLink(OWNER(), c.id)) as any).url.slice(3);
    expect((await recordProofUpload(OWNER(), c.id, upload())).ok).toBe(true);
    expect(await signOnline(c.id, token)).toBeUndefined();
    expect(world().contracts[0]).toMatchObject({ status: "Signed", signedByBrand: true, clientSignedAt: null, proofFileName: "signed.pdf" });
  });
  it("both at once, many times: exactly one wins, and the record is always one or the other, never a mix", async () => {
    for (let i = 0; i < 20; i++) {
      useWorld(createWorld());
      const c = draft();
      const token = ((await createAgreementSignLink(OWNER(), c.id)) as any).url.slice(3);
      const order = i % 2 === 0;
      const [proof, sig] = order
        ? await Promise.all([recordProofUpload(OWNER(), c.id, upload()), signOnline(c.id, token)])
        : await Promise.all([signOnline(c.id, token), recordProofUpload(OWNER(), c.id, upload())]).then(([s, p]) => [p, s] as const);
      const row = world().contracts[0];
      expect(Number(proof.ok) + Number(!!sig), `run ${i}`).toBe(1);
      if (sig) { expect(row.proofFilePath).toBeUndefined(); expect(integrity(c.id)).toBe("verified"); }
      else { expect(row.clientSignedAt).toBeNull(); expect(row.proofFileName).toBe("signed.pdf"); }
    }
  });
});

describe("follow-up: invoice documents (attachments)", () => {
  const seedInvoiceRow = (org = "org-1") => { const deal = seedDeal(world()); const inv = { id: 960 + world().invoices.length, organizationId: org, userId: org === "org-1" ? "u1" : "u2", dealId: deal.id }; world().invoices.push(inv); return inv; };
  const store = () => { const rows: Row[] = []; world().storage.createInvoiceAttachment = async (a: Row) => { const r = { id: rows.length + 1, ...a }; rows.push(r); return r; }; world().storage.getInvoiceAttachment = async (id: number) => rows.find((r) => r.id === id); return rows; };
  it("download needs invoice access: a custom role without it is refused; ACCOUNTS may", async () => {
    const rows = store(); const inv = seedInvoiceRow();
    rows.push({ id: 1, brandInvoiceId: inv.id, fileUrl: "/uploads/1791849718123-7.pdf", fileName: "r.pdf" });
    expect(await attachmentDownload(CUSTOM_NO_AGREEMENTS(), 1)).toMatchObject({ ok: false, status: 403 });
    expect(await attachmentDownload(ACCOUNTS(), 1)).toMatchObject({ ok: true });
  });
  it("upload: content must match the extension; the stored type is the checked one; refusals and failures remove the temporary file", async () => {
    const rows = store(); const inv = seedInvoiceRow();
    const fake = upload("receipt.png", "%PDF-1.7 not a png");
    expect(await recordAttachmentUpload(OWNER(), inv.id, fake, "Other")).toMatchObject({ ok: false, status: 400, code: "file_content" });
    expect(fs.existsSync(fake.path)).toBe(false);
    const foreign = upload("r.pdf");
    expect(await recordAttachmentUpload(OTHER_ORG(), inv.id, foreign, "Other")).toMatchObject({ ok: false, status: 403 });
    expect(fs.existsSync(foreign.path)).toBe(false);
    world().storage.createInvoiceAttachment = async () => { throw new Error("db down"); };
    const failing = upload("r.pdf");
    await expect(recordAttachmentUpload(OWNER(), inv.id, failing, "Other")).rejects.toThrow("db down");
    expect(fs.existsSync(failing.path)).toBe(false);
    expect(rows).toHaveLength(0);
  });
  it("upload: a good file is stored with a safe name and the checked type; with ImageKit the remote copy is deleted if saving fails", async () => {
    const rows = store(); const inv = seedInvoiceRow();
    const good = { ...upload("../x/My \"receipt\".pdf"), filename: "1791849718123-5.pdf" };
    expect(await recordAttachmentUpload(OWNER(), inv.id, good, "nonsense")).toMatchObject({ ok: true });
    expect(rows[0]).toMatchObject({ fileName: "My receipt.pdf", mimeType: "application/pdf", category: "Other", fileUrl: "/uploads/1791849718123-5.pdf" });
    expect(fs.existsSync(good.path)).toBe(true); // a local upload is the stored document
    ik.on = true;
    world().storage.createInvoiceAttachment = async () => { throw new Error("db down"); };
    await expect(recordAttachmentUpload(OWNER(), inv.id, upload("r.pdf"), "Other")).rejects.toThrow();
    expect(ik.deleted).toEqual(["f1"]);
  });
  it("upload is refused before the file is accepted for another org or a lapsed plan", async () => {
    const inv = seedInvoiceRow();
    expect(await checkAttachmentUpload(OTHER_ORG(), inv.id)).toMatchObject({ ok: false, status: 403 });
    world().billing.set("org-1", { id: "u1", plan: "free" });
    expect(await checkAttachmentUpload(OWNER(), inv.id)).toMatchObject({ ok: false, code: "UPGRADE_REQUIRED" });
  });
});

describe("follow-up: e-stamp details are frozen once the client has signed", () => {
  const stamp = { estampCertificateNo: "IN-DL12345", estampDate: "2026-10-01", estampAmountMinor: 50_000, estampAuthority: "SHCIL" };
  it("editable on a Draft; refused after an online signature or an owner-attested copy", async () => {
    const a = draft();
    expect(await world().storage.setContractEstamp(a.id, stamp)).toMatchObject(stamp);
    const token = ((await createAgreementSignLink(OWNER(), a.id)) as any).url.slice(3);
    await signOnline(a.id, token);
    expect(await world().storage.setContractEstamp(a.id, { ...stamp, estampCertificateNo: "IN-DL99999" })).toBeUndefined();
    expect(world().contracts.find((x) => x.id === a.id)!.estampCertificateNo).toBe("IN-DL12345");
    const b = draft();
    await recordProofUpload(OWNER(), b.id, upload());
    expect(await world().storage.setContractEstamp(b.id, stamp)).toBeUndefined();
  });
  it("the route checks first and storage decides at write time (an edit that read the row before signing is refused)", () => {
    const src = fs.readFileSync(path.join(__dirname, "../../routes.ts"), "utf8");
    const route = src.slice(src.indexOf('app.patch("/api/contracts/:id/estamp"'), src.indexOf('app.get("/api/contracts/:id/proof"'));
    expect(route).toContain("if (!canEditEstamp(contract))");
    expect(route).toContain("await storage.setContractEstamp(");
    expect(route).not.toContain("storage.updateContract(");
  });
});

describe("follow-up: the deal page uses the server's signed rule", () => {
  it("no screen gates invoicing on an uploaded proof file or on status alone", () => {
    for (const f of ["client/src/pages/deal-details.tsx", "client/src/pages/contract-details.tsx"]) {
      const src = fs.readFileSync(path.join(__dirname, "../../..", f), "utf8");
      expect(src, f).toContain("isAgreementSigned(");
      expect(src, f).not.toMatch(/hasProof|status (!==|===) "Signed"/);
    }
  });
});

describe("F: local uploads are organization-scoped, never public", () => {
  const SECRET = "test-session-secret";
  beforeEach(() => { process.env.SESSION_SECRET = SECRET; });
  afterEach(() => { delete process.env.SESSION_SECRET; delete (process.env as any).NODE_ENV_OVERRIDE; });
  const named = (user: any) => `1791849718123-42-${uploadTagFor(user)}.png`;
  it("a tagged upload is served to its own organization only (404 for another, so existence isn't confirmed)", async () => {
    const mine = named(OWNER());
    expect(await uploadAccess(OWNER(), mine)).toEqual({ ok: true, name: mine });
    expect(await uploadAccess(ACCOUNTS(), mine)).toMatchObject({ ok: true }); // same organization, other member
    expect(await uploadAccess(OTHER_ORG(), mine)).toMatchObject({ ok: false, status: 404 });
    expect(await uploadAccess(OWNER(), named(OTHER_ORG()))).toMatchObject({ ok: false, status: 404 });
  });
  it("an older untagged name: only when a server-written record of the requester's organization references it", async () => {
    const legacy = "1700000000000-555.pdf";
    expect(await uploadAccess(OWNER(), legacy)).toMatchObject({ ok: false, status: 404 });
    draft({ proofFilePath: `/old/host/uploads/${legacy}` });
    expect(await uploadAccess(OWNER(), legacy)).toMatchObject({ ok: true });
    expect(await uploadAccess(OTHER_ORG(), legacy)).toMatchObject({ ok: false, status: 404 });
    const doc = "1700000000000-777.png";
    const inv = { id: 990, organizationId: "org-1", userId: "u1", dealId: seedDeal(world()).id };
    world().invoices.push(inv);
    (world() as any).attachments = [{ id: 1, brandInvoiceId: inv.id, fileUrl: `/uploads/${doc}` }];
    expect(await uploadAccess(OWNER(), doc)).toMatchObject({ ok: true });
    expect(await uploadAccess(OTHER_ORG(), doc)).toMatchObject({ ok: false, status: 404 });
  });
  it("a client-written profile field never makes another organization's file readable", async () => {
    const victim = "1700000000000-999.png";
    draft({ organizationId: "org-2", userId: "u2", proofFilePath: `/uploads/${victim}` }); // the other org's own file
    world().users.get("u1")!.digitalSignature = `/uploads/${victim}`; // planted on the attacker's own profile
    expect(await uploadAccess(OWNER(), victim)).toMatchObject({ ok: false, status: 404 });
    expect(profileImageUpdateAllowed(OWNER(), "digitalSignature", `/uploads/${victim}`)).toBe(true); // only because it's already stored...
    world().users.get("u1")!.digitalSignature = null;
    expect(profileImageUpdateAllowed(OWNER(), "digitalSignature", `/uploads/${victim}`)).toBe(false); // ...it can't be set now
    expect(profileImageUpdateAllowed(OWNER(), "digitalSignature", `/uploads/${named(OWNER())}`)).toBe(true);
    expect(profileImageUpdateAllowed(OWNER(), "companySeal", `/uploads/${named(OTHER_ORG())}`)).toBe(false);
  });
  it("names that aren't upload names (traversal, dotfiles, encodings) are refused before any lookup", async () => {
    for (const bad of ["../.env", ".env", "%2e%2e%2fpackage.json", "1791849718123-1.pdf/..", "", null, "1791849718123-1.svg"]) {
      expect(await uploadAccess(OWNER(), bad), String(bad)).toMatchObject({ ok: false, status: 404 });
    }
  });
  it("production without ImageKit refuses uploads instead of writing to local disk, and removes the temporary file", async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const c = draft();
      const file = upload();
      expect(await recordProofUpload(OWNER(), c.id, file)).toMatchObject({ ok: false, status: 503, code: "storage_unavailable" });
      expect(fs.existsSync(file.path)).toBe(false);
      expect(world().contracts[0]).toMatchObject({ status: "Draft", signedByBrand: false });
      ik.on = true; // with ImageKit configured, production uploads proceed
      expect((await recordProofUpload(OWNER(), c.id, upload())).ok).toBe(true);
    } finally { process.env.NODE_ENV = prev; }
  });
  it("wiring: no static mount; every upload route refuses before multer; /uploads/:name needs the app session; profile image fields are checked", () => {
    const routes = fs.readFileSync(path.join(__dirname, "../../routes.ts"), "utf8");
    const index = fs.readFileSync(path.join(__dirname, "../../index.ts"), "utf8");
    expect(index).not.toMatch(/express\.static\([^)]*uploads/);
    expect(routes).not.toMatch(/express\.static\([^)]*uploads/);
    const singles = routes.match(/[^,\s]+, uploadSingle\(/g) ?? [];
    expect(singles.length).toBe(6);
    for (const s of singles) expect(s).toMatch(/^requireDurableUploads, uploadSingle\(/);
    expect(routes.match(/upload\.single\(/g)).toHaveLength(1); // only inside uploadSingle
    expect(routes).toMatch(/app\.get\("\/uploads\/:name", isAuthenticated, async/);
    expect(routes).toContain("profileImageUpdateAllowed(req.user, field, req.body[field])");
  });
});

describe("G: attachment and proof routes answer errors safely", () => {
  const routes = fs.readFileSync(path.join(__dirname, "../../routes.ts"), "utf8");
  const section = (from: string, to: string) => routes.slice(routes.indexOf(from), routes.indexOf(to, routes.indexOf(from)));
  it("no route returns a raw error message; the attachment and proof routes log with an error id", () => {
    expect(routes).not.toMatch(/reason:\s*msg/);
    // From the document list route to the end of the document delete route.
    const del = routes.indexOf('app.delete("/api/attachments/:id"');
    const docs = routes.slice(routes.indexOf('app.get("/api/brand-invoices/:id/attachments"'), routes.indexOf("\n  app.", del + 1));
    expect(docs.match(/sendInternalError\(res, "attachments"/g)).toHaveLength(5); // list, upload pre-check, upload, download, delete
    expect(docs).not.toMatch(/res\.status\(500\)/);
    expect(routes.match(/sendInternalError\(res, "proof"/g)).toHaveLength(3);
  });
  it("the proof upload page shows the server's reason (and a reference), not a blanket 'try again'", () => {
    const page = fs.readFileSync(path.join(__dirname, "../../../client/src/pages/contract-details.tsx"), "utf8");
    const mutation = page.slice(page.indexOf("const uploadProof = useMutation"), page.indexOf("const deleteBrandInvoice"));
    expect(mutation).toContain("parseApiError(err)");
    expect(mutation).toContain("parsed.errorId");
    expect(mutation).not.toContain('"Failed to upload proof. Please try again."');
  });
});
