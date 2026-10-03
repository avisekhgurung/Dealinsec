/**
 * In-memory lead store with the same semantics as server/leads/store.ts:
 * organization scoping, the per-company uniqueness, compare-and-set stage
 * moves and the atomic conversion claim. Lets the real services and agent tools
 * run in tests with no database. Test-only.
 */
import type { Lead, LeadClaim, LeadEvent, LeadTicket } from "@shared/schema";
import type { LeadStatus } from "@shared/leads";
import { OPEN_STATUSES } from "@shared/leads";
import { LeadConflictError, type DueTicket, type LeadDetail, type LeadPatch, type LeadRow, type LeadsStore, type ListOptions, type NewLead } from "../../leads/types";

export class FakeLeadsStore implements LeadsStore {
  leads: Lead[] = [];
  events: LeadEvent[] = [];
  tickets: LeadTicket[] = [];
  claims: LeadClaim[] = [];
  private seq = { lead: 0, event: 0, ticket: 0, claim: 0 };
  private tick = 0;
  /** Make every write throw (to prove a read tool never writes). */
  constructor(private readOnly: () => boolean = () => false) {}

  private now() { return new Date(Date.UTC(2026, 9, 3, 12, 0, 0) + ++this.tick * 1000); }
  private w() { if (this.readOnly()) throw new Error("WRITE ATTEMPTED BY A READ-ONLY TOOL"); }
  private mine(orgId: string, id: number) { return this.leads.find((l) => l.id === id && l.organizationId === orgId); }
  private live(orgId: string) { return this.leads.filter((l) => l.organizationId === orgId && !l.archivedAt); }
  private copy<T extends object | undefined>(r: T): T { return (r ? ({ ...r } as T) : r); }

  /** Test setup: a lead in any state, written directly (bypasses the read-only tripwire and the stage machine). */
  seed(orgId: string, over: Partial<Lead> = {}): Lead {
    const t = this.now();
    const name = over.companyName ?? `Lead ${this.seq.lead + 1}`;
    const lead: Lead = {
      id: ++this.seq.lead, organizationId: orgId, ownerUserId: "u1", companyName: name, website: null, domain: null, industry: null, location: null, sizeHint: null,
      source: "manual", status: "new", statusChangedAt: t, fitSummary: null, estValueMinor: null, currency: null, contactName: null, contactRole: null, contactEmail: null,
      contactSource: null, doNotContact: false, lostReason: null, converting: false, convertedDealId: null, archivedAt: null, createdAt: t, updatedAt: t, ...over,
    };
    this.leads.push(lead);
    return lead;
  }

  async list(orgId: string, o: ListOptions): Promise<{ rows: LeadRow[]; total: number }> {
    const q = o.q?.trim().toLowerCase();
    const all = this.leads
      .filter((l) => l.organizationId === orgId && (o.includeArchived || !l.archivedAt) && (!o.status || l.status === o.status)
        && (!q || l.companyName.toLowerCase().includes(q) || (l.domain ?? "").includes(q)))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || b.id - a.id);
    const rows = all.slice(o.offset, o.offset + o.limit).map((l): LeadRow => {
      const open = this.tickets.filter((t) => t.leadId === l.id && t.organizationId === orgId && t.status === "open")
        .sort((a, b) => (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity) || a.id - b.id)[0];
      return { ...l, nextTicket: open ? { id: open.id, title: open.title, dueAt: open.dueAt } : null };
    });
    return { rows, total: all.length };
  }

  async counts(orgId: string) {
    const out: Record<string, number> = {};
    for (const l of this.live(orgId)) out[l.status] = (out[l.status] ?? 0) + 1;
    return out;
  }

  async dueTickets(orgId: string, until: Date, limit: number): Promise<DueTicket[]> {
    return this.tickets
      .filter((t) => t.organizationId === orgId && t.status === "open" && t.dueAt && t.dueAt.getTime() <= until.getTime())
      .map((t) => ({ t, l: this.mine(orgId, t.leadId) }))
      .filter(({ l }) => l && !l.archivedAt && (OPEN_STATUSES as readonly string[]).includes(l.status))
      .sort((a, b) => a.t.dueAt!.getTime() - b.t.dueAt!.getTime() || a.t.id - b.t.id)
      .slice(0, limit)
      .map(({ t, l }) => ({ id: t.id, title: t.title, kind: t.kind, dueAt: t.dueAt!, leadId: l!.id, companyName: l!.companyName, leadStatus: l!.status }));
  }

  async get(orgId: string, id: number) { return this.copy(this.mine(orgId, id)) ?? null; }

  async detail(orgId: string, id: number): Promise<LeadDetail | null> {
    const lead = this.mine(orgId, id);
    if (!lead) return null;
    return {
      lead: { ...lead },
      events: this.events.filter((e) => e.leadId === id && e.organizationId === orgId).sort((a, b) => b.id - a.id),
      tickets: this.tickets.filter((t) => t.leadId === id && t.organizationId === orgId),
      claims: this.claims.filter((c) => c.leadId === id && c.organizationId === orgId),
    };
  }

  async findByDomain(orgId: string, domain: string) { return this.copy(this.live(orgId).find((l) => l.domain === domain)) ?? null; }
  async findByName(orgId: string, name: string) { return this.copy(this.live(orgId).find((l) => l.companyName.toLowerCase() === name.trim().toLowerCase())) ?? null; }

  async insert(orgId: string, d: NewLead): Promise<Lead> {
    this.w();
    if (d.domain) {
      const dup = this.live(orgId).find((l) => l.domain === d.domain);
      if (dup) throw new LeadConflictError(dup.id);
    }
    const t = this.now();
    const lead: Lead = {
      id: ++this.seq.lead, organizationId: orgId, ownerUserId: d.ownerUserId, companyName: d.companyName,
      website: d.website ?? null, domain: d.domain ?? null, industry: d.industry ?? null, location: d.location ?? null, sizeHint: d.sizeHint ?? null,
      source: d.source, status: "new", statusChangedAt: t, fitSummary: d.fitSummary ?? null,
      estValueMinor: d.estValueMinor ?? null, currency: d.currency ?? null,
      contactName: d.contactName ?? null, contactRole: d.contactRole ?? null, contactEmail: d.contactEmail ?? null, contactSource: d.contactSource ?? null,
      doNotContact: false, lostReason: null, converting: false, convertedDealId: null, archivedAt: null, createdAt: t, updatedAt: t,
    };
    this.leads.push(lead);
    return { ...lead };
  }

  async update(orgId: string, id: number, patch: LeadPatch): Promise<Lead | null> {
    this.w();
    const lead = this.mine(orgId, id);
    if (!lead) return null;
    if (patch.domain) {
      const dup = this.live(orgId).find((l) => l.domain === patch.domain && l.id !== id);
      if (dup) throw new LeadConflictError(dup.id);
    }
    Object.assign(lead, patch, { updatedAt: this.now() });
    return { ...lead };
  }

  async setStatus(orgId: string, id: number, from: LeadStatus, to: LeadStatus, lostReason?: string | null): Promise<Lead | null> {
    this.w();
    const lead = this.mine(orgId, id);
    if (!lead || lead.status !== from || lead.archivedAt || lead.converting) return null;
    Object.assign(lead, { status: to, statusChangedAt: this.now(), updatedAt: this.now(), lostReason: to === "lost" ? (lostReason ?? null) : null });
    return { ...lead };
  }

  async archive(orgId: string, id: number): Promise<Lead | null> {
    this.w();
    const lead = this.mine(orgId, id);
    if (!lead || lead.archivedAt || lead.converting) return null;
    Object.assign(lead, { archivedAt: this.now(), updatedAt: this.now() });
    return { ...lead };
  }

  async addEvent(orgId: string, leadId: number, e: Parameters<LeadsStore["addEvent"]>[2]) {
    this.w();
    this.events.push({ id: ++this.seq.event, leadId, organizationId: orgId, kind: e.kind, data: e.data ?? null, actor: e.actor, actorUserId: e.actorUserId ?? null, createdAt: this.now() });
    const lead = this.mine(orgId, leadId);
    if (lead) lead.updatedAt = this.now();
  }

  async addTicket(orgId: string, leadId: number, t: Parameters<LeadsStore["addTicket"]>[2]): Promise<LeadTicket> {
    this.w();
    const row: LeadTicket = { id: ++this.seq.ticket, leadId, organizationId: orgId, title: t.title, kind: t.kind, status: "open", dueAt: t.dueAt ?? null, createdBy: t.createdBy, doneAt: null, createdAt: this.now() };
    this.tickets.push(row);
    return { ...row };
  }

  async getTicket(orgId: string, leadId: number, ticketId: number) {
    return this.copy(this.tickets.find((t) => t.id === ticketId && t.leadId === leadId && t.organizationId === orgId)) ?? null;
  }

  async closeTicket(orgId: string, leadId: number, ticketId: number, status: "done" | "cancelled"): Promise<LeadTicket | null> {
    this.w();
    const t = this.tickets.find((x) => x.id === ticketId && x.leadId === leadId && x.organizationId === orgId && x.status === "open");
    if (!t) return null;
    Object.assign(t, { status, doneAt: this.now() });
    return { ...t };
  }

  async addClaim(orgId: string, leadId: number, c: Parameters<LeadsStore["addClaim"]>[2]): Promise<LeadClaim> {
    this.w();
    const row: LeadClaim = { id: ++this.seq.claim, leadId, organizationId: orgId, field: c.field, value: c.value, status: c.status, evidenceUrl: c.evidenceUrl ?? null, evidenceSnippet: c.evidenceSnippet ?? null, source: c.source, retrievedAt: this.now(), createdAt: this.now() };
    this.claims.push(row);
    return { ...row };
  }

  async beginConversion(orgId: string, id: number, convertibleFrom: readonly LeadStatus[]): Promise<Lead | null> {
    this.w();
    const lead = this.mine(orgId, id);
    if (!lead || lead.converting || lead.convertedDealId || lead.archivedAt || !convertibleFrom.includes(lead.status as LeadStatus)) return null;
    Object.assign(lead, { converting: true, updatedAt: this.now() });
    return { ...lead };
  }

  async finishConversion(orgId: string, id: number, dealId: number): Promise<Lead | null> {
    this.w();
    const lead = this.mine(orgId, id);
    if (!lead || !lead.converting) return null;
    Object.assign(lead, { converting: false, convertedDealId: dealId, status: "won", statusChangedAt: this.now(), updatedAt: this.now(), lostReason: null });
    return { ...lead };
  }

  async abortConversion(orgId: string, id: number): Promise<void> {
    this.w();
    const lead = this.mine(orgId, id);
    if (lead && lead.converting && !lead.convertedDealId) lead.converting = false;
  }
}
