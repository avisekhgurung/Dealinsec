/**
 * The agreement lifecycle, and which agreement fields a client may ever set.
 *
 * Pure: no database, no request. The server's create route and Copilot parse
 * the create body here; storage enforces the protected-field rule and mirrors
 * the transition conditions in its atomic UPDATE ... WHERE clauses (see
 * server/storage.ts — the in-memory evaluation world uses these same
 * predicates, so the two are checked against one definition).
 *
 *   create ─────────────▶ Draft
 *   share (link made) ──▶ Pending          only from Draft; never once signed
 *   revoke ─────────────▶ Draft            only from Pending, never once signed
 *   sign_online ────────▶ Signed           the client signs on the public link
 *   proof ──────────────▶ Signed           owner-attested: the OWNER uploads a
 *                                          signed copy. It records the owner's
 *                                          statement, not a verified signer
 *                                          identity, and can never replace an
 *                                          online signature.
 *
 * Existing rows are left as they are. Rows created before this lifecycle may
 * read "Signed" (the old web create sent it), "Active" or "Pending" without a
 * signature; isAgreementSigned keeps reading them exactly as every screen did.
 */
import { z } from "zod";
import { insertContractSchema } from "./schema";

export type AgreementStatus = "Draft" | "Pending" | "Signed";

interface LifecycleRow {
  status?: string | null;
  signedByBrand?: boolean | null;
  clientSignedAt?: Date | string | null;
  clientShareToken?: string | null;
  clientShareRevokedAt?: Date | string | null;
}

/** The one definition of "signed" for invoicing, Money Radar and the workflow: unchanged from what every reader used. */
export const isAgreementSigned = (c: LifecycleRow | null | undefined): boolean =>
  !!c && (c.status === "Signed" || !!c.signedByBrand);

/** Signed by the client on the public link (has a sign time). A proof upload never sets this. */
export const isSignedOnline = (c: LifecycleRow | null | undefined): boolean => !!c?.clientSignedAt;

// ── Create: an allowlist, not a denylist ─────────────────────────────────

/** The only fields a client chooses when creating an agreement. */
export const CONTRACT_CREATE_FIELDS = ["dealId", "contractName", "brandName", "startDate", "endDate", "contractValueMinor", "exclusive"] as const;

/** Sent by web clients from before this change; accepted only to be dropped. A client-sent "Signed" is never used. */
const DROPPED_LEGACY_KEYS = ["currency", "status"];

export const contractCreateBodySchema = insertContractSchema.pick({
  dealId: true, contractName: true, brandName: true, startDate: true, endDate: true, contractValueMinor: true, exclusive: true,
});
export type ContractCreateBody = z.infer<typeof contractCreateBodySchema>;

export type ContractCreateParse =
  | { ok: true; data: ContractCreateBody }
  | { ok: false; code: "unexpected_field"; fields: string[] }
  | { ok: false; code: "invalid"; issues: z.ZodIssue[] };

/** Strict: any key outside the allowlist (and the two dropped legacy keys) refuses the whole request. */
export function parseContractCreateBody(body: unknown): ContractCreateParse {
  const raw = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const allowed = new Set<string>([...CONTRACT_CREATE_FIELDS, ...DROPPED_LEGACY_KEYS]);
  const unexpected = Object.keys(raw).filter((k) => !allowed.has(k));
  if (unexpected.length) return { ok: false, code: "unexpected_field", fields: unexpected.slice(0, 20).map((k) => k.slice(0, 60)) };
  const picked: Record<string, unknown> = {};
  for (const k of CONTRACT_CREATE_FIELDS) if (k in raw) picked[k] = raw[k];
  const parsed = contractCreateBodySchema.safeParse(picked);
  if (!parsed.success) return { ok: false, code: "invalid", issues: parsed.error.errors };
  return { ok: true, data: parsed.data };
}

// ── Fields only the server's dedicated paths may write ───────────────────

/**
 * Never written by a general update. Status, signature, share and proof
 * fields change only through storage's dedicated methods (share, revoke,
 * claim signature, record proof, revise unsigned); identity and issuer
 * fields are set once, at creation, by the server.
 */
export const PROTECTED_CONTRACT_FIELDS = [
  // status and signing
  "status", "signedByBrand", "signedDate",
  "clientSignedAt", "clientSignerName", "clientSignerEmail", "clientSignatureDataUrl", "clientSignerIp", "documentHash",
  // the public signing link
  "clientShareToken", "clientSignShareSnapshot", "clientSharedAt", "clientShareRevokedAt",
  // the owner-attested proof
  "proofFilePath", "proofFileName",
  // the e-stamp reference: it prints on the agreement, so it is frozen once the client has signed
  "estampCertificateNo", "estampDate", "estampAmountMinor", "estampAuthority",
  // identity and issue
  "id", "userId", "organizationId", "dealId", "currency", "issuerSnapshot",
  // the issuer's own signature
  "signerUserId", "signerName", "signatureUrl", "sealUrl", "signedByInfluencer", "signedByInfluencerDate",
] as const;
const PROTECTED = new Set<string>(PROTECTED_CONTRACT_FIELDS);

export class ProtectedContractFieldError extends Error {
  readonly code = "protected_contract_field";
  constructor(readonly fields: string[]) {
    super(`Refused a general update of protected agreement field(s): ${fields.join(", ")}`);
  }
}

export function protectedFieldsIn(updates: object): string[] {
  return Object.keys(updates).filter((k) => PROTECTED.has(k));
}
export function assertNoProtectedContractFields(updates: object): void {
  const hit = protectedFieldsIn(updates);
  if (hit.length) throw new ProtectedContractFieldError(hit);
}

/** The only fields a revision of an unsigned agreement may change (server/services/revisions.ts). */
export const REVISABLE_CONTRACT_FIELDS = ["contractName", "exclusive", "contractValueMinor", "startDate", "endDate"] as const;
export function assertRevisableOnly(updates: object): void {
  const allowed = new Set<string>(REVISABLE_CONTRACT_FIELDS);
  const bad = Object.keys(updates).filter((k) => !allowed.has(k));
  if (bad.length) throw new ProtectedContractFieldError(bad);
}

/** Every field a new agreement must start without; createContract refuses a row that sets any of them. */
const BLANK_AT_CREATE = [
  "signedDate", "clientSignedAt", "clientSignerName", "clientSignerEmail", "clientSignatureDataUrl", "clientSignerIp", "documentHash",
  "clientShareToken", "clientSignShareSnapshot", "clientSharedAt", "clientShareRevokedAt", "proofFilePath", "proofFileName",
] as const;
export function assertNewAgreementRow(row: Record<string, unknown>): void {
  const bad: string[] = [];
  if (row.status !== "Draft") bad.push("status");
  if (row.signedByBrand) bad.push("signedByBrand");
  for (const k of BLANK_AT_CREATE) if (row[k] !== undefined && row[k] !== null) bad.push(k);
  if (bad.length) throw new ProtectedContractFieldError(bad);
}

/** The server-owned part of a new agreement row: Draft, unsigned, no link, no proof. */
export function newAgreementLifecycleFields() {
  return {
    status: "Draft" as const,
    signedByBrand: false,
    signedDate: null,
    proofFileName: null, proofFilePath: null,
    clientShareToken: null, clientSignShareSnapshot: null, clientSharedAt: null, clientShareRevokedAt: null,
    clientSignedAt: null, clientSignerName: null, clientSignerEmail: null, clientSignatureDataUrl: null, clientSignerIp: null,
    documentHash: null,
  };
}

// ── Transitions (mirrored by storage's WHERE clauses) ────────────────────

/** A new signing link may be made only while nobody has signed. */
export const canShare = (c: LifecycleRow): boolean => !c.signedByBrand && !c.clientSignedAt;
/** Status after a share: Draft becomes Pending; any other status (including an older row's) is kept. */
export const statusAfterShare = (c: LifecycleRow): string => (c.status === "Draft" ? "Pending" : String(c.status ?? "Pending"));
/** Status after a revoke: an unsigned Pending goes back to Draft; anything else is kept. */
export const statusAfterRevoke = (c: LifecycleRow): string =>
  c.status === "Pending" && !c.signedByBrand && !c.clientSignedAt ? "Draft" : String(c.status ?? "Draft");
/** The client may sign only with the link that is live now, and only once. */
export const canClaimSignature = (c: LifecycleRow, token: string): boolean =>
  !c.signedByBrand && !c.clientSignedAt && !!token && c.clientShareToken === token && !c.clientShareRevokedAt;
/** An owner-attested proof may be recorded unless the client signed online (it may replace an earlier proof). */
export const canRecordProof = (c: LifecycleRow): boolean => !c.clientSignedAt;
/** A revision may change only an agreement nobody has signed. */
export const canRevise = (c: LifecycleRow): boolean => !c.signedByBrand && !c.clientSignedAt;
/**
 * The e-stamp reference prints on the agreement but is not part of the signed
 * snapshot or its hash, so once the client has signed (online, or by an
 * owner-attested copy) it is frozen: otherwise a "signed" document could show a
 * stamp the client never saw. An older row stored as "Signed" that no client
 * ever signed stays editable.
 */
export const canEditEstamp = (c: LifecycleRow): boolean => !c.signedByBrand && !c.clientSignedAt;

// ── Invoicing ────────────────────────────────────────────────────────────

export type InvoiceEligibility =
  | { ok: true }
  | { ok: false; code: "agreement_not_signed" | "agreement_other_deal"; message: string };

/**
 * Whether a deal's invoice may be raised against its agreement. The server
 * decides this, not the screen: an agreement that exists must be signed (the
 * same isAgreementSigned every screen uses). A deal with no agreement yet is
 * not judged here — that is the existing deal-only invoice, kept as it was.
 */
export function invoiceEligibility(agreement: (LifecycleRow & { dealId?: number | null }) | null | undefined, dealId: number): InvoiceEligibility {
  if (!agreement) return { ok: true };
  if (agreement.dealId != null && agreement.dealId !== dealId) return { ok: false, code: "agreement_other_deal", message: "This agreement belongs to a different deal." };
  if (!isAgreementSigned(agreement)) {
    return { ok: false, code: "agreement_not_signed", message: "This agreement isn't signed yet. Send it for signature or upload the signed copy before invoicing." };
  }
  return { ok: true };
}
