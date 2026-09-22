/**
 * Client-facing agreement signing.
 *
 * Same split as server/quoteShare.ts (read that file's header first — same
 * token pattern, same rate limiter, same redaction discipline). The
 * difference here is that a successful sign is a BUSINESS EVENT: it sets
 * `contracts.status = "Signed"` and `signedByBrand = true`, exactly the state
 * the existing manual proof-upload path already produces (server/routes.ts,
 * POST /api/contracts/:id/proof) — this is a second way to reach that same
 * state, not a parallel one, so Money Radar, Deal Health, the workflow
 * stepper and the invoice ceiling all keep working with no change.
 *
 * Legal wording, unchanged from everywhere else this product says it:
 * electronic acceptance with an audit record, NOT a Digital Signature
 * Certificate or Aadhaar eSign.
 */
import type { Express } from "express";
import crypto from "crypto";
import { storage } from "./storage";
import { isAuthenticated } from "./auth";
import { memberCan } from "@shared/permissions";
import { hasProAccess } from "@shared/schema";
import { documentLocaleSettings } from "@shared/money";
import { buildAgreementShareSnapshot, computeDocumentHash, verifyDocumentHash } from "@shared/contractSign";
import { sendEmail, agreementSignedByClientEmail } from "./emails";
import { documentLocaleFor, issuedCurrency } from "./routes";
import { getBillingUser, logOrgActivity } from "./entitlements";

const inOrg = (resource: { organizationId?: string | null; userId?: string | null } | null | undefined, user: { id: string; organizationId?: string | null }): boolean => {
  if (!resource) return false;
  if (resource.organizationId) return resource.organizationId === user.organizationId;
  return resource.userId === user.id;
};

const newToken = () => crypto.randomBytes(24).toString("base64url");

const PER_IP_PER_DAY = 60;
const ipHits = new Map<string, { day: string; n: number }>();
function takeQuota(ip: string): boolean {
  const day = new Date().toISOString().slice(0, 10);
  const hit = ipHits.get(ip);
  if (!hit || hit.day !== day) {
    if (ipHits.size > 5000) ipHits.clear();
    ipHits.set(ip, { day, n: 1 });
    return true;
  }
  if (hit.n >= PER_IP_PER_DAY) return false;
  hit.n++;
  return true;
}

function clientIp(req: any): string {
  const cf = req.headers["cf-connecting-ip"];
  if (cf) return String(cf).trim();
  const xff = String(req.headers["x-forwarded-for"] || "").split(",").map((s: string) => s.trim()).filter(Boolean);
  return (xff.length ? xff[xff.length - 1] : req.ip || "unknown").trim() || "unknown";
}

/** A drawn signature as a small PNG data URL. Capped well under the DB's
 *  practical limits — this is a signature mark, not a photograph. */
const MAX_SIGNATURE_DATA_URL = 200_000;
function isValidSignatureDataUrl(v: unknown): v is string {
  return typeof v === "string" && v.length > 100 && v.length <= MAX_SIGNATURE_DATA_URL && v.startsWith("data:image/png;base64,");
}

export function registerAgreementSignRoutes(app: Express) {
  // ── Owner side: authenticated, org-scoped ──────────────────────────────

  app.get("/api/contracts/:id/sign-share", isAuthenticated, async (req: any, res) => {
    try {
      const contract = await storage.getContract(parseInt(req.params.id, 10));
      if (!contract || !inOrg(contract, req.user)) return res.status(404).json({ error: "Agreement not found" });
      if (!contract.clientShareToken || contract.clientShareRevokedAt) return res.json({ active: false, signed: contract.signedByBrand });
      res.json({
        active: true,
        signed: contract.signedByBrand,
        url: `/s/${contract.clientShareToken}`,
        sharedAt: contract.clientSharedAt,
        viewCount: contract.clientShareViewCount,
        signerName: contract.clientSignerName,
        signerEmail: contract.clientSignerEmail,
        signedAt: contract.clientSignedAt,
        documentIntegrity: contract.clientSignedAt ? verifyDocumentHash(contract, contract.documentHash) : null,
      });
    } catch (err) {
      console.error("[agreement-sign] status error:", err);
      res.status(500).json({ error: "Couldn't load the signing link." });
    }
  });

  app.post("/api/contracts/:id/sign-share", isAuthenticated, async (req: any, res) => {
    try {
      if (!memberCan(req.user, "agreements.create")) {
        return res.status(403).json({ error: "Your role doesn't allow sending this for signature." });
      }
      const contract = await storage.getContract(parseInt(req.params.id, 10));
      if (!contract || !inOrg(contract, req.user)) return res.status(404).json({ error: "Agreement not found" });
      if (contract.signedByBrand) return res.status(409).json({ error: "This agreement is already signed." });

      const billing = await getBillingUser(req.user);
      if (!hasProAccess(billing)) return res.status(403).json({ error: "Agreements are a Pro feature." });

      const deal = await storage.getDeal(contract.dealId);
      const settings = await documentLocaleFor(req.user, contract);
      const issuerName = [req.user.firstName, req.user.lastName].filter(Boolean).join(" ") || req.user.email || "";
      const snapshot = buildAgreementShareSnapshot({
        issuerName,
        contract,
        dealStandardTermIds: (deal?.standardTermIds as string[] | null) ?? [],
        dealCustomTerms: deal?.customTerms ?? null,
        settings,
      });

      const token = newToken();
      const updated = await storage.updateContract(contract.id, {
        clientShareToken: token,
        clientSignShareSnapshot: snapshot as any,
        clientSharedAt: new Date(),
        clientShareRevokedAt: null,
      });
      if (!updated) return res.status(500).json({ error: "Couldn't create the signing link." });
      res.json({ active: true, url: `/s/${token}`, sharedAt: updated.clientSharedAt });
    } catch (err) {
      console.error("[agreement-sign] create error:", err);
      res.status(500).json({ error: "Couldn't create the signing link." });
    }
  });

  app.post("/api/contracts/:id/sign-share/revoke", isAuthenticated, async (req: any, res) => {
    try {
      if (!memberCan(req.user, "agreements.create")) {
        return res.status(403).json({ error: "Your role doesn't allow revoking this link." });
      }
      const contract = await storage.getContract(parseInt(req.params.id, 10));
      if (!contract || !inOrg(contract, req.user)) return res.status(404).json({ error: "Agreement not found" });
      await storage.updateContract(contract.id, { clientShareRevokedAt: new Date() });
      res.json({ active: false });
    } catch (err) {
      console.error("[agreement-sign] revoke error:", err);
      res.status(500).json({ error: "Couldn't revoke the signing link." });
    }
  });

  // ── Public side: no session, token-only, rate-limited ──────────────────

  app.get("/api/public/agreements/:token", async (req: any, res) => {
    try {
      if (!takeQuota(clientIp(req))) return res.status(429).json({ error: "Too many requests. Try again shortly." });
      const token = String(req.params.token || "");
      if (token.length < 30 || token.length > 40) return res.status(404).json({ error: "Agreement not found." });
      const contract = await storage.getContractByShareToken(token);
      if (!contract || contract.clientShareRevokedAt || !contract.clientSignShareSnapshot) {
        return res.status(404).json({ error: "This signing link is no longer available." });
      }
      storage.updateContract(contract.id, { clientShareViewCount: (contract.clientShareViewCount ?? 0) + 1 }).catch(() => {});
      res.json({
        snapshot: contract.clientSignShareSnapshot,
        signed: contract.signedByBrand,
        signedAt: contract.clientSignedAt,
        signerName: contract.clientSignerName,
        signerEmail: contract.clientSignerEmail,
        documentIntegrity: contract.clientSignedAt ? verifyDocumentHash(contract, contract.documentHash) : null,
      });
    } catch (err) {
      console.error("[agreement-sign] public view error:", err);
      res.status(500).json({ error: "Couldn't load this agreement." });
    }
  });

  app.post("/api/public/agreements/:token/sign", async (req: any, res) => {
    try {
      if (!takeQuota(clientIp(req))) return res.status(429).json({ error: "Too many requests. Try again shortly." });
      const token = String(req.params.token || "");
      const contract = await storage.getContractByShareToken(token);
      if (!contract || contract.clientShareRevokedAt || !contract.clientSignShareSnapshot) {
        return res.status(404).json({ error: "This signing link is no longer available." });
      }
      // Terminal check FIRST, before touching anything the model/client sent:
      // whichever path signs first wins, and a second attempt (online after a
      // manual proof upload, or a resubmit) is refused, never overwritten.
      if (contract.signedByBrand) {
        return res.status(409).json({ error: "This agreement has already been signed.", signedAt: contract.clientSignedAt });
      }

      const signerName = String(req.body?.signerName || "").trim().slice(0, 120);
      if (signerName.length < 2) return res.status(400).json({ error: "Please enter the signer's full name." });
      const signerEmailRaw = String(req.body?.signerEmail || "").trim().slice(0, 200);
      const signerEmail = signerEmailRaw && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signerEmailRaw) ? signerEmailRaw : null;
      if (!isValidSignatureDataUrl(req.body?.signatureDataUrl)) {
        return res.status(400).json({ error: "Please draw a signature before signing." });
      }
      if (req.body?.agree !== true) {
        return res.status(400).json({ error: "Please confirm you agree to sign electronically." });
      }

      const now = new Date();
      // The hash covers exactly the fields being written here — computed from
      // the SAME values before they're stored, not re-read afterwards, so it
      // can never drift from what verifyDocumentHash later recomputes.
      const documentHash = computeDocumentHash({
        clientSignShareSnapshot: contract.clientSignShareSnapshot,
        clientSignerName: signerName,
        clientSignerEmail: signerEmail,
        clientSignatureDataUrl: req.body.signatureDataUrl,
        clientSignedAt: now,
      });
      const updated = await storage.updateContract(contract.id, {
        status: "Signed",
        signedByBrand: true,
        signedDate: now.toISOString().slice(0, 10),
        clientSignedAt: now,
        clientSignerName: signerName,
        clientSignerEmail: signerEmail,
        clientSignatureDataUrl: req.body.signatureDataUrl,
        clientSignerIp: clientIp(req),
        documentHash,
      });
      if (!updated) return res.status(500).json({ error: "Couldn't record the signature." });

      // Best-effort notification — never blocks the client's confirmation.
      const deal = await storage.getDeal(contract.dealId);
      const owner = await storage.getUser(contract.userId);
      if (owner?.email) {
        const settings = documentLocaleSettings(
          contract.organizationId ? await storage.getOrganization(contract.organizationId) : undefined,
          owner,
          issuedCurrency(contract) ? { currency: issuedCurrency(contract)! } : null,
        );
        const { subject, html } = agreementSignedByClientEmail({
          firstName: owner.firstName || undefined,
          clientName: contract.brandName,
          contractName: contract.contractName,
          amountMinor: contract.contractValueMinor,
          contractId: contract.id,
          signerName,
          locale: settings,
        });
        void sendEmail({ to: owner.email, subject, html });
      }
      if (deal && owner) {
        logOrgActivity(owner, "signed online", "agreement", contract.id, `Signed by ${signerName} for ${contract.brandName}`);
      }

      res.json({ ok: true, signedAt: now });
    } catch (err) {
      console.error("[agreement-sign] sign error:", err);
      res.status(500).json({ error: "Couldn't record the signature. Please try again." });
    }
  });
}
