/**
 * Client-facing quotation sharing.
 *
 * A signed-in freelancer creates a share link for a deal's current quotation;
 * the link needs no account to view. The public route returns ONLY the frozen,
 * redacted snapshot in shared/quoteShare.ts — never the live deal, never the
 * issuer's profile. See shared/schema.ts (the `quotes` share columns) and
 * script/migrate-quote-share.ts for the storage this depends on.
 *
 * Authorization split, as required:
 *  - creating/revoking a link: authenticated, org-scoped, same permission as
 *    generating the quotation itself (quotations.create).
 *  - viewing/accepting a link: PUBLIC, no session, rate-limited per IP,
 *    looked up ONLY by the opaque token (never by deal id or quote id).
 */
import type { Express } from "express";
import crypto from "crypto";
import { storage } from "./storage";
import { isAuthenticated } from "./auth";
import { memberCan } from "@shared/permissions";
import { documentLocaleSettings } from "@shared/money";
import { buildQuoteShareSnapshot } from "@shared/quoteShare";
import { sendEmail, quoteAcceptedEmail } from "./emails";
import { documentLocaleFor } from "./routes";

const inOrg = (resource: { organizationId?: string | null; userId?: string | null } | null | undefined, user: { id: string; organizationId?: string | null }): boolean => {
  if (!resource) return false;
  if (resource.organizationId) return resource.organizationId === user.organizationId;
  return resource.userId === user.id;
};

/** A capability URL's token: 192 bits, base64url so it drops cleanly into a
 *  path segment with nothing to escape. Not a hash target (see shared/schema
 *  for why this one is stored plain, unlike the password-reset token). */
const newToken = () => crypto.randomBytes(24).toString("base64url");

/* ── Public-endpoint rate limiting — the same lightweight per-IP + daily
   pattern already used for the public Copilot guide and the free AI tool. ── */
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

/** Real client IP behind Cloudflare — see the identical comment on
 *  POST /api/ai/invoice in routes.ts for why CF-Connecting-IP is the one
 *  header here that cannot be spoofed by the client. */
function clientIp(req: any): string {
  const cf = req.headers["cf-connecting-ip"];
  if (cf) return String(cf).trim();
  const xff = String(req.headers["x-forwarded-for"] || "").split(",").map((s: string) => s.trim()).filter(Boolean);
  return (xff.length ? xff[xff.length - 1] : req.ip || "unknown").trim() || "unknown";
}

export function registerQuoteShareRoutes(app: Express) {
  // ── Owner side: authenticated, org-scoped ──────────────────────────────

  app.get("/api/deals/:id/quote/share", isAuthenticated, async (req: any, res) => {
    try {
      const deal = await storage.getDeal(parseInt(req.params.id, 10));
      if (!deal || !inOrg(deal, req.user)) return res.status(404).json({ error: "Deal not found" });
      const quote = await storage.getQuoteByDealId(deal.id);
      if (!quote) return res.status(404).json({ error: "No quotation for this deal yet" });
      if (!quote.shareToken || quote.shareRevokedAt) {
        return res.json({ active: false });
      }
      res.json({
        active: true,
        token: quote.shareToken,
        url: `/d/${quote.shareToken}`,
        sharedAt: quote.sharedAt,
        viewCount: quote.shareViewCount,
        acceptedAt: quote.acceptedAt,
      });
    } catch (err) {
      console.error("[quote-share] status error:", err);
      res.status(500).json({ error: "Couldn't load the share link." });
    }
  });

  app.post("/api/deals/:id/quote/share", isAuthenticated, async (req: any, res) => {
    try {
      if (!memberCan(req.user, "quotations.create")) {
        return res.status(403).json({ error: "Your role doesn't allow sharing quotations." });
      }
      const deal = await storage.getDeal(parseInt(req.params.id, 10));
      if (!deal || !inOrg(deal, req.user)) return res.status(404).json({ error: "Deal not found" });
      const quote = await storage.getQuoteByDealId(deal.id);
      if (!quote) return res.status(400).json({ error: "Generate the quotation before sharing it." });

      const settings = await documentLocaleFor(req.user);
      const issuerName = [req.user.firstName, req.user.lastName].filter(Boolean).join(" ") || req.user.email || "";
      const snapshot = buildQuoteShareSnapshot({ issuerName, deal, quoteId: quote.id, version: quote.version, settings });

      const token = newToken();
      const updated = await storage.updateQuote(quote.id, {
        shareToken: token,
        shareSnapshot: snapshot as any,
        sharedAt: new Date(),
        shareRevokedAt: null,
        acceptedAt: null, // a re-share (edited deal) starts the acceptance signal over
      });
      if (!updated) return res.status(500).json({ error: "Couldn't create the share link." });

      res.json({ active: true, token, url: `/d/${token}`, sharedAt: updated.sharedAt });
    } catch (err) {
      console.error("[quote-share] create error:", err);
      res.status(500).json({ error: "Couldn't create the share link." });
    }
  });

  app.post("/api/deals/:id/quote/share/revoke", isAuthenticated, async (req: any, res) => {
    try {
      if (!memberCan(req.user, "quotations.create")) {
        return res.status(403).json({ error: "Your role doesn't allow revoking this link." });
      }
      const deal = await storage.getDeal(parseInt(req.params.id, 10));
      if (!deal || !inOrg(deal, req.user)) return res.status(404).json({ error: "Deal not found" });
      const quote = await storage.getQuoteByDealId(deal.id);
      if (!quote) return res.status(404).json({ error: "No quotation for this deal." });
      await storage.updateQuote(quote.id, { shareRevokedAt: new Date() });
      res.json({ active: false });
    } catch (err) {
      console.error("[quote-share] revoke error:", err);
      res.status(500).json({ error: "Couldn't revoke the share link." });
    }
  });

  // ── Public side: no session, token-only, rate-limited ──────────────────

  app.get("/api/public/quotes/:token", async (req: any, res) => {
    try {
      if (!takeQuota(clientIp(req))) return res.status(429).json({ error: "Too many requests. Try again shortly." });
      const token = String(req.params.token || "");
      // Exact-length check before it ever reaches the database: newToken()
      // always produces this length, so anything else cannot be a real token.
      if (token.length < 30 || token.length > 40) return res.status(404).json({ error: "Quotation not found." });
      const quote = await storage.getQuoteByShareToken(token);
      if (!quote || quote.shareRevokedAt || !quote.shareSnapshot) {
        return res.status(404).json({ error: "This quotation link is no longer available." });
      }
      // Best-effort: a lost view count is not worth failing the request over.
      storage.updateQuote(quote.id, { shareViewCount: (quote.shareViewCount ?? 0) + 1 }).catch(() => {});
      res.json({ snapshot: quote.shareSnapshot, acceptedAt: quote.acceptedAt });
    } catch (err) {
      console.error("[quote-share] public view error:", err);
      res.status(500).json({ error: "Couldn't load this quotation." });
    }
  });

  app.post("/api/public/quotes/:token/accept", async (req: any, res) => {
    try {
      if (!takeQuota(clientIp(req))) return res.status(429).json({ error: "Too many requests. Try again shortly." });
      const token = String(req.params.token || "");
      // Same exact-length gate as the GET route — newToken() always produces
      // this length, so anything else cannot be a real token and is rejected
      // before it ever reaches the database.
      if (token.length < 30 || token.length > 40) return res.status(404).json({ error: "This quotation link is no longer available." });
      const quote = await storage.getQuoteByShareToken(token);
      if (!quote || quote.shareRevokedAt || !quote.shareSnapshot) {
        return res.status(404).json({ error: "This quotation link is no longer available." });
      }
      if (quote.acceptedAt) return res.json({ ok: true, acceptedAt: quote.acceptedAt }); // idempotent
      const acceptedAt = new Date();
      await storage.updateQuote(quote.id, { acceptedAt });

      // Best-effort notification — never blocks the client's confirmation.
      const deal = await storage.getDeal(quote.dealId);
      if (deal) {
        const owner = await storage.getUser(deal.userId);
        if (owner?.email) {
          const settings = documentLocaleSettings(
            deal.organizationId ? await storage.getOrganization(deal.organizationId) : undefined,
            owner,
          );
          const { subject, html } = quoteAcceptedEmail({
            firstName: owner.firstName || undefined,
            clientName: deal.brandName,
            dealTitle: deal.dealTitle,
            amountMinor: deal.dealAmountMinor,
            dealId: deal.id,
            locale: settings,
          });
          void sendEmail({ to: owner.email, subject, html });
        }
      }
      res.json({ ok: true, acceptedAt });
    } catch (err) {
      console.error("[quote-share] accept error:", err);
      res.status(500).json({ error: "Couldn't record acceptance. Please try again." });
    }
  });
}
