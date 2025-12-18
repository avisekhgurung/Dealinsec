import { sql } from 'drizzle-orm';
import { pgTable, text, integer, boolean, json, serial, varchar, timestamp, index, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const platformOptions = ["Instagram", "YouTube", "Twitter"] as const;
export const contentTypeOptions = ["Reel", "Video", "Story", "Post"] as const;
export const frequencyOptions = ["Per Week", "Per Month", "One-time"] as const;

export const deliverableSchema = z.object({
  id: z.string(),
  platform: z.enum(platformOptions),
  contentType: z.enum(contentTypeOptions),
  quantity: z.number().min(1),
  frequency: z.enum(frequencyOptions),
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
  phone: varchar("phone"),
  panNumber: varchar("pan_number"),
  gstNumber: varchar("gst_number"),
  digitalSignature: varchar("digital_signature"),
  onboardingComplete: boolean("onboarding_complete").notNull().default(false),
  contractCredits: integer("contract_credits").notNull().default(3),
  role: varchar("role").notNull().default("influencer"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;

export const deals = pgTable("deals", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  brandUserId: varchar("brand_user_id").references(() => users.id),
  brandName: text("brand_name").notNull(),
  dealTitle: text("deal_title").notNull(),
  dealAmount: integer("deal_amount").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  deliverables: json("deliverables").$type<Deliverable[]>().notNull(),
  status: text("status").notNull().default("Pending"),
});

export const contracts = pgTable("contracts", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
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
  invoiceNumber: text("invoice_number").notNull().unique(),
  invoiceDate: text("invoice_date").notNull(),
  dueDate: text("due_date"),
  dealId: integer("deal_id").notNull().references(() => deals.id),
  contractId: integer("contract_id").references(() => contracts.id),
  brandName: text("brand_name").notNull(),
  influencerName: text("influencer_name").notNull(),
  influencerEmail: text("influencer_email"),
  dealAmount: integer("deal_amount").notNull(),
  notes: text("notes"),
  status: text("status").notNull().default("Unpaid"),
});

export const insertBrandInvoiceSchema = createInsertSchema(brandInvoices).omit({ id: true });
export type InsertBrandInvoice = z.infer<typeof insertBrandInvoiceSchema>;
export type BrandInvoice = typeof brandInvoices.$inferSelect;

export const creditTransactionTypeOptions = ["grant", "purchase", "usage", "refund"] as const;

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
  status: varchar("status").notNull().default("pending"),
  payuTxnId: varchar("payu_txn_id"),
  payuHash: varchar("payu_hash"),
  createdAt: timestamp("created_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const insertPayuOrderSchema = createInsertSchema(payuOrders).omit({ id: true, createdAt: true, completedAt: true });
export type InsertPayuOrder = z.infer<typeof insertPayuOrderSchema>;
export type PayuOrder = typeof payuOrders.$inferSelect;
