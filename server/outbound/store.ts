/**
 * Database store for AI Outbound. Tests replace this module (eval/world-mocks.ts). Every query that a person's
 * request can reach is scoped by organization. The runner's claim is deliberately global (it serves every
 * workspace) and returns the run, whose organization then scopes everything else.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  llmCalls, prospectFindings, prospectRunItems, prospectRuns, prospects, providerCalls,
  type ProspectFindingRow, type ProspectRow, type ProspectRunItemRow, type ProspectRunRow,
} from "@shared/schema";
import type { Provenance } from "@shared/prospect";
import { tablesReadyCheck } from "../leads/ready";

/** The feature needs its own five tables and the model trace (allowances are counted from it). */
export const prospectsTablesReady = tablesReadyCheck(["prospect_runs", "prospects", "prospect_run_items", "prospect_findings", "provider_calls", "llm_calls"]);

export class RunActive extends Error { constructor(public runId: string) { super("a run with this ICP is already in progress"); } }

export interface NewRun {
  id: string; orgId: string; userId: string; by: "user" | "agent"; request: string; icp: unknown; quantity: number;
  idemKey: string; queries: unknown[]; now: Date;
}
export interface NewFinding {
  kind: string; type: string; value: string; status: string; sourceUrl: string | null; sourceType: string; quote: string | null;
  contentHash?: string | null; observedAt?: Date | null; confidence?: string; meta?: Record<string, unknown>;
  /** Supporting findings: ids already stored, or positions of earlier entries in the same list. */
  supports?: { findingId?: number; local?: number }[];
}
export type ItemWithProspect = ProspectRunItemRow & { prospect: ProspectRow };

export interface OutboundStore {
  createRun(r: NewRun): Promise<ProspectRunRow>; // throws RunActive (the same ICP is already running)
  getRun(orgId: string, id: string): Promise<ProspectRunRow | null>;
  listRuns(orgId: string, limit: number): Promise<ProspectRunRow[]>;
  countRunsSince(orgId: string, since: Date): Promise<number>;
  /** One atomic claim of a running run whose lease is free (or expired). */
  claimRun(now: Date, leaseMs: number): Promise<ProspectRunRow | null>;
  /** Changes a run only while this worker still holds it (lease not taken over). */
  updateRun(id: string, set: Partial<ProspectRunRow>): Promise<void>;
  releaseRun(id: string): Promise<void>;
  setRunStatus(orgId: string, id: string, from: string, to: string, now: Date, errorCode?: string | null): Promise<boolean>;

  /** Inserts the prospect, or merges new sources into the existing one for this organization and domain. */
  upsertProspect(orgId: string, p: { domain: string; name: string; website: string; sources: Provenance[] }, now: Date): Promise<ProspectRow>;
  getProspect(orgId: string, id: number): Promise<ProspectRow | null>;
  updateProspect(orgId: string, id: number, set: Partial<ProspectRow>): Promise<ProspectRow | null>;
  /** Sets lead_id only if it is still empty: the claim that stops two leads for one prospect. */
  linkLead(orgId: string, id: number, leadId: number): Promise<boolean>;
  prospectByLead(orgId: string, leadId: number): Promise<ProspectRow | null>;
  /** A prospect of this organization with this domain, or (no domain) this exact name, ignoring case. */
  prospectMatching(orgId: string, m: { domain: string | null; name: string }): Promise<ProspectRow | null>;
  /** Prospects whose name or domain contains the text (case-insensitive), newest first. */
  prospectsLike(orgId: string, text: string, limit: number): Promise<ProspectRow[]>;

  addRunItem(i: { runId: string; orgId: string; prospectId: number; stage: string; now: Date }): Promise<void>;
  /** Items of a run in a stage, due now, best rank first. */
  itemsAt(runId: string, stage: string, limit: number, now: Date): Promise<ItemWithProspect[]>;
  runItems(orgId: string, runId: string): Promise<ItemWithProspect[]>;
  setItem(id: number, set: Partial<ProspectRunItemRow>): Promise<void>;

  findings(orgId: string, prospectId: number): Promise<ProspectFindingRow[]>;
  findingsFor(orgId: string, prospectIds: number[]): Promise<ProspectFindingRow[]>;
  /**
   * One transaction: replaces the findings a step wrote before (same batch), inserts the new ones (resolving
   * supports), updates the prospect and the run item. A crash leaves either all of it or none of it.
   */
  saveStep(o: { orgId: string; prospectId: number; batch: string; findings: NewFinding[]; prospect?: Partial<ProspectRow>; itemId?: number; item?: Partial<ProspectRunItemRow>; now: Date }): Promise<ProspectFindingRow[]>;

  recordProviderCall(r: { orgId: string; runId: string | null; provider: string; operation: string; ok: boolean; errorCode: string | null; latencyMs: number; costMicroUsd: number; now: Date }): Promise<void>;
  countProviderCalls(o: { orgId?: string; operation: string; since: Date }): Promise<number>;
  runCostMicroUsd(runId: string): Promise<number>;
}

const due = (now: Date) => or(isNull(prospectRunItems.nextAttemptAt), lte(prospectRunItems.nextAttemptAt, now));

async function withProspects(rows: ProspectRunItemRow[], orgId?: string): Promise<ItemWithProspect[]> {
  if (!rows.length) return [];
  const ps = await db.select().from(prospects).where(and(inArray(prospects.id, rows.map((r) => r.prospectId)), orgId ? eq(prospects.organizationId, orgId) : undefined));
  const by = new Map(ps.map((p) => [p.id, p]));
  return rows.filter((r) => by.has(r.prospectId)).map((r) => ({ ...r, prospect: by.get(r.prospectId)! }));
}

export const outboundStore: OutboundStore = {
  async createRun(r) {
    try {
      const [row] = await db.insert(prospectRuns).values({
        id: r.id, organizationId: r.orgId, createdByUser: r.userId, createdBy: r.by, request: r.request, icp: r.icp, quantity: r.quantity,
        status: "running", stage: "search", counters: {}, queries: r.queries, idemKey: r.idemKey, createdAt: r.now, updatedAt: r.now,
      }).returning();
      return row;
    } catch (e) {
      if ((e as { code?: string })?.code === "23505") {
        const [active] = await db.select({ id: prospectRuns.id }).from(prospectRuns).where(and(eq(prospectRuns.organizationId, r.orgId), eq(prospectRuns.idemKey, r.idemKey), eq(prospectRuns.status, "running"))).limit(1);
        throw new RunActive(active?.id ?? "");
      }
      throw e;
    }
  },
  async getRun(orgId, id) {
    const [r] = await db.select().from(prospectRuns).where(and(eq(prospectRuns.organizationId, orgId), eq(prospectRuns.id, id))).limit(1);
    return r ?? null;
  },
  async listRuns(orgId, limit) {
    return db.select().from(prospectRuns).where(eq(prospectRuns.organizationId, orgId)).orderBy(desc(prospectRuns.createdAt)).limit(limit);
  },
  async countRunsSince(orgId, since) {
    const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(prospectRuns).where(and(eq(prospectRuns.organizationId, orgId), gte(prospectRuns.createdAt, since)));
    return r?.n ?? 0;
  },
  async claimRun(now, leaseMs) {
    const r = await db.execute(sql`
      UPDATE prospect_runs SET lease_until = ${new Date(now.getTime() + leaseMs)}, attempts = attempts + 1, updated_at = ${now}
      WHERE id = (SELECT id FROM prospect_runs WHERE status = 'running' AND (lease_until IS NULL OR lease_until < ${now}) ORDER BY updated_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING id, organization_id`);
    const row = (r as unknown as { rows: { id: string; organization_id: string }[] }).rows[0];
    return row ? await this.getRun(row.organization_id, row.id) : null;
  },
  async updateRun(id, set) {
    await db.update(prospectRuns).set(set).where(eq(prospectRuns.id, id));
  },
  async releaseRun(id) {
    await db.update(prospectRuns).set({ leaseUntil: null }).where(eq(prospectRuns.id, id));
  },
  async setRunStatus(orgId, id, from, to, now, errorCode = null) {
    const r = await db.update(prospectRuns).set({ status: to, updatedAt: now, finishedAt: to === "running" ? null : now, errorCode, leaseUntil: null })
      .where(and(eq(prospectRuns.organizationId, orgId), eq(prospectRuns.id, id), eq(prospectRuns.status, from))).returning({ id: prospectRuns.id });
    return r.length > 0;
  },

  async upsertProspect(orgId, p, now) {
    const [row] = await db.insert(prospects).values({
      organizationId: orgId, domain: p.domain, name: p.name.slice(0, 120), website: p.website, status: "candidate", sources: p.sources, createdAt: now, updatedAt: now,
    }).onConflictDoUpdate({
      target: [prospects.organizationId, prospects.domain],
      // Sources are appended (provenance is kept from every run), capped; nothing else is overwritten by a new search.
      set: { sources: sql`(SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (SELECT x FROM jsonb_array_elements(${prospects.sources} || ${JSON.stringify(p.sources)}::jsonb) x LIMIT 20) s)`, updatedAt: now },
    }).returning();
    return row;
  },
  async getProspect(orgId, id) {
    const [r] = await db.select().from(prospects).where(and(eq(prospects.organizationId, orgId), eq(prospects.id, id))).limit(1);
    return r ?? null;
  },
  async updateProspect(orgId, id, set) {
    const [r] = await db.update(prospects).set(set).where(and(eq(prospects.organizationId, orgId), eq(prospects.id, id))).returning();
    return r ?? null;
  },
  async linkLead(orgId, id, leadId) {
    const r = await db.update(prospects).set({ leadId, updatedAt: new Date() }).where(and(eq(prospects.organizationId, orgId), eq(prospects.id, id), isNull(prospects.leadId))).returning({ id: prospects.id });
    return r.length > 0;
  },

  async prospectByLead(orgId, leadId) {
    const [r] = await db.select().from(prospects).where(and(eq(prospects.organizationId, orgId), eq(prospects.leadId, leadId))).limit(1);
    return r ?? null;
  },

  async prospectMatching(orgId, m) {
    const cond = m.domain ? eq(prospects.domain, m.domain) : sql`lower(${prospects.name}) = ${m.name.toLowerCase()}`;
    const [r] = await db.select().from(prospects).where(and(eq(prospects.organizationId, orgId), cond)).limit(1);
    return r ?? null;
  },

  async prospectsLike(orgId, text, limit) {
    const t = `%${text.toLowerCase().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    return db.select().from(prospects).where(and(eq(prospects.organizationId, orgId), sql`(lower(${prospects.name}) LIKE ${t} OR ${prospects.domain} LIKE ${t})`)).orderBy(desc(prospects.id)).limit(limit);
  },

  async addRunItem(i) {
    await db.insert(prospectRunItems).values({ runId: i.runId, organizationId: i.orgId, prospectId: i.prospectId, stage: i.stage, updatedAt: i.now }).onConflictDoNothing();
  },
  async itemsAt(runId, stage, limit, now) {
    const rows = await db.select().from(prospectRunItems).where(and(eq(prospectRunItems.runId, runId), eq(prospectRunItems.stage, stage), due(now))).orderBy(desc(prospectRunItems.rank), asc(prospectRunItems.id)).limit(limit);
    return withProspects(rows);
  },
  async runItems(orgId, runId) {
    const rows = await db.select().from(prospectRunItems).where(and(eq(prospectRunItems.organizationId, orgId), eq(prospectRunItems.runId, runId))).orderBy(desc(prospectRunItems.rank), asc(prospectRunItems.id)).limit(500);
    return withProspects(rows, orgId);
  },
  async setItem(id, set) {
    await db.update(prospectRunItems).set(set).where(eq(prospectRunItems.id, id));
  },

  async findings(orgId, prospectId) {
    return db.select().from(prospectFindings).where(and(eq(prospectFindings.organizationId, orgId), eq(prospectFindings.prospectId, prospectId))).orderBy(asc(prospectFindings.id));
  },
  async findingsFor(orgId, ids) {
    if (!ids.length) return [];
    return db.select().from(prospectFindings).where(and(eq(prospectFindings.organizationId, orgId), inArray(prospectFindings.prospectId, ids))).orderBy(asc(prospectFindings.id));
  },
  async saveStep(o) {
    return db.transaction(async (tx) => {
      await tx.delete(prospectFindings).where(and(eq(prospectFindings.organizationId, o.orgId), eq(prospectFindings.prospectId, o.prospectId), eq(prospectFindings.batch, o.batch)));
      const saved: ProspectFindingRow[] = [];
      for (const f of o.findings) {
        const supportingIds = (f.supports ?? []).map((s) => s.findingId ?? saved[s.local ?? -1]?.id).filter((x): x is number => typeof x === "number");
        const [row] = await tx.insert(prospectFindings).values({
          organizationId: o.orgId, prospectId: o.prospectId, kind: f.kind, type: f.type.slice(0, 40), value: f.value.slice(0, 400), status: f.status,
          sourceUrl: f.sourceUrl?.slice(0, 500) ?? null, sourceType: f.sourceType, quote: f.quote?.slice(0, 500) ?? null, contentHash: f.contentHash ?? null,
          observedAt: f.observedAt ?? null, confidence: f.confidence ?? "medium", supportingIds, meta: f.meta ?? {}, batch: o.batch, retrievedAt: o.now,
        }).returning();
        saved.push(row);
      }
      if (o.prospect) await tx.update(prospects).set({ ...o.prospect, updatedAt: o.now }).where(and(eq(prospects.organizationId, o.orgId), eq(prospects.id, o.prospectId)));
      if (o.itemId && o.item) await tx.update(prospectRunItems).set({ ...o.item, updatedAt: o.now }).where(and(eq(prospectRunItems.id, o.itemId), eq(prospectRunItems.organizationId, o.orgId)));
      return saved;
    });
  },

  async recordProviderCall(r) {
    await db.insert(providerCalls).values({ organizationId: r.orgId, runId: r.runId, provider: r.provider, operation: r.operation, ok: r.ok, errorCode: r.errorCode, latencyMs: r.latencyMs, costMicroUsd: r.costMicroUsd, createdAt: r.now });
  },
  async countProviderCalls({ orgId, operation, since }) {
    const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(providerCalls).where(and(orgId ? eq(providerCalls.organizationId, orgId) : undefined, eq(providerCalls.operation, operation), gte(providerCalls.createdAt, since)));
    return r?.n ?? 0;
  },
  async runCostMicroUsd(runId) {
    const [a] = await db.select({ n: sql<number>`COALESCE(sum(${llmCalls.costMicroUsd}), 0)::int` }).from(llmCalls).where(eq(llmCalls.runId, runId));
    const [b] = await db.select({ n: sql<number>`COALESCE(sum(${providerCalls.costMicroUsd}), 0)::int` }).from(providerCalls).where(eq(providerCalls.runId, runId));
    return (a?.n ?? 0) + (b?.n ?? 0);
  },
};
