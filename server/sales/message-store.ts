/** Database store for outreach messages. Tests replace this module (eval/world-mocks.ts). Every query is scoped by organization. */
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { leadMessages, type LeadMessageRow } from "@shared/schema";
import { tablesReadyCheck } from "../leads/ready";

/** Drafting needs its own table and the model trace (daily allowances are counted from it). */
export const messagesTablesReady = tablesReadyCheck(["lead_messages", "llm_calls"]);

export type MessageStatus = "draft" | "approved" | "sent" | "cancelled";
export interface NewMessage {
  orgId: string; leadId: number; subject: string; body: string; bodyHash: string; toAddress: string; toSource: "lead" | "site";
  researchId: number | null; claimIds: number[]; promptVersion: string; by: "user" | "agent"; userId: string; now: Date;
}
export class DraftExists extends Error { constructor() { super("this lead already has an unsent message"); } }

export interface MessageStore {
  /** Creates a draft, or throws DraftExists if the lead already has an unsent (draft or approved) message. */
  create(m: NewMessage): Promise<LeadMessageRow>;
  get(orgId: string, id: number): Promise<LeadMessageRow | null>;
  listForLead(orgId: string, leadId: number, limit?: number): Promise<LeadMessageRow[]>;
  /** The lead's unsent message, if any. */
  unsent(orgId: string, leadId: number): Promise<LeadMessageRow | null>;
  /**
   * One atomic change: applies `set` only if the row is currently in `from` (and, when given, still has `hash`), and returns the
   * new row, or null when it was not (someone else got there first, or the text changed). This is what makes a double click safe.
   */
  transition(o: { orgId: string; id: number; from: MessageStatus; to: MessageStatus; hash?: string; now: Date; set?: Partial<Pick<LeadMessageRow, "subject" | "body" | "bodyHash" | "edited" | "approvedBy" | "approvedAt" | "sentAt">> }): Promise<LeadMessageRow | null>;
}

export const messageStore: MessageStore = {
  async create(m) {
    try {
      const [row] = await db.insert(leadMessages).values({
        leadId: m.leadId, organizationId: m.orgId, subject: m.subject, body: m.body, bodyHash: m.bodyHash, toAddress: m.toAddress, toSource: m.toSource,
        status: "draft", researchId: m.researchId, claimIds: m.claimIds, promptVersion: m.promptVersion, createdBy: m.by, createdByUser: m.userId,
        createdAt: m.now, updatedAt: m.now,
      }).returning();
      return row;
    } catch (e) {
      // The partial unique index (one unsent message per lead) decides, not a check-then-insert.
      if ((e as { code?: string })?.code === "23505") throw new DraftExists();
      throw e;
    }
  },
  async get(orgId, id) {
    const [r] = await db.select().from(leadMessages).where(and(eq(leadMessages.organizationId, orgId), eq(leadMessages.id, id))).limit(1);
    return r ?? null;
  },
  async listForLead(orgId, leadId, limit = 50) {
    return db.select().from(leadMessages).where(and(eq(leadMessages.organizationId, orgId), eq(leadMessages.leadId, leadId))).orderBy(desc(leadMessages.createdAt), desc(leadMessages.id)).limit(limit);
  },
  async unsent(orgId, leadId) {
    const [r] = await db.select().from(leadMessages)
      .where(and(eq(leadMessages.organizationId, orgId), eq(leadMessages.leadId, leadId), eq(leadMessages.direction, "out"), sql`${leadMessages.status} IN ('draft', 'approved')`)).limit(1);
    return r ?? null;
  },
  async transition({ orgId, id, from, to, hash, now, set }) {
    const [r] = await db.update(leadMessages).set({ ...set, status: to, updatedAt: now })
      .where(and(eq(leadMessages.organizationId, orgId), eq(leadMessages.id, id), eq(leadMessages.status, from), hash ? eq(leadMessages.bodyHash, hash) : undefined)).returning();
    return r ?? null;
  },
};
