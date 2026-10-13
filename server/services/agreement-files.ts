/**
 * Agreement proof upload, proof and attachment downloads, and invoice
 * eligibility — the server-side rules the REST routes and Copilot share.
 *
 * Moved out of server/routes.ts so the rules run (and are tested) in one
 * place; the routes only translate results to HTTP. Every stored path or URL
 * is untrusted (see server/stored-files.ts), and a proof upload is the
 * OWNER's attestation that the client signed a copy — it is recorded as
 * such, never as a verified signer identity, and it can never replace a
 * signature the client made online.
 */
import fs from "fs";
import path from "path";
import { canReadModule, memberCan } from "@shared/permissions";
import { hasProAccess, type Contract, type User } from "@shared/schema";
import { invoiceEligibility, isSignedOnline } from "@shared/agreement-lifecycle";
import { storage } from "../storage";
import { getBillingUser, logOrgActivity } from "../entitlements";
import { isImageKitConfigured, uploadFileToImageKit, deleteFromImageKit } from "../imagekitClient";
import { classifyStoredFile, contentMatchesExtension, safeDownloadName, type StoredFileDecision } from "../stored-files";

export type Fail = { ok: false; status: number; code: string; error: string };
const fail = (status: number, code: string, error: string): Fail => ({ ok: false, status, code, error });

const inOrg = (r: { organizationId?: string | null; userId?: string | null } | null | undefined, user: { id: string; organizationId?: string | null }) =>
  !!r && (r.organizationId ? r.organizationId === user.organizationId : r.userId === user.id);

/** Where this app's own uploads live (multer's destination in server/routes.ts). */
export const UPLOAD_DIR = path.join(process.cwd(), "uploads");
const storedFileConfig = () => ({ imagekitEndpoint: process.env.IMAGEKIT_URL_ENDPOINT ?? null, uploadDir: UPLOAD_DIR });

/** Remove a temporary upload, awaited so the request doesn't finish with the file still on disk. Never throws. */
const removeTemp = async (p: string | undefined) => { if (p) await fs.promises.unlink(p).catch(() => {}); };

async function firstBytes(file: string, n = 16): Promise<Uint8Array> {
  const fh = await fs.promises.open(file, "r");
  try {
    const buf = Buffer.alloc(n);
    const { bytesRead } = await fh.read(buf, 0, n, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

// ── Proof upload ─────────────────────────────────────────────────────────

/**
 * Everything decidable before a file is accepted: role, plan, organization,
 * and that the client hasn't already signed online. Runs before multer writes
 * the upload, and again after it (the agreement may have changed meanwhile).
 */
export async function checkProofUpload(user: User, contractId: number): Promise<{ ok: true; contract: Contract } | Fail> {
  if (!memberCan(user, "agreements.create")) return fail(403, "FORBIDDEN", "Your role doesn't allow uploading signed proof.");
  if (!hasProAccess(await getBillingUser(user))) return fail(403, "UPGRADE_REQUIRED", "Creating agreements requires DealInSec Pro");
  if (!Number.isFinite(contractId)) return fail(404, "not_found", "Contract not found");
  const contract = await storage.getContract(contractId);
  if (!contract) return fail(404, "not_found", "Contract not found");
  if (!inOrg(contract, user)) return fail(403, "forbidden", "Access denied");
  if (isSignedOnline(contract)) {
    return fail(409, "signed_online", "The client signed this agreement online. An uploaded copy can't replace that signature.");
  }
  return { ok: true, contract };
}

export interface UploadedFile { path: string; originalname: string; size: number }

/**
 * Record the owner-attested signed copy. The temporary upload is removed on
 * every refusal or failure; with ImageKit it is removed after the transfer.
 * Final rule in the database: storage.recordContractProof refuses if the
 * client signed online in the meantime.
 */
export async function recordProofUpload(user: User, contractId: number, file: UploadedFile | undefined): Promise<{ ok: true; contract: Contract } | Fail> {
  if (!file) return fail(400, "no_file", "No file uploaded");
  let kept = false;
  let remote: { fileId: string } | null = null;
  try {
    const check = await checkProofUpload(user, contractId);
    if (!check.ok) return check;
    if (!contentMatchesExtension(await firstBytes(file.path), file.originalname)) {
      return fail(400, "file_content", "That file isn't a real PDF, JPG, PNG or WEBP. Upload the signed agreement itself.");
    }
    let proofFilePath = file.path;
    if (isImageKitConfigured()) {
      const uploaded = await uploadFileToImageKit(file, { folder: "contracts", baseName: `contract-${contractId}-proof` });
      remote = { fileId: uploaded.fileId };
      proofFilePath = uploaded.url;
    }
    const updated = await storage.recordContractProof(contractId, {
      proofFileName: safeDownloadName(file.originalname, "contract-proof"),
      proofFilePath,
    });
    if (!updated) {
      if (remote) deleteFromImageKit(remote.fileId).catch(() => {});
      return fail(409, "signed_online", "The client signed this agreement online. An uploaded copy can't replace that signature.");
    }
    kept = !remote; // a local upload IS the stored proof; an ImageKit one was already cleaned up
    logOrgActivity(user, "uploaded signed proof (owner-attested) for", "agreement", contractId, check.contract.brandName);
    return { ok: true, contract: updated };
  } finally {
    if (!kept) await removeTemp(file.path);
  }
}

// ── Downloads ────────────────────────────────────────────────────────────

export type DownloadResult = { ok: true; decision: Exclude<StoredFileDecision, { type: "refuse" }>; downloadName: string } | Fail;

function served(decision: StoredFileDecision, what: string, id: number, user: User, downloadName: string): DownloadResult {
  if (decision.type === "refuse") {
    // The reason code and ids only — never the stored value.
    console.warn(`[stored-file] refused ${what} ${id} for user ${user.id}: ${decision.reason}`);
    return fail(404, "not_found", "File not available");
  }
  return { ok: true, decision, downloadName };
}

export async function proofDownload(user: User, contractId: number): Promise<DownloadResult> {
  if (!canReadModule(user, "agreements")) return fail(403, "FORBIDDEN", "Your role doesn't include access to agreements.");
  const contract = Number.isFinite(contractId) ? await storage.getContract(contractId) : undefined;
  if (!contract) return fail(404, "not_found", "Contract not found");
  if (!inOrg(contract, user)) return fail(403, "forbidden", "Access denied");
  if (!contract.proofFilePath) return fail(404, "no_proof", "No proof uploaded");
  return served(classifyStoredFile(contract.proofFilePath, "proof", storedFileConfig()), "proof", contract.id, user, safeDownloadName(contract.proofFileName, "contract-proof"));
}

export async function attachmentDownload(user: User, attachmentId: number): Promise<DownloadResult> {
  const attachment = Number.isFinite(attachmentId) ? await storage.getInvoiceAttachment(attachmentId) : undefined;
  if (!attachment) return fail(404, "not_found", "Document not found");
  const parentInvoice = await storage.getBrandInvoice(attachment.brandInvoiceId);
  if (!inOrg(parentInvoice, user)) return fail(403, "forbidden", "Access denied");
  return served(classifyStoredFile(attachment.fileUrl, "attachment", storedFileConfig()), "attachment", attachment.id, user, safeDownloadName(attachment.fileName, "document"));
}

// ── Invoice eligibility ──────────────────────────────────────────────────

/**
 * The agreement an invoice on this deal is raised against, if it may be.
 * The caller has already checked the deal is in the user's organization.
 * A deal's agreement is used even when the request names none, so leaving
 * contractId out can't skip the signed check or the agreement's ceiling.
 */
export async function invoiceAgreementFor(user: User, dealId: number, contractIdRaw: unknown): Promise<{ ok: true; contract: Contract | undefined } | Fail> {
  let chosen: Contract | undefined;
  if (contractIdRaw !== undefined && contractIdRaw !== null && contractIdRaw !== "") {
    const id = parseInt(String(contractIdRaw), 10);
    chosen = Number.isFinite(id) ? await storage.getContract(id) : undefined;
    if (!chosen || !inOrg(chosen, user)) return fail(403, "forbidden", "Not authorized for this agreement");
  } else {
    chosen = await storage.getContractByDealId(dealId);
    if (chosen && !inOrg(chosen, user)) return fail(403, "forbidden", "Not authorized for this agreement");
  }
  const e = invoiceEligibility(chosen, dealId);
  if (!e.ok) return fail(e.code === "agreement_other_deal" ? 400 : 409, e.code, e.message);
  return { ok: true, contract: chosen };
}
