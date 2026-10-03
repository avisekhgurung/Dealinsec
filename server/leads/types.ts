/**
 * The lead store's contract. The database implementation is store.ts; the
 * evaluation suite uses an in-memory one with the same semantics, so this file
 * holds only types and is safe to import anywhere.
 *
 * Every method is scoped by organization: a lead, ticket or claim in another
 * organization behaves exactly like one that doesn't exist.
 */
import type { Lead, LeadClaim, LeadEvent, LeadTicket } from "@shared/schema";
import type { LeadStatus } from "@shared/leads";

export interface NewLead {
  ownerUserId: string;
  companyName: string;
  website?: string | null;
  domain?: string | null;
  industry?: string | null;
  location?: string | null;
  sizeHint?: string | null;
  source: string;
  fitSummary?: string | null;
  estValueMinor?: number | null;
  currency?: string | null;
  contactName?: string | null;
  contactRole?: string | null;
  contactEmail?: string | null;
  contactSource?: string | null;
}

export type LeadPatch = Partial<Omit<NewLead, "ownerUserId" | "source">> & { doNotContact?: boolean; lostReason?: string | null };

export interface ListOptions {
  status?: LeadStatus;
  q?: string;
  limit: number;
  offset: number;
  includeArchived?: boolean;
}

export type LeadRow = Lead & { nextTicket: { id: number; title: string; dueAt: Date | null } | null };

/** An open, dated next step on a lead that is still being worked. */
export interface DueTicket {
  id: number; title: string; kind: string; dueAt: Date; leadId: number; companyName: string; leadStatus: string;
}

export interface LeadDetail {
  lead: Lead;
  events: LeadEvent[];
  tickets: LeadTicket[];
  claims: LeadClaim[];
}

/** Thrown when a live lead for the same company already exists. */
export class LeadConflictError extends Error {
  constructor(readonly existingId: number) {
    super("A lead for this company already exists.");
    this.name = "LeadConflictError";
  }
}

export interface LeadsStore {
  list(orgId: string, opts: ListOptions): Promise<{ rows: LeadRow[]; total: number }>;
  counts(orgId: string): Promise<Record<string, number>>;
  /** Open dated tickets due on or before `until`, on open, unarchived leads, soonest first. */
  dueTickets(orgId: string, until: Date, limit: number): Promise<DueTicket[]>;
  get(orgId: string, id: number): Promise<Lead | null>;
  detail(orgId: string, id: number): Promise<LeadDetail | null>;
  findByDomain(orgId: string, domain: string): Promise<Lead | null>;
  findByName(orgId: string, name: string): Promise<Lead | null>;

  insert(orgId: string, data: NewLead): Promise<Lead>;
  update(orgId: string, id: number, patch: LeadPatch): Promise<Lead | null>;
  /** Compare-and-set: moves the lead only if it is still in `from`. Null when it isn't (changed meanwhile) or doesn't exist. */
  setStatus(orgId: string, id: number, from: LeadStatus, to: LeadStatus, lostReason?: string | null): Promise<Lead | null>;
  archive(orgId: string, id: number): Promise<Lead | null>;

  addEvent(orgId: string, leadId: number, e: { kind: string; data?: Record<string, unknown> | null; actor: "user" | "agent"; actorUserId?: string | null }): Promise<void>;

  addTicket(orgId: string, leadId: number, t: { title: string; kind: string; dueAt?: Date | null; createdBy: "user" | "agent" }): Promise<LeadTicket>;
  getTicket(orgId: string, leadId: number, ticketId: number): Promise<LeadTicket | null>;
  /** Only an OPEN ticket can be closed; null if it isn't open (already done) or doesn't exist. */
  closeTicket(orgId: string, leadId: number, ticketId: number, status: "done" | "cancelled"): Promise<LeadTicket | null>;

  addClaim(orgId: string, leadId: number, c: { field: string; value: string; status: string; evidenceUrl?: string | null; evidenceSnippet?: string | null; source: "user" | "agent" }): Promise<LeadClaim>;

  /** Atomically takes the right to convert. Null if the lead isn't convertible now (wrong stage, archived, already converting or converted). */
  beginConversion(orgId: string, id: number, convertibleFrom: readonly LeadStatus[]): Promise<Lead | null>;
  finishConversion(orgId: string, id: number, dealId: number): Promise<Lead | null>;
  abortConversion(orgId: string, id: number): Promise<void>;
}
