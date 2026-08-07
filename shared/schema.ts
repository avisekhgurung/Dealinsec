import { sql } from 'drizzle-orm';
import { pgTable, text, integer, boolean, json, serial, varchar, timestamp, index, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { dealTypeOptions as TAXONOMY_DEAL_TYPES } from "./dealTypeTaxonomy";

// Legacy enum options — kept for backward compat with existing UI helpers.
// New deals can store any string here (validated client-side against taxonomy).
export const platformOptions = ["Instagram", "YouTube", "Twitter", "Facebook"] as const;
export const contentTypeOptions = ["Reel", "Video", "Story", "Post"] as const;
export const frequencyOptions = [
  "One-time",
  "Per week",
  "Per month",
  "Per quarter",
  "Per event",
  "Per session",
  "Per day",
  "Per hour",
] as const;

export const dealTypeOptions = TAXONOMY_DEAL_TYPES;
export type DealTypeOption = (typeof dealTypeOptions)[number];

// Deliverable is now generic — `platform` and `contentType` accept any string
// (e.g. "Instagram"/"Reel" for Creator, "Wedding photography"/"Per shoot" for
// Service Vendor). Frontend validates against the taxonomy.
export const deliverableSchema = z.object({
  id: z.string(),
  platform: z.string().min(1),
  contentType: z.string().min(1),
  quantity: z.number().min(1),
  frequency: z.string().min(1),
  notes: z.string().optional(),
});

export type Deliverable = z.infer<typeof deliverableSchema>;

export const dealStatusOptions = ["Pending", "Active", "Completed"] as const;
export const contractStatusOptions = ["Signed", "Active", "Completed"] as const;
export const invoiceStatusOptions = ["Unpaid", "Paid"] as const;
export const userRoleOptions = ["influencer", "brand"] as const;

export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  password: varchar("password"),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  coverImageUrl: varchar("cover_image_url"),
  phone: varchar("phone"),
  panNumber: varchar("pan_number"),
  gstNumber: varchar("gst_number"),
  digitalSignature: varchar("digital_signature"),
  billingAddress: varchar("billing_address"),
  accountHolderName: varchar("account_holder_name"),
  accountNumber: varchar("account_number"),
  ifscCode: varchar("ifsc_code"),
  bankName: varchar("bank_name"),
  onboardingComplete: boolean("onboarding_complete").notNull().default(false),
  // Legacy migration bucket: old paid ₹299 agreement credits became these.
  // Never expire, cover 1 deal + its quotation each, consumed only after the
  // monthly allowance runs out. Nothing sells these anymore (referrals still
  // grant them). NOTE: deliberately still mapped to the legacy "contract_credits"
  // SQL column — the deployed production build selects that column by name, so
  // renaming it in the DB would break prod auth. Only the TS property is renamed.
  purchasedDealCredits: integer("contract_credits").notNull().default(0),
  plan: varchar("plan").notNull().default("free"),
  // "monthly" | "yearly" — distinguishes PRO_MONTHLY vs PRO_YEARLY while
  // `plan`/`planExpiresAt` keep working unchanged (incl. hasActivePro).
  planTerm: varchar("plan_term"),
  planExpiresAt: timestamp("plan_expires_at"),
  // Free plan: 4 Deal Credits per month (1 credit = create 1 deal + generate
  // its quotation). Reset lazily: whenever credits are read/spent after
  // monthlyCreditsResetAt has passed, the balance is SET back to 4 (no
  // rollover) and the next reset scheduled a month out.
  monthlyDealCredits: integer("monthly_deal_credits").notNull().default(4),
  monthlyCreditsResetAt: timestamp("monthly_credits_reset_at")
    .notNull()
    .default(sql`now() + interval '1 month'`),
  // ₹99 Deal Boost: unlimited deals + quotations while this is in the future.
  // Never unlocks Pro features (agreements/invoices/payment tracking).
  dealBoostExpiresAt: timestamp("deal_boost_expires_at"),
  referralCode: varchar("referral_code").unique(),
  // ── Organization membership (single org per user) ──
  organizationId: varchar("organization_id"),
  orgRole: varchar("org_role").notNull().default("OWNER"), // OWNER | ADMIN | SALES | ACCOUNTS
  memberStatus: varchar("member_status").notNull().default("active"), // active | removed
  invitedBy: varchar("invited_by"),
  joinedAt: timestamp("joined_at"),
  role: varchar("role").notNull().default("influencer"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

// ───────────────────────────────────────────────────────────────────────
// Organizations — every account belongs to one. All business data (deals,
// quotations, agreements, invoices) is owned by the organization; users are
// members with a role. Billing deliberately stays on the OWNER's user row
// (plan/planTerm/planExpiresAt/credits) so the hardened payment paths are
// untouched — the org resolves its entitlements through its owner.
// ───────────────────────────────────────────────────────────────────────

export const organizations = pgTable("organizations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull(),
  slug: varchar("slug").unique(),
  logo: varchar("logo"),
  industry: varchar("industry"),
  // Extra seats purchased beyond the plan's included seats (₹199/seat/month).
  // One shared expiry: rebuying resets the pack. Included seats are derived
  // from the owner's plan (free = 1, Pro = 5) via getSeatLimit().
  extraSeats: integer("extra_seats").notNull().default(0),
  extraSeatsExpiresAt: timestamp("extra_seats_expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type Organization = typeof organizations.$inferSelect;
export type InsertOrganization = typeof organizations.$inferInsert;

export const invitations = pgTable("invitations", {
  id: serial("id").primaryKey(),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id),
  email: varchar("email").notNull(),
  orgRole: varchar("org_role").notNull().default("SALES"),
  token: varchar("token").notNull().unique(),
  invitedBy: varchar("invited_by").references(() => users.id),
  status: varchar("status").notNull().default("pending"), // pending | accepted | revoked
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export type Invitation = typeof invitations.$inferSelect;
export type InsertInvitation = typeof invitations.$inferInsert;

export const activityLogs = pgTable("activity_logs", {
  id: serial("id").primaryKey(),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id),
  userId: varchar("user_id").references(() => users.id),
  userName: varchar("user_name"),
  action: varchar("action").notNull(),       // e.g. "created", "updated", "removed"
  entityType: varchar("entity_type").notNull(), // "deal" | "quotation" | "agreement" | "invoice" | "member" | ...
  entityId: varchar("entity_id"),
  detail: varchar("detail"),                 // human line, e.g. "Deal: Sharma Residence"
  createdAt: timestamp("created_at").defaultNow(),
});

export type ActivityLog = typeof activityLogs.$inferSelect;
export type InsertActivityLog = typeof activityLogs.$inferInsert;

export const planOptions = ["free", "pro"] as const;
export const planTermOptions = ["monthly", "yearly"] as const;

// DealInSec Pro: subscription with the unlimited full workflow (agreements,
// invoices, payment tracking). A user is Pro while `plan` is "pro" and the
// expiry is in the future. `planExpiresAt` is a Date on the server but an ISO
// string once serialized over the API, so both are accepted — this helper is
// shared by server route guards and client UI.
export function hasActivePro(
  user?: { plan?: string | null; planExpiresAt?: Date | string | null } | null,
): boolean {
  if (!user || user.plan !== "pro" || !user.planExpiresAt) return false;
  const expires = new Date(user.planExpiresAt).getTime();
  return Number.isFinite(expires) && expires > Date.now();
}

// ₹99 Deal Boost: unlimited deals + quotations for a month. Same Date|string
// tolerance as hasActivePro. Does NOT unlock Pro-only features.
export function hasActiveDealBoost(
  user?: { dealBoostExpiresAt?: Date | string | null } | null,
): boolean {
  if (!user?.dealBoostExpiresAt) return false;
  const expires = new Date(user.dealBoostExpiresAt).getTime();
  return Number.isFinite(expires) && expires > Date.now();
}

export type SubscriptionType = "FREE" | "PRO_MONTHLY" | "PRO_YEARLY";
export type SubscriptionStatus = "ACTIVE" | "EXPIRED" | "FREE";

type PlanFields = {
  plan?: string | null;
  planTerm?: string | null;
  planExpiresAt?: Date | string | null;
};

export function getSubscriptionType(user?: PlanFields | null): SubscriptionType {
  if (!hasActivePro(user)) return "FREE";
  return user?.planTerm === "monthly" ? "PRO_MONTHLY" : "PRO_YEARLY";
}

// Derived, not stored: ACTIVE = Pro in force; EXPIRED = was Pro, term lapsed
// (renew prompt); FREE = never subscribed (or fully reverted).
export function getSubscriptionStatus(user?: PlanFields | null): SubscriptionStatus {
  if (hasActivePro(user)) return "ACTIVE";
  if (user?.plan === "pro") return "EXPIRED";
  return "FREE";
}

// Deal Credits as displayed everywhere: the monthly allowance plus any legacy
// purchased/referral credits (spent only after monthly hits 0).
export function getDealCredits(
  user?: { monthlyDealCredits?: number | null; purchasedDealCredits?: number | null } | null,
): { monthly: number; purchased: number; total: number } {
  const monthly = user?.monthlyDealCredits ?? 0;
  const purchased = user?.purchasedDealCredits ?? 0;
  return { monthly, purchased, total: monthly + purchased };
}

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;

export const deals = pgTable("deals", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  organizationId: varchar("organization_id"),
  brandUserId: varchar("brand_user_id").references(() => users.id),
  brandName: text("brand_name").notNull(),
  dealTitle: text("deal_title").notNull(),
  dealType: varchar("deal_type").notNull().default("Custom"),
  dealAmount: integer("deal_amount").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  deliverables: json("deliverables").$type<Deliverable[]>().notNull(),
  deliverableMode: varchar("deliverable_mode").notNull().default("all"),
  standardTermIds: json("standard_term_ids").$type<string[]>().default(sql`'[]'::json`),
  customTerms: text("custom_terms"),
  status: text("status").notNull().default("Pending"),
});

export const deliverableModeOptions = ["all", "any_one"] as const;

// Selectable standard T&Cs applied on quotations / deals.
// Wording is deal-type-neutral on purpose — these defaults appear on every deal
// type (creators, freelancers, consultants, service vendors), so they avoid
// creator-only words like "video" or "posting" and use "deliverables/work"
// instead. IDs are stable; only labels are looked up at render time.
export const STANDARD_TERMS = [
  { id: "validity_30", label: "This quotation is valid for 30 days from the date of issue." },
  { id: "advance_50", label: "50% advance payment is required to confirm the project." },
  { id: "balance_7d", label: "The remaining 50% is due within 7 days of final delivery of the agreed deliverables." },
  { id: "revisions_2", label: "Up to 2 rounds of revisions are included. All change requests must be submitted together at one time." },
  { id: "cancellation", label: "If the project is cancelled after work has started, the advance payment is non-refundable. If the work has already been delivered, full payment may be required." },
] as const;

export type StandardTermId = typeof STANDARD_TERMS[number]["id"];

export const contracts = pgTable("contracts", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  organizationId: varchar("organization_id"),
  dealId: integer("deal_id").notNull().references(() => deals.id),
  contractName: text("contract_name").notNull(),
  brandName: text("brand_name").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  contractValue: integer("contract_value").notNull(),
  status: text("status").notNull().default("Pending"),
  exclusive: boolean("exclusive").notNull().default(true),
  proofFileName: text("proof_file_name"),
  proofFilePath: text("proof_file_path"),
  signedByInfluencer: boolean("signed_by_influencer").notNull().default(false),
  signedByInfluencerDate: text("signed_by_influencer_date"),
  signedByBrand: boolean("signed_by_brand").notNull().default(false),
  signedDate: text("signed_date"),
});

export const invoices = pgTable("invoices", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  organizationId: varchar("organization_id"),
  invoiceNumber: text("invoice_number").notNull().unique(),
  invoiceDate: text("invoice_date").notNull(),
  contractId: integer("contract_id").notNull().references(() => contracts.id),
  dealId: integer("deal_id").notNull().references(() => deals.id),
  brandName: text("brand_name").notNull(),
  influencerName: text("influencer_name").notNull(),
  contractFee: integer("contract_fee").notNull(),
  platformFee: integer("platform_fee").notNull(),
  totalAmount: integer("total_amount").notNull(),
  status: text("status").notNull().default("Unpaid"),
});

export const insertDealSchema = createInsertSchema(deals).omit({ id: true, status: true });
export type InsertDeal = z.infer<typeof insertDealSchema>;
export type Deal = typeof deals.$inferSelect;

export const insertContractSchema = createInsertSchema(contracts).omit({ id: true });
export type InsertContract = z.infer<typeof insertContractSchema>;
export type Contract = typeof contracts.$inferSelect;

export const insertInvoiceSchema = createInsertSchema(invoices).omit({ id: true });
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoices.$inferSelect;

export const brandInvoices = pgTable("brand_invoices", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  organizationId: varchar("organization_id"),
  invoiceNumber: text("invoice_number").notNull().unique(),
  invoiceDate: text("invoice_date").notNull(),
  dueDate: text("due_date"),
  dealId: integer("deal_id").notNull().references(() => deals.id),
  contractId: integer("contract_id").references(() => contracts.id),
  brandName: text("brand_name").notNull(),
  influencerName: text("influencer_name").notNull(),
  influencerEmail: text("influencer_email"),
  dealAmount: integer("deal_amount").notNull(),
  invoiceType: varchar("invoice_type").notNull().default("full"),
  splitPercentage: integer("split_percentage"),
  notes: text("notes"),
  status: text("status").notNull().default("Unpaid"),
});

export const brandInvoiceTypeOptions = ["full", "advance", "final"] as const;

export const insertBrandInvoiceSchema = createInsertSchema(brandInvoices).omit({ id: true });
export type InsertBrandInvoice = z.infer<typeof insertBrandInvoiceSchema>;
export type BrandInvoice = typeof brandInvoices.$inferSelect;

// Tax & supporting documents attached to an invoice (GST invoice copy, TDS
// certificate, payment receipt, etc.). Centralises the paperwork creators
// otherwise scatter across email/WhatsApp, so tax filing is a single tap away.
export const invoiceDocumentCategories = [
  "GST Invoice",
  "TDS Certificate",
  "Form 16A",
  "Payment Receipt",
  "Bank Statement",
  "Purchase Order",
  "Other",
] as const;
export type InvoiceDocumentCategory = (typeof invoiceDocumentCategories)[number];

export const invoiceAttachments = pgTable("invoice_attachments", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  brandInvoiceId: integer("brand_invoice_id").notNull().references(() => brandInvoices.id),
  category: varchar("category").notNull().default("Other"),
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url").notNull(),
  fileId: varchar("file_id"),          // ImageKit fileId, for later deletion (null for local uploads)
  fileSize: integer("file_size"),
  mimeType: varchar("mime_type"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertInvoiceAttachmentSchema = createInsertSchema(invoiceAttachments).omit({ id: true, createdAt: true });
export type InsertInvoiceAttachment = z.infer<typeof insertInvoiceAttachmentSchema>;
export type InvoiceAttachment = typeof invoiceAttachments.$inferSelect;

export const creditTransactionTypeOptions = ["grant", "purchase", "usage", "refund", "referral"] as const;

export const creditTransactions = pgTable("credit_transactions", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  delta: integer("delta").notNull(),
  type: varchar("type").notNull(),
  amount: integer("amount"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCreditTransactionSchema = createInsertSchema(creditTransactions).omit({ id: true, createdAt: true });
export type InsertCreditTransaction = z.infer<typeof insertCreditTransactionSchema>;
export type CreditTransaction = typeof creditTransactions.$inferSelect;

export const payuOrders = pgTable("payu_orders", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  orderId: varchar("order_id").notNull().unique(),
  amount: integer("amount").notNull(),
  credits: integer("credits").notNull(),
  // What the payment buys: "credits" (default) or "pro_plan" (annual Pro).
  purpose: varchar("purpose").notNull().default("credits"),
  status: varchar("status").notNull().default("pending"),
  payuTxnId: varchar("payu_txn_id"),
  payuHash: varchar("payu_hash"),
  createdAt: timestamp("created_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const insertPayuOrderSchema = createInsertSchema(payuOrders).omit({ id: true, createdAt: true, completedAt: true });
export type InsertPayuOrder = z.infer<typeof insertPayuOrderSchema>;
export type PayuOrder = typeof payuOrders.$inferSelect;

export const quotes = pgTable("quotes", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  organizationId: varchar("organization_id"),
  dealId: integer("deal_id").notNull().references(() => deals.id),
  status: varchar("status").notNull().default("draft"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertQuoteSchema = createInsertSchema(quotes).omit({ id: true, createdAt: true });
export type InsertQuote = z.infer<typeof insertQuoteSchema>;
export type Quote = typeof quotes.$inferSelect;

// Referrals table
export const referrals = pgTable("referrals", {
  id: serial("id").primaryKey(),
  referrerId: varchar("referrer_id").notNull().references(() => users.id),
  referredUserId: varchar("referred_user_id").notNull().references(() => users.id),
  status: varchar("status").notNull().default("completed"),
  creditAwarded: integer("credit_awarded").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertReferralSchema = createInsertSchema(referrals).omit({ id: true, createdAt: true });
export type InsertReferral = z.infer<typeof insertReferralSchema>;
export type Referral = typeof referrals.$inferSelect;

// Newsletter / waitlist email capture (from landing footer)
export const newsletterSubscribers = pgTable("newsletter_subscribers", {
  id: serial("id").primaryKey(),
  email: varchar("email").notNull().unique(),
  source: varchar("source").default("footer"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertNewsletterSchema = createInsertSchema(newsletterSubscribers).omit({ id: true, createdAt: true });
export type InsertNewsletterSubscriber = z.infer<typeof insertNewsletterSchema>;
export type NewsletterSubscriber = typeof newsletterSubscribers.$inferSelect;

// Documents saved from the public free tools (invoice, quotation, proforma,
// purchase order, service agreement). Standalone artifacts — NOT tied to a deal
// or credits — that a signed-in user chose to keep. `payload` holds the full
// in-browser form state so the document can be re-rendered/edited later.
export const TOOL_DOCUMENT_TYPES = [
  "invoice",
  "quotation",
  "proforma",
  "purchase_order",
  "agreement",
] as const;
export type ToolDocumentType = (typeof TOOL_DOCUMENT_TYPES)[number];

export const toolDocuments = pgTable("tool_documents", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  type: varchar("type").notNull(),
  title: varchar("title"),
  docNumber: varchar("doc_number"),
  partyName: varchar("party_name"),
  total: integer("total"),
  currency: varchar("currency").notNull().default("INR"),
  payload: jsonb("payload").notNull(),
  source: varchar("source").notNull().default("free_tool"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertToolDocumentSchema = createInsertSchema(toolDocuments).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertToolDocument = z.infer<typeof insertToolDocumentSchema>;
export type ToolDocument = typeof toolDocuments.$inferSelect;
