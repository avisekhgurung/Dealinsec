import { db } from "./db";
import { eq, desc, sql } from "drizzle-orm";
import {
  users, deals, contracts, invoices, brandInvoices, creditTransactions, payuOrders, quotes,
  type User, type UpsertUser,
  type Deal, type InsertDeal,
  type Contract, type InsertContract,
  type Invoice, type InsertInvoice,
  type BrandInvoice, type InsertBrandInvoice,
  type CreditTransaction, type InsertCreditTransaction,
  type PayuOrder, type InsertPayuOrder,
  type Quote, type InsertQuote
} from "@shared/schema";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: UpsertUser): Promise<User>;
  updateUser(id: string, updates: Partial<User>): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  getBrandUsers(): Promise<User[]>;

  getDeals(userId: string): Promise<Deal[]>;
  getDeal(id: number): Promise<Deal | undefined>;
  createDeal(deal: InsertDeal): Promise<Deal>;
  updateDeal(id: number, updates: Partial<Deal>): Promise<Deal | undefined>;
  getDealsForBrand(brandUserId: string): Promise<Deal[]>;

  getContracts(userId: string): Promise<Contract[]>;
  getContract(id: number): Promise<Contract | undefined>;
  createContract(contract: InsertContract): Promise<Contract>;
  updateContract(id: number, updates: Partial<Contract>): Promise<Contract | undefined>;
  getContractsForBrand(brandUserId: string): Promise<Contract[]>;

  getInvoices(userId: string): Promise<Invoice[]>;
  getInvoice(id: number): Promise<Invoice | undefined>;
  createInvoice(invoice: InsertInvoice): Promise<Invoice>;
  updateInvoice(id: number, updates: Partial<Invoice>): Promise<Invoice | undefined>;
  
  getBrandInvoices(userId: string): Promise<BrandInvoice[]>;
  getBrandInvoice(id: number): Promise<BrandInvoice | undefined>;
  createBrandInvoice(invoice: InsertBrandInvoice): Promise<BrandInvoice>;
  updateBrandInvoice(id: number, updates: Partial<BrandInvoice>): Promise<BrandInvoice | undefined>;
  
  generateInvoiceNumber(): Promise<string>;
  generateBrandInvoiceNumber(): Promise<string>;
  
  getCreditTransactions(userId: string): Promise<CreditTransaction[]>;
  createCreditTransaction(transaction: InsertCreditTransaction): Promise<CreditTransaction>;
  deductCreditIfSufficient(userId: string): Promise<boolean>;
  addCredits(userId: string, amount: number, type: string, paymentAmount?: number): Promise<User | undefined>;
  
  createPayuOrder(order: InsertPayuOrder): Promise<PayuOrder>;
  getPayuOrder(orderId: string): Promise<PayuOrder | undefined>;
  updatePayuOrder(orderId: string, updates: Partial<PayuOrder>): Promise<PayuOrder | undefined>;

  createQuote(data: InsertQuote): Promise<Quote>;
  getQuoteByDealId(dealId: number): Promise<Quote | undefined>;
  updateQuote(id: number, updates: Partial<Quote>): Promise<Quote | undefined>;
}

export class DatabaseStorage implements IStorage {
  private invoiceCounter = 1000;

  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async createUser(userData: UpsertUser): Promise<User> {
    const [user] = await db.insert(users).values(userData).returning();
    return user;
  }

  async updateUser(id: string, updates: Partial<User>): Promise<User | undefined> {
    const [user] = await db.update(users).set({ ...updates, updatedAt: new Date() }).where(eq(users.id, id)).returning();
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  async getBrandUsers(): Promise<User[]> {
    return db.select().from(users).where(eq(users.role, "brand"));
  }

  async getDeals(userId: string): Promise<Deal[]> {
    return db.select().from(deals).where(eq(deals.userId, userId));
  }

  async getDeal(id: number): Promise<Deal | undefined> {
    const [deal] = await db.select().from(deals).where(eq(deals.id, id));
    return deal;
  }

  async createDeal(deal: InsertDeal): Promise<Deal> {
    const [created] = await db.insert(deals).values(deal as any).returning();
    return created;
  }

  async updateDeal(id: number, updates: Partial<Deal>): Promise<Deal | undefined> {
    const [updated] = await db.update(deals).set(updates).where(eq(deals.id, id)).returning();
    return updated;
  }

  async getDealsForBrand(brandUserId: string): Promise<Deal[]> {
    return db.select().from(deals).where(eq(deals.brandUserId, brandUserId));
  }

  async getContracts(userId: string): Promise<Contract[]> {
    return db.select().from(contracts).where(eq(contracts.userId, userId));
  }

  async getContract(id: number): Promise<Contract | undefined> {
    const [contract] = await db.select().from(contracts).where(eq(contracts.id, id));
    return contract;
  }

  async createContract(contract: InsertContract): Promise<Contract> {
    const [created] = await db.insert(contracts).values(contract as any).returning();
    return created;
  }

  async updateContract(id: number, updates: Partial<Contract>): Promise<Contract | undefined> {
    const [updated] = await db.update(contracts).set(updates).where(eq(contracts.id, id)).returning();
    return updated;
  }

  async getContractsForBrand(brandUserId: string): Promise<Contract[]> {
    const brandDeals = await this.getDealsForBrand(brandUserId);
    const dealIds = brandDeals.map(d => d.id);
    if (dealIds.length === 0) return [];
    const result = await db.select().from(contracts);
    return result.filter(c => dealIds.includes(c.dealId));
  }

  async getInvoices(userId: string): Promise<Invoice[]> {
    return db.select().from(invoices).where(eq(invoices.userId, userId));
  }

  async getInvoice(id: number): Promise<Invoice | undefined> {
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id));
    return invoice;
  }

  async createInvoice(invoice: InsertInvoice): Promise<Invoice> {
    const [created] = await db.insert(invoices).values(invoice as any).returning();
    return created;
  }

  async updateInvoice(id: number, updates: Partial<Invoice>): Promise<Invoice | undefined> {
    const [updated] = await db.update(invoices).set(updates).where(eq(invoices.id, id)).returning();
    return updated;
  }

  async generateInvoiceNumber(): Promise<string> {
    this.invoiceCounter++;
    return `INV-${Date.now()}-${this.invoiceCounter}`;
  }

  async getBrandInvoices(userId: string): Promise<BrandInvoice[]> {
    return db.select().from(brandInvoices).where(eq(brandInvoices.userId, userId));
  }

  async getBrandInvoice(id: number): Promise<BrandInvoice | undefined> {
    const [invoice] = await db.select().from(brandInvoices).where(eq(brandInvoices.id, id));
    return invoice;
  }

  async createBrandInvoice(invoice: InsertBrandInvoice): Promise<BrandInvoice> {
    const [created] = await db.insert(brandInvoices).values(invoice as any).returning();
    return created;
  }

  async updateBrandInvoice(id: number, updates: Partial<BrandInvoice>): Promise<BrandInvoice | undefined> {
    const [updated] = await db.update(brandInvoices).set(updates).where(eq(brandInvoices.id, id)).returning();
    return updated;
  }

  async generateBrandInvoiceNumber(): Promise<string> {
    this.invoiceCounter++;
    return `BINV-${Date.now()}-${this.invoiceCounter}`;
  }

  async getCreditTransactions(userId: string): Promise<CreditTransaction[]> {
    return db.select().from(creditTransactions)
      .where(eq(creditTransactions.userId, userId))
      .orderBy(desc(creditTransactions.createdAt));
  }

  async createCreditTransaction(transaction: InsertCreditTransaction): Promise<CreditTransaction> {
    const [created] = await db.insert(creditTransactions).values(transaction as any).returning();
    return created;
  }

  async deductCreditIfSufficient(userId: string): Promise<boolean> {
    const result = await db.update(users)
      .set({ 
        contractCredits: sql`${users.contractCredits} - 1`,
        updatedAt: new Date()
      })
      .where(sql`${users.id} = ${userId} AND ${users.contractCredits} > 0`)
      .returning();
    
    if (result.length > 0) {
      await this.createCreditTransaction({
        userId,
        delta: -1,
        type: "usage",
        metadata: { action: "contract_creation" }
      });
      return true;
    }
    return false;
  }

  async addCredits(userId: string, amount: number, type: string, paymentAmount?: number): Promise<User | undefined> {
    const [updated] = await db.update(users)
      .set({ 
        contractCredits: sql`${users.contractCredits} + ${amount}`,
        updatedAt: new Date()
      })
      .where(eq(users.id, userId))
      .returning();
    
    if (updated) {
      await this.createCreditTransaction({
        userId,
        delta: amount,
        type,
        amount: paymentAmount,
        metadata: { credits: amount }
      });
    }
    return updated;
  }

  async createPayuOrder(order: InsertPayuOrder): Promise<PayuOrder> {
    const [created] = await db.insert(payuOrders).values(order as any).returning();
    return created;
  }

  async getPayuOrder(orderId: string): Promise<PayuOrder | undefined> {
    const [order] = await db.select().from(payuOrders).where(eq(payuOrders.orderId, orderId));
    return order;
  }

  async updatePayuOrder(orderId: string, updates: Partial<PayuOrder>): Promise<PayuOrder | undefined> {
    const [updated] = await db.update(payuOrders).set(updates).where(eq(payuOrders.orderId, orderId)).returning();
    return updated;
  }

  async createQuote(data: InsertQuote): Promise<Quote> {
    const [created] = await db.insert(quotes).values(data as any).returning();
    return created;
  }

  async getQuoteByDealId(dealId: number): Promise<Quote | undefined> {
    const [quote] = await db.select().from(quotes).where(eq(quotes.dealId, dealId));
    return quote;
  }

  async updateQuote(id: number, updates: Partial<Quote>): Promise<Quote | undefined> {
    const [updated] = await db.update(quotes).set(updates).where(eq(quotes.id, id)).returning();
    return updated;
  }
}

export const storage = new DatabaseStorage();
