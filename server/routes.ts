import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertDealSchema, insertContractSchema, brandInvoices as brandInvoicesTable, newsletterSubscribers, invoiceDocumentCategories, hasActivePro, hasActiveDealBoost, getDealCredits } from "@shared/schema";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { setupAuth, isAuthenticated } from "./auth";
import { requirePro } from "./entitlements";
import { aiEnabled, reserve, refund, extractInvoice } from "./ai";
import { getUncachableStripeClient, getStripePublishableKey } from "./stripeClient";
import multer from "multer";
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
  PRO_MONTHLY_DAYS,
  PRO_YEARLY_DAYS,
  DEAL_BOOST_DAYS,
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
} from "./emails";

// Deliver what a completed payment order bought. Shared by the browser verify
// path and the webhook (whichever atomically claims the order first calls
// this exactly once). Legacy purposes from orders created before the
// subscription-first model ("pro_plan", "credits") are still honored.
type GrantResult =
  | { kind: "pro"; term: "monthly" | "yearly"; user?: import("@shared/schema").User }
  | { kind: "boost"; user?: import("@shared/schema").User }
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

  app.get('/api/auth/user', isAuthenticated, async (req: any, res) => {
    try {
      // Lazy monthly credit reset: every page load hits this endpoint, so the
      // displayed Deal Credit balance is always current without any cron.
      const refreshed = await storage.ensureMonthlyCredits(req.user.id);
      const { password: _, ...userWithoutPassword } = refreshed ?? req.user;
      res.json(userWithoutPassword);
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

  app.get("/api/deals", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const deals = await storage.getDeals(userId);
      res.json(deals);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch deals" });
    }
  });

  app.get("/api/deals/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const deal = await storage.getDeal(parseInt(req.params.id));
      if (!deal) {
        return res.status(404).json({ error: "Deal not found" });
      }
      const isOwner = deal.userId === userId;
      const isBrandUser = deal.brandUserId === userId;
      if (!isOwner && !isBrandUser) {
        return res.status(403).json({ error: "Access denied" });
      }
      res.json(deal);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch deal" });
    }
  });

  app.post("/api/deals", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const parsed = insertDealSchema.safeParse({ ...req.body, userId });
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors });
      }

      // Free plan: 1 Deal Credit = this deal + its quotation. Pro and Deal
      // Boost are unlimited. Spend happens AFTER validation so a 400 never
      // burns a credit; the reset runs first so a stale month can't block.
      let creditSpent = false;
      if (!hasActivePro(req.user) && !hasActiveDealBoost(req.user)) {
        await storage.ensureMonthlyCredits(userId);
        const spend = await storage.spendDealCredit(userId);
        if (!spend.ok) {
          const user = await storage.getUser(userId);
          const credits = getDealCredits(user);
          return res.status(402).json({
            code: "NO_CREDITS",
            feature: "deals",
            error: "You've used all your Deal Credits for this month",
            credits: {
              monthly: credits.monthly,
              purchased: credits.purchased,
              resetsAt: user?.monthlyCreditsResetAt ?? null,
            },
          });
        }
        creditSpent = true;
      }

      try {
        const deal = await storage.createDeal(parsed.data);
        res.status(201).json(deal);
      } catch (insertError) {
        // Rare compensation path: the credit was taken but the insert failed.
        if (creditSpent) await storage.regrantDealCredit(userId).catch(() => {});
        throw insertError;
      }
    } catch (error) {
      console.error("Deal creation error:", error);
      res.status(500).json({ error: "Failed to create deal" });
    }
  });

  // Edit a deal (only Pending deals)
  app.patch("/api/deals/:id", isAuthenticated, async (req: any, res) => {
    try {
      const dealId = parseInt(req.params.id);
      const deal = await storage.getDeal(dealId);
      if (!deal) return res.status(404).json({ error: "Deal not found" });
      if (deal.userId !== req.user.id) return res.status(403).json({ error: "Not authorized" });
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
  app.post("/api/deals/:id/quote", isAuthenticated, async (req: any, res) => {
    try {
      const dealId = parseInt(req.params.id);
      const deal = await storage.getDeal(dealId);
      if (!deal) return res.status(404).json({ error: "Deal not found" });
      if (deal.userId !== req.user.id) return res.status(403).json({ error: "Not authorized" });

      const existing = await storage.getQuoteByDealId(dealId);

      // If latest quote is still draft, return it (idempotent)
      if (existing && existing.status === "draft") {
        return res.json(existing);
      }

      // Create new quote (first one, or after revision)
      const newVersion = existing ? (existing.version || 1) + 1 : 1;
      const quote = await storage.createQuote({
        userId: req.user.id,
        dealId,
        status: "draft",
        version: newVersion,
      });
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
      if (deal.userId !== req.user.id) return res.status(403).json({ error: "Not authorized" });

      const quote = await storage.getQuoteByDealId(dealId);
      if (!quote) return res.status(404).json({ error: "Quote not found" });
      res.json(quote);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch quote" });
    }
  });

  // Mark deal as completed
  app.patch("/api/deals/:id/complete", isAuthenticated, async (req: any, res) => {
    try {
      const dealId = parseInt(req.params.id);
      const deal = await storage.getDeal(dealId);
      if (!deal) return res.status(404).json({ error: "Deal not found" });
      if (deal.userId !== req.user.id && deal.brandUserId !== req.user.id) {
        return res.status(403).json({ error: "Not authorized" });
      }
      if (deal.status !== "Active") {
        return res.status(400).json({ error: "Only active deals can be completed" });
      }
      const updated = await storage.updateDeal(dealId, { status: "Completed" });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to complete deal" });
    }
  });

  app.get("/api/contracts", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const contracts = await storage.getContracts(userId);
      res.json(contracts);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch contracts" });
    }
  });

  app.get("/api/contracts/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const contract = await storage.getContract(parseInt(req.params.id));
      if (!contract) {
        return res.status(404).json({ error: "Contract not found" });
      }
      const isOwner = contract.userId === userId;
      const deal = await storage.getDeal(contract.dealId);
      const isBrandUser = deal?.brandUserId === userId;
      if (!isOwner && !isBrandUser) {
        return res.status(403).json({ error: "Access denied" });
      }
      res.json(contract);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch contract" });
    }
  });

  app.post("/api/contracts", isAuthenticated, requirePro("agreements"), async (req: any, res) => {
    try {
      const userId = req.user.id;

      const parsed = insertContractSchema.safeParse({ ...req.body, userId });
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors });
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

  app.post("/api/contracts/:id/proof", isAuthenticated, upload.single("proof"), async (req: any, res) => {
    try {
      const contract = await storage.getContract(parseInt(req.params.id));
      if (!contract) {
        return res.status(404).json({ error: "Contract not found" });
      }
      if (contract.userId !== req.user.id) {
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

      res.json(updated);
    } catch (error) {
      console.error("Proof upload error:", error);
      res.status(500).json({ error: "Failed to upload proof" });
    }
  });

  // Download the uploaded Contract Proof.
  // If the stored path is an external URL (ImageKit), redirect; if it's a
  // local file (legacy uploads), stream from disk.
  app.get("/api/contracts/:id/proof", isAuthenticated, async (req: any, res) => {
    try {
      const contract = await storage.getContract(parseInt(req.params.id));
      if (!contract) return res.status(404).json({ error: "Contract not found" });
      if (contract.userId !== req.user.id) return res.status(403).json({ error: "Access denied" });
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
      const invoices = await storage.getInvoices(userId);
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
      if (invoice.userId !== req.user.id) {
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
      if (invoice.userId !== req.user.id) {
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
  app.get("/api/brand-invoices", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const invoices = await storage.getBrandInvoices(userId);
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
      if (invoice.userId !== req.user.id) {
        return res.status(403).json({ error: "Access denied" });
      }
      res.json(invoice);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch brand invoice" });
    }
  });

  app.post("/api/brand-invoices", isAuthenticated, requirePro("invoices"), async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      const invoiceNumber = await storage.generateBrandInvoiceNumber();
      
      const influencerName = user?.firstName && user?.lastName 
        ? `${user.firstName} ${user.lastName}` 
        : user?.email || "Influencer";

      const invoiceData = {
        ...req.body,
        userId,
        invoiceNumber,
        invoiceDate: req.body.invoiceDate || new Date().toISOString().split("T")[0],
        influencerName,
        influencerEmail: user?.email || null,
        status: "Unpaid",
      };

      const invoice = await storage.createBrandInvoice(invoiceData);
      res.status(201).json(invoice);
    } catch (error) {
      console.error("Brand invoice creation error:", error);
      res.status(500).json({ error: "Failed to create brand invoice" });
    }
  });

  app.patch("/api/brand-invoices/:id", isAuthenticated, requirePro("payment_tracking"), async (req: any, res) => {
    try {
      const invoice = await storage.getBrandInvoice(parseInt(req.params.id));
      if (!invoice) {
        return res.status(404).json({ error: "Invoice not found" });
      }
      if (invoice.userId !== req.user.id) {
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

      // Coerce dealAmount to int if provided as string
      const updates: any = { ...req.body };
      if (updates.dealAmount !== undefined) {
        const n = typeof updates.dealAmount === "string" ? parseInt(updates.dealAmount, 10) : updates.dealAmount;
        if (!Number.isFinite(n) || n < 1) {
          return res.status(400).json({ error: "Invoice amount must be a positive number" });
        }
        updates.dealAmount = n;
      }

      const updated = await storage.updateBrandInvoice(parseInt(req.params.id), updates);

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

  app.delete("/api/brand-invoices/:id", isAuthenticated, requirePro("invoices"), async (req: any, res) => {
    try {
      const invoice = await storage.getBrandInvoice(parseInt(req.params.id));
      if (!invoice) return res.status(404).json({ error: "Invoice not found" });
      if (invoice.userId !== req.user.id) return res.status(403).json({ error: "Access denied" });
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
      if (invoice.userId !== req.user.id) return res.status(403).json({ error: "Access denied" });
      const attachments = await storage.getInvoiceAttachments(invoice.id);
      res.json(attachments);
    } catch (error) {
      console.error("List attachments error:", error);
      res.status(500).json({ error: "Failed to fetch documents" });
    }
  });

  app.post("/api/brand-invoices/:id/attachments", isAuthenticated, requirePro("invoices"), upload.single("file"), async (req: any, res) => {
    try {
      const invoice = await storage.getBrandInvoice(parseInt(req.params.id));
      if (!invoice) return res.status(404).json({ error: "Invoice not found" });
      if (invoice.userId !== req.user.id) return res.status(403).json({ error: "Access denied" });
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
      if (attachment.userId !== req.user.id) return res.status(403).json({ error: "Access denied" });
      if (/^https?:\/\//.test(attachment.fileUrl)) {
        return res.redirect(attachment.fileUrl);
      }
      res.download(attachment.fileUrl, attachment.fileName);
    } catch (error) {
      console.error("Attachment download error:", error);
      res.status(500).json({ error: "Failed to download document" });
    }
  });

  app.delete("/api/attachments/:id", isAuthenticated, requirePro("invoices"), async (req: any, res) => {
    try {
      const attachment = await storage.getInvoiceAttachment(parseInt(req.params.id));
      if (!attachment) return res.status(404).json({ error: "Document not found" });
      if (attachment.userId !== req.user.id) return res.status(403).json({ error: "Access denied" });
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
      if (deal.userId !== req.user.id) return res.status(403).json({ error: "Not authorized" });

      const invoices = await storage.getBrandInvoicesByDealId(dealId);
      res.json(invoices);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch invoices" });
    }
  });

  // Split deal amount into advance + final invoices
  app.post("/api/deals/:id/split-invoices", isAuthenticated, requirePro("invoices"), async (req: any, res) => {
    try {
      const dealId = parseInt(req.params.id);
      const deal = await storage.getDeal(dealId);
      if (!deal) return res.status(404).json({ error: "Deal not found" });
      if (deal.userId !== req.user.id) return res.status(403).json({ error: "Not authorized" });

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

      // Find contractId for this deal
      const contracts = await storage.getContracts(userId);
      const contract = contracts.find(c => c.dealId === dealId);

      const baseData = {
        userId,
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
        invoiceNumber: await storage.generateBrandInvoiceNumber(),
        dealAmount: advanceAmount,
        invoiceType: "advance",
        splitPercentage: advancePercentage,
        status: "Unpaid" as const,
      });

      const finalInvoice = await storage.createBrandInvoice({
        ...baseData,
        invoiceNumber: await storage.generateBrandInvoiceNumber(),
        dealAmount: finalAmount,
        invoiceType: "final",
        splitPercentage: 100 - advancePercentage,
        status: "Unpaid" as const,
      });

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
      if (profileImageUrl !== undefined) updates.profileImageUrl = profileImageUrl;
      if (coverImageUrl !== undefined) updates.coverImageUrl = coverImageUrl;
      if (onboardingComplete !== undefined) updates.onboardingComplete = onboardingComplete;
      if (billingAddress !== undefined) updates.billingAddress = billingAddress;
      if (accountHolderName !== undefined) updates.accountHolderName = accountHolderName;
      if (accountNumber !== undefined) updates.accountNumber = accountNumber;
      if (ifscCode !== undefined) updates.ifscCode = ifscCode ? ifscCode.toUpperCase() : ifscCode;
      if (bankName !== undefined) updates.bankName = bankName;

      const user = await storage.updateUser(userId, updates);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
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

  app.get("/api/credits/balance", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      // Lazy reset first so a stale month never shows 0.
      const refreshed = await storage.ensureMonthlyCredits(userId);
      const user = refreshed ?? (await storage.getUser(userId));
      const credits = getDealCredits(user);
      const transactions = await storage.getCreditTransactions(userId);
      res.json({
        monthly: credits.monthly,
        purchased: credits.purchased,
        total: credits.total,
        resetsAt: user?.monthlyCreditsResetAt ?? null,
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
  app.post("/api/payments/razorpay/order", isAuthenticated, async (req: any, res) => {
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

      let sku: "pro_monthly" | "pro_yearly" | "deal_boost";
      switch (req.body.plan) {
        case "pro_monthly": sku = "pro_monthly"; break;
        case "pro_yearly": sku = "pro_yearly"; break;
        case "deal_boost": sku = "deal_boost"; break;
        case "pro": sku = "pro_yearly"; break;          // legacy cached client
        default:
          if (req.body.credits) { sku = "deal_boost"; break; } // legacy cached client
          return res.status(400).json({ error: "Unknown plan" });
      }

      const PRICES: Record<typeof sku, number> = {
        pro_monthly: getProMonthlyPrice(),
        pro_yearly: getProYearlyPrice(),
        deal_boost: getDealBoostPrice(),
      };
      const DESCRIPTIONS: Record<typeof sku, string> = {
        pro_monthly: "DealInSec Pro — Monthly (unlimited workflow)",
        pro_yearly: "DealInSec Pro — 1 Year (unlimited workflow)",
        deal_boost: "Deal Boost — unlimited deals & quotations for 1 month",
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
        credits: 0,
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
                };
                const days = termDays[claimed.purpose];
                const grantLapsed =
                  days != null &&
                  claimed.completedAt != null &&
                  Date.now() - new Date(claimed.completedAt).getTime() > days * 86_400_000;

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

  // ── Documents saved from the public free tools (invoice/quotation/etc.) ──
  // Standalone artifacts a signed-in user chose to keep; not tied to a deal or credits.
  const TOOL_DOC_TYPES = ["invoice", "quotation", "proforma", "purchase_order", "agreement"];

  app.post("/api/documents", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const b = req.body || {};
      const type = String(b.type || "");
      if (!TOOL_DOC_TYPES.includes(type)) {
        return res.status(400).json({ error: "Invalid document type" });
      }
      if (b.payload == null || typeof b.payload !== "object" || Array.isArray(b.payload)) {
        return res.status(400).json({ error: "Missing document data" });
      }
      // Guard against oversized payloads (localStorage docs are tiny; images are data URLs).
      if (JSON.stringify(b.payload).length > 500_000) {
        return res.status(413).json({ error: "Document is too large to save" });
      }
      const totalNum = Number(b.total);
      const created = await storage.createToolDocument({
        userId,
        type,
        title: b.title ? String(b.title).slice(0, 200) : null,
        docNumber: b.docNumber ? String(b.docNumber).slice(0, 60) : null,
        partyName: b.partyName ? String(b.partyName).slice(0, 200) : null,
        total: Number.isFinite(totalNum) ? Math.round(totalNum) : null,
        currency: String(b.currency || "INR").slice(0, 8),
        payload: b.payload,
        source: String(b.source || "free_tool").slice(0, 40),
      });
      res.status(201).json(created);
    } catch (error) {
      console.error("Save tool document error:", error);
      res.status(500).json({ error: "Could not save the document" });
    }
  });

  app.get("/api/documents", isAuthenticated, async (req: any, res) => {
    try {
      const docs = await storage.getToolDocuments(req.user.id);
      // List view doesn't need the heavy payload
      res.json(docs.map(({ payload, ...meta }) => meta));
    } catch (error) {
      console.error("List tool documents error:", error);
      res.status(500).json({ error: "Could not load your documents" });
    }
  });

  app.get("/api/documents/:id", isAuthenticated, async (req: any, res) => {
    try {
      const doc = await storage.getToolDocument(parseInt(req.params.id, 10));
      if (!doc) return res.status(404).json({ error: "Document not found" });
      if (doc.userId !== req.user.id) return res.status(403).json({ error: "Not authorized" });
      res.json(doc);
    } catch (error) {
      console.error("Get tool document error:", error);
      res.status(500).json({ error: "Could not load the document" });
    }
  });

  app.delete("/api/documents/:id", isAuthenticated, async (req: any, res) => {
    try {
      const doc = await storage.getToolDocument(parseInt(req.params.id, 10));
      if (!doc) return res.status(404).json({ error: "Document not found" });
      if (doc.userId !== req.user.id) return res.status(403).json({ error: "Not authorized" });
      await storage.deleteToolDocument(doc.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete tool document error:", error);
      res.status(500).json({ error: "Could not delete the document" });
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
