/** Database store for document styles. Tests replace this module (eval/world-mocks.ts). */
import { eq } from "drizzle-orm";
import { db } from "../db";
import { documentStyles, type DocumentStyleRow } from "@shared/schema";
import { tablesReadyCheck } from "../leads/ready";

export const documentStyleTableReady = tablesReadyCheck(["document_styles"]);

export interface StyleData { accent: string; font: string; footerNote: string | null }
export interface DocumentStyleStore {
  get(orgId: string): Promise<DocumentStyleRow | null>;
  save(orgId: string, data: StyleData, userId: string): Promise<DocumentStyleRow>;
}

export const documentStyleStore: DocumentStyleStore = {
  async get(orgId) {
    const [row] = await db.select().from(documentStyles).where(eq(documentStyles.organizationId, orgId)).limit(1);
    return row ?? null;
  },
  async save(orgId, data, userId) {
    const [row] = await db.insert(documentStyles).values({ organizationId: orgId, ...data, updatedBy: userId, updatedAt: new Date() })
      .onConflictDoUpdate({ target: documentStyles.organizationId, set: { ...data, updatedBy: userId, updatedAt: new Date() } }).returning();
    return row;
  },
};
