/**
 * Database implementation of the lead store. Imports the database, so it is
 * never imported by pure modules; tests of the services and tools replace this
 * module with an in-memory store (see server/agent/eval/world-mocks.ts).
 */
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "../db";
import { leadClaims, leadEvents, leads, leadTickets, type Lead, type LeadClaim, type LeadTicket } from "@shared/schema";
import type { LeadStatus } from "@shared/leads";
import { OPEN_STATUSES } from "@shared/leads";
import { tablesReadyCheck } from "./ready";
import { LeadConflictError, type DueTicket, type LeadDetail, type LeadPatch, type LeadRow, type LeadsStore, type ListOptions, type NewLead } from "./types";

/** Are the lead tables there? (see ./ready.ts) */
export const leadsTablesReady = tablesReadyCheck(["leads", "lead_events", "lead_tickets", "lead_claims"]);

const own = (orgId: string, id: number) => and(eq(leads.organizationId, orgId), eq(leads.id, id));
const isUniqueViolation = (e: unknown) => (e as { code?: string })?.code === "23505";

export class DbLeadsStore implements LeadsStore {
  async list(orgId: string, o: ListOptions): Promise<{ rows: LeadRow[]; total: number }> {
    const q = o.q?.trim();
    const where = and(
      eq(leads.organizationId, orgId),
      o.includeArchived ? undefined : isNull(leads.archivedAt),
      o.status ? eq(leads.status, o.status) : undefined,
      q ? or(ilike(leads.companyName, `%${q.replace(/[%_\\]/g, "\\$&")}%`), ilike(leads.domain, `%${q.replace(/[%_\\]/g, "\\$&")}%`)) : undefined,
    );
    const [rows, [{ n }]] = await Promise.all([
      db.select().from(leads).where(where).orderBy(desc(leads.updatedAt), desc(leads.id)).limit(o.limit).offset(o.offset),
      db.select({ n: count() }).from(leads).where(where),
    ]);
    if (!rows.length) return { rows: [], total: Number(n) };
    // The next open ticket per lead: earliest due date first, undated last.
    const open = await db.select().from(leadTickets)
      .where(and(eq(leadTickets.organizationId, orgId), eq(leadTickets.status, "open"), inArray(leadTickets.leadId, rows.map((r) => r.id))))
      .orderBy(sql`${leadTickets.dueAt} ASC NULLS LAST`, asc(leadTickets.id));
    const next = new Map<number, LeadTicket>();
    for (const t of open) if (!next.has(t.leadId)) next.set(t.leadId, t);
    return {
      rows: rows.map((r) => {
        const t = next.get(r.id);
        return { ...r, nextTicket: t ? { id: t.id, title: t.title, dueAt: t.dueAt } : null };
      }),
      total: Number(n),
    };
  }

  async counts(orgId: string): Promise<Record<string, number>> {
    const rows = await db.select({ status: leads.status, n: count() }).from(leads)
      .where(and(eq(leads.organizationId, orgId), isNull(leads.archivedAt))).groupBy(leads.status);
    return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
  }

  async dueTickets(orgId: string, until: Date, limit: number): Promise<DueTicket[]> {
    const rows = await db.select({
      id: leadTickets.id, title: leadTickets.title, kind: leadTickets.kind, dueAt: leadTickets.dueAt,
      leadId: leads.id, companyName: leads.companyName, leadStatus: leads.status,
    }).from(leadTickets).innerJoin(leads, and(eq(leads.id, leadTickets.leadId), eq(leads.organizationId, leadTickets.organizationId)))
      .where(and(
        eq(leadTickets.organizationId, orgId), eq(leadTickets.status, "open"), isNotNull(leadTickets.dueAt), lte(leadTickets.dueAt, until),
        isNull(leads.archivedAt), inArray(leads.status, [...OPEN_STATUSES]),
      ))
      .orderBy(asc(leadTickets.dueAt), asc(leadTickets.id)).limit(limit);
    return rows.map((r) => ({ ...r, dueAt: r.dueAt as Date }));
  }

  async get(orgId: string, id: number): Promise<Lead | null> {
    const [row] = await db.select().from(leads).where(own(orgId, id));
    return row ?? null;
  }

  async detail(orgId: string, id: number): Promise<LeadDetail | null> {
    const lead = await this.get(orgId, id);
    if (!lead) return null;
    const scoped = (t: typeof leadEvents | typeof leadTickets | typeof leadClaims) => and(eq(t.leadId, id), eq(t.organizationId, orgId));
    const [events, tickets, claims] = await Promise.all([
      db.select().from(leadEvents).where(scoped(leadEvents)).orderBy(desc(leadEvents.id)).limit(200),
      db.select().from(leadTickets).where(scoped(leadTickets)).orderBy(sql`${leadTickets.status} = 'open' DESC`, sql`${leadTickets.dueAt} ASC NULLS LAST`, asc(leadTickets.id)),
      db.select().from(leadClaims).where(scoped(leadClaims)).orderBy(asc(leadClaims.id)),
    ]);
    return { lead, events, tickets, claims };
  }

  async findByDomain(orgId: string, domain: string): Promise<Lead | null> {
    const [row] = await db.select().from(leads).where(and(eq(leads.organizationId, orgId), eq(leads.domain, domain), isNull(leads.archivedAt)));
    return row ?? null;
  }

  async findByName(orgId: string, name: string): Promise<Lead | null> {
    const [row] = await db.select().from(leads).where(and(eq(leads.organizationId, orgId), sql`lower(${leads.companyName}) = ${name.trim().toLowerCase()}`, isNull(leads.archivedAt)));
    return row ?? null;
  }

  async insert(orgId: string, data: NewLead): Promise<Lead> {
    try {
      const [row] = await db.insert(leads).values({ ...data, organizationId: orgId }).returning();
      return row;
    } catch (e) {
      if (isUniqueViolation(e) && data.domain) {
        const existing = await this.findByDomain(orgId, data.domain);
        if (existing) throw new LeadConflictError(existing.id);
      }
      throw e;
    }
  }

  async update(orgId: string, id: number, patch: LeadPatch): Promise<Lead | null> {
    try {
      const [row] = await db.update(leads).set({ ...patch, updatedAt: new Date() }).where(own(orgId, id)).returning();
      return row ?? null;
    } catch (e) {
      if (isUniqueViolation(e) && patch.domain) {
        const existing = await this.findByDomain(orgId, patch.domain);
        if (existing && existing.id !== id) throw new LeadConflictError(existing.id);
      }
      throw e;
    }
  }

  async setStatus(orgId: string, id: number, from: LeadStatus, to: LeadStatus, lostReason?: string | null): Promise<Lead | null> {
    const [row] = await db.update(leads)
      .set({ status: to, statusChangedAt: new Date(), updatedAt: new Date(), lostReason: to === "lost" ? (lostReason ?? null) : null })
      .where(and(own(orgId, id), eq(leads.status, from), isNull(leads.archivedAt), eq(leads.converting, false)))
      .returning();
    return row ?? null;
  }

  async archive(orgId: string, id: number): Promise<Lead | null> {
    const [row] = await db.update(leads).set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(and(own(orgId, id), isNull(leads.archivedAt), eq(leads.converting, false))).returning();
    return row ?? null;
  }

  async addEvent(orgId: string, leadId: number, e: Parameters<LeadsStore["addEvent"]>[2]): Promise<void> {
    await db.insert(leadEvents).values({ leadId, organizationId: orgId, kind: e.kind, data: e.data ?? null, actor: e.actor, actorUserId: e.actorUserId ?? null });
    await db.update(leads).set({ updatedAt: new Date() }).where(own(orgId, leadId));
  }

  async addTicket(orgId: string, leadId: number, t: Parameters<LeadsStore["addTicket"]>[2]): Promise<LeadTicket> {
    const [row] = await db.insert(leadTickets).values({ leadId, organizationId: orgId, title: t.title, kind: t.kind, dueAt: t.dueAt ?? null, createdBy: t.createdBy }).returning();
    return row;
  }

  async getTicket(orgId: string, leadId: number, ticketId: number): Promise<LeadTicket | null> {
    const [row] = await db.select().from(leadTickets).where(and(eq(leadTickets.id, ticketId), eq(leadTickets.leadId, leadId), eq(leadTickets.organizationId, orgId)));
    return row ?? null;
  }

  async closeTicket(orgId: string, leadId: number, ticketId: number, status: "done" | "cancelled"): Promise<LeadTicket | null> {
    const [row] = await db.update(leadTickets).set({ status, doneAt: new Date() })
      .where(and(eq(leadTickets.id, ticketId), eq(leadTickets.leadId, leadId), eq(leadTickets.organizationId, orgId), eq(leadTickets.status, "open"))).returning();
    return row ?? null;
  }

  async addClaim(orgId: string, leadId: number, c: Parameters<LeadsStore["addClaim"]>[2]): Promise<LeadClaim> {
    const [row] = await db.insert(leadClaims).values({
      leadId, organizationId: orgId, field: c.field, value: c.value, status: c.status,
      evidenceUrl: c.evidenceUrl ?? null, evidenceSnippet: c.evidenceSnippet ?? null, source: c.source,
    }).returning();
    return row;
  }

  /** One UPDATE decides who converts: only a live, convertible, not-already-converting lead matches. */
  async beginConversion(orgId: string, id: number, convertibleFrom: readonly LeadStatus[]): Promise<Lead | null> {
    const [row] = await db.update(leads).set({ converting: true, updatedAt: new Date() })
      .where(and(own(orgId, id), eq(leads.converting, false), isNull(leads.convertedDealId), isNull(leads.archivedAt), inArray(leads.status, [...convertibleFrom])))
      .returning();
    return row ?? null;
  }

  async finishConversion(orgId: string, id: number, dealId: number): Promise<Lead | null> {
    const [row] = await db.update(leads)
      .set({ converting: false, convertedDealId: dealId, status: "won", statusChangedAt: new Date(), updatedAt: new Date(), lostReason: null })
      .where(and(own(orgId, id), eq(leads.converting, true))).returning();
    return row ?? null;
  }

  async abortConversion(orgId: string, id: number): Promise<void> {
    await db.update(leads).set({ converting: false }).where(and(own(orgId, id), eq(leads.converting, true), isNull(leads.convertedDealId)));
  }
}

export const leadsStore = new DbLeadsStore();
