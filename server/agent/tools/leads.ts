/**
 * Lead-pipeline tools. A lead is a company the user is pursuing; the agent can
 * capture them, move them through the stages, keep notes and next-action
 * tickets, store evidence-backed facts, and — with the user's approval —
 * close a lead as won by creating its deal.
 *
 * Every tool wraps server/services/leads.ts, the same code the /api/leads
 * routes run, so the agent has exactly the app's permissions and rules. The
 * tools add three things of their own, all about not inventing:
 *   - a company, a contact or an email is only ever what the user (or a
 *     confirmed source) supplied;
 *   - a "confirmed" fact must carry its URL and the words from the page;
 *   - a lead is won ONLY by converting it to a deal, and that always asks.
 */
import { z } from "zod";
import { CONVERTIBLE_FROM, LEAD_STATUSES, MAX_BATCH, TICKET_KINDS, CLAIM_STATUSES, leadStatusLabels, type LeadStatus } from "@shared/leads";
import { hasActiveDealBoost, hasProAccess, type Lead } from "@shared/schema";
import { getBillingUser } from "../../entitlements";
import { buildDealDraft } from "../../copilot/proposals";
import {
  addClaim, addNote, archiveLead, closeTicket, convertToDeal, createLead, createLeads, createTicket, getLead, listLeads,
  listFollowUps, moveLead, planMove, prepareNewLead, previewConversion, updateLead,
} from "../../services/leads";
import { prospectMatch, prospectsNamed } from "../../outbound/lead-angle";
import { allOf, needsPermission, needsRead } from "../policy";
import type { AgentTool, ToolContext, ToolOutcome } from "../types";
import { dateLabel, fail, money, settingsFor } from "./shared";

const canWrite = needsPermission("deals.create", "changing leads");
const readLeads = needsRead("deals");
const who = (ctx: ToolContext) => ctx.user as any;
const stageLabel = (s: string) => leadStatusLabels[s as LeadStatus] ?? s;
const route = (id: number) => `/leads/${id}`;
const failFrom = (r: { code: string; message: string }): Extract<ToolOutcome, { ok: false }> => fail(r.code, r.message);

/** Fields a lead can carry. Every one is optional except the company name, and none is ever guessed. */
const leadFields = {
  companyName: z.string().describe("The company's name, exactly as the user gave it"),
  website: z.string().optional().describe("The company's website or domain, only if given"),
  industry: z.string().optional(),
  location: z.string().optional(),
  sizeHint: z.string().optional().describe("For example '10-50 people', only if given"),
  fitSummary: z.string().optional().describe("Why this company may need the user's service, in the user's own terms"),
  estValueMajor: z.number().optional().describe("Estimated deal value in whole currency units, only if the user gave one"),
  contactName: z.string().optional().describe("Only a name the user gave. Never guess a contact."),
  contactRole: z.string().optional(),
  contactEmail: z.string().optional().describe("Only an email the user gave. NEVER construct or guess one."),
  contactSource: z.string().optional().describe("Where the contact came from, if given"),
};

async function valueLabel(ctx: ToolContext, l: Pick<Lead, "estValueMinor" | "currency">): Promise<string | null> {
  return l.estValueMinor ? money(l.estValueMinor, await settingsFor(ctx), l.currency) : null;
}

async function leadCard(ctx: ToolContext, title: string, rows: (Lead & { nextTicket?: { title: string; dueAt: Date | null } | null })[]) {
  const leads = await Promise.all(rows.map(async (l) => ({
    id: l.id, company: l.companyName, stage: l.status, stageLabel: stageLabel(l.status), route: route(l.id),
    value: await valueLabel(ctx, l), next: l.nextTicket ? { title: l.nextTicket.title, due: dateLabel(l.nextTicket.dueAt) } : null,
  })));
  return { kind: "lead" as const, data: { title, leads } };
}

const line = (label: string, value: string | null | undefined) => (value ? [{ label, value }] : []);

// ── reads ──────────────────────────────────────────────────────────────────

const listLeadsTool: AgentTool<{ status?: LeadStatus; query?: string; limit?: number }> = {
  name: "list_leads",
  description: "List the user's leads, newest activity first, with each lead's stage and next ticket, plus how many leads are in each stage. Filter by stage or search by company name or website.",
  risk: "READ_ONLY", activity: "searching",
  input: z.object({ status: z.enum(LEAD_STATUSES).optional(), query: z.string().optional(), limit: z.number().int().min(1).max(50).optional() }),
  authorize: readLeads,
  async run(ctx, { status, query, limit }): Promise<ToolOutcome> {
    const r = await listLeads(who(ctx), { status, q: query, limit: limit ?? 20 });
    if (!r.ok) return failFrom(r);
    const counts = LEAD_STATUSES.filter((s) => r.counts[s]).map((s) => `${stageLabel(s)} ${r.counts[s]}`).join(", ") || "none yet";
    if (!r.rows.length) {
      // A company that isn't a lead may be a PROSPECT AI Outbound found: say so here, where the agent is looking.
      const found = query ? await prospectsNamed(who(ctx).organizationId, query) : [];
      const hint = found.length
        ? `\nBut ${found.length === 1 ? "a prospect" : "prospects"} from a prospect search match${found.length === 1 ? "es" : ""} "${query}":\n${found.map((p) => `- [${p.id}] ${p.name} (${p.domain})${p.leadId ? ` — already lead ${p.leadId}` : p.aside ? ` — set aside (${p.aside})` : ""}`).join("\n")}\nUse get_prospect_intelligence for what is known, and add_prospect_to_leads (not create_lead) to add one.`
        : "";
      return { ok: true, route: "/leads", summary: `No leads match. Leads by stage: ${counts}.${hint}` };
    }
    const lines = r.rows.map((l) => `- [${l.id}] ${l.companyName} — ${stageLabel(l.status)}${l.nextTicket ? `; next: ${l.nextTicket.title}${l.nextTicket.dueAt ? ` (due ${dateLabel(l.nextTicket.dueAt)})` : ""}` : ""}`);
    return {
      ok: true, route: "/leads", cards: [await leadCard(ctx, "Leads", r.rows)],
      summary: `${r.total} lead${r.total === 1 ? "" : "s"} (showing ${r.rows.length}). By stage: ${counts}.\n${lines.join("\n")}`,
    };
  },
};

const getLeadTool: AgentTool<{ leadId: number }> = {
  name: "get_lead",
  description: "Everything about ONE lead: its details, stage and the stages it can move to, open tickets, recorded facts with how well each is evidenced, and the recent timeline.",
  risk: "READ_ONLY", activity: "searching",
  input: z.object({ leadId: z.number().describe("Lead id") }),
  authorize: readLeads,
  async run(ctx, { leadId }): Promise<ToolOutcome> {
    const r = await getLead(who(ctx), leadId);
    if (!r.ok) return failFrom(r);
    const { lead, tickets, claims, events } = r.detail;
    const value = await valueLabel(ctx, lead);
    const open = tickets.filter((t) => t.status === "open");
    const out = [
      `${lead.companyName} — ${stageLabel(lead.status)}${lead.archivedAt ? " (archived)" : ""}${lead.convertedDealId ? ` · deal #${lead.convertedDealId}` : ""}`,
      ...[["Website", lead.website], ["Industry", lead.industry], ["Location", lead.location], ["Size", lead.sizeHint], ["Estimated value", value],
        ["Why it fits", lead.fitSummary], ["Contact", [lead.contactName, lead.contactRole, lead.contactEmail].filter(Boolean).join(", ") || null],
        ["Do not contact", lead.doNotContact ? "yes" : null], ["Lost because", lead.lostReason]]
        .filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`),
      r.moves.length ? `Can move to: ${r.moves.map(stageLabel).join(", ")}.` : "No stage moves available.",
      r.canConvert ? "It can be turned into a deal." : "",
      open.length ? `Open tickets:\n${open.map((t) => `- [${t.id}] ${t.title} (${t.kind}${t.dueAt ? `, due ${dateLabel(t.dueAt)}` : ""})`).join("\n")}` : "No open tickets.",
      claims.length ? `Facts on record:\n${claims.map((c) => `- ${c.field}: ${c.value} [${c.status}${c.evidenceUrl ? ` — ${c.evidenceUrl}` : ""}]`).join("\n")}` : "No facts recorded yet.",
      events.length ? `Recent timeline:\n${events.slice(0, 8).map((e) => `- ${dateLabel(e.createdAt)} ${e.kind.replace("_", " ")}${e.kind === "note" ? `: ${String((e.data as any)?.text ?? "").slice(0, 200)}` : ""}`).join("\n")}` : "",
    ].filter(Boolean);
    return { ok: true, route: route(lead.id), cards: [await leadCard(ctx, lead.companyName, [lead])], summary: out.join("\n") };
  },
};

const followUpsTool: AgentTool<{ days?: number }> = {
  name: "get_lead_followups",
  description: "What to do on the lead pipeline: next steps that are overdue, due today, and coming up (default the next 7 days), each with its lead. Use for 'what should I do today', 'what's due', 'who do I need to follow up with'.",
  risk: "READ_ONLY", activity: "searching",
  input: z.object({ days: z.number().int().min(1).max(30).optional().describe("How many days ahead to include; default 7") }),
  authorize: readLeads,
  async run(ctx, { days }): Promise<ToolOutcome> {
    const r = await listFollowUps(who(ctx), { days });
    if (!r.ok) return failFrom(r);
    const all = [...r.overdue, ...r.dueToday, ...r.upcoming];
    if (!all.length) return { ok: true, route: "/leads", summary: `Nothing is due on your leads in the next ${days ?? 7} days. Leads with no dated next step won't appear here.` };
    const line = (f: (typeof all)[number]) => `- [lead ${f.leadId}] ${f.companyName} (${stageLabel(f.leadStatus)}): ${f.title} — ${f.due}`;
    const section = (name: string, xs: typeof all) => (xs.length ? `${name} (${xs.length}):\n${xs.map(line).join("\n")}` : "");
    const items = all.map((f) => ({ id: f.leadId, company: f.companyName, stage: f.leadStatus, stageLabel: stageLabel(f.leadStatus), route: route(f.leadId), value: null, next: { title: f.title, due: f.due } }));
    return {
      ok: true, route: "/leads", cards: [{ kind: "lead", data: { title: "Follow-ups", leads: items } }],
      summary: [`Today is ${r.today}.`, section("Overdue", r.overdue), section("Due today", r.dueToday), section("Coming up", r.upcoming)].filter(Boolean).join("\n"),
    };
  },
};

// ── create ─────────────────────────────────────────────────────────────────

const createLeadTool: AgentTool<z.infer<z.ZodObject<typeof leadFields>>> = {
  name: "create_lead",
  description: "Add ONE company to the lead pipeline as a new lead. Use only details the user gave: never invent a website, a contact, an email, a size or a value. For several companies use create_leads. Duplicates (same website or name) are refused.",
  risk: "SAFE_MUTATION",
  input: z.object(leadFields),
  authorize: canWrite,
  async prepare(ctx, input) {
    // A company AI Outbound already found is added with its evidence (add_prospect_to_leads), never again from just its name.
    const hit = await prospectMatch(who(ctx).organizationId, { companyName: String(input.companyName ?? ""), website: input.website });
    if (hit && !hit.leadId) {
      return hit.rejectLabel
        ? { ok: false, code: "prospect_set_aside", message: `${hit.name} was found by a prospect search and set aside (${hit.rejectLabel}), so it isn't added automatically. Tell the user why; they can add it themselves from the Leads page if they still want it.` }
        : { ok: false, code: "is_prospect", message: `${hit.name} is already one of the user's prospects (id ${hit.id}). Call add_prospect_to_leads with prospectId ${hit.id} now, in this turn: the approval card is the user's confirmation, so don't ask first. It brings the evidence along.` };
    }
    const r = await prepareNewLead(who(ctx), input);
    if (!r.ok) return { ok: false, code: r.code, message: r.message, ...(typeof r.existingId === "number" ? { route: route(r.existingId) } : {}) };
    const f = r.fields;
    return {
      ok: true, args: input as Record<string, unknown>,
      preview: {
        title: `Add lead: ${f.companyName}`,
        lines: [{ label: "Company", value: f.companyName }, ...line("Website", r.domain), ...line("Industry", f.industry), ...line("Location", f.location),
          ...line("Estimated value", r.estValueMinor ? money(r.estValueMinor, await settingsFor(ctx), r.currency) : null),
          ...line("Contact", [f.contactName, f.contactRole, f.contactEmail].filter(Boolean).join(", ")), ...line("Why it fits", f.fitSummary)],
        effects: ["Adds it to your pipeline as a New lead. Nothing is sent to the company."],
      },
    };
  },
  async execute(ctx, args): Promise<ToolOutcome> {
    const r = await createLead(who(ctx), args, { source: "agent", actor: "agent" });
    if (!r.ok) return failFrom(r);
    return { ok: true, route: route(r.lead.id), cards: [await leadCard(ctx, "Lead added", [r.lead])], summary: `Added ${r.lead.companyName} as a new lead (id ${r.lead.id}).` };
  },
};

const createLeadsTool: AgentTool<{ leads: z.infer<z.ZodObject<typeof leadFields>>[] }> = {
  name: "create_leads",
  description: `Add SEVERAL companies to the pipeline in one step (up to ${MAX_BATCH}); one approval covers all of them. Same rule as create_lead: only details the user gave, nothing invented. Duplicates are skipped and reported.`,
  risk: "SAFE_MUTATION",
  input: z.object({ leads: z.array(z.object(leadFields)).min(1).max(MAX_BATCH) }),
  authorize: canWrite,
  async prepare(ctx, { leads }) {
    const ok: typeof leads = [];
    const skipped: string[] = [];
    const seen = new Set<string>();
    for (const item of leads) {
      const key = (item.website || item.companyName).trim().toLowerCase();
      const r = await prepareNewLead(who(ctx), item);
      if (!r.ok) { skipped.push(`${item.companyName || "(no name)"}: ${r.message}`); continue; }
      const k2 = r.domain ?? r.fields.companyName.toLowerCase();
      if (seen.has(k2) || seen.has(key)) { skipped.push(`${item.companyName}: listed twice.`); continue; }
      seen.add(k2); seen.add(key);
      ok.push(item);
    }
    if (!ok.length) return { ok: false, code: "nothing_to_add", message: `None of these can be added. ${skipped.join(" ")}` };
    return {
      ok: true, args: { leads: ok },
      preview: {
        title: `Add ${ok.length} lead${ok.length === 1 ? "" : "s"}`,
        lines: ok.map((l) => ({ label: l.companyName, value: [l.website, l.industry, l.location].filter(Boolean).join(" · ") || "New lead" })),
        effects: ["Adds them to your pipeline as New leads. Nothing is sent to any company.", ...(skipped.length ? [`Skipped: ${skipped.join(" ")}`] : [])],
      },
    };
  },
  async execute(ctx, args): Promise<ToolOutcome> {
    const r = await createLeads(who(ctx), (args.leads as unknown[]) ?? [], { source: "agent", actor: "agent" });
    if (!r.ok) return failFrom(r);
    if (!r.created.length) return fail("nothing_added", `Nothing was added. ${r.skipped.map((s) => `${s.companyName}: ${s.message}`).join(" ")}`);
    return {
      ok: true, route: "/leads", cards: [await leadCard(ctx, "Leads added", r.created)],
      summary: `Added ${r.created.length} lead${r.created.length === 1 ? "" : "s"}: ${r.created.map((l) => `${l.companyName} (id ${l.id})`).join(", ")}.` +
        (r.skipped.length ? ` Skipped ${r.skipped.length}: ${r.skipped.map((s) => `${s.companyName} — ${s.message}`).join(" ")}` : ""),
    };
  },
};

// ── change ─────────────────────────────────────────────────────────────────

const updateInput = z.object({
  leadId: z.number(),
  ...Object.fromEntries(Object.entries(leadFields).map(([k, v]) => [k, (v as z.ZodTypeAny).optional()])),
  doNotContact: z.boolean().optional().describe("Mark true when the company or contact asked not to be contacted"),
}) as z.ZodType<{ leadId: number; doNotContact?: boolean } & Partial<z.infer<z.ZodObject<typeof leadFields>>>>;

const updateLeadTool: AgentTool<z.infer<typeof updateInput>> = {
  name: "update_lead",
  description: "Change details of a lead (name, website, industry, location, size, why it fits, estimated value, contact, do-not-contact). Only values the user gave. To record a researched fact with its source, use add_lead_claim instead.",
  risk: "SAFE_MUTATION",
  input: updateInput,
  authorize: canWrite,
  async prepare(ctx, input) {
    const { leadId, ...changes } = input;
    const d = await getLead(who(ctx), leadId);
    if (!d.ok) return { ok: false, code: d.code, message: d.message };
    const lead = d.detail.lead;
    if (lead.archivedAt) return { ok: false, code: "archived", message: "That lead is archived." };
    const lines = Object.entries(changes).filter(([, v]) => v !== undefined).map(([k, v]) => ({ label: k.replace(/([A-Z])/g, " $1").toLowerCase(), value: String(v) }));
    if (!lines.length) return { ok: false, code: "no_change", message: "There's nothing to change." };
    return { ok: true, args: input as Record<string, unknown>, preview: { title: `Update lead: ${lead.companyName}`, lines, effects: ["Nothing is sent to the company."] } };
  },
  async execute(ctx, args): Promise<ToolOutcome> {
    const { leadId, ...changes } = args as { leadId: number } & Record<string, unknown>;
    const r = await updateLead(who(ctx), Number(leadId), changes, { actor: "agent" });
    return r.ok ? { ok: true, route: route(r.lead.id), summary: `Updated ${r.lead.companyName}.` } : failFrom(r);
  },
};

const moveInput = z.object({
  leadId: z.number(),
  to: z.enum(LEAD_STATUSES.filter((s) => s !== "won") as [LeadStatus, ...LeadStatus[]]).describe("The stage to move to. A lead is never moved to 'won': use convert_lead_to_deal."),
  lostReason: z.string().optional().describe("When moving to lost: why, in the user's words"),
});

const moveLeadTool: AgentTool<z.infer<typeof moveInput>> = {
  name: "move_lead",
  description: "Move a lead to another stage (new → researching → qualified → contacted → replied → meeting → proposal; or lost; a lost lead can reopen to new). Only the user's say-so moves a lead: never move one because you think it should advance. Not for 'won' — use convert_lead_to_deal.",
  risk: "SAFE_MUTATION",
  input: moveInput,
  authorize: canWrite,
  async prepare(ctx, { leadId, to, lostReason }) {
    const p = await planMove(who(ctx), leadId, to);
    if (!p.ok) return { ok: false, code: p.code, message: p.message };
    return {
      ok: true, args: { leadId, to, ...(lostReason ? { lostReason } : {}) },
      preview: {
        title: `Move ${p.lead.companyName}: ${stageLabel(p.from)} → ${stageLabel(p.to)}`,
        lines: [{ label: "Company", value: p.lead.companyName }, { label: "Stage", value: `${stageLabel(p.from)} → ${stageLabel(p.to)}` }, ...line("Reason", lostReason)],
        effects: ["Only changes the stage. Nothing is sent to the company."],
      },
    };
  },
  async execute(ctx, args): Promise<ToolOutcome> {
    const r = await moveLead(who(ctx), Number(args.leadId), args.to, { actor: "agent", lostReason: args.lostReason as string | undefined });
    return r.ok ? { ok: true, route: route(r.lead.id), summary: `${r.lead.companyName} is now ${stageLabel(r.lead.status)} (was ${stageLabel(r.from)}).` } : failFrom(r);
  },
};

const noteTool: AgentTool<{ leadId: number; text: string }> = {
  name: "add_lead_note",
  description: "Add a note to a lead's timeline, in the user's words (what was said, decided or learned).",
  risk: "SAFE_MUTATION",
  input: z.object({ leadId: z.number(), text: z.string().describe("The note, max 2000 characters") }),
  authorize: canWrite,
  async prepare(ctx, { leadId, text }) {
    const d = await getLead(who(ctx), leadId);
    if (!d.ok) return { ok: false, code: d.code, message: d.message };
    if (!text.trim()) return { ok: false, code: "invalid", message: "Write the note first." };
    return { ok: true, args: { leadId, text }, preview: { title: `Add note: ${d.detail.lead.companyName}`, lines: [{ label: "Note", value: text.trim().slice(0, 300) }], effects: [] } };
  },
  async execute(ctx, args): Promise<ToolOutcome> {
    const r = await addNote(who(ctx), Number(args.leadId), args.text, { actor: "agent" });
    return r.ok ? { ok: true, route: route(r.leadId), summary: "Added the note to the timeline." } : failFrom(r);
  },
};

// ── tickets ────────────────────────────────────────────────────────────────

const ticketInput = z.object({
  leadId: z.number(),
  title: z.string().describe("The next action, for example 'Send intro email' or 'Follow up on proposal'"),
  kind: z.enum(TICKET_KINDS).optional(),
  dueAt: z.string().optional().describe("Due date as YYYY-MM-DD, only if the user gave or implied one you can compute"),
});

const createTicketTool: AgentTool<z.infer<typeof ticketInput>> = {
  name: "create_ticket",
  description: "Create a next-action ticket on a lead: one concrete task with an optional due date. It is a reminder for the user, not something that sends anything.",
  risk: "SAFE_MUTATION",
  input: ticketInput,
  authorize: canWrite,
  async prepare(ctx, input) {
    const d = await getLead(who(ctx), input.leadId);
    if (!d.ok) return { ok: false, code: d.code, message: d.message };
    const lead = d.detail.lead;
    if (lead.archivedAt || lead.status === "won" || lead.status === "lost") return { ok: false, code: "closed", message: "That lead is closed, so it can't take new tickets." };
    if (!input.title.trim()) return { ok: false, code: "invalid", message: "Give the ticket a title." };
    if (input.dueAt && !Number.isFinite(new Date(input.dueAt).getTime())) return { ok: false, code: "invalid", message: "That due date isn't valid." };
    return {
      ok: true, args: input as Record<string, unknown>,
      preview: { title: `Add ticket: ${input.title.trim()}`, lines: [{ label: "Lead", value: lead.companyName }, ...line("Type", input.kind), ...line("Due", input.dueAt)], effects: ["A reminder only. Nothing is sent."] },
    };
  },
  async execute(ctx, args): Promise<ToolOutcome> {
    const { leadId, ...rest } = args as { leadId: number } & Record<string, unknown>;
    const r = await createTicket(who(ctx), Number(leadId), rest, { actor: "agent" });
    return r.ok ? { ok: true, route: route(Number(leadId)), summary: `Added the ticket "${r.ticket.title}" (id ${r.ticket.id})${r.ticket.dueAt ? `, due ${dateLabel(r.ticket.dueAt)}` : ""}.` } : failFrom(r);
  },
};

const completeTicketTool: AgentTool<{ leadId: number; ticketId: number; cancel?: boolean }> = {
  name: "complete_ticket",
  description: "Mark a lead's ticket done (or cancelled, if the user says it is no longer needed). Only when the user says it is done: never assume a task was carried out.",
  risk: "SAFE_MUTATION",
  input: z.object({ leadId: z.number(), ticketId: z.number(), cancel: z.boolean().optional().describe("true to cancel instead of completing") }),
  authorize: canWrite,
  async prepare(ctx, { leadId, ticketId, cancel }) {
    const d = await getLead(who(ctx), leadId);
    if (!d.ok) return { ok: false, code: d.code, message: d.message };
    const t = d.detail.tickets.find((x) => x.id === ticketId);
    if (!t) return { ok: false, code: "not_found", message: "That ticket isn't on this lead." };
    if (t.status !== "open") return { ok: false, code: "not_open", message: `That ticket is already ${t.status}.` };
    return { ok: true, args: { leadId, ticketId, ...(cancel ? { cancel: true } : {}) }, preview: { title: `${cancel ? "Cancel" : "Complete"} ticket: ${t.title}`, lines: [{ label: "Lead", value: d.detail.lead.companyName }], effects: [] } };
  },
  async execute(ctx, args): Promise<ToolOutcome> {
    const r = await closeTicket(who(ctx), Number(args.leadId), Number(args.ticketId), args.cancel ? "cancelled" : "done", { actor: "agent" });
    return r.ok ? { ok: true, route: route(Number(args.leadId)), summary: `Ticket "${r.ticket.title}" is ${r.ticket.status}.` } : failFrom(r);
  },
};

// ── evidence ───────────────────────────────────────────────────────────────

const claimInput = z.object({
  leadId: z.number(),
  field: z.string().describe("What the fact is about, for example 'headcount', 'tech stack', 'hiring', 'funding'"),
  value: z.string().describe("The fact"),
  status: z.enum(CLAIM_STATUSES).describe("confirmed = seen on a page you can cite; inferred = a reasonable guess; unknown; conflicting = sources disagree"),
  evidenceUrl: z.string().optional().describe("REQUIRED when confirmed: the page where it was seen"),
  evidenceSnippet: z.string().optional().describe("REQUIRED when confirmed: the words from that page, copied, not paraphrased"),
});

const claimTool: AgentTool<z.infer<typeof claimInput>> = {
  name: "add_lead_claim",
  description: "Record a fact about a lead's company and how well it is known. 'confirmed' REQUIRES the page URL and the words from the page; with no source, record it as 'inferred' or 'unknown'. Never mark something confirmed because it sounds right.",
  risk: "SAFE_MUTATION",
  input: claimInput,
  authorize: canWrite,
  async prepare(ctx, input) {
    const d = await getLead(who(ctx), input.leadId);
    if (!d.ok) return { ok: false, code: d.code, message: d.message };
    // Same validation the service will apply, so a missing source is caught before the user is asked anything.
    const { claimInputSchema } = await import("@shared/leads");
    const { leadId: _l, ...claim } = input;
    const parsed = claimInputSchema.safeParse(claim);
    if (!parsed.success) return { ok: false, code: "invalid", message: `${parsed.error.issues[0]?.message ?? "That fact isn't valid."} Record it as inferred or unknown if you have no source.` };
    return {
      ok: true, args: input as Record<string, unknown>,
      preview: { title: `Record fact: ${input.field}`, lines: [{ label: "Lead", value: d.detail.lead.companyName }, { label: "Fact", value: input.value }, { label: "Status", value: input.status }, ...line("Source", input.evidenceUrl)], effects: [] },
    };
  },
  async execute(ctx, args): Promise<ToolOutcome> {
    const { leadId, ...claim } = args as { leadId: number } & Record<string, unknown>;
    const r = await addClaim(who(ctx), Number(leadId), claim, { actor: "agent" });
    return r.ok ? { ok: true, route: route(Number(leadId)), summary: `Recorded ${r.claim.field}: ${r.claim.value} (${r.claim.status}).` } : failFrom(r);
  },
};

// ── archive and close ──────────────────────────────────────────────────────

const archiveTool: AgentTool<{ leadId: number }> = {
  name: "archive_lead",
  description: "Hide a lead from the pipeline (it is kept, never deleted). Use when the user says to remove or drop a lead.",
  risk: "SAFE_MUTATION",
  input: z.object({ leadId: z.number() }),
  authorize: canWrite,
  async prepare(ctx, { leadId }) {
    const d = await getLead(who(ctx), leadId);
    if (!d.ok) return { ok: false, code: d.code, message: d.message };
    if (d.detail.lead.archivedAt) return { ok: false, code: "archived", message: "That lead is already archived." };
    if (d.detail.lead.converting) return { ok: false, code: "busy", message: "That lead is being converted to a deal." };
    return { ok: true, args: { leadId }, preview: { title: `Archive lead: ${d.detail.lead.companyName}`, lines: [{ label: "Stage", value: stageLabel(d.detail.lead.status) }], effects: ["Removes it from the pipeline. Nothing is deleted."] } };
  },
  async execute(ctx, args): Promise<ToolOutcome> {
    const r = await archiveLead(who(ctx), Number(args.leadId), { actor: "agent" });
    return r.ok ? { ok: true, route: "/leads", summary: `Archived ${r.lead.companyName}.` } : failFrom(r);
  },
};

const convertInput = z.object({
  leadId: z.number(),
  dealTitle: z.string().optional().describe("Only if the user named the project"),
  dealAmount: z.number().optional().describe("Deal amount in whole currency units. Required unless the lead has an estimated value, and only a value the user gave."),
  startDate: z.string().optional().describe("YYYY-MM-DD, only if given"),
  endDate: z.string().optional().describe("YYYY-MM-DD, only if given"),
  customTerms: z.string().optional().describe("Only terms the user stated"),
});

const convertTool: AgentTool<z.infer<typeof convertInput>> = {
  name: "convert_lead_to_deal",
  description: `Close a lead as WON by creating its deal. The only way a lead becomes won. The lead must be at least Qualified (${CONVERTIBLE_FROM.map(stageLabel).join(", ")}). Needs a deal amount: the user's, or the lead's estimated value. It always asks the user first and shows the deal and its Protection Check.`,
  risk: "CONSEQUENTIAL_MUTATION",
  input: convertInput,
  authorize: allOf(canWrite, readLeads),
  async prepare(ctx, input) {
    const { leadId, ...rest } = input;
    const p = await previewConversion(who(ctx), leadId, rest);
    if (!p.ok) return { ok: false, code: p.code, message: p.message, ...(typeof (p as any).dealId === "number" ? { route: `/deals/${(p as any).dealId}` } : {}) };
    const { built, lead } = p;
    const draft = buildDealDraft(built.data as any, built.amountMajor, built.settings, "");
    const billing = await getBillingUser(who(ctx));
    const spendsCredit = !hasProAccess(billing) && !hasActiveDealBoost(billing);
    return {
      ok: true, args: input as Record<string, unknown>,
      preview: {
        title: `Close ${lead.companyName} and create the deal`,
        lines: [{ label: "Client", value: draft.client }, { label: "Project", value: draft.project }, { label: "Amount", value: draft.amount }, { label: "Lead", value: `${stageLabel(lead.status)} → Won` }],
        effects: [...(spendsCredit ? ["Uses 1 of your Deal Credits for this month."] : []), "Creates the deal and marks the lead Won. Nothing is sent to the client."],
        draft,
      },
    };
  },
  async execute(ctx, args): Promise<ToolOutcome> {
    const { leadId, ...rest } = args as { leadId: number } & Record<string, unknown>;
    const r = await convertToDeal(who(ctx), Number(leadId), rest, { actor: "agent" });
    if (!r.ok) return { ok: false, code: r.code, message: r.message, ...(typeof r.dealId === "number" ? { route: `/deals/${r.dealId}` } : {}) };
    return { ok: true, route: r.route, summary: `${r.lead.companyName} is won. ${r.message}` };
  },
};

export const LEAD_TOOLS: AgentTool<any>[] = [
  listLeadsTool, getLeadTool, followUpsTool, createLeadTool, createLeadsTool, updateLeadTool, moveLeadTool, noteTool,
  createTicketTool, completeTicketTool, claimTool, archiveTool, convertTool,
];
