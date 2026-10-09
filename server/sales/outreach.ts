/**
 * Outreach: a model drafts ONE first message to a lead from verified facts, code checks it, and a PERSON
 * approves it. Nothing here sends anything. "Sending" in this version is the person opening the approved
 * message in their own email app (or copying it) and then recording that they sent it; the lead moves to
 * "contacted" only when they say so.
 *
 *   draft -> approved -> sent        (or cancelled from draft/approved)
 *
 * What makes it safe:
 *  - a lead marked do-not-contact, archived or closed cannot be drafted for, approved or edited (checked again
 *    at approval, because the flag may have been set since the draft was written);
 *  - a draft with a price, an invented link or address, a placeholder or a false "as we discussed" is refused
 *    by shared/outreach-check.ts (one retry is allowed, told what to fix) and never stored;
 *  - approval is of ONE text: the approver sends the hash of what they read, and the approval fails if the text
 *    has changed since; editing an approved message returns it to draft;
 *  - every status change is one atomic UPDATE ... WHERE status = <expected>, so a double click does the work once;
 *  - one unsent message per lead (a unique index, not a check);
 *  - the timeline records ids and counts only, never message text.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { checkDraft, checkStructure, issuesForRetry, type Issue } from "@shared/outreach-check";
import { latestPerField, normField, type ScoreClaim } from "@shared/lead-score";
import { dailyLimit, modelFor } from "@shared/llm-cost";
import { canMove, type LeadStatus } from "@shared/leads";
import { siteHost } from "@shared/research";
import type { LeadMessageRow } from "@shared/schema";
import { ProviderError, type ChatMessage } from "../copilot/provider";
import { agentLog } from "../agent/log";
import { parseJsonObject } from "../agent/extraction";
import { leadsStore } from "../leads/store";
import { CapExceeded, CapUnavailable, assertWithinCap, tracedChat } from "../llm/traced";
import { getIdealClient } from "../services/ideal-client";
import { relatedKnowledge } from "../services/knowledge";
import { createTicket, fail, getLead, moveLead, readGate, writeGate, type Result, type Who } from "../services/leads";
import { storage } from "../storage";
import { OUTREACH_PROMPT_VERSION, draftSystemPrompt, draftUserMessage, type DraftInput } from "./outreach-prompt";
import { DraftExists, messageStore, messagesTablesReady, type MessageStore } from "./message-store";
import { researchStore, salesTablesReady } from "./research-store";

export interface OutreachDeps { store: MessageStore; chat: typeof tracedChat; now: () => Date }
const defaults = (): OutreachDeps => ({ store: messageStore, chat: tracedChat, now: () => new Date() });

export const hashDraft = (subject: string, body: string): string => createHash("sha256").update(`${subject.trim()}\n${body.trim()}`).digest("hex");

export interface MessageView {
  id: number; leadId: number; status: LeadMessageRow["status"]; subject: string; body: string; bodyHash: string;
  to: string | null; toSource: string | null; edited: boolean; createdBy: string; createdAt: string; approvedAt: string | null; sentAt: string | null;
}
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
export const messageView = (m: LeadMessageRow): MessageView => ({
  id: m.id, leadId: m.leadId, status: m.status, subject: m.subject ?? "", body: m.body, bodyHash: m.bodyHash, to: m.toAddress, toSource: m.toSource,
  edited: m.edited, createdBy: m.createdBy, createdAt: iso(m.createdAt)!, approvedAt: iso(m.approvedAt), sentAt: iso(m.sentAt),
});

const NOT_SETUP = () => fail(503, "MESSAGES_NOT_SETUP", "Outreach drafts aren't set up on this server yet.");
async function ready(): Promise<boolean> { try { return await messagesTablesReady(); } catch { return false; } }

const EMAIL_SHAPE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
/** Facts a message may be written from (read from the company's own site, or recorded by the person). */
const FACT_FIELDS: Record<string, string> = { description: "What it does", services: "What it offers", industry: "Industry", location: "Based in", recent_news: "Recent news", hiring: "Hiring", launch: "Launch", team_size: "Team size" };
const ANGLE_FIELDS: Record<string, string> = { pain_point: "Possible pain point", opportunity: "Possible opportunity", buying_signal: "Possible buying signal", timing: "Possible timing" };

/** Where a message to this lead would go: the address the person recorded, else a confirmed business address found on the company's own site. */
export function recipientFor(lead: { contactEmail?: string | null }, claims: ScoreClaim[]): { address: string; source: "lead" | "site" } | null {
  const own = lead.contactEmail?.trim();
  if (own && EMAIL_SHAPE.test(own)) return { address: own, source: "lead" };
  const site = latestPerField(claims).find((c) => normField(c.field) === "business_email" && c.status === "confirmed" && EMAIL_SHAPE.test(c.value.trim()));
  return site ? { address: site.value.trim(), source: "site" } : null;
}

/** The verified facts and the guesses a draft may use. Nothing else about the company reaches the model. */
export function draftFacts(claims: ScoreClaim[]): { facts: { id: number; label: string; value: string }[]; angles: { id: number; label: string; value: string }[] } {
  const latest = latestPerField(claims);
  const facts: { id: number; label: string; value: string }[] = [], angles: { id: number; label: string; value: string }[] = [];
  for (const c of latest) {
    const f = normField(c.field);
    if (FACT_FIELDS[f] && c.status === "confirmed") facts.push({ id: c.id, label: FACT_FIELDS[f], value: c.value });
    else if (ANGLE_FIELDS[f] && (c.status === "inferred" || c.status === "confirmed")) angles.push({ id: c.id, label: ANGLE_FIELDS[f], value: c.value });
  }
  return { facts, angles };
}

/** A lead a message may not be written to, approved for, or edited for; null when it is fine. */
const blocked = (lead: { doNotContact?: boolean | null; archivedAt?: Date | string | null; status: string }) =>
  lead.doNotContact ? fail(409, "do_not_contact", "This lead is marked do-not-contact, so no message can be drafted or approved for it.")
    : lead.archivedAt || lead.status === "won" || lead.status === "lost" ? fail(409, "closed", "This lead is closed, so it can't take a message.")
      : null;

const asDraft = (text: string | null): { subject: string; body: string } | null => {
  const raw = parseJsonObject(text) as { subject?: unknown; body?: unknown } | null;
  return raw && typeof raw.subject === "string" && typeof raw.body === "string" ? { subject: raw.subject.trim(), body: raw.body.replace(/\r\n/g, "\n").trim() } : null;
};

export async function listMessages(user: Who, leadId: number, d: Partial<OutreachDeps> = {}): Promise<Result<{ messages: MessageView[] }>> {
  const deps = { ...defaults(), ...d };
  const gate = readGate(user);
  if (gate) return gate;
  if (!(await ready())) return NOT_SETUP();
  const got = await getLead(user, leadId);
  if (!got.ok) return got;
  const rows = await deps.store.listForLead(user.organizationId!, leadId);
  return { ok: true, messages: rows.map(messageView) };
}

/** Writes the first message to a lead. Synchronous: one model call (and at most one retry), then the draft is stored for review. */
export async function draftOutreach(user: Who, leadId: number, opts: { by?: "user" | "agent" } = {}, d: Partial<OutreachDeps> = {}): Promise<Result<{ message: MessageView; retried: boolean }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await ready())) return NOT_SETUP();
  const got = await getLead(user, leadId);
  if (!got.ok) return got;
  const { lead, claims } = got.detail;
  const stop = blocked(lead);
  if (stop) return stop;
  const orgId = user.organizationId!;

  // This writes a FIRST message. A lead already contacted (or past that stage) gets follow-ups later, written from the conversation.
  if (!FIRST_CONTACT_STAGES.includes(lead.status as LeadStatus) || (await deps.store.listForLead(orgId, leadId)).some((m) => m.status === "sent")) {
    return fail(409, "already_contacted", "You've already been in touch with this lead. This writes first messages only; follow-ups are written from the conversation.");
  }

  const existing = await deps.store.unsent(orgId, leadId);
  if (existing) return fail(409, "draft_exists", "This lead already has a message waiting. Send or cancel it first.", { messageId: existing.id });

  const scoreClaims: ScoreClaim[] = claims.map((c) => ({ id: c.id, field: c.field, value: c.value, status: c.status, evidenceUrl: c.evidenceUrl, createdAt: c.createdAt }));
  const to = recipientFor(lead, scoreClaims);
  if (!to) return fail(422, "no_address", "There is no email address for this lead yet. Add one, or research the lead's website to find a business address.");
  const { facts, angles } = draftFacts(scoreClaims);
  if (!facts.length) return fail(422, "no_facts", "There is nothing verified about this company to write from yet. Research the lead first, so the message says something true.");

  try { await assertWithinCap("draft", orgId); }
  catch (e) {
    if (e instanceof CapExceeded) return fail(429, "daily_limit", `You've used today's ${dailyLimit("draft")} drafts. Try again tomorrow.`);
    if (e instanceof CapUnavailable) return fail(503, "SALES_NOT_SETUP", "The sales agent isn't set up on this server yet.");
    throw e;
  }

  const [org, ideal, notes] = await Promise.all([
    storage.getOrganization(orgId),
    getIdealClient(user),
    relatedKnowledge(user, [lead.companyName, lead.industry, lead.location, ...facts.map((f) => f.value)].filter(Boolean).join(" "), 2),
  ]);
  const senderName = [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || org?.name || "The team";
  const input: DraftInput = {
    sender: { name: senderName, business: org?.name ?? "" },
    offer: ideal.ok ? { about: ideal.profile.about, services: ideal.profile.services } : { about: null, services: [] },
    company: lead.companyName, greetName: lead.contactName?.trim() || null,
    facts, angles, notes: notes.map((n) => ({ title: n.title, text: n.text })),
    angle: await import("../outbound/lead-angle").then((m) => m.angleForLead(orgId, leadId)).catch(() => null),
  };
  const ctx = { to: to.address, siteHost: siteHost(lead.domain || (() => { try { return new URL(lead.website ?? "").hostname; } catch { return ""; } })()) };
  const trace = { task: "draft" as const, orgId, userId: user.id, leadId, promptVersion: OUTREACH_PROMPT_VERSION };
  const model = modelFor("draft");

  let issues: Issue[] = [], draft: { subject: string; body: string } | null = null, retried = false;
  try {
    const messages: ChatMessage[] = [{ role: "system", content: draftSystemPrompt() }, { role: "user", content: draftUserMessage(input) }];
    for (let attempt = 0; attempt < 2; attempt++) {
      const reply = await deps.chat(trace, messages, { maxTokens: 2500, model });
      draft = asDraft(reply.content);
      issues = draft ? checkDraft(draft, ctx) : [{ code: "body_length", message: "Reply with only the JSON object: {\"subject\":...,\"body\":...}." }];
      if (!issues.length) break;
      retried = true;
      messages.push({ role: "assistant", content: reply.content ?? "" }, { role: "user", content: `That draft cannot be used. Fix these problems and return the JSON object again:\n${issuesForRetry(issues)}` });
    }
  } catch (e) {
    if (e instanceof CapExceeded) return fail(429, "daily_limit", `You've used today's ${dailyLimit("draft")} drafts. Try again tomorrow.`);
    if (e instanceof CapUnavailable) return fail(503, "SALES_NOT_SETUP", "The sales agent isn't set up on this server yet.");
    agentLog("error", { errorType: (e as Error)?.name ?? "Error", where: "sales_draft", code: e instanceof ProviderError ? e.code : "internal" }); // never the text
    return fail(502, "model_unavailable", "The writing assistant didn't answer. Try again in a moment.");
  }
  if (!draft || issues.length) return fail(422, "draft_rejected", "The draft didn't pass the safety checks, so it wasn't saved. Try again, or write the message yourself.", { issues: issues.map((i) => i.code) });

  let row: LeadMessageRow;
  try {
    row = await deps.store.create({
      orgId, leadId, subject: draft.subject, body: draft.body, bodyHash: hashDraft(draft.subject, draft.body), toAddress: to.address, toSource: to.source,
      researchId: await latestResearchId(orgId, leadId), claimIds: [...facts, ...angles].map((f) => f.id), promptVersion: OUTREACH_PROMPT_VERSION,
      by: opts.by ?? "user", userId: user.id, now: deps.now(),
    });
  } catch (e) {
    if (e instanceof DraftExists) return fail(409, "draft_exists", "This lead already has a message waiting. Send or cancel it first.");
    throw e;
  }
  await leadsStore.addEvent(orgId, leadId, { kind: "draft_created", data: { messageId: row.id, claims: facts.length + angles.length }, actor: opts.by ?? "user", actorUserId: user.id });
  return { ok: true, message: messageView(row), retried };
}

async function latestResearchId(orgId: string, leadId: number): Promise<number | null> {
  try { return (await salesTablesReady()) ? (await researchStore.latest(orgId, leadId))?.id ?? null : null; } catch { return null; }
}

const editSchema = z.object({ subject: z.string().max(400), body: z.string().max(10_000) });

/** Loads a message and its lead, in this workspace. Anything else answers "not found". */
async function load(user: Who, id: number, deps: OutreachDeps) {
  const row = await deps.store.get(user.organizationId!, id);
  if (!row) return fail(404, "not_found", "That message isn't in your workspace.");
  const got = await getLead(user, row.leadId);
  if (!got.ok) return got;
  return { ok: true as const, row, lead: got.detail.lead };
}

/** A person's change to the text. They are held to the structural rules only (their own message may quote their own price). An approved message goes back to draft: approval was of the old text. */
export async function editDraft(user: Who, id: number, raw: unknown, d: Partial<OutreachDeps> = {}): Promise<Result<{ message: MessageView }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await ready())) return NOT_SETUP();
  const parsed = editSchema.safeParse(raw);
  if (!parsed.success) return fail(400, "invalid", "Send the subject and the message.");
  const l = await load(user, id, deps);
  if (!l.ok) return l;
  const stop = blocked(l.lead);
  if (stop) return stop;
  if (l.row.status !== "draft" && l.row.status !== "approved") return fail(409, "not_editable", `That message is already ${l.row.status}.`);
  const subject = parsed.data.subject.trim(), body = parsed.data.body.replace(/\r\n/g, "\n").trim();
  const issues = checkStructure({ subject, body });
  if (issues.length) return fail(422, "invalid_text", issues[0].message, { issues: issues.map((i) => i.code) });
  const hash = hashDraft(subject, body);
  if (hash === l.row.bodyHash) return { ok: true, message: messageView(l.row) };
  const next = await deps.store.transition({ orgId: user.organizationId!, id, from: l.row.status as "draft" | "approved", to: "draft", hash: l.row.bodyHash, now: deps.now(), set: { subject, body, bodyHash: hash, edited: true, approvedBy: null, approvedAt: null } });
  if (!next) return fail(409, "changed", "That message changed while you were editing it. Reload and try again.");
  return { ok: true, message: messageView(next) };
}

/** The person approves exactly the text they read (`bodyHash`). Fails if it has changed, or if the lead has since become do-not-contact. */
export async function approveMessage(user: Who, id: number, bodyHash: unknown, d: Partial<OutreachDeps> = {}): Promise<Result<{ message: MessageView; already: boolean }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await ready())) return NOT_SETUP();
  if (typeof bodyHash !== "string" || !/^[a-f0-9]{64}$/.test(bodyHash)) return fail(400, "invalid", "Approve the message you are looking at.");
  const l = await load(user, id, deps);
  if (!l.ok) return l;
  const stop = blocked(l.lead);
  if (stop) return stop;
  if (l.row.status === "approved" && l.row.bodyHash === bodyHash) return { ok: true, message: messageView(l.row), already: true }; // a second click
  if (l.row.status !== "draft") return fail(409, "not_draft", `That message is ${l.row.status}, so it can't be approved.`);
  if (l.row.bodyHash !== bodyHash) return fail(409, "changed", "The message changed since you read it. Read it again before approving.");
  const next = await deps.store.transition({ orgId: user.organizationId!, id, from: "draft", to: "approved", hash: bodyHash, now: deps.now(), set: { approvedBy: user.id, approvedAt: deps.now() } });
  if (!next) {
    const again = await deps.store.get(user.organizationId!, id);
    if (again?.status === "approved" && again.bodyHash === bodyHash) return { ok: true, message: messageView(again), already: true };
    return fail(409, "changed", "That message changed while you were approving it. Reload and try again.");
  }
  await leadsStore.addEvent(user.organizationId!, l.row.leadId, { kind: "draft_approved", data: { messageId: id }, actor: "user", actorUserId: user.id });
  return { ok: true, message: messageView(next), already: false };
}

/** The stages a lead passes through when its first message goes out, each one a move the lead pipeline allows. */
export function pathToContacted(status: string): LeadStatus[] {
  if (status === "new" || status === "researching") return ["qualified", "contacted"];
  if (status === "qualified") return ["contacted"];
  return [];
}
const FOLLOW_UP_DAYS = 4;
/** The stages a lead is in before anyone has contacted it. */
const FIRST_CONTACT_STAGES: LeadStatus[] = ["new", "researching", "qualified"];

/** The person says they sent the approved message (from their own email app). Records it, moves the lead on, and adds a follow-up. Done once, however many times it is clicked. */
export async function markSent(user: Who, id: number, d: Partial<OutreachDeps> = {}): Promise<Result<{ message: MessageView; already: boolean; movedTo: string | null }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await ready())) return NOT_SETUP();
  const l = await load(user, id, deps);
  if (!l.ok) return l;
  if (l.row.status === "sent") return { ok: true, message: messageView(l.row), already: true, movedTo: null };
  if (l.row.status !== "approved") return fail(409, "not_approved", "Approve the message before you send it.");
  const orgId = user.organizationId!, now = deps.now();
  const next = await deps.store.transition({ orgId, id, from: "approved", to: "sent", now, set: { sentAt: now } });
  if (!next) {
    const again = await deps.store.get(orgId, id);
    if (again?.status === "sent") return { ok: true, message: messageView(again), already: true, movedTo: null };
    return fail(409, "changed", "That message changed. Reload and try again.");
  }
  // Only the call that won the change reaches here: each side effect happens once.
  await leadsStore.addEvent(orgId, l.row.leadId, { kind: "message_sent", data: { messageId: id, channel: "manual" }, actor: "user", actorUserId: user.id });
  let movedTo: string | null = null;
  let status = l.lead.status as LeadStatus;
  for (const step of pathToContacted(status)) {
    if (!canMove(status, step)) break;
    const m = await moveLead(user, l.row.leadId, step, { actor: "user" });
    if (!m.ok) break;
    status = step; movedTo = step;
  }
  await createTicket(user, l.row.leadId, { title: `Follow up with ${l.lead.companyName}`, kind: "follow_up", dueAt: new Date(now.getTime() + FOLLOW_UP_DAYS * 86_400_000) }, { actor: "user" });
  return { ok: true, message: messageView(next), already: false, movedTo };
}

/** Throws the draft away (nothing was sent). Works from draft or approved. */
export async function cancelMessage(user: Who, id: number, d: Partial<OutreachDeps> = {}): Promise<Result<{ message: MessageView }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await ready())) return NOT_SETUP();
  const l = await load(user, id, deps);
  if (!l.ok) return l;
  if (l.row.status === "cancelled") return { ok: true, message: messageView(l.row) };
  if (l.row.status !== "draft" && l.row.status !== "approved") return fail(409, "not_cancellable", `That message is already ${l.row.status}.`);
  const next = await deps.store.transition({ orgId: user.organizationId!, id, from: l.row.status as "draft" | "approved", to: "cancelled", now: deps.now() });
  if (!next) return fail(409, "changed", "That message changed. Reload and try again.");
  await leadsStore.addEvent(user.organizationId!, l.row.leadId, { kind: "draft_cancelled", data: { messageId: id }, actor: "user", actorUserId: user.id });
  return { ok: true, message: messageView(next) };
}
