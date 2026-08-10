import { db } from "./db";
import { eq, desc, sql } from "drizzle-orm";
import { canonicalEmail } from "@shared/email";
import { DEFAULT_ROLE_SEEDS } from "@shared/permissions";
import {
  users, deals, contracts, invoices, brandInvoices, invoiceAttachments, creditTransactions, payuOrders, quotes, referrals,
  organizations, invitations, activityLogs, orgRoles, invoiceCounters, financialYearCode,
  type OrgCustomRole,
  type User, type UpsertUser,
  type Deal, type InsertDeal,
  type Contract, type InsertContract,
  type Invoice, type InsertInvoice,
  type BrandInvoice, type InsertBrandInvoice,
  type InvoiceAttachment, type InsertInvoiceAttachment,
  type CreditTransaction, type InsertCreditTransaction,
  type PayuOrder, type InsertPayuOrder,
  type Quote, type InsertQuote,
  type Referral, type InsertReferral,
  type Organization, type Invitation, type InsertInvitation,
  type ActivityLog, type InsertActivityLog
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
  getContractByDealId(dealId: number): Promise<Contract | undefined>;
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
  deleteBrandInvoice(id: number): Promise<void>;

  getInvoiceAttachments(brandInvoiceId: number): Promise<InvoiceAttachment[]>;
  getInvoiceAttachment(id: number): Promise<InvoiceAttachment | undefined>;
  createInvoiceAttachment(data: InsertInvoiceAttachment): Promise<InvoiceAttachment>;
  deleteInvoiceAttachment(id: number): Promise<void>;
  
  generateInvoiceNumber(): Promise<string>;
  generateBrandInvoiceNumber(): Promise<string>;
  
  getCreditTransactions(userId: string): Promise<CreditTransaction[]>;
  createCreditTransaction(transaction: InsertCreditTransaction): Promise<CreditTransaction>;
  ensureMonthlyCredits(userId: string): Promise<User | undefined>;
  spendDealCredit(userId: string): Promise<{ ok: boolean; user?: User }>;
  regrantDealCredit(userId: string): Promise<void>;
  addPurchasedCredits(userId: string, amount: number, type: string, paymentAmount?: number): Promise<User | undefined>;
  activateProPlan(userId: string, days: number, term: "monthly" | "yearly"): Promise<User | undefined>;
  revokeProPlan(userId: string, days: number): Promise<User | undefined>;
  activateDealBoost(userId: string, days: number): Promise<User | undefined>;
  revokeDealBoost(userId: string, days: number): Promise<User | undefined>;

  createPayuOrder(order: InsertPayuOrder): Promise<PayuOrder>;
  getPayuOrder(orderId: string): Promise<PayuOrder | undefined>;
  getPayuOrderByPaymentId(paymentId: string): Promise<PayuOrder | undefined>;
  updatePayuOrder(orderId: string, updates: Partial<PayuOrder>): Promise<PayuOrder | undefined>;
  completePayuOrderOnce(orderId: string, updates: Partial<PayuOrder>): Promise<PayuOrder | undefined>;
  markPayuOrderFailedIfPending(orderId: string): Promise<void>;
  markPayuOrderRefundedOnce(orderId: string): Promise<PayuOrder | undefined>;

  createQuote(data: InsertQuote): Promise<Quote>;
  getQuoteByDealId(dealId: number): Promise<Quote | undefined>;
  getQuotesByDealId(dealId: number): Promise<Quote[]>;
  updateQuote(id: number, updates: Partial<Quote>): Promise<Quote | undefined>;

  getBrandInvoicesByDealId(dealId: number): Promise<BrandInvoice[]>;
  getBrandInvoicesByDealIdForOrg(dealId: number, orgId: string, userId?: string): Promise<BrandInvoice[]>;

  getUserByReferralCode(code: string): Promise<User | undefined>;
  createReferral(data: InsertReferral): Promise<Referral>;
  getReferralsByUser(userId: string): Promise<Referral[]>;

  // ── Organizations, team, invitations, activity ──
  createOrganization(name: string, slug: string): Promise<Organization>;
  getOrganization(id: string): Promise<Organization | undefined>;
  updateOrganization(id: string, updates: Partial<Organization>): Promise<Organization | undefined>;
  getOrgMembers(orgId: string): Promise<User[]>;
  getOrgOwner(orgId: string): Promise<User | undefined>;
  countActiveMembers(orgId: string): Promise<number>;
  getDealsByOrg(orgId: string, userId?: string): Promise<Deal[]>;
  getContractsByOrg(orgId: string, userId?: string): Promise<Contract[]>;
  getInvoicesByOrg(orgId: string, userId?: string): Promise<Invoice[]>;
  getBrandInvoicesByOrg(orgId: string, userId?: string): Promise<BrandInvoice[]>;
  getQuotesByOrg(orgId: string, userId?: string): Promise<(Quote & { deal: Deal | null })[]>;
  createInvitation(data: InsertInvitation): Promise<Invitation>;
  getInvitationByToken(token: string): Promise<Invitation | undefined>;
  getPendingInvitations(orgId: string): Promise<Invitation[]>;
  updateInvitation(id: number, updates: Partial<Invitation>): Promise<Invitation | undefined>;
  logActivity(entry: InsertActivityLog): Promise<void>;
  getActivityLogs(orgId: string, limit?: number): Promise<ActivityLog[]>;
  activateExtraSeats(orgId: string, qty: number, days: number): Promise<Organization | undefined>;
  revokeExtraSeats(orgId: string, qty: number): Promise<Organization | undefined>;
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
    // email_canonical is derived here — the single choke point across all
    // signup paths (email, Google, invite-accept) — so the trial's
    // one-per-mailbox dedupe can never be skipped by a forgotten call site.
    const values = {
      ...userData,
      emailCanonical: userData.emailCanonical ?? canonicalEmail(userData.email),
    };
    const [user] = await db.insert(users).values(values).returning();
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

  async getContractByDealId(dealId: number): Promise<Contract | undefined> {
    const [contract] = await db.select().from(contracts).where(eq(contracts.dealId, dealId));
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

  async deleteBrandInvoice(id: number): Promise<void> {
    await db.delete(brandInvoices).where(eq(brandInvoices.id, id));
  }

  /** Per-org, per-FY sequential number: INV-2627-0001. Atomic upsert, so two
   *  simultaneous invoices can never take the same number. Falls back to the
   *  legacy generator only if the org is unknown. */
  async generateOrgInvoiceNumber(orgId: string | null | undefined): Promise<string> {
    if (!orgId) return this.generateBrandInvoiceNumber();
    const fy = financialYearCode();
    const [row] = await db
      .insert(invoiceCounters)
      .values({ organizationId: orgId, fy, lastNo: 1 })
      .onConflictDoUpdate({
        target: [invoiceCounters.organizationId, invoiceCounters.fy],
        set: { lastNo: sql`${invoiceCounters.lastNo} + 1` },
      })
      .returning();
    return `INV-${fy}-${String(row.lastNo).padStart(4, "0")}`;
  }

  async generateBrandInvoiceNumber(): Promise<string> {
    this.invoiceCounter++;
    return `BINV-${Date.now()}-${this.invoiceCounter}`;
  }

  async getInvoiceAttachments(brandInvoiceId: number): Promise<InvoiceAttachment[]> {
    return db.select().from(invoiceAttachments)
      .where(eq(invoiceAttachments.brandInvoiceId, brandInvoiceId))
      .orderBy(desc(invoiceAttachments.createdAt));
  }

  async getInvoiceAttachment(id: number): Promise<InvoiceAttachment | undefined> {
    const [attachment] = await db.select().from(invoiceAttachments).where(eq(invoiceAttachments.id, id));
    return attachment;
  }

  async createInvoiceAttachment(data: InsertInvoiceAttachment): Promise<InvoiceAttachment> {
    const [created] = await db.insert(invoiceAttachments).values(data as any).returning();
    return created;
  }

  async deleteInvoiceAttachment(id: number): Promise<void> {
    await db.delete(invoiceAttachments).where(eq(invoiceAttachments.id, id));
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

  async ensureMonthlyCredits(userId: string): Promise<User | undefined> {
    // Lazy monthly reset: no cron exists (and the free-tier host sleeps), so
    // the reset happens on access. Atomic: of N concurrent callers the WHERE
    // guard lets exactly one row-update through. SET to 4 (not += 4) — unused
    // monthly credits do not roll over. Next reset is a month from NOW, so an
    // inactive user doesn't accrue several resets.
    const [updated] = await db.update(users)
      .set({
        monthlyDealCredits: 4,
        monthlyCreditsResetAt: sql`now() + interval '1 month'`,
        updatedAt: new Date(),
      })
      .where(sql`${users.id} = ${userId} AND ${users.monthlyCreditsResetAt} <= now()`)
      .returning();
    return updated; // undefined = no reset was due
  }

  async spendDealCredit(userId: string): Promise<{ ok: boolean; user?: User }> {
    // One atomic statement, monthly bucket first then legacy purchased. Both
    // CASE expressions read the pre-update row, so exactly one bucket loses 1;
    // the WHERE guard stops the spend at 0/0 (same pattern as the old
    // deductCreditIfSufficient). The ledger row records the post-spend
    // balances (RETURNING can't expose pre-update values, so which bucket was
    // hit is derivable from consecutive ledger entries rather than stored).
    const [row] = await db.update(users)
      .set({
        monthlyDealCredits: sql`CASE WHEN ${users.monthlyDealCredits} > 0 THEN ${users.monthlyDealCredits} - 1 ELSE ${users.monthlyDealCredits} END`,
        purchasedDealCredits: sql`CASE WHEN ${users.monthlyDealCredits} > 0 THEN ${users.purchasedDealCredits} ELSE ${users.purchasedDealCredits} - 1 END`,
        updatedAt: new Date(),
      })
      .where(sql`${users.id} = ${userId} AND (${users.monthlyDealCredits} > 0 OR ${users.purchasedDealCredits} > 0)`)
      .returning();
    if (!row) return { ok: false };
    await this.createCreditTransaction({
      userId,
      delta: -1,
      type: "usage",
      metadata: {
        action: "deal_creation",
        monthlyAfter: row.monthlyDealCredits,
        purchasedAfter: row.purchasedDealCredits,
      },
    });
    return { ok: true, user: row };
  }

  async regrantDealCredit(userId: string): Promise<void> {
    // Compensation for the rare path where the credit was spent but the deal
    // insert then failed. We can't tell which bucket spendDealCredit hit
    // (RETURNING only exposes post-update values), so refund into the
    // never-expiring purchased bucket: refunding into monthly would let the
    // next lazy reset (SET monthly = 4, no rollover) silently destroy a paid
    // legacy credit. Worst case a monthly-bucket spend becomes a permanent
    // credit — the error favors the user, and the ledger records it.
    await db.update(users)
      .set({
        purchasedDealCredits: sql`${users.purchasedDealCredits} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
    await this.createCreditTransaction({
      userId,
      delta: 1,
      type: "refund",
      metadata: { action: "deal_creation_failed" },
    });
  }

  async addPurchasedCredits(userId: string, amount: number, type: string, paymentAmount?: number): Promise<User | undefined> {
    const [updated] = await db.update(users)
      .set({
        purchasedDealCredits: sql`${users.purchasedDealCredits} + ${amount}`,
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

  async activateProPlan(userId: string, days: number, term: "monthly" | "yearly"): Promise<User | undefined> {
    // Atomic in SQL: renewals extend from the current expiry when the plan is
    // still active, else from now. Computing this in the UPDATE itself (not
    // read-modify-write in JS) means two concurrent grants both extend — no
    // lost paid term under the verify/webhook race or double-renewal.
    //
    // TRIAL INVARIANT: this must NOT add remaining trial days to the paid
    // term (revokeProPlan subtracts a FIXED term, so a refund would leave
    // free Pro days behind). Buying mid-trial: planExpiresAt is NULL, so
    // GREATEST gives NOW()+days; the unexpired trial changes no entitlement
    // (hasProAccess = pro || trial) and trialEndsAt stays untouched.
    const [updated] = await db.update(users)
      .set({
        plan: "pro",
        planTerm: term,
        planExpiresAt: sql`GREATEST(COALESCE(${users.planExpiresAt}, NOW()), NOW()) + make_interval(days => ${days})`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();
    return updated;
  }

  async activateDealBoost(userId: string, days: number): Promise<User | undefined> {
    // ₹99 Deal Boost: unlimited deals + quotations for `days`. Same atomic
    // GREATEST-extend as Pro, so buying again stacks the expiry.
    const [updated] = await db.update(users)
      .set({
        dealBoostExpiresAt: sql`GREATEST(COALESCE(${users.dealBoostExpiresAt}, NOW()), NOW()) + make_interval(days => ${days})`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();
    return updated;
  }

  async revokeDealBoost(userId: string, days: number): Promise<User | undefined> {
    // Refund clawback for a boost purchase.
    // TRIAL INVARIANT: never touches trial columns — a refund must not
    // destroy a legitimate remaining trial.
    const [updated] = await db.update(users)
      .set({
        dealBoostExpiresAt: sql`COALESCE(${users.dealBoostExpiresAt}, NOW()) - make_interval(days => ${days})`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();
    return updated;
  }

  async revokeProPlan(userId: string, days: number): Promise<User | undefined> {
    // Refund clawback: reverse one term's extension atomically. If the plan
    // no longer reaches the future after the rollback, downgrade to free.
    // TRIAL INVARIANT: must never learn about trial columns — a day-5 refund
    // of a day-3 purchase falls back onto trial days 5-7 (accepted, bounded:
    // trialEndsAt is immutable after grant, so it can't be farmed).
    const [updated] = await db.update(users)
      .set({
        planExpiresAt: sql`COALESCE(${users.planExpiresAt}, NOW()) - make_interval(days => ${days})`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();
    if (
      updated &&
      updated.plan === "pro" &&
      (!updated.planExpiresAt || new Date(updated.planExpiresAt).getTime() <= Date.now())
    ) {
      const [downgraded] = await db.update(users)
        .set({ plan: "free", updatedAt: new Date() })
        .where(eq(users.id, userId))
        .returning();
      return downgraded;
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

  async completePayuOrderOnce(orderId: string, updates: Partial<PayuOrder>): Promise<PayuOrder | undefined> {
    // Atomic claim: the status guard lives in the WHERE clause, so of N
    // concurrent callers (browser verify + Razorpay webhook) exactly one gets
    // the row back and performs the grant. Returns undefined when someone else
    // already completed it. Only 'pending' and 'failed' are claimable —
    // 'failed' so a legitimate retry after a transient signature error still
    // delivers, but 'refunded' is TERMINAL: without that, a buyer could replay
    // the (forever-valid) verify signature after a refund and re-grant the
    // entitlement they were just refunded for.
    const [updated] = await db.update(payuOrders)
      .set({ ...updates, status: "completed" })
      .where(sql`${payuOrders.orderId} = ${orderId} AND ${payuOrders.status} IN ('pending', 'failed')`)
      .returning();
    return updated;
  }

  async markPayuOrderFailedIfPending(orderId: string): Promise<void> {
    // Only a pending order may be marked failed. An unguarded write here could
    // race the webhook (read pending → webhook completes+grants → we stomp
    // 'failed' over 'completed'), making the order re-claimable for a second
    // grant and invisible to the refund clawback.
    await db.update(payuOrders)
      .set({ status: "failed" })
      .where(sql`${payuOrders.orderId} = ${orderId} AND ${payuOrders.status} = 'pending'`);
  }

  async markPayuOrderRefundedOnce(orderId: string): Promise<PayuOrder | undefined> {
    // Atomic completed→refunded claim — same pattern as completePayuOrderOnce,
    // so a re-delivered refund webhook can't claw back twice.
    const [updated] = await db.update(payuOrders)
      .set({ status: "refunded" })
      .where(sql`${payuOrders.orderId} = ${orderId} AND ${payuOrders.status} = 'completed'`)
      .returning();
    return updated;
  }

  async getPayuOrderByPaymentId(paymentId: string): Promise<PayuOrder | undefined> {
    const [order] = await db.select().from(payuOrders).where(eq(payuOrders.payuTxnId, paymentId));
    return order;
  }

  async createQuote(data: InsertQuote): Promise<Quote> {
    const [created] = await db.insert(quotes).values(data as any).returning();
    return created;
  }

  async getQuoteByDealId(dealId: number): Promise<Quote | undefined> {
    const [quote] = await db.select().from(quotes).where(eq(quotes.dealId, dealId)).orderBy(desc(quotes.createdAt)).limit(1);
    return quote;
  }

  async getQuotesByDealId(dealId: number): Promise<Quote[]> {
    return db.select().from(quotes).where(eq(quotes.dealId, dealId)).orderBy(desc(quotes.createdAt));
  }

  async updateQuote(id: number, updates: Partial<Quote>): Promise<Quote | undefined> {
    const [updated] = await db.update(quotes).set(updates).where(eq(quotes.id, id)).returning();
    return updated;
  }

  async getBrandInvoicesByDealIdForOrg(dealId: number, orgId: string, userId?: string): Promise<BrandInvoice[]> {
    // Deal-scoped read, still fenced by organization so a row planted with
    // another org's dealId can never surface in this org's deal view.
    return db.select().from(brandInvoices).where(
      sql`${brandInvoices.dealId} = ${dealId} AND (${brandInvoices.organizationId} = ${orgId} OR (${brandInvoices.organizationId} IS NULL AND ${brandInvoices.userId} = ${userId ?? null}))`,
    );
  }

  async getBrandInvoicesByDealId(dealId: number): Promise<BrandInvoice[]> {
    return db.select().from(brandInvoices).where(eq(brandInvoices.dealId, dealId));
  }

  async getUserByReferralCode(code: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.referralCode, code));
    return user;
  }

  async createReferral(data: InsertReferral): Promise<Referral> {
    const [created] = await db.insert(referrals).values(data as any).returning();
    return created;
  }

  async getReferralsByUser(userId: string): Promise<Referral[]> {
    return db.select().from(referrals).where(eq(referrals.referrerId, userId)).orderBy(desc(referrals.createdAt));
  }

  // ── Organizations, team, invitations, activity ──

  async createOrganization(name: string, slug: string): Promise<Organization> {
    const [org] = await db.insert(organizations).values({ name, slug }).returning();
    // Default roles are ordinary editable rows from day one (single choke
    // point — every org-creation path passes through here).
    await this.seedDefaultRoles(org.id);
    return org;
  }

  /** Seed Admin/Sales/Accounts as editable org_roles rows and latch the
   *  flag. Idempotent via the latch — callers check rolesSeeded first (or
   *  rely on createOrganization). */
  async seedDefaultRoles(orgId: string): Promise<void> {
    for (const seed of DEFAULT_ROLE_SEEDS) {
      await db.insert(orgRoles)
        .values({ organizationId: orgId, name: seed.name, permissions: seed.permissions })
        .onConflictDoNothing();
    }
    await db.update(organizations)
      .set({ rolesSeeded: true, updatedAt: new Date() })
      .where(eq(organizations.id, orgId));
  }

  async getOrganization(id: string): Promise<Organization | undefined> {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, id));
    return org;
  }

  async updateOrganization(id: string, updates: Partial<Organization>): Promise<Organization | undefined> {
    const [org] = await db.update(organizations)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(organizations.id, id))
      .returning();
    return org;
  }

  async getOrgMembers(orgId: string): Promise<User[]> {
    return db.select().from(users)
      .where(sql`${users.organizationId} = ${orgId} AND ${users.memberStatus} = 'active'`)
      .orderBy(users.joinedAt);
  }

  // ── Custom roles (owner-minted permission sets) ──

  async getOrgRole(id: string): Promise<OrgCustomRole | undefined> {
    const [role] = await db.select().from(orgRoles).where(eq(orgRoles.id, id));
    return role;
  }

  async getOrgRoles(orgId: string): Promise<OrgCustomRole[]> {
    return db.select().from(orgRoles)
      .where(eq(orgRoles.organizationId, orgId))
      .orderBy(orgRoles.createdAt);
  }

  async createOrgRole(orgId: string, name: string, permissions: string[]): Promise<OrgCustomRole> {
    const [role] = await db.insert(orgRoles)
      .values({ organizationId: orgId, name, permissions })
      .returning();
    return role;
  }

  async updateOrgRole(id: string, updates: { name?: string; permissions?: string[] }): Promise<OrgCustomRole | undefined> {
    const [role] = await db.update(orgRoles)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(orgRoles.id, id))
      .returning();
    return role;
  }

  async deleteOrgRole(id: string): Promise<void> {
    await db.delete(orgRoles).where(eq(orgRoles.id, id));
  }

  /** Members + pending invites still pointing at a role — deletion is
   *  blocked while this is non-zero. */
  async countCustomRoleUsage(roleId: string): Promise<{ members: number; invites: number }> {
    const [m] = await db.select({ n: sql<number>`count(*)::int` }).from(users)
      .where(sql`${users.customRoleId} = ${roleId} AND ${users.memberStatus} = 'active'`);
    const [i] = await db.select({ n: sql<number>`count(*)::int` }).from(invitations)
      .where(sql`${invitations.customRoleId} = ${roleId} AND ${invitations.status} = 'pending'`);
    return { members: m?.n ?? 0, invites: i?.n ?? 0 };
  }

  async getOrgOwner(orgId: string): Promise<User | undefined> {
    const [owner] = await db.select().from(users)
      .where(sql`${users.organizationId} = ${orgId} AND ${users.orgRole} = 'OWNER' AND ${users.memberStatus} = 'active'`)
      .limit(1);
    return owner;
  }

  async countActiveMembers(orgId: string): Promise<number> {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(users)
      .where(sql`${users.organizationId} = ${orgId} AND ${users.memberStatus} = 'active'`);
    return row?.n ?? 0;
  }

  // Org lists mirror the routes' inOrg() rule exactly: rows belonging to the
  // organization, PLUS the caller's own rows that predate the org migration
  // (organization_id IS NULL) — otherwise a legacy row stays reachable by its
  // detail route but silently vanishes from every list.
  async getDealsByOrg(orgId: string, userId?: string): Promise<Deal[]> {
    return db.select().from(deals).where(
      sql`${deals.organizationId} = ${orgId} OR (${deals.organizationId} IS NULL AND ${deals.userId} = ${userId ?? null})`,
    );
  }

  async getContractsByOrg(orgId: string, userId?: string): Promise<Contract[]> {
    return db.select().from(contracts).where(
      sql`${contracts.organizationId} = ${orgId} OR (${contracts.organizationId} IS NULL AND ${contracts.userId} = ${userId ?? null})`,
    );
  }

  async getInvoicesByOrg(orgId: string, userId?: string): Promise<Invoice[]> {
    return db.select().from(invoices).where(
      sql`${invoices.organizationId} = ${orgId} OR (${invoices.organizationId} IS NULL AND ${invoices.userId} = ${userId ?? null})`,
    );
  }

  async getBrandInvoicesByOrg(orgId: string, userId?: string): Promise<BrandInvoice[]> {
    return db.select().from(brandInvoices).where(
      sql`${brandInvoices.organizationId} = ${orgId} OR (${brandInvoices.organizationId} IS NULL AND ${brandInvoices.userId} = ${userId ?? null})`,
    ).orderBy(desc(brandInvoices.id));
  }

  async getQuotesByOrg(orgId: string, userId?: string): Promise<(Quote & { deal: Deal | null })[]> {
    // Quotation register: every quote in the org with its parent deal, newest
    // first. Same org-or-legacy-own rule as the other list queries.
    const rows = await db.select({ quote: quotes, deal: deals })
      .from(quotes)
      .leftJoin(deals, eq(quotes.dealId, deals.id))
      .where(sql`${quotes.organizationId} = ${orgId} OR (${quotes.organizationId} IS NULL AND ${quotes.userId} = ${userId ?? null})`)
      .orderBy(desc(quotes.createdAt));
    return rows.map((r) => ({ ...r.quote, deal: r.deal ?? null }));
  }

  async createInvitation(data: InsertInvitation): Promise<Invitation> {
    const [inv] = await db.insert(invitations).values(data as any).returning();
    return inv;
  }

  async getInvitationByToken(token: string): Promise<Invitation | undefined> {
    const [inv] = await db.select().from(invitations).where(eq(invitations.token, token));
    return inv;
  }

  async getPendingInvitations(orgId: string): Promise<Invitation[]> {
    // Only LIVE invitations: an expired one can no longer be accepted, so it
    // must not keep occupying a seat in the limit check (nor clutter the UI).
    return db.select().from(invitations)
      .where(sql`${invitations.organizationId} = ${orgId} AND ${invitations.status} = 'pending' AND ${invitations.expiresAt} > now()`)
      .orderBy(desc(invitations.createdAt));
  }

  async updateInvitation(id: number, updates: Partial<Invitation>): Promise<Invitation | undefined> {
    const [inv] = await db.update(invitations).set(updates).where(eq(invitations.id, id)).returning();
    return inv;
  }

  async logActivity(entry: InsertActivityLog): Promise<void> {
    // Best-effort audit trail — never let a logging failure break the action.
    try {
      await db.insert(activityLogs).values(entry as any);
    } catch (err) {
      console.error("activity log failed:", err);
    }
  }

  async getActivityLogs(orgId: string, limit = 50): Promise<ActivityLog[]> {
    return db.select().from(activityLogs)
      .where(eq(activityLogs.organizationId, orgId))
      .orderBy(desc(activityLogs.createdAt))
      .limit(limit);
  }

  async activateExtraSeats(orgId: string, qty: number, days: number): Promise<Organization | undefined> {
    // Seat pack: if the current pack lapsed, the new purchase REPLACES it;
    // if still active, the qty adds on and shares the existing expiry
    // (the whole pack renews together). Atomic in SQL like the plan grants.
    const [org] = await db.update(organizations)
      .set({
        extraSeats: sql`CASE
          WHEN ${organizations.extraSeatsExpiresAt} IS NULL OR ${organizations.extraSeatsExpiresAt} <= now()
            THEN ${qty}
          ELSE ${organizations.extraSeats} + ${qty}
        END`,
        extraSeatsExpiresAt: sql`CASE
          WHEN ${organizations.extraSeatsExpiresAt} IS NULL OR ${organizations.extraSeatsExpiresAt} <= now()
            THEN now() + make_interval(days => ${days})
          ELSE ${organizations.extraSeatsExpiresAt}
        END`,
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, orgId))
      .returning();
    return org;
  }

  async revokeExtraSeats(orgId: string, qty: number): Promise<Organization | undefined> {
    // Refund clawback — never below zero.
    const [org] = await db.update(organizations)
      .set({
        extraSeats: sql`GREATEST(${organizations.extraSeats} - ${qty}, 0)`,
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, orgId))
      .returning();
    return org;
  }
}

export const storage = new DatabaseStorage();
