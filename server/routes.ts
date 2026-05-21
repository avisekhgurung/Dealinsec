import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertDealSchema, insertContractSchema, brandInvoices as brandInvoicesTable } from "@shared/schema";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { setupAuth, isAuthenticated } from "./auth";
import { getUncachableStripeClient, getStripePublishableKey } from "./stripeClient";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { uploadFileToImageKit, isImageKitConfigured } from "./imagekitClient";
import {
  isRazorpayConfigured,
  getRazorpayKeyId,
  getCreditPrice,
  createRazorpayOrder,
  verifyPaymentSignature,
  verifyWebhookSignature,
} from "./razorpayClient";
import {
  sendEmail,
  paymentReceiptEmail,
  contractSignedEmail,
  paymentReceivedEmail,
} from "./emails";

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
      const { password: _, ...userWithoutPassword } = req.user;
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
      const deal = await storage.createDeal(parsed.data);
      res.status(201).json(deal);
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

  app.post("/api/contracts", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      
      const parsed = insertContractSchema.safeParse({ ...req.body, userId });
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors });
      }

      const creditDeducted = await storage.deductCreditIfSufficient(userId);
      if (!creditDeducted) {
        const user = await storage.getUser(userId);
        return res.status(402).json({ 
          error: "Insufficient credits",
          message: "You need at least 1 contract credit to create a contract. Please purchase credits.",
          creditsRequired: 1,
          creditsAvailable: user?.contractCredits || 0
        });
      }

      const contractData = {
        ...parsed.data,
        signedByInfluencer: true,
        signedByInfluencerDate: new Date().toISOString(),
      };
      const contract = await storage.createContract(contractData);

      await storage.updateDeal(contract.dealId, { status: "Active" });

      const user = await storage.getUser(userId);
      const invoiceNumber = await storage.generateInvoiceNumber();
      const influencerName = user?.firstName && user?.lastName 
        ? `${user.firstName} ${user.lastName}` 
        : user?.email || "Influencer";

      // Credit was consumed above — the invoice is considered Paid via credit.
      // creditValue: 1 credit = ₹299 platform fee, no extra charge.
      const creditValue = parseInt(process.env.CREDIT_VALUE ?? "299");
      await storage.createInvoice({
        userId,
        invoiceNumber,
        invoiceDate: new Date().toISOString().split("T")[0],
        contractId: contract.id,
        dealId: contract.dealId,
        brandName: contract.brandName,
        influencerName,
        contractFee: creditValue,
        platformFee: 0,
        totalAmount: creditValue,
        // Paid immediately because the user consumed a credit as payment
        status: "Paid",
      });

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
                name: `InfluDeal Platform Fee - ${invoice.invoiceNumber}`,
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

  app.post("/api/brand-invoices", isAuthenticated, async (req: any, res) => {
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

  app.patch("/api/brand-invoices/:id", isAuthenticated, async (req: any, res) => {
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

  app.delete("/api/brand-invoices/:id", isAuthenticated, async (req: any, res) => {
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
  app.post("/api/deals/:id/split-invoices", isAuthenticated, async (req: any, res) => {
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

  // Get referral info for authenticated user
  app.get("/api/referrals", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      const referralsList = await storage.getReferralsByUser(userId);
      const totalCreditsEarned = referralsList.reduce((sum, r) => sum + (r.creditAwarded || 0), 0);

      res.json({
        referralCode: user?.referralCode || null,
        referrals: referralsList,
        totalCreditsEarned,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch referral info" });
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
      const user = await storage.getUser(userId);
      const transactions = await storage.getCreditTransactions(userId);
      res.json({ 
        balance: user?.contractCredits || 0,
        transactions: transactions.slice(0, 10)
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch credit balance" });
    }
  });

  app.post("/api/payments/create", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const payu = getPayuConfig();

      if (!payu.key || !payu.salt) {
        console.error("PayU not configured. PAYU_MERCHANT_KEY:", !!process.env.PAYU_MERCHANT_KEY, "PAYU_SALT:", !!process.env.PAYU_SALT);
        return res.status(503).json({
          error: "Payment gateway not configured",
          message: "PayU credentials not set. Please configure PAYU_MERCHANT_KEY and PAYU_SALT."
        });
      }

      const credits = req.body.credits || 1;
      const amount = credits * payu.price;
      const orderId = `INFLU_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      await storage.createPayuOrder({
        userId,
        orderId,
        amount,
        credits,
        status: "pending",
      });

      const productInfo = `${credits} Contract Credit${credits > 1 ? 's' : ''}`;
      const firstName = user.firstName || "User";
      const email = user.email || "";
      const phone = user.phone || "";

      const hashString = `${payu.key}|${orderId}|${amount}|${productInfo}|${firstName}|${email}|||||||||||${payu.salt}`;
      const hash = crypto.createHash("sha512").update(hashString).digest("hex");

      const baseUrl = process.env.APP_URL
        || (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://localhost:3000");

      const formHtml = `
        <!DOCTYPE html>
        <html>
        <head><title>Redirecting to PayU...</title></head>
        <body onload="document.forms['payuForm'].submit();">
          <p>Redirecting to payment gateway...</p>
          <form name="payuForm" action="${payu.url}" method="POST">
            <input type="hidden" name="key" value="${payu.key}" />
            <input type="hidden" name="txnid" value="${orderId}" />
            <input type="hidden" name="amount" value="${amount}" />
            <input type="hidden" name="productinfo" value="${productInfo}" />
            <input type="hidden" name="firstname" value="${firstName}" />
            <input type="hidden" name="email" value="${email}" />
            <input type="hidden" name="phone" value="${phone}" />
            <input type="hidden" name="surl" value="${baseUrl}/api/payments/success" />
            <input type="hidden" name="furl" value="${baseUrl}/api/payments/failure" />
            <input type="hidden" name="hash" value="${hash}" />
          </form>
        </body>
        </html>
      `;

      res.json({ formHtml, orderId });
    } catch (error) {
      console.error("Payment creation error:", error);
      res.status(500).json({ error: "Failed to create payment" });
    }
  });

  app.post("/api/payments/success", async (req, res) => {
    try {
      const { txnid, mihpayid, status, hash: receivedHash, amount } = req.body;

      if (!txnid) {
        return res.redirect("/pricing?error=invalid_transaction");
      }

      const order = await storage.getPayuOrder(txnid);
      if (!order) {
        return res.redirect("/pricing?error=order_not_found");
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

      const payu = getPayuConfig();
      if (payu.salt && receivedHash) {
        const reverseHashString = `${payu.salt}|${status}|||||||||||${req.body.email || ""}|${req.body.firstname || ""}|${req.body.productinfo || ""}|${amount}|${txnid}|${payu.key}`;
        const calculatedHash = crypto.createHash("sha512").update(reverseHashString).digest("hex");
        if (calculatedHash !== receivedHash) {
          console.error("Hash verification failed");
          await storage.updatePayuOrder(txnid, { status: "failed" });
          return res.redirect("/pricing?error=verification_failed");
        }
      }

      if (status === "success") {
        const updateResult = await storage.updatePayuOrder(txnid, {
          status: "completed",
          payuTxnId: mihpayid,
          payuHash: receivedHash,
          completedAt: new Date(),
        });

        if (updateResult && updateResult.status === "completed") {
          await storage.addCredits(order.userId, order.credits, "purchase", order.amount);
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
      if (txnid) {
        await storage.updatePayuOrder(txnid, { status: "failed" });
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

  // Public config — lets the frontend render the live price (driven by the
  // CREDIT_VALUE env var) so testing at ₹1 shows ₹1 everywhere.
  app.get("/api/payments/config", (_req, res) => {
    const price = getCreditPrice();
    res.json({
      creditPrice: price,
      // Marketing anchor only makes sense at real prices; hide for low test values.
      anchorPrice: price >= 100 ? Math.round(price * 2) : null,
      razorpayEnabled: isRazorpayConfigured(),
    });
  });

  // Step 1: create an order. Frontend opens Razorpay Checkout with the
  // returned orderId + key. Reuses the payu_orders table for persistence.
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

      const credits = Math.max(1, parseInt(req.body.credits, 10) || 1);
      const price = getCreditPrice();
      const amountInRupees = credits * price;
      const receipt = `DIS_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

      const order = await createRazorpayOrder({
        amountInRupees,
        receipt,
        notes: { userId, credits: String(credits) },
      });

      // Persist as pending — orderId column holds the Razorpay order id
      await storage.createPayuOrder({
        userId,
        orderId: order.id,
        amount: amountInRupees,
        credits,
        status: "pending",
      });

      res.json({
        keyId: getRazorpayKeyId(),
        orderId: order.id,
        amount: order.amount,        // paise
        currency: order.currency,
        credits,
        name: "DealInSec",
        description: `${credits} Contract Credit${credits > 1 ? "s" : ""}`,
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

      const valid = verifyPaymentSignature({
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        signature: razorpay_signature,
      });
      if (!valid) {
        await storage.updatePayuOrder(razorpay_order_id, { status: "failed" });
        return res.status(400).json({ error: "Signature verification failed" });
      }

      const updated = await storage.updatePayuOrder(razorpay_order_id, {
        status: "completed",
        payuTxnId: razorpay_payment_id,
        payuHash: razorpay_signature,
        completedAt: new Date(),
      });

      if (updated && updated.status === "completed") {
        await storage.addCredits(order.userId, order.credits, "purchase", order.amount);

        // Payment receipt email — best-effort
        const buyer = await storage.getUser(order.userId);
        if (buyer?.email) {
          const { subject, html } = paymentReceiptEmail({
            firstName: buyer.firstName || undefined,
            credits: order.credits,
            amount: order.amount,
            paymentId: razorpay_payment_id,
            date: new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
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
            if (order && order.status !== "completed") {
              const updated = await storage.updatePayuOrder(orderId, {
                status: "completed",
                payuTxnId: paymentId,
                completedAt: new Date(),
              });
              if (updated && updated.status === "completed") {
                await storage.addCredits(order.userId, order.credits, "purchase", order.amount);
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

  const httpServer = createServer(app);
  return httpServer;
}
