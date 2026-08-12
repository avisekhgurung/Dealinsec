import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertFeedbackSchema, feedback, insertDealSchema, insertContractSchema, brandInvoices as brandInvoicesTable, newsletterSubscribers, invoiceDocumentCategories, invoiceLineItemSchema, brandInvoiceTypeOptions, hasActivePro, hasActiveDealBoost, hasProAccess, hasActiveTrial, getTrialDaysLeft, getDealCredits } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { db } from "./db";
import { setupAuth, isAuthenticated } from "./auth";
import { requirePro, requireOrgPermission, withOrg, getBillingUser, logOrgActivity , requireModuleRead, requireLinkedRead} from "./entitlements";
import { maybeStartTrial } from "./trial";
import { registerCopilotRoutes } from "./copilot/routes";
import { getSeatLimit, INVITABLE_ROLES, hasPermission as hasOrgPermission, orgRoleOptions, CUSTOM_ROLE, ASSIGNABLE_PERMISSIONS , canReadModule} from "@shared/permissions";
import { aiEnabled, reserve, refund, extractInvoice } from "./ai";
import { getUncachableStripeClient, getStripePublishableKey } from "./stripeClient";
import multer from "multer";
import { z } from "zod";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { uploadFileToImageKit, isImageKitConfigured, deleteFromImageKit } from "./imagekitClient";
import {
  isRazorpayConfigured,
  getRazorpayKeyId,
  getProMonthlyPrice,
  getProYearlyPrice,
  getDealBoostPrice,
  getExtraSeatPrice,
  PRO_MONTHLY_DAYS,
  PRO_YEARLY_DAYS,
  DEAL_BOOST_DAYS,
  EXTRA_SEAT_DAYS,
  createRazorpayOrder,
  verifyPaymentSignature,
  verifyWebhookSignature,
} from "./razorpayClient";
import {
  sendEmail,
  paymentReceiptEmail,
  proPlanReceiptEmail,
  contractSignedEmail,
  paymentReceivedEmail,
  inviteEmail,
} from "./emails";

// Deliver what a completed payment order bought. Shared by the browser verify
// path and the webhook (whichever atomically claims the order first calls
// this exactly once). Legacy purposes from orders created before the
// subscription-first model ("pro_plan", "credits") are still honored.
type GrantResult =
  | { kind: "pro"; term: "monthly" | "yearly"; user?: import("@shared/schema").User }
  | { kind: "boost"; user?: import("@shared/schema").User }
  | { kind: "seats"; qty: number }
  | { kind: "credits" };

async function grantPurchase(
  purpose: string,
  userId: string,
  legacyOrder?: { credits: number; amount: number },
): Promise<GrantResult> {
  switch (purpose) {
    case "pro_monthly": {
      const user = await storage.activateProPlan(userId, PRO_MONTHLY_DAYS, "monthly");
      return { kind: "pro", term: "monthly", user };
    }
    case "pro_yearly":
    case "pro_plan": { // legacy annual orders
      const user = await storage.activateProPlan(userId, PRO_YEARLY_DAYS, "yearly");
      return { kind: "pro", term: "yearly", user };
    }
    case "deal_boost": {
      const user = await storage.activateDealBoost(userId, DEAL_BOOST_DAYS);
      return { kind: "boost", user };
    }
    case "extra_seat": {
      const buyer = await storage.getUser(userId);
      const qty = Math.max(1, legacyOrder?.credits ?? 1);
      if (!buyer?.organizationId) {
        // Paid-but-undeliverable: throw so the caller reopens the order claim
        // and a retry (or the webhook) can deliver once the org exists —
        // never silently pocket the money.
        throw new Error(`extra_seat grant: user ${userId} has no organization`);
      }
      await storage.activateExtraSeats(buyer.organizationId, qty, EXTRA_SEAT_DAYS);
      return { kind: "seats", qty };
    }
    default: { // legacy "credits" orders in flight at deploy time
      if (legacyOrder && legacyOrder.credits > 0) {
        await storage.addPurchasedCredits(userId, legacyOrder.credits, "purchase", legacyOrder.amount);
      }
      return { kind: "credits" };
    }
  }
}

// PayU config — read lazily so .env files loaded at runtime are picked up
function getPayuConfig() {
  const key = process.env.PAYU_MERCHANT_KEY || "";
  const salt = process.env.PAYU_SALT || "";
  const raw = process.env.PAYU_URL || process.env.PAYU_BASE_URL || "https://test.payu.in";
  const url = raw.endsWith("/_payment") ? raw : `${raw}/_payment`;
  const price = parseInt(process.env.CREDIT_VALUE ?? "299");
  return { key, salt, url, price };
}

const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      cb(null, uniqueSuffix + path.extname(file.originalname));
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [".pdf", ".jpg", ".jpeg", ".png", ".webp"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type"));
    }
  },
});

export async function registerRoutes(app: Express): Promise<Server> {
  await setupAuth(app);
  registerCopilotRoutes(app);

  // Org-scoped access check: a resource is visible to every active member of
  // its organization. Rows created before the org migration (or by an old
  // build during a deploy) may lack organization_id — fall back to creator.
  const inOrg = (
    resource: { organizationId?: string | null; userId?: string | null } | null | undefined,
    user: any,
  ): boolean => {
    if (!resource) return false;
    if (resource.organizationId) return resource.organizationId === user.organizationId;
    return resource.userId === user.id;
  };

  app.get('/api/auth/user', isAuthenticated, async (req: any, res) => {
    try {
      // Lazy monthly credit reset on the ORG's billing pool (the owner's row):
      // every page load hits this endpoint, so the balance stays current
      // without any cron — whichever member shows up first triggers it.
      const billing = await getBillingUser(req.user);
      const refreshedBilling = await storage.ensureMonthlyCredits(billing.id);
      const me = billing.id === req.user.id ? (refreshedBilling ?? req.user) : req.user;
      const { password: _, ...userWithoutPassword } = me;
      // Additive `entitlements`: computed from the ORG's billing owner, so a
      // member of a Pro/trialing org doesn't read as "Free" while every
      // feature works. Display data only — server gates re-derive their own.
      const billingFresh = refreshedBilling ?? billing;
      res.json({
        ...userWithoutPassword,
        entitlements: {
          pro: hasActivePro(billingFresh),
          trial: hasActiveTrial(billingFresh),
          trialEndsAt: billingFresh.trialEndsAt ?? null,
          trialDaysLeft: getTrialDaysLeft(billingFresh),
          proExpiresAt: billingFresh.planExpiresAt ?? null,
          isOwner: billing.id === req.user.id,
        },
      });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  app.get("/api/users/:id/public", isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.params.id);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      res.json({
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch user" });
    }
  });

  app.get("/api/deals", isAuthenticated, requireModuleRead("deals"), async (req: any, res) => {
    try {
      const userId = req.user.id;
      const deals = await storage.getDealsByOrg(req.user.organizationId, req.user.id);
      res.json(deals);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch deals" });
    }
  });

  app.get("/api/deals/:id", isAuthenticated, requireLinkedRead, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const deal = await storage.getDeal(parseInt(req.params.id));
      if (!deal) {
        return res.status(404).json({ error: "Deal not found" });
      }
      if (!inOrg(deal, req.user) && deal.brandUserId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }
      res.json(deal);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch deal" });
    }
  });

  app.post("/api/deals", isAuthenticated, requireOrgPermission("deals.create"), async (req: any, res) => {
    try {
      const userId = req.user.id;
      const parsed = insertDealSchema.safeParse({
        ...req.body,
        userId,
        organizationId: req.user.organizationId,
      });
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors });
      }

      // The ORG's plan and credit pool live on its OWNER's user row. Free
      // plan: 1 Deal Credit = this deal + its quotation; Pro (paid OR
      // trial — hasProAccess) and Deal Boost are unlimited for every
      // member. A trialist must NOT burn monthly credits: they'd hit 402
      // mid-trial and face day 8 at zero with a ~23-day wait. Spend
      // happens AFTER validation so a 400 never burns a credit.
      const billing = await getBillingUser(req.user);
      let creditSpent = false;
      if (!hasProAccess(billing) && !hasActiveDealBoost(billing)) {
        await storage.ensureMonthlyCredits(billing.id);
        const spend = await storage.spendDealCredit(billing.id);
        if (!spend.ok) {
          const fresh = await storage.getUser(billing.id);
          const credits = getDealCredits(fresh);
          return res.status(402).json({
            code: "NO_CREDITS",
            feature: "deals",
            error: "Your organization has used all its Deal Credits for this month",
            credits: {
              monthly: credits.monthly,
              purchased: credits.purchased,
              resetsAt: fresh?.monthlyCreditsResetAt ?? null,
            },
          });
        }
        creditSpent = true;
      }

      try {
        const deal = await storage.createDeal(parsed.data);
        logOrgActivity(req.user, "created", "deal", deal.id, `Deal: ${deal.dealTitle || deal.brandName}`);
        res.status(201).json(deal);
      } catch (insertError) {
        // Rare compensation path: the credit was taken but the insert failed.
        if (creditSpent) await storage.regrantDealCredit(billing.id).catch(() => {});
        throw insertError;
      }
    } catch (error) {
      console.error("Deal creation error:", error);
      res.status(500).json({ error: "Failed to create deal" });
    }
  });

  // Edit a deal (only Pending deals)
  app.patch("/api/deals/:id", isAuthenticated, requireOrgPermission("deals.edit"), async (req: any, res) => {
    try {
      const dealId = parseInt(req.params.id);
      const deal = await storage.getDeal(dealId);
      if (!deal) return res.status(404).json({ error: "Deal not found" });
      if (!inOrg(deal, req.user)) return res.status(403).json({ error: "Not authorized" });
      if (deal.status !== "Pending") {
        return res.status(400).json({ error: "Only pending deals can be edited" });
      }

      const { brandName, dealTitle, dealAmount, startDate, endDate, deliverables, brandUserId, deliverableMode, standardTermIds, customTerms } = req.body;
      const updates: any = {};
      if (brandName !== undefined) updates.brandName = brandName;
      if (dealTitle !== undefined) updates.dealTitle = dealTitle;
      if (dealAmount !== undefined) updates.dealAmount = dealAmount;
      if (startDate !== undefined) updates.startDate = startDate;
      if (endDate !== undefined) updates.endDate = endDate;
      if (deliverables !== undefined) updates.deliverables = deliverables;
      if (brandUserId !== undefined) updates.brandUserId = brandUserId;
      if (deliverableMode !== undefined) updates.deliverableMode = deliverableMode;
      if (standardTermIds !== undefined) updates.standardTermIds = standardTermIds;
      if (customTerms !== undefined) updates.customTerms = customTerms;

      const updated = await storage.updateDeal(dealId, updates);

      // If a quote exists, mark it as revised so user can regenerate
      const existingQuote = await storage.getQuoteByDealId(dealId);
      if (existingQuote && existingQuote.status === "draft") {
        await storage.updateQuote(existingQuote.id, { status: "revised" });
      }

      res.json(updated);
    } catch (error) {
      console.error("Deal update error:", error);
      res.status(500).json({ error: "Failed to update deal" });
    }
  });

  // Generate or get quote for a deal (supports revision flow)
  app.post("/api/deals/:id/quote", isAuthenticated, requireOrgPermission("quotations.create"), async (req: any, res) => {
    try {
      const dealId = parseInt(req.params.id);
      const deal = await storage.getDeal(dealId);
      if (!deal) return res.status(404).json({ error: "Deal not found" });
      if (!inOrg(deal, req.user)) return res.status(403).json({ error: "Not authorized" });

      const existing = await storage.getQuoteByDealId(dealId);

      // If latest quote is still draft, return it (idempotent)
      if (existing && existing.status === "draft") {
        return res.json(existing);
      }

      // Create new quote (first one, or after revision)
      const newVersion = existing ? (existing.version || 1) + 1 : 1;
      const quote = await storage.createQuote({
        userId: req.user.id,
        organizationId: req.user.organizationId,
        dealId,
        status: "draft",
        version: newVersion,
      });
      logOrgActivity(req.user, "generated", "quotation", quote.id, `Quotation for: ${deal.dealTitle || deal.brandName}`);
      res.status(201).json(quote);
    } catch (error) {
      res.status(500).json({ error: "Failed to create quote" });
    }
  });

  app.get("/api/deals/:id/quote", isAuthenticated, async (req: any, res) => {
    try {
      const dealId = parseInt(req.params.id);
      const deal = await storage.getDeal(dealId);
      if (!deal) return res.status(404).json({ error: "Deal not found" });
      if (!inOrg(deal, req.user)) return res.status(403).json({ error: "Not authorized" });

      const quote = await storage.getQuoteByDealId(dealId);
      if (!quote) return res.status(404).json({ error: "Quote not found" });
      res.json(quote);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch quote" });
    }
  });

  // Mark deal as completed
  app.patch("/api/deals/:id/complete", isAuthenticated, requireOrgPermission("deals.edit"), async (req: any, res) => {
    try {
      const dealId = parseInt(req.params.id);
      const deal = await storage.getDeal(dealId);
      if (!deal) return res.status(404).json({ error: "Deal not found" });
      if (!inOrg(deal, req.user) && deal.brandUserId !== req.user.id) {
        return res.status(403).json({ error: "Not authorized" });
      }
      if (deal.status !== "Active") {
        return res.status(400).json({ error: "Only active deals can be completed" });
      }
      const updated = await storage.updateDeal(dealId, { status: "Completed" });
      logOrgActivity(req.user, "completed", "deal", req.params.id, deal?.dealTitle || deal?.brandName || "");
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to complete deal" });
    }
  });

  // Quotation register — every quotation in the organization.
  app.get("/api/quotes", isAuthenticated, requireModuleRead("quotations"), async (req: any, res) => {
    try {
      const rows = await storage.getQuotesByOrg(req.user.organizationId, req.user.id);
      res.json(rows);
    } catch (error) {
      console.error("Quotes list error:", error);
      res.status(500).json({ error: "Failed to fetch quotations" });
    }
  });

  app.get("/api/contracts", isAuthenticated, requireModuleRead("agreements"), async (req: any, res) => {
    try {
      const userId = req.user.id;
      const contracts = await storage.getContractsByOrg(req.user.organizationId, req.user.id);
      res.json(contracts);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch contracts" });
    }
  });

  app.get("/api/contracts/:id", isAuthenticated, requireLinkedRead, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const contract = await storage.getContract(parseInt(req.params.id));
      if (!contract) {
        return res.status(404).json({ error: "Contract not found" });
      }
      const deal = await storage.getDeal(contract.dealId);
      if (!inOrg(contract, req.user) && deal?.brandUserId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }
      res.json(contract);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch contract" });
    }
  });

  app.post("/api/contracts", isAuthenticated, requirePro("agreements"), requireOrgPermission("agreements.create"), async (req: any, res) => {
    try {
      const userId = req.user.id;

      // Snapshot WHO signs and WITH WHICH signature — the document must
      // never render the current viewer's profile signature (see
      // migrate-document-authenticity.ts).
      const signerName = [req.user.firstName, req.user.lastName].filter(Boolean).join(" ") || req.user.email || null;
      const parsed = insertContractSchema.safeParse({
        ...req.body,
        signerUserId: req.user.id,
        signerName,
        signatureUrl: req.user.digitalSignature ?? null,
        sealUrl: req.user.companySeal ?? null,
        userId,
        organizationId: req.user.organizationId,
      });
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors });
      }

      // The deal being contracted must belong to the caller's organization.
      const parentDeal = await storage.getDeal(parsed.data.dealId);
      if (!parentDeal || !inOrg(parentDeal, req.user)) {
        return res.status(403).json({ error: "Not authorized" });
      }

      // One deal → one agreement. Guard against duplicates (e.g. the user hits
      // the confirmation page again via back-button).
      const existingContract = await storage.getContractByDealId(parsed.data.dealId);
      if (existingContract) {
        return res.status(409).json({
          error: "An agreement already exists for this deal.",
          contractId: existingContract.id,
        });
      }

      const user = req.user;

      const contractData = {
        ...parsed.data,
        signedByInfluencer: true,
        signedByInfluencerDate: new Date().toISOString(),
      };
      const contract = await storage.createContract(contractData);
      logOrgActivity(req.user, "created", "agreement", contract.id, `Agreement: ${contract.brandName}`);

      await storage.updateDeal(contract.dealId, { status: "Active" });

      // Contract-signed email — best-effort
      if (user?.email) {
        const { subject, html } = contractSignedEmail({
          firstName: user.firstName || undefined,
          brandName: contract.brandName,
          contractValue: contract.contractValue,
          contractId: contract.id,
        });
        void sendEmail({ to: user.email, subject, html });
      }

      res.status(201).json(contract);
    } catch (error) {
      console.error("Contract creation error:", error);
      res.status(500).json({ error: "Failed to create contract" });
    }
  });

  app.post("/api/contracts/:id/proof", isAuthenticated, requireOrgPermission("agreements.create"), upload.single("proof"), async (req: any, res) => {
    try {
      const contract = await storage.getContract(parseInt(req.params.id));
      if (!contract) {
        return res.status(404).json({ error: "Contract not found" });
      }
      if (!inOrg(contract, req.user)) {
        return res.status(403).json({ error: "Access denied" });
      }

      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      // Upload to ImageKit (or fall back to local path if not configured)
      let proofFilePath = req.file.path;
      if (isImageKitConfigured()) {
        const uploaded = await uploadFileToImageKit(req.file, {
          folder: "contracts",
          baseName: `contract-${req.params.id}-proof`,
        });
        proofFilePath = uploaded.url; // store the public CDN URL
      }

      const updated = await storage.updateContract(parseInt(req.params.id), {
        proofFileName: req.file.originalname,
        proofFilePath,
        status: "Signed",
        signedByBrand: true,
        signedDate: new Date().toISOString(),
      });

      logOrgActivity(req.user, "uploaded signed proof for", "agreement", req.params.id, contract.brandName);
      res.json(updated);
    } catch (error) {
      console.error("Proof upload error:", error);
      res.status(500).json({ error: "Failed to upload proof" });
    }
  });

  /**
   * Record the e-stamp certificate the user bought themselves.
   *
   * DealInSec does not sell, issue or satisfy stamp duty — it stores a
   * reference so the agreement can cite a real certificate. That is why this
   * takes a certificate NUMBER and not a file: an uploaded image of stamp
   * paper is not valid stamping and must never be presented as if it were.
   */
  app.patch("/api/contracts/:id/estamp", isAuthenticated, requireOrgPermission("agreements.create"), async (req: any, res) => {
    try {
      const contract = await storage.getContract(parseInt(req.params.id));
      if (!contract) return res.status(404).json({ error: "Agreement not found" });
      if (!inOrg(contract, req.user)) return res.status(403).json({ error: "Access denied" });

      const certificateNo = String(req.body?.estampCertificateNo ?? "").trim();
      const clear = certificateNo === "";

      if (!clear && certificateNo.length > 60) {
        return res.status(400).json({ error: "Certificate number looks too long — check and re-enter it." });
      }
      const amountRaw = req.body?.estampAmount;
      const amount = amountRaw === "" || amountRaw === null || amountRaw === undefined
        ? null : Math.round(Number(amountRaw));
      if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
        return res.status(400).json({ error: "Stamp duty amount must be a positive number" });
      }

      const updated = await storage.updateContract(parseInt(req.params.id), {
        estampCertificateNo: clear ? null : certificateNo,
        estampDate: clear ? null : (String(req.body?.estampDate ?? "").trim() || null),
        estampAmount: clear ? null : amount,
        estampAuthority: clear ? null : (String(req.body?.estampAuthority ?? "").trim().slice(0, 120) || null),
      } as any);

      logOrgActivity(req.user, clear ? "removed the e-stamp reference from" : "recorded an e-stamp certificate on",
        "agreement", contract.id, clear ? contract.brandName : `${certificateNo} · ${contract.brandName}`);
      res.json(updated);
    } catch (error) {
      console.error("e-stamp update error:", error);
      res.status(500).json({ error: "Failed to save the e-stamp details" });
    }
  });

  // Download the uploaded Contract Proof.
  // If the stored path is an external URL (ImageKit), redirect; if it's a
  // local file (legacy uploads), stream from disk.
  app.get("/api/contracts/:id/proof", isAuthenticated, async (req: any, res) => {
    try {
      const contract = await storage.getContract(parseInt(req.params.id));
      if (!contract) return res.status(404).json({ error: "Contract not found" });
      if (!inOrg(contract, req.user)) return res.status(403).json({ error: "Access denied" });
      if (!contract.proofFilePath) return res.status(404).json({ error: "No proof uploaded" });

      if (/^https?:\/\//.test(contract.proofFilePath)) {
        return res.redirect(contract.proofFilePath);
      }
      res.download(contract.proofFilePath, contract.proofFileName || "contract-proof");
    } catch (error) {
      console.error("Proof download error:", error);
      res.status(500).json({ error: "Failed to download proof" });
    }
  });

  app.get("/api/invoices", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const invoices = await storage.getInvoicesByOrg(req.user.organizationId, req.user.id);
      res.json(invoices);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch invoices" });
    }
  });

  app.get("/api/invoices/:id", isAuthenticated, async (req: any, res) => {
    try {
      const invoice = await storage.getInvoice(parseInt(req.params.id));
      if (!invoice) {
        return res.status(404).json({ error: "Invoice not found" });
      }
      if (!inOrg(invoice, req.user)) {
        return res.status(403).json({ error: "Access denied" });
      }
      res.json(invoice);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch invoice" });
    }
  });

  app.post("/api/invoices/:id/pay", isAuthenticated, async (req: any, res) => {
    try {
      const invoice = await storage.getInvoice(parseInt(req.params.id));
      if (!invoice) {
        return res.status(404).json({ error: "Invoice not found" });
      }
      if (!inOrg(invoice, req.user)) {
        return res.status(403).json({ error: "Access denied" });
      }

      if (invoice.status === "Paid") {
        return res.status(400).json({ error: "Invoice already paid" });
      }

      const stripe = await getUncachableStripeClient();
      const baseUrl = process.env.APP_URL || `https://${process.env.REPLIT_DOMAINS?.split(',')[0]}`;

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'inr',
              product_data: {
                name: `DealInSec Platform Fee - ${invoice.invoiceNumber}`,
                description: `Contract creation and platform service fee for ${invoice.brandName} deal`,
              },
              unit_amount: invoice.totalAmount * 100,
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        success_url: `${baseUrl}/billing/success?invoice_id=${invoice.id}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/billing/invoice/${invoice.id}`,
        metadata: {
          invoiceId: invoice.id.toString(),
          contractId: invoice.contractId.toString(),
          userId: invoice.userId,
        },
      });

      res.json({ url: session.url });
    } catch (error) {
      console.error("Stripe checkout error:", error);
      res.status(500).json({ error: "Failed to create payment session" });
    }
  });

  app.post("/api/invoices/:id/confirm-payment", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const invoice = await storage.getInvoice(parseInt(req.params.id));
      if (!invoice) {
        return res.status(404).json({ error: "Invoice not found" });
      }
      if (invoice.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }

      if (invoice.status === "Paid") {
        return res.json(invoice);
      }

      const { session_id } = req.body;
      if (!session_id) {
        return res.status(400).json({ error: "Session ID required" });
      }

      const stripe = await getUncachableStripeClient();
      const session = await stripe.checkout.sessions.retrieve(session_id);

      if (session.payment_status !== 'paid') {
        return res.status(400).json({ error: "Payment not completed" });
      }

      if (session.metadata?.invoiceId !== invoice.id.toString()) {
        return res.status(400).json({ error: "Session does not match invoice" });
      }

      if (session.metadata?.userId !== userId) {
        return res.status(403).json({ error: "Session does not belong to you" });
      }

      const expectedAmount = invoice.totalAmount * 100;
      if (session.amount_total !== expectedAmount) {
        return res.status(400).json({ error: "Amount mismatch" });
      }

      const updatedInvoice = await storage.updateInvoice(parseInt(req.params.id), {
        status: "Paid",
      });

      await storage.updateContract(invoice.contractId, {
        status: "Active",
      });

      res.json(updatedInvoice);
    } catch (error) {
      console.error("Payment confirmation error:", error);
      res.status(500).json({ error: "Failed to confirm payment" });
    }
  });

  // Brand-specific routes
  app.get("/api/brand/deals", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      if (!user || user.role !== "brand") {
        return res.status(403).json({ error: "Brand access required" });
      }
      const deals = await storage.getDealsForBrand(userId);
      res.json(deals);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch brand deals" });
    }
  });

  app.get("/api/brand/contracts", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      if (!user || user.role !== "brand") {
        return res.status(403).json({ error: "Brand access required" });
      }
      const contracts = await storage.getContractsForBrand(userId);
      res.json(contracts);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch brand contracts" });
    }
  });

  // Brand can see invoices sent to them
  app.get("/api/brand/received-invoices", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      if (!user || user.role !== "brand") {
        return res.status(403).json({ error: "Brand access required" });
      }
      const brandDeals = await storage.getDealsForBrand(userId);
      const dealIds = brandDeals.map(d => d.id);
      if (dealIds.length === 0) return res.json([]);
      const allBrandInvoices = await Promise.all(
        brandDeals.map(async (deal) => {
          const invoiceList = await db.select().from(brandInvoicesTable).where(eq(brandInvoicesTable.dealId, deal.id));
          return invoiceList;
        })
      );
      res.json(allBrandInvoices.flat());
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch received invoices" });
    }
  });

  app.get("/api/brands", isAuthenticated, async (req: any, res) => {
    try {
      const brands = await storage.getBrandUsers();
      res.json(brands.map(b => ({ id: b.id, name: `${b.firstName || ''} ${b.lastName || ''}`.trim() || b.email || 'Brand' })));
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch brands" });
    }
  });

  // Brand invoices (invoices influencers send to brands)
  app.get("/api/brand-invoices", isAuthenticated, requireModuleRead("invoices"), async (req: any, res) => {
    try {
      const userId = req.user.id;
      const invoices = await storage.getBrandInvoicesByOrg(req.user.organizationId, req.user.id);
      res.json(invoices);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch brand invoices" });
    }
  });

  app.get("/api/brand-invoices/:id", isAuthenticated, async (req: any, res) => {
    try {
      const invoice = await storage.getBrandInvoice(parseInt(req.params.id));
      if (!invoice) {
        return res.status(404).json({ error: "Invoice not found" });
      }
      if (!inOrg(invoice, req.user)) {
        return res.status(403).json({ error: "Access denied" });
      }
      res.json(invoice);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch brand invoice" });
    }
  });

  app.post("/api/brand-invoices", isAuthenticated, requirePro("invoices"), requireOrgPermission("invoices.create"), async (req: any, res) => {
    try {
      const userId = req.user.id;

      // The parent deal (and contract, if given) must belong to the caller's
      // organization — otherwise an invoice could be planted in another org's
      // deal view, which reads by dealId.
      const parentDealId = parseInt(req.body?.dealId, 10);
      if (!Number.isFinite(parentDealId)) {
        return res.status(400).json({ error: "A valid dealId is required" });
      }
      const parentDeal = await storage.getDeal(parentDealId);
      if (!parentDeal || !inOrg(parentDeal, req.user)) {
        return res.status(403).json({ error: "Not authorized for this deal" });
      }
      if (req.body?.contractId) {
        const parentContract = await storage.getContract(parseInt(req.body.contractId, 10));
        if (!parentContract || !inOrg(parentContract, req.user)) {
          return res.status(403).json({ error: "Not authorized for this agreement" });
        }
      }

      // The supplier on the document is the ORG's issuer (owner), not whichever
      // teammate happened to press the button — same rule the PDF follows.
      const issuer = await getBillingUser(req.user);
      const influencerName =
        [issuer.firstName, issuer.lastName].filter(Boolean).join(" ") || issuer.email || "Influencer";

      // Whitelist: never spread req.body into a row. It previously let a client
      // set any column, including amounts unrelated to the agreement.
      const amount = Math.round(Number(req.body?.dealAmount));
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ error: "Invoice amount must be greater than zero" });
      }

      // An invoice may not bill more than its agreement is worth, minus what
      // has already been invoiced against it. This is the scope-protection
      // promise applied to money.
      if (req.body?.contractId) {
        const contractId = parseInt(req.body.contractId, 10);
        const parentContract = await storage.getContract(contractId);
        const existing = await storage.getBrandInvoicesByDealIdForOrg(parentDealId, req.user.organizationId);
        const alreadyInvoiced = existing
          .filter((i) => i.contractId === contractId)
          .reduce((sum, i) => sum + (i.dealAmount || 0), 0);
        const remaining = Number(parentContract!.contractValue) - alreadyInvoiced;
        if (amount > remaining) {
          return res.status(400).json({
            error:
              remaining > 0
                ? `Only ₹${remaining.toLocaleString("en-IN")} is left to invoice on this agreement.`
                : "This agreement is already fully invoiced.",
          });
        }
      }

      let lineItems: unknown = null;
      if (Array.isArray(req.body?.lineItems) && req.body.lineItems.length) {
        const parsed = z.array(invoiceLineItemSchema).min(1).max(50).safeParse(req.body.lineItems);
        if (!parsed.success) {
          return res.status(400).json({ error: "Invoice lines are invalid", details: parsed.error.flatten() });
        }
        const linesTotal = parsed.data.reduce((sum: number, l) => sum + l.amount, 0);
        if (linesTotal !== amount) {
          return res.status(400).json({ error: "Invoice lines must add up to the invoice total" });
        }
        lineItems = parsed.data;
      }

      const invoiceNumber = await storage.generateOrgInvoiceNumber(req.user.organizationId);

      const invoiceData = {
        dealId: parentDealId,
        contractId: req.body?.contractId ? parseInt(req.body.contractId, 10) : null,
        brandName: String(req.body?.brandName ?? parentDeal.brandName),
        dealAmount: amount,
        invoiceType: brandInvoiceTypeOptions.includes(req.body?.invoiceType) ? req.body.invoiceType : "full",
        splitPercentage: null,
        dueDate: typeof req.body?.dueDate === "string" && req.body.dueDate ? req.body.dueDate : null,
        notes: typeof req.body?.notes === "string" ? req.body.notes.slice(0, 2000) || null : null,
        lineItems,
        userId,
        organizationId: req.user.organizationId,
        invoiceNumber,
        invoiceDate: req.body.invoiceDate || new Date().toISOString().split("T")[0],
        influencerName,
        influencerEmail: issuer.email || null,
        status: "Unpaid",
      };

      const invoice = await storage.createBrandInvoice(invoiceData as any);
      logOrgActivity(req.user, "created", "invoice", invoice.id, `Invoice ${invoice.invoiceNumber}: ${invoice.brandName}`);
      res.status(201).json(invoice);
    } catch (error) {
      console.error("Brand invoice creation error:", error);
      res.status(500).json({ error: "Failed to create brand invoice" });
    }
  });

  app.patch("/api/brand-invoices/:id", isAuthenticated, requirePro("payment_tracking"), requireOrgPermission("payments.manage"), async (req: any, res) => {
    try {
      const invoice = await storage.getBrandInvoice(parseInt(req.params.id));
      if (!invoice) {
        return res.status(404).json({ error: "Invoice not found" });
      }
      if (!inOrg(invoice, req.user)) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Paid invoices are locked — only status changes are allowed (e.g. accidental undo).
      // Amount/notes edits are rejected to prevent retroactive accounting surprises.
      if (invoice.status === "Paid") {
        const amountChange = req.body.dealAmount !== undefined && req.body.dealAmount !== invoice.dealAmount;
        const notesChange = req.body.notes !== undefined && req.body.notes !== invoice.notes;
        if (amountChange || notesChange) {
          return res.status(400).json({ error: "Paid invoices cannot be edited. Mark it Unpaid first or delete and recreate." });
        }
      }

      // Explicit allowlist — never spread req.body. Tenancy keys (id, userId,
      // organizationId) and identity fields (invoiceNumber, dealId, contractId)
      // must not be client-writable: setting organizationId would move the
      // invoice into another org (or hide it from its own by nulling it).
      const EDITABLE = [
        "status", "dealAmount", "notes", "dueDate", "invoiceDate",
        "brandName", "brandEmail", "invoiceType", "splitPercentage",
      ] as const;
      const updates: any = {};
      for (const k of EDITABLE) {
        if (req.body[k] !== undefined) updates[k] = req.body[k];
      }
      if (!Object.keys(updates).length) {
        return res.status(400).json({ error: "Nothing to update" });
      }
      if (updates.dealAmount !== undefined) {
        const n = typeof updates.dealAmount === "string" ? parseInt(updates.dealAmount, 10) : updates.dealAmount;
        if (!Number.isFinite(n) || n < 1) {
          return res.status(400).json({ error: "Invoice amount must be a positive number" });
        }
        updates.dealAmount = n;
      }

      // paid_at is server-owned: stamp it when the payment is recorded,
      // clear it when the payment is reversed.
      if (invoice.status !== "Paid" && updates.status === "Paid") {
        (updates as any).paidAt = new Date();
      } else if (invoice.status === "Paid" && updates.status === "Unpaid") {
        (updates as any).paidAt = null;
      }

      const updated = await storage.updateBrandInvoice(parseInt(req.params.id), updates);

      if (invoice.status !== "Paid" && updates.status === "Paid" && updated) {
        logOrgActivity(req.user, "recorded payment for", "invoice", invoice.id,
          `₹${Number(updated.dealAmount || 0).toLocaleString("en-IN")} from ${invoice.brandName}`);
      }

      // Reversing a payment is a money event too — it must leave the same trail
      // as recording one, so "who marked this unpaid and when" is answerable.
      if (invoice.status === "Paid" && updates.status === "Unpaid" && updated) {
        logOrgActivity(req.user, "reversed the payment on", "invoice", invoice.id,
          `${updated.invoiceNumber} — back to Unpaid`);
      }

      // "Payment received" email — only when transitioning Unpaid -> Paid
      if (invoice.status !== "Paid" && updates.status === "Paid" && updated) {
        const owner = await storage.getUser(req.user.id);
        if (owner?.email) {
          const { subject, html } = paymentReceivedEmail({
            firstName: owner.firstName || undefined,
            brandName: updated.brandName,
            amount: updated.dealAmount,
            invoiceNumber: updated.invoiceNumber,
          });
          void sendEmail({ to: owner.email, subject, html });
        }
      }

      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to update brand invoice" });
    }
  });

  app.delete("/api/brand-invoices/:id", isAuthenticated, requirePro("invoices"), requireOrgPermission("invoices.delete"), async (req: any, res) => {
    try {
      const invoice = await storage.getBrandInvoice(parseInt(req.params.id));
      if (!invoice) return res.status(404).json({ error: "Invoice not found" });
      if (!inOrg(invoice, req.user)) return res.status(403).json({ error: "Access denied" });
      if (invoice.status === "Paid") {
        return res.status(400).json({ error: "Paid invoices cannot be deleted" });
      }
      await storage.deleteBrandInvoice(parseInt(req.params.id));
      res.status(204).end();
    } catch (error) {
      console.error("Delete brand invoice error:", error);
      res.status(500).json({ error: "Failed to delete brand invoice" });
    }
  });

  // ── Invoice tax documents (GST invoice / TDS certificate / receipts) ──────
  // Centralises the paperwork creators need for tax filing, attached per invoice.
  app.get("/api/brand-invoices/:id/attachments", isAuthenticated, async (req: any, res) => {
    try {
      const invoice = await storage.getBrandInvoice(parseInt(req.params.id));
      if (!invoice) return res.status(404).json({ error: "Invoice not found" });
      if (!inOrg(invoice, req.user)) return res.status(403).json({ error: "Access denied" });
      const attachments = await storage.getInvoiceAttachments(invoice.id);
      res.json(attachments);
    } catch (error) {
      console.error("List attachments error:", error);
      res.status(500).json({ error: "Failed to fetch documents" });
    }
  });

  app.post("/api/brand-invoices/:id/attachments", isAuthenticated, requirePro("invoices"), requireOrgPermission("invoices.create"), upload.single("file"), async (req: any, res) => {
    try {
      const invoice = await storage.getBrandInvoice(parseInt(req.params.id));
      if (!invoice) return res.status(404).json({ error: "Invoice not found" });
      if (!inOrg(invoice, req.user)) return res.status(403).json({ error: "Access denied" });
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });

      const category = invoiceDocumentCategories.includes(req.body.category)
        ? req.body.category
        : "Other";

      // Store on ImageKit so files survive redeploys; fall back to local path.
      let fileUrl = `/uploads/${req.file.filename}`;
      let fileId: string | null = null;
      if (isImageKitConfigured()) {
        const uploaded = await uploadFileToImageKit(req.file, {
          folder: "invoice-documents",
          baseName: `invoice-${invoice.id}-${String(category).replace(/\s+/g, "-").toLowerCase()}`,
        });
        fileUrl = uploaded.url;
        fileId = uploaded.fileId;
      }

      const attachment = await storage.createInvoiceAttachment({
        userId: req.user.id,
        brandInvoiceId: invoice.id,
        category,
        fileName: req.file.originalname,
        fileUrl,
        fileId,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
      });
      res.status(201).json(attachment);
    } catch (error: any) {
      console.error("Attachment upload error:", error);
      const msg = String(error?.message || "");
      // Most common cause: the invoice_attachments table hasn't been created
      // yet (db:push not run). Surface a clear, actionable reason.
      const missingTable = /relation .*invoice_attachments.* does not exist|no such table/i.test(msg);
      res.status(500).json({
        error: missingTable
          ? "Document storage isn't set up yet. Run the database migration (npm run db:push)."
          : "Failed to upload document",
        reason: msg || undefined,
      });
    }
  });

  // Download a document — redirect to CDN URL or stream a legacy local file.
  app.get("/api/attachments/:id/download", isAuthenticated, async (req: any, res) => {
    try {
      const attachment = await storage.getInvoiceAttachment(parseInt(req.params.id));
      if (!attachment) return res.status(404).json({ error: "Document not found" });
      const parentInvoice = await storage.getBrandInvoice(attachment.brandInvoiceId);
      if (!inOrg(parentInvoice, req.user)) return res.status(403).json({ error: "Access denied" });
      if (/^https?:\/\//.test(attachment.fileUrl)) {
        return res.redirect(attachment.fileUrl);
      }
      res.download(attachment.fileUrl, attachment.fileName);
    } catch (error) {
      console.error("Attachment download error:", error);
      res.status(500).json({ error: "Failed to download document" });
    }
  });

  app.delete("/api/attachments/:id", isAuthenticated, requirePro("invoices"), requireOrgPermission("invoices.delete"), async (req: any, res) => {
    try {
      const attachment = await storage.getInvoiceAttachment(parseInt(req.params.id));
      if (!attachment) return res.status(404).json({ error: "Document not found" });
      const parentInvoice = await storage.getBrandInvoice(attachment.brandInvoiceId);
      if (!inOrg(parentInvoice, req.user)) return res.status(403).json({ error: "Access denied" });
      if (attachment.fileId) await deleteFromImageKit(attachment.fileId);
      await storage.deleteInvoiceAttachment(attachment.id);
      res.status(204).end();
    } catch (error) {
      console.error("Attachment delete error:", error);
      res.status(500).json({ error: "Failed to delete document" });
    }
  });

  // Get all brand invoices for a specific deal
  app.get("/api/deals/:id/brand-invoices", isAuthenticated, async (req: any, res) => {
    try {
      const dealId = parseInt(req.params.id);
      const deal = await storage.getDeal(dealId);
      if (!deal) return res.status(404).json({ error: "Deal not found" });
      if (!inOrg(deal, req.user)) return res.status(403).json({ error: "Not authorized" });

      const invoices = await storage.getBrandInvoicesByDealIdForOrg(dealId, req.user.organizationId, req.user.id);
      res.json(invoices);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch invoices" });
    }
  });

  // Split deal amount into advance + final invoices
  app.post("/api/deals/:id/split-invoices", isAuthenticated, requirePro("invoices"), requireOrgPermission("invoices.create"), async (req: any, res) => {
    try {
      const dealId = parseInt(req.params.id);
      const deal = await storage.getDeal(dealId);
      if (!deal) return res.status(404).json({ error: "Deal not found" });
      if (!inOrg(deal, req.user)) return res.status(403).json({ error: "Not authorized" });

      const { advancePercentage } = req.body;
      if (!advancePercentage || advancePercentage < 1 || advancePercentage > 99) {
        return res.status(400).json({ error: "advancePercentage must be between 1 and 99" });
      }

      // Allow multiple invoice sets per deal — invoices can be regenerated as the deal evolves.
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      const influencerName = user?.firstName && user?.lastName
        ? `${user.firstName} ${user.lastName}`
        : user?.email || "Influencer";

      const advanceAmount = Math.round(deal.dealAmount * advancePercentage / 100);
      const finalAmount = deal.dealAmount - advanceAmount;

      // Find contractId for this deal (org-wide — a teammate may have signed it)
      const contract = await storage.getContractByDealId(dealId);

      const baseData = {
        userId,
        organizationId: req.user.organizationId,
        invoiceDate: new Date().toISOString().split("T")[0],
        dealId,
        contractId: contract?.id || null,
        brandName: deal.brandName,
        influencerName,
        influencerEmail: user?.email || null,
        status: "Unpaid" as const,
      };

      const advanceInvoice = await storage.createBrandInvoice({
        ...baseData,
        invoiceNumber: await storage.generateOrgInvoiceNumber(req.user.organizationId),
        dealAmount: advanceAmount,
        invoiceType: "advance",
        splitPercentage: advancePercentage,
        status: "Unpaid" as const,
      });

      const finalInvoice = await storage.createBrandInvoice({
        ...baseData,
        invoiceNumber: await storage.generateOrgInvoiceNumber(req.user.organizationId),
        dealAmount: finalAmount,
        invoiceType: "final",
        splitPercentage: 100 - advancePercentage,
        status: "Unpaid" as const,
      });

      logOrgActivity(req.user, "created", "invoice", advanceInvoice.id, `Split invoices for: ${deal.brandName}`);
      res.status(201).json([advanceInvoice, finalInvoice]);
    } catch (error) {
      console.error("Split invoice error:", error);
      res.status(500).json({ error: "Failed to create split invoices" });
    }
  });

  app.patch("/api/profile", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const {
        firstName,
        lastName,
        phone,
        panNumber,
        gstNumber,
        digitalSignature,
        companySeal,
        profileImageUrl,
        coverImageUrl,
        onboardingComplete,
        billingAddress,
        accountHolderName,
        accountNumber,
        ifscCode,
        bankName,
      } = req.body;

      const updates: any = {};
      if (firstName !== undefined) updates.firstName = firstName;
      if (lastName !== undefined) updates.lastName = lastName;
      if (phone !== undefined) updates.phone = phone;
      if (panNumber !== undefined) updates.panNumber = panNumber;
      if (gstNumber !== undefined) updates.gstNumber = gstNumber;
      if (digitalSignature !== undefined) updates.digitalSignature = digitalSignature;
      if (companySeal !== undefined) updates.companySeal = companySeal;
      if (profileImageUrl !== undefined) updates.profileImageUrl = profileImageUrl;
      if (coverImageUrl !== undefined) updates.coverImageUrl = coverImageUrl;
      // One-way latch: the client may only ever set onboardingComplete to
      // TRUE, and only once a first name exists. Never back to false — the
      // trial grant hangs off this transition, and the grant's own guards
      // (one-shot trial_started_at, atomic UPDATE in server/trial.ts) are
      // what make a replayed PATCH harmless.
      if (onboardingComplete === true && (firstName ?? req.user.firstName)) {
        updates.onboardingComplete = true;
      }
      if (billingAddress !== undefined) updates.billingAddress = billingAddress;
      if (accountHolderName !== undefined) updates.accountHolderName = accountHolderName;
      if (accountNumber !== undefined) updates.accountNumber = accountNumber;
      if (ifscCode !== undefined) updates.ifscCode = ifscCode ? ifscCode.toUpperCase() : ifscCode;
      if (bankName !== undefined) updates.bankName = bankName;

      const wasOnboarded = !!req.user.onboardingComplete;
      let user = await storage.updateUser(userId, updates);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      // Finishing onboarding is the trial's grant point. maybeStartTrial is
      // one atomic guarded UPDATE (one-shot per owner + canonical-email
      // dedupe), so calling it on a replay grants nothing.
      if (!wasOnboarded && user.onboardingComplete) {
        const granted = await maybeStartTrial(userId);
        if (granted) user = granted;
      }
      const { password: _, ...userWithoutPassword } = user;
      res.json(userWithoutPassword);
    } catch (error) {
      console.error("Profile update error:", error);
      res.status(500).json({ error: "Failed to update profile" });
    }
  });

  app.post("/api/profile/photo", isAuthenticated, upload.single("photo"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });

      // Prefer ImageKit so files survive Railway redeploys.
      let filePath: string;
      if (isImageKitConfigured()) {
        const uploaded = await uploadFileToImageKit(req.file, {
          folder: "profiles",
          baseName: `user-${req.user.id}-photo`,
        });
        filePath = uploaded.url;
      } else {
        filePath = `/uploads/${req.file.filename}`;
      }

      await storage.updateUser(req.user.id, { profileImageUrl: filePath });
      res.json({ path: filePath });
    } catch (error) {
      console.error("Profile photo upload error:", error);
      res.status(500).json({ error: "Failed to upload photo" });
    }
  });

  app.post("/api/profile/cover", isAuthenticated, upload.single("cover"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });

      let filePath: string;
      if (isImageKitConfigured()) {
        const uploaded = await uploadFileToImageKit(req.file, {
          folder: "covers",
          baseName: `user-${req.user.id}-cover`,
        });
        filePath = uploaded.url;
      } else {
        filePath = `/uploads/${req.file.filename}`;
      }

      await storage.updateUser(req.user.id, { coverImageUrl: filePath });
      res.json({ path: filePath });
    } catch (error) {
      console.error("Cover image upload error:", error);
      res.status(500).json({ error: "Failed to upload cover image" });
    }
  });

  // Business rubber stamp / seal. Presentational only — this is NOT stamp duty.
  app.post("/api/profile/seal", isAuthenticated, upload.single("seal"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      let filePath: string;
      if (isImageKitConfigured()) {
        const uploaded = await uploadFileToImageKit(req.file, {
          folder: "seals",
          baseName: `user-${req.user.id}-seal`,
        });
        filePath = uploaded.url;
      } else {
        filePath = `/uploads/${req.file.filename}`;
      }
      res.json({ path: filePath });
    } catch (error) {
      console.error("Seal upload error:", error);
      res.status(500).json({ error: "Failed to upload seal" });
    }
  });

  app.post("/api/profile/signature", isAuthenticated, upload.single("signature"), async (req: any, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      let filePath: string;
      if (isImageKitConfigured()) {
        const uploaded = await uploadFileToImageKit(req.file, {
          folder: "signatures",
          baseName: `user-${req.user.id}-signature`,
        });
        filePath = uploaded.url;
      } else {
        filePath = `/uploads/${req.file.filename}`;
      }

      res.json({ path: filePath });
    } catch (error) {
      console.error("Signature upload error:", error);
      res.status(500).json({ error: "Failed to upload signature" });
    }
  });


  // ─────────────────────────────────────────────────────────────────────
  // ORGANIZATION, TEAM & INVITATIONS
  // ─────────────────────────────────────────────────────────────────────

  // Org profile + seat summary — any active member.
  /** Product feedback — any signed-in member, no role gate (opinions are not
   *  a permission). Stored, then emailed to the founder best-effort. Capped at
   *  5 per user per day so the inbox survives an angry evening. */
  app.post("/api/feedback", isAuthenticated, async (req: any, res) => {
    try {
      const parsed = insertFeedbackSchema.safeParse({
        rating: Number(req.body?.rating),
        category: req.body?.category || undefined,
        message: typeof req.body?.message === "string" && req.body.message.trim() ? req.body.message.trim() : undefined,
        allowTestimonial: req.body?.allowTestimonial === true,
      });
      if (!parsed.success) {
        return res.status(400).json({ error: "Pick a rating between 1 and 5." });
      }

      const [{ n }] = (await db.execute(sql`
        SELECT count(*)::int AS n FROM feedback
         WHERE user_id = ${req.user.id} AND created_at > now() - interval '1 day'`)).rows as any[];
      if (Number(n) >= 5) {
        return res.status(429).json({ error: "That's plenty for one day — thank you! Try again tomorrow." });
      }

      const [row] = await db.insert(feedback).values({
        userId: req.user.id,
        organizationId: req.user.organizationId ?? null,
        rating: parsed.data.rating,
        category: parsed.data.category ?? null,
        message: parsed.data.message ?? null,
        // Consent only counts alongside an actual message — a bare rating with
        // the box ticked gives nothing publishable.
        allowTestimonial: parsed.data.allowTestimonial === true && !!parsed.data.message,
      }).returning();

      // Founder notification. FEEDBACK_EMAIL overrides; the founder's business
      // Gmail is the default — support@dealinsec.com is not a real inbox yet.
      const to = process.env.FEEDBACK_EMAIL || "dealinsec@gmail.com";
      const stars = "★".repeat(parsed.data.rating) + "☆".repeat(5 - parsed.data.rating);
      void sendEmail({
        to,
        subject: `Feedback ${stars} — ${req.user.email}`,
        html: `<p><strong>${stars}</strong> (${parsed.data.rating}/5)</p>
<p><strong>Category:</strong> ${parsed.data.category ?? "—"}</p>
<p><strong>Testimonial use:</strong> ${row.allowTestimonial ? "✅ allowed — may publish with their name" : "❌ NOT allowed — private feedback only"}</p>
<p><strong>From:</strong> ${[req.user.firstName, req.user.lastName].filter(Boolean).join(" ")} &lt;${req.user.email}&gt;</p>
<p style="white-space:pre-wrap">${(parsed.data.message ?? "(no message)").replace(/</g, "&lt;")}</p>`,
      });

      res.status(201).json({ ok: true, id: row.id });
    } catch (error) {
      console.error("Feedback error:", error);
      res.status(500).json({ error: "Could not save your feedback" });
    }
  });

  // ── DPDP Act rights: access and erasure ────────────────────────────────
  // The privacy policy promises both, so they have to be real controls rather
  // than an email address someone has to trust.

  /** Right to access — the caller's own account plus everything their role can
   *  already see, as one JSON file. No new visibility is granted here. */
  app.get("/api/account/export", isAuthenticated, async (req: any, res) => {
    try {
      const { password: _pw, resetTokenHash: _rt, ...profile } = req.user;
      const orgId = req.user.organizationId;
      const uid = req.user.id;

      const canRead = (m: "deals" | "quotations" | "agreements" | "invoices") => canReadModule(req.user, m);
      const [deals, quotes, contracts, invoices] = await Promise.all([
        orgId && canRead("deals") ? storage.getDealsByOrg(orgId, uid) : Promise.resolve([]),
        orgId && canRead("quotations") ? storage.getQuotesByOrg(orgId, uid) : Promise.resolve([]),
        orgId && canRead("agreements") ? storage.getContractsByOrg(orgId, uid) : Promise.resolve([]),
        orgId && canRead("invoices") ? storage.getBrandInvoicesByOrg(orgId, uid) : Promise.resolve([]),
      ]);

      const stamp = new Date().toISOString();
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="dealinsec-export-${stamp.slice(0, 10)}.json"`);
      res.send(JSON.stringify({
        exportedAt: stamp,
        notice: "Personal data export under the Digital Personal Data Protection Act, 2023.",
        profile,
        deals,
        quotations: quotes,
        agreements: contracts,
        invoices,
      }, null, 2));
    } catch (error) {
      console.error("Account export error:", error);
      res.status(500).json({ error: "Could not build your export" });
    }
  });

  /** Right to erasure. An owner with teammates must hand over or remove them
   *  first — deleting them would silently destroy other people's access and
   *  the organisation's records. Financial rows are kept per the retention
   *  period stated in the privacy policy; the person is de-identified. */
  app.delete("/api/account", isAuthenticated, async (req: any, res) => {
    try {
      const uid = req.user.id;
      const orgId = req.user.organizationId;
      if (String(req.body?.confirm || "").trim().toUpperCase() !== "DELETE") {
        return res.status(400).json({ error: 'Type DELETE to confirm.' });
      }
      if (orgId && req.user.orgRole === "OWNER") {
        const members = await storage.countActiveMembers(orgId);
        if (members > 1) {
          return res.status(400).json({
            error: "Remove your team members first — deleting the owner would take their access with it.",
          });
        }
      }
      await storage.anonymizeUser(uid);
      req.logout?.(() => {});
      req.session?.destroy?.(() => {});
      res.json({ ok: true });
    } catch (error) {
      console.error("Account deletion error:", error);
      res.status(500).json({ error: "Could not delete your account" });
    }
  });

  app.get("/api/org", isAuthenticated, withOrg, async (req: any, res) => {
    try {
      const owner = await getBillingUser(req.user);
      const seatLimit = getSeatLimit(owner, req.org);
      const seatsUsed = await storage.countActiveMembers(req.org.id);
      const pending = (await storage.getPendingInvitations(req.org.id)).length;
      res.json({
        ...req.org,
        seatLimit,
        seatsUsed,
        pendingInvites: pending,
        ownerPlan: owner.plan,
        ownerPlanExpiresAt: owner.planExpiresAt,
        ownerOnTrial: hasActiveTrial(owner),
        ownerTrialEndsAt: owner.trialEndsAt ?? null,
      });
    } catch (error) {
      console.error("Org fetch error:", error);
      res.status(500).json({ error: "Failed to load organization" });
    }
  });

  // The identity that ISSUES documents for this organisation — the owner's
  // billing profile. Documents used to render whichever teammate was *viewing*
  // them, so the same invoice showed a different supplier name, PAN, bank
  // account and signature to each member. Returns only fields that legitimately
  // appear on an invoice or agreement.
  // No withOrg: a solo account has no organisation and is its own issuer.
  app.get("/api/org/issuer", isAuthenticated, async (req: any, res) => {
    try {
      const owner = await getBillingUser(req.user);
      res.json({
        name: [owner.firstName, owner.lastName].filter(Boolean).join(" ") || owner.email || "",
        email: owner.email ?? "",
        phone: owner.phone ?? "",
        panNumber: owner.panNumber ?? "",
        gstNumber: owner.gstNumber ?? "",
        billingAddress: owner.billingAddress ?? "",
        digitalSignature: owner.digitalSignature ?? "",
        companySeal: (owner as any).companySeal ?? "",
        accountHolderName: (owner as any).accountHolderName ?? "",
        accountNumber: (owner as any).accountNumber ?? "",
        ifscCode: (owner as any).ifscCode ?? "",
        bankName: (owner as any).bankName ?? "",
      });
    } catch (error) {
      console.error("Org issuer fetch error:", error);
      res.status(500).json({ error: "Failed to load issuer details" });
    }
  });

  app.patch("/api/org", isAuthenticated, requireOrgPermission("org.settings"), withOrg, async (req: any, res) => {
    try {
      const { name, industry, logo } = req.body || {};
      const updates: any = {};
      if (typeof name === "string" && name.trim()) updates.name = name.trim().slice(0, 80);
      if (typeof industry === "string") updates.industry = industry.trim().slice(0, 60) || null;
      if (typeof logo === "string") updates.logo = logo.trim().slice(0, 500) || null;
      if (!Object.keys(updates).length) return res.status(400).json({ error: "Nothing to update" });
      const org = await storage.updateOrganization(req.org.id, updates);
      logOrgActivity(req.user, "updated", "organization", req.org.id, `Organization settings`);
      res.json(org);
    } catch (error) {
      res.status(500).json({ error: "Failed to update organization" });
    }
  });

  // Members — any active member can see the team.
  app.get("/api/org/members", isAuthenticated, withOrg, async (req: any, res) => {
    try {
      const members = await storage.getOrgMembers(req.org.id);
      const roles = await storage.getOrgRoles(req.org.id);
      const roleName = new Map(roles.map((r) => [r.id, r.name]));
      res.json(members.map((m) => ({
        id: m.id,
        firstName: m.firstName,
        lastName: m.lastName,
        email: m.email,
        avatar: m.profileImageUrl,
        orgRole: m.orgRole,
        customRoleId: (m as any).customRoleId ?? null,
        customRoleName: (m as any).customRoleId ? roleName.get((m as any).customRoleId) ?? null : null,
        memberStatus: m.memberStatus,
        joinedAt: m.joinedAt ?? m.createdAt,
      })));
    } catch (error) {
      res.status(500).json({ error: "Failed to load members" });
    }
  });

  // Change a member's role. Never the OWNER's, never to OWNER, never your own.
  app.patch("/api/org/members/:id", isAuthenticated, requireOrgPermission("team.manage"), withOrg, async (req: any, res) => {
    try {
      const { orgRole, customRoleId } = req.body || {};
      let nextRole: string;
      let nextCustomId: string | null = null;
      let roleLabel: string;
      if (customRoleId) {
        const role = await storage.getOrgRole(String(customRoleId));
        if (!role || role.organizationId !== req.org.id) {
          return res.status(400).json({ error: "Invalid role" });
        }
        nextRole = CUSTOM_ROLE;
        nextCustomId = role.id;
        roleLabel = role.name;
      } else if (INVITABLE_ROLES.includes(orgRole)) {
        nextRole = orgRole;
        roleLabel = orgRole;
      } else {
        return res.status(400).json({ error: "Invalid role" });
      }
      const member = await storage.getUser(req.params.id);
      if (!member || member.organizationId !== req.org.id) {
        return res.status(404).json({ error: "Member not found" });
      }
      if (member.orgRole === "OWNER") return res.status(403).json({ error: "The owner's role can't be changed" });
      if (member.id === req.user.id) return res.status(403).json({ error: "You can't change your own role" });
      await storage.updateUser(member.id, { orgRole: nextRole, customRoleId: nextCustomId } as any);
      logOrgActivity(req.user, "changed role of", "member", member.id, `${member.email} → ${roleLabel}`);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to update role" });
    }
  });

  // ── Custom roles: the owner's permission matrix ─────────────────────
  // Writes are OWNER-only (a role IS a grant of power); the team page's
  // viewers (team.manage) can list them. Permission arrays are whitelist-
  // filtered against ASSIGNABLE_PERMISSIONS server-side — org.delete and
  // billing.manage can never ride in on a crafted request.

  app.get("/api/org/roles", isAuthenticated, requireOrgPermission("team.manage"), withOrg, async (req: any, res) => {
    try {
      // Lazy one-shot seed for orgs that predate editable default roles —
      // the latch means a deliberately deleted default never resurrects.
      if (!req.org.rolesSeeded) await storage.seedDefaultRoles(req.org.id);
      const roles = await storage.getOrgRoles(req.org.id);
      const withUsage = await Promise.all(roles.map(async (r) => ({
        ...r,
        usage: await storage.countCustomRoleUsage(r.id),
      })));
      res.json(withUsage);
    } catch (error) {
      res.status(500).json({ error: "Failed to load roles" });
    }
  });

  const requireOwner = (req: any, res: any): boolean => {
    if (req.user?.orgRole === "OWNER") return true;
    res.status(403).json({ code: "FORBIDDEN", error: "Only the organization owner can manage roles" });
    return false;
  };

  const cleanRoleInput = (body: any): { name: string; permissions: string[] } | null => {
    const name = String(body?.name || "").trim().slice(0, 40);
    if (name.length < 2) return null;
    const requested = Array.isArray(body?.permissions) ? body.permissions : [];
    const permissions = ASSIGNABLE_PERMISSIONS.filter((p) => requested.includes(p));
    return { name, permissions };
  };

  app.post("/api/org/roles", isAuthenticated, withOrg, async (req: any, res) => {
    if (!requireOwner(req, res)) return;
    try {
      const input = cleanRoleInput(req.body);
      if (!input) return res.status(400).json({ error: "Role name must be at least 2 characters" });
      const role = await storage.createOrgRole(req.org.id, input.name, input.permissions);
      logOrgActivity(req.user, "created role", "member", role.id, `Role: ${role.name}`);
      res.status(201).json(role);
    } catch (error: any) {
      if (error?.code === "23505") {
        return res.status(409).json({ error: "A role with this name already exists" });
      }
      res.status(500).json({ error: "Failed to create role" });
    }
  });

  app.patch("/api/org/roles/:id", isAuthenticated, withOrg, async (req: any, res) => {
    if (!requireOwner(req, res)) return;
    try {
      const existing = await storage.getOrgRole(req.params.id);
      if (!existing || existing.organizationId !== req.org.id) {
        return res.status(404).json({ error: "Role not found" });
      }
      const input = cleanRoleInput(req.body);
      if (!input) return res.status(400).json({ error: "Role name must be at least 2 characters" });
      const role = await storage.updateOrgRole(existing.id, input);
      logOrgActivity(req.user, "updated role", "member", existing.id, `Role: ${input.name}`);
      res.json(role);
    } catch (error: any) {
      if (error?.code === "23505") {
        return res.status(409).json({ error: "A role with this name already exists" });
      }
      res.status(500).json({ error: "Failed to update role" });
    }
  });

  app.delete("/api/org/roles/:id", isAuthenticated, withOrg, async (req: any, res) => {
    if (!requireOwner(req, res)) return;
    try {
      const existing = await storage.getOrgRole(req.params.id);
      if (!existing || existing.organizationId !== req.org.id) {
        return res.status(404).json({ error: "Role not found" });
      }
      const usage = await storage.countCustomRoleUsage(existing.id);
      if (usage.members > 0 || usage.invites > 0) {
        return res.status(409).json({
          error: `This role is still assigned to ${usage.members} member(s) and ${usage.invites} pending invite(s). Reassign them first.`,
        });
      }
      await storage.deleteOrgRole(existing.id);
      logOrgActivity(req.user, "deleted role", "member", existing.id, `Role: ${existing.name}`);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete role" });
    }
  });

  // Remove a member (soft — memberStatus 'removed' kills their access; their
  // created records stay with the organization).
  app.delete("/api/org/members/:id", isAuthenticated, requireOrgPermission("team.manage"), withOrg, async (req: any, res) => {
    try {
      const member = await storage.getUser(req.params.id);
      if (!member || member.organizationId !== req.org.id) {
        return res.status(404).json({ error: "Member not found" });
      }
      if (member.orgRole === "OWNER") return res.status(403).json({ error: "The owner can't be removed" });
      if (member.id === req.user.id) return res.status(403).json({ error: "You can't remove yourself" });
      await storage.updateUser(member.id, { memberStatus: "removed" } as any);
      logOrgActivity(req.user, "removed", "member", member.id, `${member.email}`);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to remove member" });
    }
  });

  // Invitations
  app.get("/api/org/invitations", isAuthenticated, requireOrgPermission("team.invite"), withOrg, async (req: any, res) => {
    try {
      res.json(await storage.getPendingInvitations(req.org.id));
    } catch (error) {
      res.status(500).json({ error: "Failed to load invitations" });
    }
  });

  app.post("/api/org/invitations", isAuthenticated, requireOrgPermission("team.invite"), withOrg, async (req: any, res) => {
    try {
      const email = String(req.body?.email || "").trim().toLowerCase();
      let orgRole = req.body?.orgRole;
      const customRoleId = req.body?.customRoleId ? String(req.body.customRoleId) : null;
      // Human-readable role for the invitation email — "CUSTOM" is an internal
      // sentinel and must never reach the invitee.
      let roleLabel = String(req.body?.orgRole ?? "");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: "Please enter a valid email" });
      }
      // Either a built-in invitable role OR one of this org's custom roles —
      // the custom role must belong to the caller's org (no cross-org grants).
      if (customRoleId) {
        const role = await storage.getOrgRole(customRoleId);
        if (!role || role.organizationId !== req.org.id) {
          return res.status(400).json({ error: "Invalid role" });
        }
        orgRole = CUSTOM_ROLE;
        roleLabel = role.name;
      } else if (!INVITABLE_ROLES.includes(orgRole)) {
        return res.status(400).json({ error: "Invalid role" });
      }

      // Seat validation: active members + live pending invites vs the limit.
      // This read-then-insert isn't transactional, so concurrent invites can
      // over-create pending rows — harmless because ACCEPT re-checks seats and
      // is the authoritative gate (an extra invite simply can't be redeemed).
      const owner = await getBillingUser(req.user);
      const seatLimit = getSeatLimit(owner, req.org);
      const used = await storage.countActiveMembers(req.org.id);
      const pending = (await storage.getPendingInvitations(req.org.id)).length;
      if (used + pending >= seatLimit) {
        return res.status(403).json({
          code: "SEAT_LIMIT",
          error: `Your current plan allows ${seatLimit} team member${seatLimit === 1 ? "" : "s"}. Upgrade your plan or purchase additional seats.`,
          seats: { used, pending, limit: seatLimit },
        });
      }

      const existing = await storage.getUserByEmail(email);
      if (existing) {
        return res.status(409).json({ error: "This email already has a DealInSec account" });
      }
      const dup = (await storage.getPendingInvitations(req.org.id)).find((i) => i.email === email);
      if (dup) {
        return res.status(409).json({ error: "This email already has a pending invitation" });
      }

      const token = crypto.randomBytes(24).toString("hex");
      const inv = await storage.createInvitation({
        organizationId: req.org.id,
        email,
        orgRole,
        customRoleId,
        token,
        invitedBy: req.user.id,
        status: "pending",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      } as any);

      const inviterName = [req.user.firstName, req.user.lastName].filter(Boolean).join(" ") || req.user.email || "A teammate";
      const { subject, html } = inviteEmail({
        orgName: req.org.name,
        inviterName,
        roleLabel: roleLabel && roleLabel !== CUSTOM_ROLE
          ? roleLabel
          : orgRole.charAt(0) + orgRole.slice(1).toLowerCase(),
        token,
      });
      void sendEmail({ to: email, subject, html });

      logOrgActivity(req.user, "invited", "member", null, `${email} as ${roleLabel || orgRole}`);
      res.status(201).json(inv);
    } catch (error) {
      console.error("Invitation error:", error);
      res.status(500).json({ error: "Failed to send invitation" });
    }
  });

  app.post("/api/org/invitations/:id/resend", isAuthenticated, requireOrgPermission("team.invite"), withOrg, async (req: any, res) => {
    try {
      const pending = await storage.getPendingInvitations(req.org.id);
      const inv = pending.find((i) => i.id === parseInt(req.params.id));
      if (!inv) return res.status(404).json({ error: "Invitation not found" });
      // Refresh expiry on resend
      await storage.updateInvitation(inv.id, { expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) });
      const inviterName = [req.user.firstName, req.user.lastName].filter(Boolean).join(" ") || req.user.email || "A teammate";
      const { subject, html } = inviteEmail({
        orgName: req.org.name,
        inviterName,
        roleLabel: inv.orgRole.charAt(0) + inv.orgRole.slice(1).toLowerCase(),
        token: inv.token,
      });
      void sendEmail({ to: inv.email, subject, html });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to resend invitation" });
    }
  });

  app.delete("/api/org/invitations/:id", isAuthenticated, requireOrgPermission("team.invite"), withOrg, async (req: any, res) => {
    try {
      const pending = await storage.getPendingInvitations(req.org.id);
      const inv = pending.find((i) => i.id === parseInt(req.params.id));
      if (!inv) return res.status(404).json({ error: "Invitation not found" });
      await storage.updateInvitation(inv.id, { status: "revoked" });
      logOrgActivity(req.user, "revoked invitation for", "member", null, inv.email);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to revoke invitation" });
    }
  });

  // Activity feed
  app.get("/api/org/activity", isAuthenticated, requireOrgPermission("activity.view"), withOrg, async (req: any, res) => {
    try {
      // 500, not 100: the client paginates locally, and a silent cap makes
      // "Showing 1–20 of 100" a lie when there are 400 events. 500 covers
      // months of a small team's history; server-side paging can come later.
      res.json(await storage.getActivityLogs(req.org.id, 500));
    } catch (error) {
      res.status(500).json({ error: "Failed to load activity" });
    }
  });

  // ── Public invitation acceptance (no auth — token is the credential) ──
  app.get("/api/invitations/:token", async (req, res) => {
    try {
      const inv = await storage.getInvitationByToken(req.params.token);
      if (!inv || inv.status !== "pending" || new Date(inv.expiresAt).getTime() < Date.now()) {
        return res.status(404).json({ error: "This invitation is invalid or has expired" });
      }
      const org = await storage.getOrganization(inv.organizationId);
      res.json({ email: inv.email, orgRole: inv.orgRole, orgName: org?.name || "an organization" });
    } catch (error) {
      res.status(500).json({ error: "Failed to load invitation" });
    }
  });

  app.post("/api/invitations/:token/accept", async (req: any, res) => {
    try {
      const inv = await storage.getInvitationByToken(req.params.token);
      if (!inv || inv.status !== "pending" || new Date(inv.expiresAt).getTime() < Date.now()) {
        return res.status(404).json({ error: "This invitation is invalid or has expired" });
      }
      const { password, firstName, lastName } = req.body || {};
      if (!password || String(password).length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters" });
      }
      const existing = await storage.getUserByEmail(inv.email);
      if (existing) {
        return res.status(409).json({ error: "This email already has an account. Please contact your organization owner." });
      }

      // Re-check seats AT ACCEPT TIME: the invite passed the limit when it was
      // sent, but the org's plan may have lapsed (Pro 5 seats -> free 1) or
      // other invitations may have been accepted since. Without this, stale
      // invites would let an org exceed the seats it currently pays for.
      const org = await storage.getOrganization(inv.organizationId);
      const orgOwner = await storage.getOrgOwner(inv.organizationId);
      const limit = getSeatLimit(orgOwner, org);
      const activeNow = await storage.countActiveMembers(inv.organizationId);
      if (activeNow >= limit) {
        return res.status(403).json({
          code: "SEAT_LIMIT",
          error: "This organization has no seats available right now. Please ask the owner to upgrade or free a seat.",
        });
      }

      const bcrypt = await import("bcrypt");
      const hashed = await bcrypt.hash(String(password), 10);
      const member = await storage.createUser({
        email: inv.email,
        password: hashed,
        firstName: firstName || null,
        lastName: lastName || null,
        role: "influencer",
        onboardingComplete: true,
        organizationId: inv.organizationId,
        orgRole: inv.orgRole,
        customRoleId: (inv as any).customRoleId ?? null,
        memberStatus: "active",
        invitedBy: inv.invitedBy,
        joinedAt: new Date(),
      } as any);
      await storage.updateInvitation(inv.id, { status: "accepted" });

      void storage.logActivity({
        organizationId: inv.organizationId,
        userId: member.id,
        userName: [member.firstName, member.lastName].filter(Boolean).join(" ") || member.email || "New member",
        action: "joined",
        entityType: "member",
        entityId: member.id,
        detail: `${member.email} joined as ${inv.orgRole}`,
      });

      (req.session as any).userId = member.id;
      const { password: _, ...userWithoutPassword } = member;
      res.status(201).json(userWithoutPassword);
    } catch (error) {
      console.error("Invitation accept error:", error);
      res.status(500).json({ error: "Failed to accept invitation" });
    }
  });

  app.get("/api/credits/balance", isAuthenticated, async (req: any, res) => {
    try {
      // The org's credit pool lives on its owner's row. Lazy-reset first so a
      // stale month never shows 0.
      const billing = await getBillingUser(req.user);
      const refreshed = await storage.ensureMonthlyCredits(billing.id);
      const user = refreshed ?? (await storage.getUser(billing.id));
      const credits = getDealCredits(user);
      const transactions = await storage.getCreditTransactions(billing.id);
      res.json({
        monthly: credits.monthly,
        purchased: credits.purchased,
        total: credits.total,
        resetsAt: user?.monthlyCreditsResetAt ?? null,
        // True while paid Pro OR trial is in force — the balance above is
        // irrelevant to deal creation while this is set.
        unlimited: hasProAccess(user),
        transactions: transactions.slice(0, 10),
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch credit balance" });
    }
  });

  // NOTE: the legacy PayU purchase initiator (POST /api/payments/create) was
  // removed with the subscription-first model — Razorpay is the only rail.
  // The PayU success/failure callbacks below stay dormant to safely absorb any
  // in-flight redirect from before the deploy.

  app.post("/api/payments/success", async (req, res) => {
    try {
      const { txnid, mihpayid, status, hash: receivedHash, amount } = req.body;

      if (!txnid) {
        return res.redirect("/pricing?error=invalid_transaction");
      }

      // This unauthenticated legacy callback must only ever touch orders the
      // PayU flow itself created (INFLU_ prefix, credit purchases). Razorpay
      // orders (order_..., including Pro plans) share the same table and are
      // completed exclusively by the signature-verified Razorpay paths.
      if (typeof txnid !== "string" || !txnid.startsWith("INFLU_")) {
        return res.redirect("/pricing?error=invalid_transaction");
      }

      const order = await storage.getPayuOrder(txnid);
      if (!order) {
        return res.redirect("/pricing?error=order_not_found");
      }

      if (order.purpose !== "credits") {
        return res.redirect("/pricing?error=invalid_transaction");
      }

      if (order.status === "completed") {
        return res.redirect("/pricing?success=true&already_processed=true");
      }

      if (order.status !== "pending") {
        return res.redirect("/pricing?error=invalid_order_status");
      }

      const parsedAmount = parseFloat(amount);
      if (parsedAmount !== order.amount) {
        console.error(`Amount mismatch: expected ${order.amount}, got ${parsedAmount}`);
        await storage.updatePayuOrder(txnid, { status: "failed" });
        return res.redirect("/pricing?error=amount_mismatch");
      }

      // Hash verification is mandatory — fail closed. An absent hash or an
      // unconfigured salt must never grant credits.
      const payu = getPayuConfig();
      if (!payu.salt || !receivedHash) {
        console.error("PayU callback rejected: missing salt or hash");
        return res.redirect("/pricing?error=verification_failed");
      }
      const reverseHashString = `${payu.salt}|${status}|||||||||||${req.body.email || ""}|${req.body.firstname || ""}|${req.body.productinfo || ""}|${amount}|${txnid}|${payu.key}`;
      const calculatedHash = crypto.createHash("sha512").update(reverseHashString).digest("hex");
      if (calculatedHash !== receivedHash) {
        console.error("Hash verification failed");
        await storage.updatePayuOrder(txnid, { status: "failed" });
        return res.redirect("/pricing?error=verification_failed");
      }

      if (status === "success") {
        // Atomic claim — grants exactly once even under concurrent callbacks.
        const claimed = await storage.completePayuOrderOnce(txnid, {
          payuTxnId: mihpayid,
          payuHash: receivedHash,
          completedAt: new Date(),
        });

        if (claimed) {
          await storage.addPurchasedCredits(order.userId, order.credits, "purchase", order.amount);
        }

        res.redirect("/pricing?success=true");
      } else {
        await storage.updatePayuOrder(txnid, { status: "failed" });
        res.redirect("/pricing?error=payment_failed");
      }
    } catch (error) {
      console.error("Payment success callback error:", error);
      res.redirect("/pricing?error=processing_error");
    }
  });

  app.post("/api/payments/failure", async (req, res) => {
    try {
      const { txnid } = req.body;
      // Same scoping as the success callback: only legacy PayU orders, and
      // never flip an already-completed order to failed.
      if (typeof txnid === "string" && txnid.startsWith("INFLU_")) {
        const order = await storage.getPayuOrder(txnid);
        if (order && order.status === "pending") {
          await storage.updatePayuOrder(txnid, { status: "failed" });
        }
      }
      res.redirect("/pricing?error=payment_failed");
    } catch (error) {
      console.error("Payment failure callback error:", error);
      res.redirect("/pricing?error=processing_error");
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // RAZORPAY — primary payment gateway (UPI QR / cards / netbanking)
  // ─────────────────────────────────────────────────────────────────────

  // Public config — lets the frontend render the live prices (env-driven) so
  // testing at ₹1 shows ₹1 everywhere.
  app.get("/api/payments/config", (_req, res) => {
    res.json({
      proMonthlyPrice: getProMonthlyPrice(),
      proYearlyPrice: getProYearlyPrice(),
      dealBoostPrice: getDealBoostPrice(),
      extraSeatPrice: getExtraSeatPrice(),
      // Legacy alias for stale pre-deploy tabs: the old client renders Pro's
      // price from this key (its {plan:"pro"} order maps to pro_yearly), so
      // keeping it prevents an old tab showing one price and being charged
      // another.
      proPlanPrice: getProYearlyPrice(),
      razorpayEnabled: isRazorpayConfigured(),
    });
  });

  // Step 1: create an order. Frontend opens Razorpay Checkout with the
  // returned orderId + key. Reuses the payu_orders table for persistence.
  //
  // Three SKUs (one-time payments; terms are non-auto-renewing):
  //   { plan: "pro_monthly" } — ₹999, Pro for 1 month
  //   { plan: "pro_yearly" }  — ₹9,999, Pro for 1 year
  //   { plan: "deal_boost" }  — ₹99, unlimited deals+quotations for 1 month
  // Legacy bodies from cached clients are mapped: {plan:"pro"} → pro_yearly,
  // {credits:n} → deal_boost.
  app.post("/api/payments/razorpay/order", isAuthenticated, requireOrgPermission("billing.manage"), async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ error: "User not found" });

      if (!isRazorpayConfigured()) {
        return res.status(503).json({
          error: "Payment gateway not configured",
          message: "Razorpay credentials not set. Configure RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.",
        });
      }

      let sku: "pro_monthly" | "pro_yearly" | "deal_boost" | "extra_seat";
      switch (req.body.plan) {
        case "pro_monthly": sku = "pro_monthly"; break;
        case "pro_yearly": sku = "pro_yearly"; break;
        case "deal_boost": sku = "deal_boost"; break;
        case "extra_seat": sku = "extra_seat"; break;
        case "pro": sku = "pro_yearly"; break;          // legacy cached client
        default:
          if (req.body.credits) { sku = "deal_boost"; break; } // legacy cached client
          return res.status(400).json({ error: "Unknown plan" });
      }

      // Seat purchases carry a quantity (1–20); stored in the order's credits
      // column so the grant/refund paths know how many seats to apply.
      const seatQty = sku === "extra_seat"
        ? Math.min(20, Math.max(1, parseInt(req.body.qty, 10) || 1))
        : 0;

      const PRICES: Record<typeof sku, number> = {
        pro_monthly: getProMonthlyPrice(),
        pro_yearly: getProYearlyPrice(),
        deal_boost: getDealBoostPrice(),
        extra_seat: getExtraSeatPrice() * seatQty,
      };
      const DESCRIPTIONS: Record<typeof sku, string> = {
        pro_monthly: "DealInSec Pro — Monthly (unlimited workflow)",
        pro_yearly: "DealInSec Pro — 1 Year (unlimited workflow)",
        deal_boost: "Deal Boost — unlimited deals & quotations for 1 month",
        extra_seat: `${seatQty} extra team seat${seatQty > 1 ? "s" : ""} — 1 month`,
      };
      const amountInRupees = PRICES[sku];
      const receipt = `DIS_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

      const order = await createRazorpayOrder({
        amountInRupees,
        receipt,
        notes: { userId, plan: sku },
      });

      // Persist as pending — orderId column holds the Razorpay order id
      await storage.createPayuOrder({
        userId,
        orderId: order.id,
        amount: amountInRupees,
        credits: seatQty,
        purpose: sku,
        status: "pending",
      });

      res.json({
        keyId: getRazorpayKeyId(),
        orderId: order.id,
        amount: order.amount,        // paise
        currency: order.currency,
        plan: sku,
        name: "DealInSec",
        description: DESCRIPTIONS[sku],
        prefill: {
          name: [user.firstName, user.lastName].filter(Boolean).join(" ") || undefined,
          email: user.email || undefined,
          contact: user.phone || undefined,
        },
      });
    } catch (error: any) {
      // Surface the real Razorpay reason — most failures here are credential
      // or amount issues (wrong key/secret, test-vs-live mismatch, etc.)
      const rzpDesc =
        error?.error?.description ||
        error?.description ||
        error?.message ||
        "Unknown error";
      console.error("Razorpay order creation error:", JSON.stringify(error?.error || error, null, 2));
      res.status(500).json({
        error: "Failed to create payment order",
        reason: rzpDesc,
      });
    }
  });

  // Step 2: verify payment after Checkout success (called from the browser).
  // This is the primary credit-grant path; the webhook is a backup.
  app.post("/api/payments/razorpay/verify", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.status(400).json({ error: "Missing payment verification fields" });
      }

      const order = await storage.getPayuOrder(razorpay_order_id);
      if (!order) return res.status(404).json({ error: "Order not found" });
      if (order.userId !== userId) return res.status(403).json({ error: "Order does not belong to you" });

      // Idempotent — if already completed, just succeed
      if (order.status === "completed") {
        return res.json({ success: true, alreadyProcessed: true });
      }
      // Refunded is terminal. The verify signature stays valid forever, so
      // without this a buyer could replay it after a refund and get the
      // entitlement re-granted on top of their money back.
      if (order.status === "refunded") {
        return res.status(409).json({ error: "This payment was refunded" });
      }

      const valid = verifyPaymentSignature({
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        signature: razorpay_signature,
      });
      if (!valid) {
        // Guarded pending→failed only: an unguarded write here could race the
        // webhook and stomp 'failed' over a completed (already granted) order.
        await storage.markPayuOrderFailedIfPending(razorpay_order_id);
        return res.status(400).json({ error: "Signature verification failed" });
      }

      // Atomic pending→completed claim: if the webhook got here first this
      // returns undefined and we skip the grant — no double credit / 732-day
      // Pro term from one payment.
      const updated = await storage.completePayuOrderOnce(razorpay_order_id, {
        payuTxnId: razorpay_payment_id,
        payuHash: razorpay_signature,
        completedAt: new Date(),
      });

      if (updated) {
        let granted;
        try {
          granted = await grantPurchase(updated.purpose, order.userId, order);
        } catch (grantError) {
          // The claim already marked the order completed; without this revert a
          // transient grant failure would be permanent (paid, never delivered,
          // and every webhook retry loses the claim). Reopen so a retry or the
          // webhook can deliver.
          await storage.updatePayuOrder(razorpay_order_id, { status: "pending" }).catch(() => {});
          throw grantError;
        }

        // Payment receipt email — best-effort
        const buyer = await storage.getUser(order.userId);
        if (buyer?.email) {
          const date = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
          const fmt = (d: Date | string | null | undefined) =>
            d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "";
          const { subject, html } = granted.kind === "pro"
            ? proPlanReceiptEmail({
                firstName: buyer.firstName || undefined,
                amount: order.amount,
                paymentId: razorpay_payment_id,
                date,
                term: granted.term,
                expiresOn: fmt(granted.user?.planExpiresAt),
              })
            : granted.kind === "boost"
            ? paymentReceiptEmail({
                firstName: buyer.firstName || undefined,
                product: "Deal Boost — unlimited deals & quotations for 1 month",
                amount: order.amount,
                paymentId: razorpay_payment_id,
                date,
              })
            : granted.kind === "seats"
            ? paymentReceiptEmail({
                firstName: buyer.firstName || undefined,
                product: `${granted.qty} extra team seat${granted.qty > 1 ? "s" : ""} — 1 month`,
                amount: order.amount,
                paymentId: razorpay_payment_id,
                date,
              })
            : paymentReceiptEmail({
                firstName: buyer.firstName || undefined,
                product: `${order.credits} Deal Credit${order.credits > 1 ? "s" : ""}`,
                amount: order.amount,
                paymentId: razorpay_payment_id,
                date,
              });
          void sendEmail({ to: buyer.email, subject, html });
        }
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Razorpay verify error:", error);
      res.status(500).json({ error: "Failed to verify payment" });
    }
  });

  // Step 3 (backup): webhook for server-to-server confirmation.
  // The global express.json({ verify }) stashed the exact bytes on
  // req.rawBody — we HMAC over those to verify authenticity.
  app.post("/api/payments/razorpay/webhook", async (req: any, res) => {
      try {
        const signature = req.headers["x-razorpay-signature"] as string;
        const rawBody: string = req.rawBody
          ? req.rawBody.toString("utf8")
          : JSON.stringify(req.body);

        if (!verifyWebhookSignature(rawBody, signature)) {
          return res.status(400).json({ error: "Invalid webhook signature" });
        }

        const event = JSON.parse(rawBody);
        // We care about successful payments
        if (event.event === "payment.captured" || event.event === "order.paid") {
          const entity = event.payload?.payment?.entity || event.payload?.order?.entity;
          const orderId = entity?.order_id || entity?.id;
          const paymentId = entity?.id;
          if (orderId) {
            const order = await storage.getPayuOrder(orderId);
            if (order) {
              // Atomic claim — loses gracefully to the browser verify path.
              const updated = await storage.completePayuOrderOnce(orderId, {
                payuTxnId: paymentId,
                completedAt: new Date(),
              });
              if (updated) {
                try {
                  await grantPurchase(updated.purpose, order.userId, order);
                } catch (grantError) {
                  // Reopen the claim so Razorpay's webhook retry can deliver —
                  // otherwise a transient grant failure is paid-but-never-delivered.
                  await storage.updatePayuOrder(orderId, { status: "pending" }).catch(() => {});
                  throw grantError;
                }
              }
            }
          }
        }

        // Refunds (issued from the Razorpay dashboard) — claw back what the
        // payment bought. Atomic completed→refunded claim guards re-delivery.
        if (event.event === "refund.processed" || event.event === "payment.refunded") {
          const refundEntity = event.payload?.refund?.entity;
          const paymentId = refundEntity?.payment_id
            || event.payload?.payment?.entity?.id;
          if (paymentId) {
            const order = await storage.getPayuOrderByPaymentId(paymentId);
            if (order) {
              const claimed = await storage.markPayuOrderRefundedOnce(order.orderId);
              if (claimed) {
                // If the term this order granted has ALREADY fully lapsed
                // (e.g. a January monthly refunded in June after the user
                // re-subscribed), subtracting a term now would destroy the
                // freshly paid current term instead of the refunded one. The
                // entitlement already expired naturally — nothing to claw back.
                const termDays: Record<string, number> = {
                  pro_monthly: PRO_MONTHLY_DAYS,
                  pro_yearly: PRO_YEARLY_DAYS,
                  pro_plan: PRO_YEARLY_DAYS,
                  deal_boost: DEAL_BOOST_DAYS,
                  extra_seat: EXTRA_SEAT_DAYS,
                };
                const days = termDays[claimed.purpose];
                let grantLapsed =
                  days != null &&
                  claimed.completedAt != null &&
                  Date.now() - new Date(claimed.completedAt).getTime() > days * 86_400_000;

                // Seat packs share ONE expiry (a top-up inherits the pack's
                // existing end date), so purchase-age is the wrong signal —
                // ask the organization when its current pack actually ends.
                if (claimed.purpose === "extra_seat") {
                  const seatBuyer = await storage.getUser(order.userId);
                  const seatOrg = seatBuyer?.organizationId
                    ? await storage.getOrganization(seatBuyer.organizationId)
                    : null;
                  grantLapsed = !seatOrg?.extraSeatsExpiresAt ||
                    new Date(seatOrg.extraSeatsExpiresAt).getTime() <= Date.now();
                }

                if (grantLapsed) {
                  console.log(`Refund for ${order.orderId} (${claimed.purpose}): granted term already lapsed — no clawback`);
                } else {
                  switch (claimed.purpose) {
                    case "pro_monthly":
                      await storage.revokeProPlan(order.userId, PRO_MONTHLY_DAYS);
                      break;
                    case "pro_yearly":
                    case "pro_plan": // legacy annual orders
                      await storage.revokeProPlan(order.userId, PRO_YEARLY_DAYS);
                      break;
                    case "deal_boost":
                      await storage.revokeDealBoost(order.userId, DEAL_BOOST_DAYS);
                      break;
                    case "extra_seat": {
                      const buyer = await storage.getUser(order.userId);
                      if (buyer?.organizationId && order.credits > 0) {
                        await storage.revokeExtraSeats(buyer.organizationId, order.credits);
                      }
                      break;
                    }
                    default: // legacy "credits" orders
                      if (order.credits > 0) {
                        await storage.addPurchasedCredits(order.userId, -order.credits, "refund", order.amount);
                      }
                  }
                }
              }
            }
          }
        }

        res.json({ received: true });
      } catch (error) {
        console.error("Razorpay webhook error:", error);
        res.status(500).json({ error: "Webhook processing failed" });
      }
  });

  // Newsletter / waitlist capture (public — from landing footer)
  app.post("/api/newsletter", async (req, res) => {
    try {
      const email = String(req.body.email || "").trim().toLowerCase();
      const source = String(req.body.source || "footer").slice(0, 40);
      // basic email shape check
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: "Please enter a valid email" });
      }
      // Idempotent — ignore duplicates gracefully
      await db
        .insert(newsletterSubscribers)
        .values({ email, source })
        .onConflictDoNothing();
      res.status(201).json({ success: true });
    } catch (error) {
      console.error("Newsletter signup error:", error);
      res.status(500).json({ error: "Could not subscribe. Please try again." });
    }
  });

  // ── AI: "describe → invoice" for the free GST invoice tool (DeepSeek) ──
  // Public (no login) but rate-limited per IP + a global daily cap so the
  // owner's API credits can't be drained. The DeepSeek key stays server-side.
  app.post("/api/ai/invoice", async (req: any, res) => {
    let reservedIp: string | null = null;
    try {
      if (!aiEnabled()) return res.status(503).json({ error: "AI is unavailable right now." });
      const text = String(req.body?.text || "").trim();
      if (text.length < 4) return res.status(400).json({ error: "Please describe your invoice in a sentence." });
      if (text.length > 600) return res.status(400).json({ error: "That's a bit long — keep it to a sentence or two." });
      // True per-user IP: behind Cloudflare, CF-Connecting-IP is set by Cloudflare
      // and CANNOT be spoofed by the client (unlike the leftmost X-Forwarded-For).
      const cf = req.headers["cf-connecting-ip"];
      const xff = String(req.headers["x-forwarded-for"] || "").split(",").map((s: string) => s.trim()).filter(Boolean);
      const ip = (cf ? String(cf) : xff.length ? xff[xff.length - 1] : req.ip || "unknown").trim() || "unknown";
      // Reserve the slot BEFORE the paid call so concurrent bursts can't bypass the caps.
      const rl = reserve(ip);
      if (!rl.ok) {
        return res.status(429).json({
          error:
            rl.reason === "ip"
              ? "You've used your free AI generations for today. Create a free account for more."
              : "AI is busy right now — please try again in a bit.",
          reason: rl.reason,
        });
      }
      reservedIp = ip;
      const result = await extractInvoice(text);
      res.json(result);
    } catch (error: any) {
      // Refund the slot ONLY when DeepSeek didn't bill us (network error / non-2xx).
      if (reservedIp && !error?.billed) refund(reservedIp);
      console.error("AI invoice error:", error?.message || error);
      res.status(502).json({ error: "Couldn't generate that — please try again, or fill it in manually." });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
