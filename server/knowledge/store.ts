/** Database store for knowledge. Tests replace this module (eval/world-mocks.ts). Every query is scoped by organization. */
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { knowledgeChunks, knowledgeFiles, knowledgeSources, type KnowledgeSourceRow } from "@shared/schema";
import { tablesReadyCheck } from "../leads/ready";

export const knowledgeTablesReady = tablesReadyCheck(["knowledge_sources", "knowledge_chunks", "knowledge_files"]);

export interface SourceInput {
  kind: "note" | "url" | "pdf" | "image";
  title: string;
  sourceUrl?: string | null;
  fileName?: string | null;
  mime?: string | null;
  sizeBytes?: number | null;
  sha256: string;
  description?: string | null;
  chars: number;
  truncated: boolean;
  addedBy: string;
}
export interface Hit { sourceId: string; title: string; kind: string; sourceUrl: string | null; position: number; content: string; rank: number }

export interface KnowledgeStore {
  list(orgId: string): Promise<KnowledgeSourceRow[]>;
  get(orgId: string, id: string): Promise<KnowledgeSourceRow | null>;
  usage(orgId: string): Promise<{ sources: number; chunks: number }>;
  findByHash(orgId: string, sha256: string): Promise<KnowledgeSourceRow | null>;
  /** A source, its passages and (for a picture) its bytes, together or not at all. A duplicate hash throws code 23505. */
  create(orgId: string, input: SourceInput, chunks: string[], file?: { mime: string; bytes: Buffer }): Promise<KnowledgeSourceRow>;
  remove(orgId: string, id: string): Promise<boolean>;
  file(orgId: string, id: string): Promise<{ mime: string; bytes: Buffer } | null>;
  /** Passages matching any of the terms, best first. `terms` are already safe words (see queryTerms). */
  search(orgId: string, terms: string[], limit: number): Promise<Hit[]>;
}

export const knowledgeStore: KnowledgeStore = {
  async list(orgId) {
    return db.select().from(knowledgeSources).where(eq(knowledgeSources.organizationId, orgId)).orderBy(desc(knowledgeSources.createdAt)).limit(200);
  },
  async get(orgId, id) {
    const [r] = await db.select().from(knowledgeSources).where(and(eq(knowledgeSources.organizationId, orgId), eq(knowledgeSources.id, id))).limit(1);
    return r ?? null;
  },
  async usage(orgId) {
    const [s] = await db.select({ n: sql<number>`count(*)::int` }).from(knowledgeSources).where(eq(knowledgeSources.organizationId, orgId));
    const [c] = await db.select({ n: sql<number>`count(*)::int` }).from(knowledgeChunks).where(eq(knowledgeChunks.organizationId, orgId));
    return { sources: s?.n ?? 0, chunks: c?.n ?? 0 };
  },
  async findByHash(orgId, sha256) {
    const [r] = await db.select().from(knowledgeSources).where(and(eq(knowledgeSources.organizationId, orgId), eq(knowledgeSources.sha256, sha256))).limit(1);
    return r ?? null;
  },
  async create(orgId, input, chunks, file) {
    return db.transaction(async (tx) => {
      const [row] = await tx.insert(knowledgeSources).values({ ...input, organizationId: orgId, chunkCount: chunks.length }).returning();
      if (chunks.length) await tx.insert(knowledgeChunks).values(chunks.map((content, position) => ({ sourceId: row.id, organizationId: orgId, position, content })));
      if (file) await tx.insert(knowledgeFiles).values({ sourceId: row.id, organizationId: orgId, mime: file.mime, bytes: file.bytes });
      return row;
    });
  },
  async remove(orgId, id) {
    const r = await db.delete(knowledgeSources).where(and(eq(knowledgeSources.organizationId, orgId), eq(knowledgeSources.id, id))).returning({ id: knowledgeSources.id });
    return r.length > 0;
  },
  async file(orgId, id) {
    const [r] = await db.select({ mime: knowledgeFiles.mime, bytes: knowledgeFiles.bytes }).from(knowledgeFiles)
      .where(and(eq(knowledgeFiles.organizationId, orgId), eq(knowledgeFiles.sourceId, id))).limit(1);
    return r ?? null;
  },
  async search(orgId, terms, limit) {
    if (!terms.length) return [];
    // websearch_to_tsquery reads "or" as OR; the terms are letters and digits only, so nothing can change the query's shape.
    const q = terms.join(" or ");
    const r = await db.execute(sql`
      SELECT c.source_id AS "sourceId", s.title, s.kind, s.source_url AS "sourceUrl", c.position, c.content,
             ts_rank_cd(c.tsv, websearch_to_tsquery('english', ${q}))::float AS rank
      FROM knowledge_chunks c JOIN knowledge_sources s ON s.id = c.source_id
      WHERE c.organization_id = ${orgId} AND s.organization_id = ${orgId} AND c.tsv @@ websearch_to_tsquery('english', ${q})
      ORDER BY rank DESC, c.source_id, c.position
      LIMIT ${limit}`);
    return r.rows as unknown as Hit[];
  },
};
