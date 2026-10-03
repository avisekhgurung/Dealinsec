/**
 * The lead pipeline's business rules. The REST routes and the agent's tools
 * both call these functions, so a lead is created, moved, annotated and
 * converted by exactly one piece of code, with the same permission checks and
 * the same validation, whoever asks.
 *
 * Results are `{ ok: true, … }` or `{ ok: false, status, code, message }`: the
 * status is the HTTP status a route would answer with, the code is what a tool
 * or a client can branch on, and the message is safe to show a person.
 */
import { canReadModule, memberCan } from "@shared/permissions";
import {
  CONVERTIBLE_FROM, MAX_BATCH, TICKET_KINDS, allowedMoves, canMove, canConvertFrom, claimInputSchema, isLeadStatus, isOpen,
  leadFieldsSchema, leadStatusLabels, normalizeDomain, type LeadStatus,
} from "@shared/leads";
import { fromMinor, resolveLocaleSettings, toMinor, MAX_AMOUNT_MINOR, type Lead, type LeadClaim, type LeadTicket, type User } from "@shared/schema";
import { z } from "zod";
import { buildDealCandidate, executeCreateDeal } from "../copilot/tools";
import { agentLog } from "../agent/log";
import { leadsStore as store } from "../leads/store";
import { LeadConflictError, type LeadDetail, type LeadRow } from "../leads/types";
import { storage } from "../storage";

type Fail = { ok: false; status: number; code: string; message: string; [extra: string]: unknown };
export type Result<T> = ({ ok: true } & T) | Fail;
export type Actor = "user" | "agent";
type Who = Pick<User, "id" | "organizationId"> & Partial<User>;

const fail = (status: number, code: string, message: string, extra: Record<string, unknown> = {}): Fail => ({ ok: false, status, code, message, ...extra });
const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? "That isn't valid.";

/** Reading leads follows the Deals module: whoever may read deals may read their pipeline. */
function readGate(user: Who): Fail | null {
  if (!user.organizationId) return fail(403, "no_organization", "Finish setting up your workspace first.");
  if (!canReadModule(user as any, "deals")) return fail(403, "forbidden", "Your role doesn't include viewing leads.");
  return null;
}
function writeGate(user: Who): Fail | null {
  const r = readGate(user);
  if (r) return r;
  if (!memberCan(user as any, "deals.create")) return fail(403, "forbidden", "Your role doesn't allow changing leads. Ask your organization owner.");
  return null;
}

async function orgCurrency(user: Who): Promise<string> {
  const org = user.organizationId ? await storage.getOrganization(user.organizationId) : undefined;
  return resolveLocaleSettings(org, user as any).currency;
}

const notFound = () => fail(404, "not_found", "That lead isn't in your organization.");

/* ── create ───────────────────────────────────────────────────────────── */

/** Validate a new lead and look for a duplicate WITHOUT writing: what a tool shows before asking. */
export async function prepareNewLead(user: Who, raw: unknown): Promise<Result<{ fields: ReturnType<typeof leadFieldsSchema.parse>; domain: string | null; estValueMinor: number | null; currency: string | null }>> {
  const gate = writeGate(user);
  if (gate) return gate;
  const parsed = leadFieldsSchema.safeParse(raw);
  if (!parsed.success) return fail(400, "invalid", firstIssue(parsed.error));
  const f = parsed.data;
  const orgId = user.organizationId!;

  const domain = f.website ? normalizeDomain(f.website) : null;
  if (f.website && !domain) return fail(400, "invalid", "That website doesn't look like a web address (for example acme.com).");

  const dup = domain ? await store.findByDomain(orgId, domain) : await store.findByName(orgId, f.companyName);
  if (dup) return fail(409, "duplicate", `You already have a lead for ${dup.companyName}.`, { existingId: dup.id });

  let estValueMinor: number | null = null;
  let currency: string | null = null;
  if (f.estValueMajor !== undefined) {
    currency = await orgCurrency(user);
    estValueMinor = toMinor(currency === "INR" ? Math.round(f.estValueMajor) : f.estValueMajor, currency);
    if (!Number.isFinite(estValueMinor) || estValueMinor <= 0 || estValueMinor > MAX_AMOUNT_MINOR) return fail(400, "invalid", "That isn't a valid estimated value.");
  }
  return { ok: true, fields: f, domain, estValueMinor, currency };
}

export async function createLead(user: Who, raw: unknown, opts: { source?: "manual" | "agent" | "import"; actor?: Actor } = {}): Promise<Result<{ lead: Lead }>> {
  const prep = await prepareNewLead(user, raw);
  if (!prep.ok) return prep;
  const { fields: f, domain, estValueMinor, currency } = prep;
  const orgId = user.organizationId!;
  try {
    const lead = await store.insert(orgId, {
      ownerUserId: user.id, companyName: f.companyName, website: f.website ?? null, domain,
      industry: f.industry ?? null, location: f.location ?? null, sizeHint: f.sizeHint ?? null,
      source: opts.source ?? "manual", fitSummary: f.fitSummary ?? null, estValueMinor, currency,
      contactName: f.contactName ?? null, contactRole: f.contactRole ?? null, contactEmail: f.contactEmail ?? null, contactSource: f.contactSource ?? null,
    });
    await store.addEvent(orgId, lead.id, { kind: "created", data: { source: lead.source }, actor: opts.actor ?? "user", actorUserId: user.id });
    return { ok: true, lead };
  } catch (e) {
    if (e instanceof LeadConflictError) return fail(409, "duplicate", "You already have a lead for this company.", { existingId: e.existingId });
    throw e;
  }
}

export interface BatchOutcome {
  created: Lead[];
  skipped: { companyName: string; code: string; message: string; existingId?: number }[];
}

/** Several leads at once. Duplicates and invalid rows are skipped and reported, never fatal to the rest. */
export async function createLeads(user: Who, items: unknown[], opts: { source?: "manual" | "agent" | "import"; actor?: Actor } = {}): Promise<Result<BatchOutcome>> {
  const gate = writeGate(user);
  if (gate) return gate;
  if (!Array.isArray(items) || !items.length) return fail(400, "invalid", "There are no leads to add.");
  if (items.length > MAX_BATCH) return fail(400, "too_many", `Add at most ${MAX_BATCH} leads at a time.`);
  const out: BatchOutcome = { created: [], skipped: [] };
  for (const item of items) {
    const name = String((item as { companyName?: unknown })?.companyName ?? "").slice(0, 120);
    const r = await createLead(user, item, opts);
    if (r.ok) out.created.push(r.lead);
    else out.skipped.push({ companyName: name, code: r.code, message: r.message, ...(typeof r.existingId === "number" ? { existingId: r.existingId } : {}) });
  }
  return { ok: true, ...out };
}

/* ── read ─────────────────────────────────────────────────────────────── */

export async function listLeads(user: Who, q: { status?: string; q?: string; limit?: number; offset?: number; includeArchived?: boolean } = {}): Promise<Result<{ rows: LeadRow[]; total: number; counts: Record<string, number> }>> {
  const gate = readGate(user);
  if (gate) return gate;
  if (q.status !== undefined && !isLeadStatus(q.status)) return fail(400, "invalid", "That isn't a lead stage.");
  const orgId = user.organizationId!;
  const [{ rows, total }, counts] = await Promise.all([
    store.list(orgId, { status: q.status as LeadStatus | undefined, q: q.q, limit: Math.min(100, Math.max(1, q.limit ?? 50)), offset: Math.max(0, q.offset ?? 0), includeArchived: q.includeArchived }),
    store.counts(orgId),
  ]);
  // A closed lead has no "next step": an old open ticket on a won or lost lead is not a thing to do.
  const shown = rows.map((r) => (isOpen(r.status as LeadStatus) ? r : { ...r, nextTicket: null }));
  return { ok: true, rows: shown, total, counts };
}

export async function getLead(user: Who, id: number): Promise<Result<{ detail: LeadDetail; moves: readonly LeadStatus[]; canConvert: boolean }>> {
  const gate = readGate(user);
  if (gate) return gate;
  const detail = await store.detail(user.organizationId!, id);
  if (!detail) return notFound();
  const { lead } = detail;
  const live = !lead.archivedAt && !lead.converting && !lead.convertedDealId;
  return { ok: true, detail, moves: live ? allowedMoves(lead.status as LeadStatus) : [], canConvert: live && canConvertFrom(lead.status as LeadStatus) };
}

/* ── change ───────────────────────────────────────────────────────────── */

const patchSchema = leadFieldsSchema.partial().extend({ doNotContact: z.boolean().optional() });

export async function updateLead(user: Who, id: number, raw: unknown, opts: { actor?: Actor } = {}): Promise<Result<{ lead: Lead }>> {
  const gate = writeGate(user);
  if (gate) return gate;
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) return fail(400, "invalid", firstIssue(parsed.error));
  const f = parsed.data;
  const orgId = user.organizationId!;
  const current = await store.get(orgId, id);
  if (!current) return notFound();
  if (current.archivedAt) return fail(409, "archived", "That lead is archived.");

  const patch: Record<string, unknown> = {};
  for (const k of ["companyName", "industry", "location", "sizeHint", "fitSummary", "contactName", "contactRole", "contactEmail", "contactSource"] as const) {
    if (f[k] !== undefined) patch[k] = f[k];
  }
  if (f.doNotContact !== undefined) patch.doNotContact = f.doNotContact;
  if (f.website !== undefined) {
    const domain = normalizeDomain(f.website);
    if (!domain) return fail(400, "invalid", "That website doesn't look like a web address (for example acme.com).");
    patch.website = f.website; patch.domain = domain;
  }
  if (f.estValueMajor !== undefined) {
    const currency = await orgCurrency(user);
    const minor = toMinor(currency === "INR" ? Math.round(f.estValueMajor) : f.estValueMajor, currency);
    if (!Number.isFinite(minor) || minor <= 0 || minor > MAX_AMOUNT_MINOR) return fail(400, "invalid", "That isn't a valid estimated value.");
    patch.estValueMinor = minor; patch.currency = currency;
  }
  if (!Object.keys(patch).length) return fail(400, "no_change", "There's nothing to change.");

  try {
    const lead = await store.update(orgId, id, patch);
    if (!lead) return notFound();
    await store.addEvent(orgId, id, { kind: "updated", data: { fields: Object.keys(patch) }, actor: opts.actor ?? "user", actorUserId: user.id });
    return { ok: true, lead };
  } catch (e) {
    if (e instanceof LeadConflictError) return fail(409, "duplicate", "You already have a lead for that website.", { existingId: e.existingId });
    throw e;
  }
}

/** Check a stage move WITHOUT making it: what a tool shows before asking. */
export async function planMove(user: Who, id: number, to: unknown): Promise<Result<{ lead: Lead; from: LeadStatus; to: LeadStatus }>> {
  const gate = writeGate(user);
  if (gate) return gate;
  if (!isLeadStatus(to)) return fail(400, "invalid", "That isn't a lead stage.");
  if (to === "won") return fail(409, "use_convert", "A lead is won by creating its deal. Convert it to a deal instead of moving it.");
  const lead = await store.get(user.organizationId!, id);
  if (!lead) return notFound();
  if (lead.archivedAt) return fail(409, "archived", "That lead is archived.");
  if (lead.converting || lead.convertedDealId) return fail(409, "converted", "That lead has been converted to a deal.");
  const from = lead.status as LeadStatus;
  if (from === to) return fail(409, "no_change", `That lead is already ${leadStatusLabels[from]}.`);
  if (!canMove(from, to)) {
    const next = allowedMoves(from).map((s) => leadStatusLabels[s]).join(", ") || "none";
    return fail(409, "invalid_move", `A ${leadStatusLabels[from]} lead can't go straight to ${leadStatusLabels[to]}. It can move to: ${next}.`, { allowed: allowedMoves(from) });
  }
  return { ok: true, lead, from, to };
}

export async function moveLead(user: Who, id: number, to: unknown, opts: { actor?: Actor; lostReason?: string } = {}): Promise<Result<{ lead: Lead; from: LeadStatus }>> {
  const plan = await planMove(user, id, to);
  if (!plan.ok) return plan;
  const orgId = user.organizationId!;
  const moved = await store.setStatus(orgId, id, plan.from, plan.to, plan.to === "lost" ? opts.lostReason?.trim().slice(0, 300) || null : null);
  if (!moved) return fail(409, "changed", "That lead changed while you were working on it. Reload and try again.");
  await store.addEvent(orgId, id, { kind: "status_changed", data: { from: plan.from, to: plan.to }, actor: opts.actor ?? "user", actorUserId: user.id });
  return { ok: true, lead: moved, from: plan.from };
}

export async function addNote(user: Who, id: number, text: unknown, opts: { actor?: Actor } = {}): Promise<Result<{ leadId: number }>> {
  const gate = writeGate(user);
  if (gate) return gate;
  const parsed = z.string().trim().min(1, "Write the note first.").max(2000, "That note is too long.").safeParse(text);
  if (!parsed.success) return fail(400, "invalid", firstIssue(parsed.error));
  const orgId = user.organizationId!;
  if (!(await store.get(orgId, id))) return notFound();
  await store.addEvent(orgId, id, { kind: "note", data: { text: parsed.data }, actor: opts.actor ?? "user", actorUserId: user.id });
  return { ok: true, leadId: id };
}

const ticketSchema = z.object({
  title: z.string().trim().min(1, "Give the ticket a title.").max(200),
  kind: z.enum(TICKET_KINDS).default("other"),
  dueAt: z.union([z.string(), z.date()]).optional().transform((v, ctx) => {
    if (v === undefined || v === "") return undefined;
    const d = v instanceof Date ? v : new Date(v);
    if (!Number.isFinite(d.getTime())) { ctx.addIssue({ code: "custom", message: "That due date isn't valid." }); return z.NEVER; }
    return d;
  }),
});

export async function createTicket(user: Who, leadId: number, raw: unknown, opts: { actor?: Actor } = {}): Promise<Result<{ ticket: LeadTicket }>> {
  const gate = writeGate(user);
  if (gate) return gate;
  const parsed = ticketSchema.safeParse(raw);
  if (!parsed.success) return fail(400, "invalid", firstIssue(parsed.error));
  const orgId = user.organizationId!;
  const lead = await store.get(orgId, leadId);
  if (!lead) return notFound();
  if (lead.archivedAt || !isOpen(lead.status as LeadStatus)) return fail(409, "closed", "That lead is closed, so it can't take new tickets.");
  const ticket = await store.addTicket(orgId, leadId, { title: parsed.data.title, kind: parsed.data.kind, dueAt: parsed.data.dueAt ?? null, createdBy: opts.actor ?? "user" });
  await store.addEvent(orgId, leadId, { kind: "ticket_created", data: { ticketId: ticket.id, kind: ticket.kind }, actor: opts.actor ?? "user", actorUserId: user.id });
  return { ok: true, ticket };
}

export async function closeTicket(user: Who, leadId: number, ticketId: number, status: "done" | "cancelled" = "done", opts: { actor?: Actor } = {}): Promise<Result<{ ticket: LeadTicket }>> {
  const gate = writeGate(user);
  if (gate) return gate;
  const orgId = user.organizationId!;
  const existing = await store.getTicket(orgId, leadId, ticketId);
  if (!existing) return fail(404, "not_found", "That ticket isn't on this lead.");
  const ticket = await store.closeTicket(orgId, leadId, ticketId, status);
  if (!ticket) return fail(409, "not_open", `That ticket is already ${existing.status}.`);
  await store.addEvent(orgId, leadId, { kind: "ticket_done", data: { ticketId, status }, actor: opts.actor ?? "user", actorUserId: user.id });
  return { ok: true, ticket };
}

export async function addClaim(user: Who, leadId: number, raw: unknown, opts: { actor?: Actor } = {}): Promise<Result<{ claim: LeadClaim }>> {
  const gate = writeGate(user);
  if (gate) return gate;
  const parsed = claimInputSchema.safeParse(raw);
  if (!parsed.success) return fail(400, "invalid", firstIssue(parsed.error));
  const orgId = user.organizationId!;
  if (!(await store.get(orgId, leadId))) return notFound();
  const claim = await store.addClaim(orgId, leadId, { ...parsed.data, source: opts.actor ?? "user" });
  await store.addEvent(orgId, leadId, { kind: "claim_added", data: { field: claim.field, status: claim.status }, actor: opts.actor ?? "user", actorUserId: user.id });
  return { ok: true, claim };
}

export async function archiveLead(user: Who, id: number, opts: { actor?: Actor } = {}): Promise<Result<{ lead: Lead }>> {
  const gate = writeGate(user);
  if (gate) return gate;
  const orgId = user.organizationId!;
  const existing = await store.get(orgId, id);
  if (!existing) return notFound();
  const lead = await store.archive(orgId, id);
  if (!lead) return fail(409, "not_archivable", existing.archivedAt ? "That lead is already archived." : "That lead is being converted to a deal.");
  await store.addEvent(orgId, id, { kind: "archived", actor: opts.actor ?? "user", actorUserId: user.id });
  return { ok: true, lead };
}

/* ── close: create the deal ───────────────────────────────────────────── */

export const convertSchema = z.object({
  dealTitle: z.string().trim().max(200).optional(),
  dealType: z.string().trim().max(40).optional(),
  dealAmount: z.coerce.number().positive().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  deliverables: z.array(z.record(z.unknown())).max(12).optional(),
  customTerms: z.string().max(1200).optional(),
  brandTerms: z.record(z.string()).optional(),
});
export type ConvertInput = z.infer<typeof convertSchema>;

/** The arguments the existing deal builder takes, from the lead and the person's choices. */
export function dealArgsForLead(lead: Lead, input: ConvertInput): Record<string, unknown> {
  const estMajor = lead.estValueMinor && lead.currency ? fromMinor(lead.estValueMinor, lead.currency) : undefined;
  return {
    brandName: lead.companyName,
    dealTitle: input.dealTitle || `Work for ${lead.companyName}`,
    dealAmount: input.dealAmount ?? estMajor,
    ...(input.dealType ? { dealType: input.dealType } : {}),
    ...(input.startDate ? { startDate: input.startDate } : {}),
    ...(input.endDate ? { endDate: input.endDate } : {}),
    ...(input.deliverables ? { deliverables: input.deliverables } : {}),
    ...(input.customTerms ? { customTerms: input.customTerms } : {}),
    ...(input.brandTerms ? { brandTerms: input.brandTerms } : {}),
  };
}

/**
 * Close a lead as WON by creating its deal through the existing deal service
 * (same permission, validation and free-plan credit rules as the Deals page).
 * The lead is claimed with one atomic UPDATE first, so two conversions racing
 * can never make two deals; the claim is released if the deal isn't created.
 */
export async function convertToDeal(user: Who, id: number, raw: unknown, opts: { actor?: Actor } = {}): Promise<Result<{ lead: Lead; dealId: number; route: string; message: string }>> {
  const gate = writeGate(user);
  if (gate) return gate;
  const parsed = convertSchema.safeParse(raw ?? {});
  if (!parsed.success) return fail(400, "invalid", firstIssue(parsed.error));
  const orgId = user.organizationId!;

  const lead = await store.get(orgId, id);
  if (!lead) return notFound();
  if (lead.convertedDealId) return fail(409, "already_converted", "That lead already has a deal.", { dealId: lead.convertedDealId });
  if (lead.archivedAt) return fail(409, "archived", "That lead is archived.");
  if (!canConvertFrom(lead.status as LeadStatus)) {
    return fail(409, "not_convertible", `A ${leadStatusLabels[lead.status as LeadStatus]} lead can't be turned into a deal yet. Move it to ${leadStatusLabels[CONVERTIBLE_FROM[0]]} first.`);
  }

  const args = dealArgsForLead(lead, parsed.data);
  if (args.dealAmount === undefined) return fail(400, "need_amount", "I need the deal amount to create the deal. Give it, or set an estimated value on the lead.");

  const claimed = await store.beginConversion(orgId, id, CONVERTIBLE_FROM);
  if (!claimed) return fail(409, "busy", "That lead is already being converted, or just was. Reload to see it.");

  let result;
  try {
    result = await executeCreateDeal(args, user as User);
  } catch (e) {
    await store.abortConversion(orgId, id);
    throw e;
  }
  if (!result.ok) {
    await store.abortConversion(orgId, id);
    return fail(400, "deal_rejected", result.message);
  }

  const dealId = result.dealId;
  let finished = await store.finishConversion(orgId, id, dealId);
  if (!finished) finished = await store.finishConversion(orgId, id, dealId); // one retry: the deal exists, the link must not be lost
  if (!finished) {
    // Rare and recoverable by hand: the deal exists but the lead wasn't linked. Say so loudly, with ids only.
    agentLog("error", { errorType: "ConversionUnlinked", organizationId: orgId, leadId: id, dealId });
    return fail(500, "unlinked", `The deal was created (#${dealId}) but the lead couldn't be linked to it. Open the deal from the Deals page.`, { dealId });
  }
  await store.addEvent(orgId, id, { kind: "converted", data: { dealId }, actor: opts.actor ?? "user", actorUserId: user.id });
  return { ok: true, lead: finished, dealId, route: result.route, message: result.message };
}

/** Everything the agent's convert tool needs to show before asking: the deal that WOULD be created. */
export async function previewConversion(user: Who, id: number, raw: unknown) {
  const gate = writeGate(user);
  if (gate) return gate;
  const parsed = convertSchema.safeParse(raw ?? {});
  if (!parsed.success) return fail(400, "invalid", firstIssue(parsed.error));
  const lead = await store.get(user.organizationId!, id);
  if (!lead) return notFound();
  if (lead.convertedDealId) return fail(409, "already_converted", "That lead already has a deal.", { dealId: lead.convertedDealId });
  if (lead.archivedAt) return fail(409, "archived", "That lead is archived.");
  if (!canConvertFrom(lead.status as LeadStatus)) {
    return fail(409, "not_convertible", `A ${leadStatusLabels[lead.status as LeadStatus]} lead can't be turned into a deal yet. Move it to ${leadStatusLabels[CONVERTIBLE_FROM[0]]} first.`);
  }
  const args = dealArgsForLead(lead, parsed.data);
  if (args.dealAmount === undefined) return fail(400, "need_amount", "I need the deal amount to create the deal. Ask the user, or set an estimated value on the lead.");
  const built = await buildDealCandidate(args, user as User);
  if (!built.ok) return fail(400, "deal_rejected", built.message);
  return { ok: true as const, lead, args, built, input: parsed.data };
}
