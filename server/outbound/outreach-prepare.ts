/**
 * "Prepare drafts" for prospects the person selected in the AI Outbound workspace: for each Ready prospect with an
 * address to write to, add it to Leads (the existing path, with its evidence) and write ONE first-message draft (the
 * existing drafting, grounded in the lead's confirmed facts and checked by code). Nothing is sent or approved here:
 * every draft waits in the outreach queue for a person to read, edit and approve.
 *
 * Bounded: PREPARE_MAX prospects per request, one request at a time per person, each prospect on its own (one that
 * fails never stops the others), and the drafting allowance stops the rest as soon as it runs out. A prospect that isn't
 * eligible is skipped with the reason; nothing is made up to fill a gap.
 */
import { PREPARE_MAX, prepareRequestSchema, type PrepareOutcome } from "@shared/outreach-safety";
import { draftOutreach, suppressionBlock } from "../sales/outreach";
import { fail, writeGate, type Result, type Who } from "../services/leads";
import { pipelineDeps, type PipelineDeps } from "./pipeline";
import { addToLeads, prospectCard } from "./service";
import { prospectsTablesReady } from "./store";

const inFlight = new Set<string>();
/** Draft results that mean "nothing to do here", with the person's words; anything else is a failure. */
const SKIP = new Set(["draft_exists", "already_contacted", "do_not_contact", "closed", "suppressed", "no_address", "no_facts", "global_limit", "daily_limit"]);
const STOP = new Set(["global_limit", "daily_limit"]);

export async function prepareOutreach(user: Who, raw: unknown, d: Partial<PipelineDeps> & { draft?: typeof draftOutreach } = {}): Promise<Result<{ results: PrepareOutcome[] }>> {
  const deps = { ...pipelineDeps(), ...d };
  const draft = d.draft ?? draftOutreach;
  const gate = writeGate(user);
  if (gate) return gate;
  const parsed = prepareRequestSchema.safeParse(raw);
  if (!parsed.success) return fail(400, "invalid", `Select between 1 and ${PREPARE_MAX} prospects.`);
  try { if (!(await prospectsTablesReady())) return fail(503, "PROSPECTS_NOT_SETUP", "AI Outbound isn't set up on this server yet."); } catch { return fail(503, "PROSPECTS_NOT_SETUP", "AI Outbound isn't set up on this server yet."); }
  if (inFlight.has(user.id)) return fail(429, "prepare_in_progress", "Drafts are already being prepared. Wait for them to finish.");
  inFlight.add(user.id);
  try {
    const orgId = user.organizationId!, now = deps.now();
    const results: PrepareOutcome[] = [];
    let stopped: { reason: string; message: string } | null = null;
    for (const id of Array.from(new Set(parsed.data.prospectIds))) {
      if (stopped) { results.push({ prospectId: id, outcome: "skipped", ...stopped }); continue; }
      const skip = (reason: string, message: string, extra: { leadId?: number; messageId?: number } = {}) => results.push({ prospectId: id, outcome: "skipped", reason, message, ...extra });
      const p = await deps.store.getProspect(orgId, id);
      if (!p) { skip("not_found", "That company isn't in your workspace."); continue; }
      const fs = await deps.store.findings(orgId, id);
      const card = prospectCard(p, fs, now);
      if (p.status === "rejected") { skip("set_aside", "This company was set aside."); continue; }
      if (card.classification !== "ready") { skip("not_ready", `Not outreach-ready yet${card.blockers.length ? `: missing ${card.blockers.join("; ")}` : ""}.`); continue; }
      // The address: a person's email only when the provider verified it, otherwise the company's own published address.
      const person = card.decisionMaker ?? card.contactPerson;
      const meta = (person?.meta ?? {}) as Record<string, unknown>;
      const verified = person && typeof meta.email === "string" && meta.emailStatus === "verified" ? String(meta.email) : null;
      const company = fs.find((f) => f.kind === "fact" && f.type === "business_email" && f.status === "confirmed")?.value ?? null;
      const address = verified ?? company;
      if (!address) { skip("no_email", "There's no verified person's email and no business email on the company's site."); continue; }
      const listed = await suppressionBlock(orgId, address);
      if (listed && !listed.ok) {
        if (listed.code === "suppressed") { skip("suppressed", listed.message); continue; }
        results.push({ prospectId: id, outcome: "failed", reason: listed.code, message: listed.message }); continue;
      }
      const lead = await addToLeads(user, id, verified && person ? { contactFindingId: person.id } : {}, d);
      if (!lead.ok) { results.push({ prospectId: id, outcome: "failed", reason: lead.code, message: lead.message }); continue; }
      const r = await draft(user, lead.leadId);
      if (r.ok) { results.push({ prospectId: id, outcome: "drafted", leadId: lead.leadId, messageId: r.message.id }); continue; }
      if (STOP.has(r.code)) stopped = { reason: r.code, message: r.message };
      const existing = (r as unknown as { messageId?: unknown }).messageId;
      if (SKIP.has(r.code)) skip(r.code, r.message, { leadId: lead.leadId, ...(typeof existing === "number" ? { messageId: existing } : {}) });
      else results.push({ prospectId: id, outcome: "failed", reason: r.code, message: r.message, leadId: lead.leadId });
    }
    return { ok: true, results };
  } finally {
    inFlight.delete(user.id);
  }
}
