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
 *  - the organization's do-not-contact list (an address or a whole domain, shared/outreach-safety.ts) AND the lead's own
 *    do-not-contact flag are checked at draft, approval, when the approved text is opened in the person's email app (the
 *    app hands it over only through openApproved, never from a stale page) and when the person records the send; if the
 *    list can't be read, nothing is done (fail closed). Marking a lead do-not-contact discards its unsent messages, so an
 *    earlier approval can't be used: a new draft and a new approval are needed if the flag is ever lifted;
 *  - what happened afterwards (a reply, a bounce, an opt-out) is recorded once per message and kind; an opt-out or a
 *    bounce puts the address on the list for every lead, and an opt-out also marks the lead do-not-contact;
 *  - the timeline records ids and counts only, never message text.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { checkDraft, checkStructure, issuesForRetry, offerDescribed, scopeIssues, type Issue } from "@shared/outreach-check";
import { MAX_VARIANTS, selectStrategies, type OutreachStrategy, type StrategyChoice } from "@shared/outreach-strategy";
import { scoreDraft, type Scorecard } from "@shared/draft-scorecard";
import { hashDraft } from "@shared/outreach-hash";
import { FOLLOW_UP_DAYS, OUTCOMES, SUPPRESSION_REASON_LABEL, isRemovable, parseSuppressionInput, pathToContacted, suppressionKeys, type Outcome, type SuppressionReason } from "@shared/outreach-safety";
import { latestPerField, normField, type ScoreClaim } from "@shared/lead-score";
import { dailyLimit, modelFor } from "@shared/llm-cost";
import { canMove, type LeadStatus } from "@shared/leads";
import { siteHost } from "@shared/research";
import type { LeadMessageRow } from "@shared/schema";
import { ProviderError, type ChatMessage } from "../copilot/provider";
import { agentLog } from "../agent/log";
import { parseJsonObject } from "../agent/extraction";
import { leadsStore } from "../leads/store";
import { CapExceeded, CapUnavailable, GlobalCapExceeded, WorkspaceBudgetExceeded, assertWithinCap, tracedChat } from "../llm/traced";
import { getIdealClient } from "../services/ideal-client";
import { relatedKnowledge } from "../services/knowledge";
import { createTicket, fail, getLead, moveLead, readGate, updateLead, writeGate, type Result, type Who } from "../services/leads";
import { storage } from "../storage";
import { draftSystemPrompt, draftUserMessage, versionFor, type DraftInput } from "./outreach-prompt";
import type { DraftStyle } from "../profiles/style";
import { profileStyleView, type ProfileStyleView } from "@shared/acquisition-profile";
import { followUpView, type FollowUpView } from "@shared/campaign";
import { DraftAllowanceReached, DraftExists, messageStore, messagesTablesReady, outreachSafetyReady, type MessageStore } from "./message-store";
import { AI_DRAFT_VERSION_PREFIX, outboundTier } from "../outbound/plan";
import { outboundAllowance } from "../outbound/limits";
import { OUTBOUND_WINDOW_DAYS, TIER_LABEL } from "@shared/outbound-plans";
import { researchStore, salesTablesReady } from "./research-store";

export interface OutreachDeps {
  store: MessageStore; chat: typeof tracedChat; now: () => Date;
  /** The lead's next follow-up still open (planned, on hold, drafted), or null (server/sales/followups.ts openFollowUpForLead). */
  followUp: (orgId: string, leadId: number) => Promise<{ status: string; dueAt: string | null; draftStatus: string | null } | null>;
  /** The tone and note of the saved client profile a draft to this lead should follow, or null (server/profiles/style.ts). Never throws. */
  style: (orgId: string, leadId: number, campaignProfileId?: number | null) => Promise<DraftStyle | null>;
}
const defaults = (): OutreachDeps => ({
  store: messageStore, chat: tracedChat, now: () => new Date(),
  followUp: async (orgId, leadId) => { try { return await (await import("./followups")).openFollowUpForLead(orgId, leadId); } catch { return null; } },
  style: async (orgId, leadId, campaignProfileId) => { try { return await (await import("../profiles/style")).styleForDraft(orgId, leadId, campaignProfileId); } catch { return null; } },
});

export { hashDraft } from "@shared/outreach-hash";

export interface MessageView {
  id: number; leadId: number; status: LeadMessageRow["status"]; subject: string; body: string; bodyHash: string;
  to: string | null; toSource: string | null; edited: boolean; createdBy: string; createdAt: string; approvedAt: string | null; sentAt: string | null;
  /** How this version opens (shared/outreach-strategy.ts) and its batch, for messages written since variants exist. */
  strategy: string | null; variantGroup: string | null;
  /** Written by a model (false: the person wrote it themselves). A follow-up's fixed text counts as written for them. */
  byAi: boolean;
  /** The deterministic quality card (shared/draft-scorecard.ts), measured on read for versions and drafts. Never a prediction. */
  scorecard?: Scorecard;
}
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
export const messageView = (m: LeadMessageRow): MessageView => ({
  id: m.id, leadId: m.leadId, status: m.status, subject: m.subject ?? "", body: m.body, bodyHash: m.bodyHash, to: m.toAddress, toSource: m.toSource,
  edited: m.edited, createdBy: m.createdBy, createdAt: iso(m.createdAt)!, approvedAt: iso(m.approvedAt), sentAt: iso(m.sentAt),
  strategy: m.strategy ?? null, variantGroup: m.variantGroup ?? null, byAi: !!m.promptVersion,
});

const NOT_SETUP = () => fail(503, "MESSAGES_NOT_SETUP", "Outreach drafts aren't set up on this server yet.");
async function ready(): Promise<boolean> { try { return await messagesTablesReady(); } catch { return false; } }
const SAFETY_NOT_SETUP = () => fail(503, "OUTREACH_SAFETY_NOT_SETUP", "The do-not-contact list isn't set up on this server yet.");
const LIST_UNREADABLE = () => fail(503, "suppression_unavailable", "Your do-not-contact list couldn't be checked, so nothing was done. Try again shortly.");

/**
 * Whether `address` (or its domain) is on the organization's do-not-contact list. Without the list's tables nothing can be
 * on it (null: go ahead); a list that exists but can't be read stops the action (fail closed).
 */
export async function suppressionBlock(orgId: string, address: string | null | undefined, deps: Pick<OutreachDeps, "store"> = defaults()) {
  const keys = suppressionKeys(address ?? "");
  if (!keys.length) return null;
  let on: boolean;
  try { on = await outreachSafetyReady(); } catch { return LIST_UNREADABLE(); }
  if (!on) return null;
  try {
    const hit = await deps.store.suppressedMatch(orgId, keys);
    if (!hit) return null;
    return listedFail(hit);
  } catch (err) {
    agentLog("error", { errorType: (err as Error)?.name ?? "Error", where: "outreach_suppression_check" });
    return LIST_UNREADABLE();
  }
}

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

/** The verified facts and the guesses a draft may use (each with its normalized field, for the strategy rules). Nothing else about the company reaches the model. */
export function draftFacts(claims: ScoreClaim[]): { facts: { id: number; field: string; label: string; value: string }[]; angles: { id: number; field: string; label: string; value: string }[] } {
  const latest = latestPerField(claims);
  const facts: { id: number; field: string; label: string; value: string }[] = [], angles: { id: number; field: string; label: string; value: string }[] = [];
  for (const c of latest) {
    const f = normField(c.field);
    if (FACT_FIELDS[f] && c.status === "confirmed") facts.push({ id: c.id, field: f, label: FACT_FIELDS[f], value: c.value });
    else if (ANGLE_FIELDS[f] && (c.status === "inferred" || c.status === "confirmed")) angles.push({ id: c.id, field: f, label: ANGLE_FIELDS[f], value: c.value });
  }
  return { facts, angles };
}

/**
 * What a first message to this lead still lacks, in the order writing one refuses it: nowhere to send it, then nothing
 * verified to write from. The page shows this before the click, so nobody presses "Write a message" only to be told no.
 * Built from the same two rules the draft itself uses, so the hint and the refusal cannot disagree.
 */
export type FirstMessageGap = "address" | "facts";
export function firstMessageGap(lead: { contactEmail?: string | null }, claims: ScoreClaim[]): FirstMessageGap | null {
  if (!recipientFor(lead, claims)) return "address";
  return draftFacts(claims).facts.length ? null : "facts";
}

/** The refusal for an address or domain on the organization's list. */
function listedFail(hit: { kind: string; value: string; reason: string }) {
  const why = SUPPRESSION_REASON_LABEL[hit.reason as SuppressionReason] ?? "on your list";
  return fail(409, "suppressed", `${hit.kind === "domain" ? `Everyone at ${hit.value}` : "This address"} is on your do-not-contact list (${why.toLowerCase()}), so nothing can be written to or sent to it.`);
}
/** Why a message that isn't approved can't be recorded as sent, in the person's words. */
const notSendable = (status: string) => status === "sending" ? SENDING()
  : fail(409, "not_approved", status === "cancelled" ? "That message was discarded, so it can't be recorded as sent." : status === "draft" ? "Approve the message before you send it." : "That message changed. Reload and try again.");
/** A message being sent from the person's connected mailbox, or waiting for them to confirm whether it went: nothing else may send or change it. */
const SENDING = () => fail(409, "sending", "This message is being sent from Gmail, or waiting for you to confirm whether it went out. Check its Gmail status first; nothing else can send it meanwhile.");

/** A lead nothing may be opened or recorded as sent for, whatever was approved before: it is marked do-not-contact. */
const doNotContact = (lead: { doNotContact?: boolean | null }) =>
  lead.doNotContact ? fail(409, "do_not_contact", "This lead is marked do-not-contact, so this message can't be opened or recorded as sent. If you had already sent it before the lead was marked, note that on the lead.") : null;

/** A lead a message may not be written to, approved for, or edited for; null when it is fine. */
const blocked = (lead: { doNotContact?: boolean | null; archivedAt?: Date | string | null; status: string }) =>
  lead.doNotContact ? fail(409, "do_not_contact", "This lead is marked do-not-contact, so no message can be drafted or approved for it.")
    : lead.archivedAt || lead.status === "won" || lead.status === "lost" ? fail(409, "closed", "This lead is closed, so it can't take a message.")
      : null;

const asDraft = (text: string | null): { subject: string; body: string } | null => {
  const raw = parseJsonObject(text) as { subject?: unknown; body?: unknown } | null;
  return raw && typeof raw.subject === "string" && typeof raw.body === "string" ? { subject: raw.subject.trim(), body: raw.body.replace(/\r\n/g, "\n").trim() } : null;
};

/** `sample`: the proof-of-value sample the lead's opportunity plan proposed (Client Radar), which a first draft can offer. */
export async function listMessages(user: Who, leadId: number, d: Partial<OutreachDeps> = {}): Promise<Result<{ messages: MessageView[]; sample: { title: string; scope: string } | null; /** The saved client profile whose tone and note this lead's AI drafts follow, when there is one. */ style: ProfileStyleView | null; /** What comes next after a sent message: a planned follow-up, one on hold, or a draft waiting. */ followUp: FollowUpView | null; /** What a first message still lacks (an address, or anything verified), or null when one can be written. */ gap: FirstMessageGap | null; /** Whether the lead has a website to research, which decides the advice that goes with a gap. */ hasWebsite: boolean }>> {
  const deps = { ...defaults(), ...d };
  const gate = readGate(user);
  if (gate) return gate;
  if (!(await ready())) return NOT_SETUP();
  const got = await getLead(user, leadId);
  if (!got.ok) return got;
  const { lead, claims } = got.detail;
  await repairAfterSend(user.organizationId!, 10, deps);
  const rows = await deps.store.listForLead(user.organizationId!, leadId);
  const sample = await import("../outbound/lead-angle").then((m) => m.angleForLead(user.organizationId!, leadId)).then((a) => a?.sample ?? null).catch(() => null);
  // The quality card a person compares versions (and reviews a draft) with: measured NOW from the message and
  // the lead's claims, stored nowhere. Each strategy is marked against its own evidence, found by the same rules
  // that offered it; a strategy grounded outside the claims (a sample, the Client Radar angle) has none to mark.
  const scoreClaims: ScoreClaim[] = claims.map((c) => ({ id: c.id, field: c.field, value: c.value, status: c.status, evidenceUrl: c.evidenceUrl, createdAt: c.createdAt }));
  const { facts, angles } = draftFacts(scoreClaims);
  const valueOf = new Map([...facts, ...angles].map((f) => [f.id, f.value]));
  const evidenceIds = new Map(selectStrategies({ facts, angles, radar: null, offerDescribed: true, sampleAvailable: false }).map((c) => [c.strategy as string, c.evidenceIds]));
  const withCard = (v: MessageView): MessageView =>
    // Only what a model wrote is marked: a person's own message is theirs to judge.
    v.byAi && (v.status === "variant" || v.status === "draft")
      ? { ...v, scorecard: scoreDraft(v, { greetName: lead.contactName?.trim() || null, factValues: facts.map((f) => f.value), evidenceValues: (evidenceIds.get(v.strategy ?? "") ?? []).map((id) => valueOf.get(id)!).filter(Boolean) }) }
      : v;
  const [style, next] = await Promise.all([deps.style(user.organizationId!, leadId).catch(() => null), deps.followUp(user.organizationId!, leadId).catch(() => null)]);
  return { ok: true, messages: rows.map((m) => withCard(messageView(m))), sample, style: profileStyleView(style), followUp: followUpView(next), gap: firstMessageGap(lead, scoreClaims), hasWebsite: !!lead.website?.trim() };
}

/** The cap refusals a draft can hit, in the person's words; null when `e` is something else. */
const capFail = (e: unknown) =>
  e instanceof WorkspaceBudgetExceeded ? fail(429, "workspace_budget", "This workspace's AI usage for the last 30 days has reached its limit. What's already found and saved stays; it frees up as earlier usage passes 30 days.")
    : e instanceof GlobalCapExceeded ? fail(429, "global_limit", "Today's AI budget for lead research and drafting is used up for everyone on DealInSec. It resets at midnight UTC.")
      : e instanceof CapExceeded ? fail(429, "daily_limit", `You've used today's ${dailyLimit("draft")} drafts. Try again tomorrow.`)
        : e instanceof CapUnavailable ? fail(503, "SALES_NOT_SETUP", "The sales agent isn't set up on this server yet.")
          : null;

type DraftOpts = {
  by?: "user" | "agent"; offerSample?: boolean;
  /** The saved client profile a campaign was built for: its tone and note win over the lead's own profile. */
  profileId?: number | null;
};
interface PreparedDraft {
  orgId: string;
  to: { address: string; source: "lead" | "site" };
  input: DraftInput;
  scope: { sampleOffered: boolean; offer: DraftInput["offer"] };
  /** The saved profile whose tone and note this draft follows, when there is one. */
  style: DraftStyle | null;
  ctx: { to: string; siteHost: string };
  model: string;
  allowance: { since: Date; max: number; prefix: string };
  draftLimit: () => ReturnType<typeof fail>;
  /** The ways the evidence supports opening this message, strongest first (never empty: "direct" is the floor). */
  strategies: StrategyChoice[];
  claimIds: number[];
  claims: number;
  researchId: number | null;
}

/**
 * Everything writing a first message needs, checked and assembled once: the gates, the recipient, the facts
 * the message may be written from, the sender's offer, the plan's allowance, and which strategies the evidence
 * supports. Shared by the single draft and the versions, so both answer every refusal the same way.
 */
/**
 * What starting ANY first message to a lead needs, whoever writes it: the gates, a lead that may be contacted and has
 * not been yet, nothing already waiting for it, somewhere to send it, and an address that is not on the do-not-contact
 * list. Shared by the AI draft and the message a person writes themselves, so neither can skip a refusal the other gives.
 */
async function prepareFirstMessage(user: Who, leadId: number, deps: OutreachDeps) {
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
  const earlier = await deps.store.listForLead(orgId, leadId);
  if (earlier.some((m) => m.status === "sending")) return SENDING();
  if (!FIRST_CONTACT_STAGES.includes(lead.status as LeadStatus) || earlier.some((m) => m.status === "sent")) {
    return fail(409, "already_contacted", "You've already been in touch with this lead. This writes first messages only; follow-ups are written from the conversation.");
  }

  const existing = await deps.store.unsent(orgId, leadId);
  if (existing) return fail(409, "draft_exists", "This lead already has a message waiting. Send or cancel it first.", { messageId: existing.id });
  const pending = await deps.store.pendingVariants(orgId, leadId);
  if (pending.length) return fail(409, "draft_exists", "This lead already has message versions waiting. Choose one or discard them first.", { messageId: pending[0].id });

  const scoreClaims: ScoreClaim[] = claims.map((c) => ({ id: c.id, field: c.field, value: c.value, status: c.status, evidenceUrl: c.evidenceUrl, createdAt: c.createdAt }));
  const to = recipientFor(lead, scoreClaims);
  if (!to) return fail(422, "no_address", "There is no email address for this lead yet. Add one, or research the lead's website to find a business address.");
  const listed = await suppressionBlock(orgId, to.address, deps);
  if (listed) return listed;
  return { ok: true as const, orgId, lead, scoreClaims, to };
}

async function prepareDraft(user: Who, leadId: number, opts: DraftOpts, deps: OutreachDeps): Promise<Result<PreparedDraft>> {
  const first = await prepareFirstMessage(user, leadId, deps);
  if (!first.ok) return first;
  const { orgId, lead, scoreClaims, to } = first;
  const { facts, angles } = draftFacts(scoreClaims);
  if (!facts.length) return fail(422, "no_facts", "There is nothing verified about this company to write from yet. Research the lead first, so the message says something true.");

  // The plan's AI-draft allowance over 30 days: checked here so no model call is paid for a draft that couldn't be saved,
  // and again with the insert (under a per-workspace lock) so parallel requests can't pass it together.
  const tier = await outboundTier(user);
  const plan = outboundAllowance(tier);
  const allowance = { since: new Date(deps.now().getTime() - OUTBOUND_WINDOW_DAYS * 86_400_000), max: plan.monthlyDrafts, prefix: AI_DRAFT_VERSION_PREFIX };
  const draftLimit = () => tier === "free"
    ? fail(402, "NO_CREDITS", `You've used the free plan's ${plan.monthlyDrafts} AI drafts for this 30-day period. Upgrade to Pro for more, or write this message yourself.`, { feature: "outbound" })
    : fail(429, "draft_allowance", `You've used the ${plan.monthlyDrafts} AI drafts included in ${TIER_LABEL[tier]} for this 30-day period. More become available as earlier drafts pass 30 days; you can still write this message yourself.`);
  if ((await deps.store.countAiDrafts(orgId, allowance.since, allowance.prefix)) >= allowance.max) return draftLimit();

  try { await assertWithinCap("draft", orgId); }
  catch (e) {
    const cf = capFail(e);
    if (cf) return cf;
    throw e;
  }

  const [org, ideal, notes, style] = await Promise.all([
    storage.getOrganization(orgId),
    getIdealClient(user),
    relatedKnowledge(user, [lead.companyName, lead.industry, lead.location, ...facts.map((f) => f.value)].filter(Boolean).join(" "), 2),
    deps.style(orgId, leadId, opts.profileId).catch(() => null),
  ]);
  const senderName = [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || org?.name || "The team";
  const input: DraftInput = {
    sender: { name: senderName, business: org?.name ?? "" },
    offer: ideal.ok ? { about: ideal.profile.about, services: ideal.profile.services } : { about: null, services: [] },
    company: lead.companyName, greetName: lead.contactName?.trim() || null,
    facts, angles, notes: notes.map((n) => ({ title: n.title, text: n.text })),
  };
  const angle = await import("../outbound/lead-angle").then((m) => m.angleForLead(orgId, leadId)).catch(() => null);
  // Without the sender's own words for what they offer, nothing about a service reaches the model (it would invent one).
  const described = offerDescribed(input.offer);
  input.angle = angle && !described ? { ...angle, solution: null } : angle;
  // The sample is offered only when the person asked for it here (it commits their time); an agent never offers it.
  input.sample = opts.offerSample && opts.by !== "agent" && described ? angle?.sample ?? null : null;
  // How the sender asked for messages to this kind of client to sound: wording only, every rule and check stays.
  input.style = style ? { tone: style.tone, note: style.note } : null;
  // "What the sender offers" is the only source for what a draft says about the sender (shared/outreach-check.ts scopeIssues).
  // The profile's note is the sender's own words too, so what it says about their work is allowed, but a note alone
  // never counts as having described the offer.
  const noted = described && style?.note.trim() ? { about: [input.offer.about, style.note].filter(Boolean).join(". "), services: input.offer.services } : input.offer;
  const scope = { sampleOffered: !!input.sample, offer: noted };
  const ctx = { to: to.address, siteHost: siteHost(lead.domain || (() => { try { return new URL(lead.website ?? "").hostname; } catch { return ""; } })()) };

  const strategies = selectStrategies({
    facts, angles,
    radar: angle ? { problem: angle.problem ?? null, opportunity: angle.opportunity ?? null } : null,
    offerDescribed: described, sampleAvailable: !!input.sample,
  });
  return {
    ok: true, orgId, to, input, scope, style, ctx, model: modelFor("draft"), allowance, draftLimit, strategies,
    claimIds: [...facts, ...angles].map((f) => f.id), claims: facts.length + angles.length, researchId: await latestResearchId(orgId, leadId),
  };
}

/** What the timeline keeps about the style a draft followed: the profile's id and the tone, never the note's words. */
const styleData = (s: DraftStyle | null) => (s ? { profileId: s.profileId, tone: s.tone, noted: !!s.note.trim() } : {});

/** One model-written version, opened the strategy's way: at most one retry, checked by the same rules as ever. Cap and provider errors are thrown to the caller. */
async function writeOne(user: Who, leadId: number, p: PreparedDraft, strategy: StrategyChoice["strategy"], deps: OutreachDeps): Promise<{ draft: { subject: string; body: string } | null; issues: Issue[]; retried: boolean }> {
  const trace = { task: "draft" as const, orgId: p.orgId, userId: user.id, leadId, promptVersion: versionFor(strategy) };
  const messages: ChatMessage[] = [{ role: "system", content: draftSystemPrompt(strategy, p.input.style) }, { role: "user", content: draftUserMessage(p.input) }];
  let issues: Issue[] = [], draft: { subject: string; body: string } | null = null, retried = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await deps.chat(trace, messages, { maxTokens: 2500, model: p.model });
    draft = asDraft(reply.content);
    issues = draft ? [...checkDraft(draft, p.ctx), ...scopeIssues(draft, p.scope)] : [{ code: "body_length", message: "Reply with only the JSON object: {\"subject\":...,\"body\":...}." }];
    if (!issues.length) break;
    retried = true;
    messages.push({ role: "assistant", content: reply.content ?? "" }, { role: "user", content: `That draft cannot be used. Fix these problems and return the JSON object again:\n${issuesForRetry(issues)}` });
  }
  return { draft: issues.length ? null : draft, issues, retried };
}

/** Stores one checked version as THE draft, with its strategy, and records the timeline entry (ids and counts only). */
async function storeSingle(user: Who, leadId: number, p: PreparedDraft, strategy: StrategyChoice["strategy"], draft: { subject: string; body: string }, opts: DraftOpts, deps: OutreachDeps): Promise<Result<{ message: MessageView }>> {
  let row: LeadMessageRow;
  try {
    row = await deps.store.create({
      orgId: p.orgId, leadId, subject: draft.subject, body: draft.body, bodyHash: hashDraft(draft.subject, draft.body), toAddress: p.to.address, toSource: p.to.source,
      researchId: p.researchId, claimIds: p.claimIds, promptVersion: versionFor(strategy), strategy,
      by: opts.by ?? "user", userId: user.id, now: deps.now(), allowance: p.allowance,
    });
  } catch (e) {
    if (e instanceof DraftExists) return fail(409, "draft_exists", "This lead already has a message waiting. Send or cancel it first.");
    if (e instanceof DraftAllowanceReached) return p.draftLimit();
    throw e;
  }
  await leadsStore.addEvent(p.orgId, leadId, { kind: "draft_created", data: { messageId: row.id, claims: p.claims, ...styleData(p.style) }, actor: opts.by ?? "user", actorUserId: user.id });
  return { ok: true, message: messageView(row) };
}

/** Writes the first message to a lead, opened the way the evidence best supports. Synchronous: one model call (and at most one retry), then the draft is stored for review. */
export async function draftOutreach(user: Who, leadId: number, opts: DraftOpts = {}, d: Partial<OutreachDeps> = {}): Promise<Result<{ message: MessageView; retried: boolean }>> {
  const deps = { ...defaults(), ...d };
  const p = await prepareDraft(user, leadId, opts, deps);
  if (!p.ok) return p;
  const strategy = p.strategies[0].strategy;
  let r: Awaited<ReturnType<typeof writeOne>>;
  try { r = await writeOne(user, leadId, p, strategy, deps); }
  catch (e) {
    const cf = capFail(e);
    if (cf) return cf;
    agentLog("error", { errorType: (e as Error)?.name ?? "Error", where: "sales_draft", code: e instanceof ProviderError ? e.code : "internal" }); // never the text
    return fail(502, "model_unavailable", "The writing assistant didn't answer. Try again in a moment.");
  }
  if (!r.draft) return fail(422, "draft_rejected", "The draft didn't pass the safety checks, so it wasn't saved. Try again, or write the message yourself.", { issues: r.issues.map((i) => i.code) });
  const stored = await storeSingle(user, leadId, p, strategy, r.draft, opts, deps);
  return stored.ok ? { ok: true, message: stored.message, retried: r.retried } : stored;
}

/**
 * Writes up to MAX_VARIANTS versions of the first message, one strategy each, for the person to choose from
 * (status "variant": not a draft yet, so nothing can be approved until one is chosen). One batch counts as ONE
 * AI draft against the plan's allowance; the model is still called once per version, under the same daily and
 * budget caps. A version that fails the safety checks is dropped, and a cap reached partway stores what passed
 * so far; when only one way is grounded, or only one version survives, it is stored as the draft directly —
 * nothing to choose between. Every refusal is the same one a single draft gives.
 */
export async function draftOutreachVariants(user: Who, leadId: number, opts: DraftOpts = {}, d: Partial<OutreachDeps> = {}): Promise<Result<{ variants: MessageView[]; retried: boolean }>> {
  const deps = { ...defaults(), ...d };
  const p = await prepareDraft(user, leadId, opts, deps);
  if (!p.ok) return p;
  const wanted = p.strategies.slice(0, MAX_VARIANTS);

  const good: { strategy: StrategyChoice["strategy"]; subject: string; body: string }[] = [];
  let retried = false, lastIssues: Issue[] = [];
  for (const choice of wanted.length >= 2 ? wanted : wanted.slice(0, 1)) {
    try {
      const r = await writeOne(user, leadId, p, choice.strategy, deps);
      retried ||= r.retried;
      if (r.draft) good.push({ strategy: choice.strategy, ...r.draft });
      else lastIssues = r.issues;
    } catch (e) {
      const cf = capFail(e);
      if (!cf) agentLog("error", { errorType: (e as Error)?.name ?? "Error", where: "sales_draft_variant", code: e instanceof ProviderError ? e.code : "internal" }); // never the text
      if (good.length) break; // keep what already passed
      return cf ?? fail(502, "model_unavailable", "The writing assistant didn't answer. Try again in a moment.");
    }
  }
  if (!good.length) return fail(422, "draft_rejected", "No version passed the safety checks, so nothing was saved. Try again, or write the message yourself.", { issues: lastIssues.map((i) => i.code) });

  if (good.length === 1) {
    const stored = await storeSingle(user, leadId, p, good[0].strategy, good[0], opts, deps);
    return stored.ok ? { ok: true, variants: [stored.message], retried } : stored;
  }
  const group = randomUUID();
  let rows: LeadMessageRow[];
  try {
    rows = await deps.store.createVariants({
      orgId: p.orgId, leadId, toAddress: p.to.address, toSource: p.to.source, researchId: p.researchId, claimIds: p.claimIds,
      by: opts.by ?? "user", userId: user.id, now: deps.now(), group,
      variants: good.map((g) => ({ strategy: g.strategy, subject: g.subject, body: g.body, bodyHash: hashDraft(g.subject, g.body), promptVersion: versionFor(g.strategy) })),
      allowance: p.allowance,
    });
  } catch (e) {
    if (e instanceof DraftExists) return fail(409, "draft_exists", "This lead already has a message waiting. Send or cancel it first.");
    if (e instanceof DraftAllowanceReached) return p.draftLimit();
    throw e;
  }
  await leadsStore.addEvent(p.orgId, leadId, { kind: "variants_created", data: { group, count: rows.length, strategies: good.map((g) => g.strategy), claims: p.claims, ...styleData(p.style) }, actor: opts.by ?? "user", actorUserId: user.id });
  return { ok: true, variants: rows.map(messageView), retried };
}

/**
 * The person writes the first message themselves: no model, no allowance, nothing about the company needed. It is
 * held to every gate a first message has (prepareFirstMessage) and to the structural rules of a person's own text
 * (editDraft's: length, no placeholder left in), then waits as a draft like any other: read, approve, send. It carries
 * no prompt version, so it is never counted as an AI draft and never appears in the strategy numbers.
 */
export async function writeOwnMessage(user: Who, leadId: number, raw: unknown, d: Partial<OutreachDeps> = {}): Promise<Result<{ message: MessageView }>> {
  const deps = { ...defaults(), ...d };
  const parsed = editSchema.safeParse(raw);
  const first = await prepareFirstMessage(user, leadId, deps);
  if (!first.ok) return first;
  if (!parsed.success) return fail(400, "invalid", "Send the subject and the message.");
  const subject = parsed.data.subject.trim(), body = parsed.data.body.replace(/\r\n/g, "\n").trim();
  const issues = checkStructure({ subject, body });
  if (issues.length) return fail(422, "invalid_text", issues[0].message, { issues: issues.map((i) => i.code) });
  let row: LeadMessageRow;
  try {
    row = await deps.store.create({
      orgId: first.orgId, leadId, subject, body, bodyHash: hashDraft(subject, body), toAddress: first.to.address, toSource: first.to.source,
      researchId: null, claimIds: [], promptVersion: null, by: "user", userId: user.id, now: deps.now(),
    });
  } catch (e) {
    if (e instanceof DraftExists) return fail(409, "draft_exists", "This lead already has a message waiting. Send or cancel it first.");
    throw e;
  }
  await leadsStore.addEvent(first.orgId, leadId, { kind: "draft_created", data: { messageId: row.id, own: true }, actor: "user", actorUserId: user.id });
  return { ok: true, message: messageView(row) };
}

/**
 * The person picks one version as THE message: it becomes the draft (the one-unsent-per-lead index holds,
 * whatever races) and its siblings are discarded. Checked NOW against the lead's do-not-contact flag and the
 * organization's list, for exactly the text the person read (`bodyHash`). Approval stays its own step.
 */
export async function chooseVariant(user: Who, id: number, bodyHash: unknown, d: Partial<OutreachDeps> = {}): Promise<Result<{ message: MessageView; already: boolean }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await ready())) return NOT_SETUP();
  if (typeof bodyHash !== "string" || !/^[a-f0-9]{64}$/.test(bodyHash)) return fail(400, "invalid", "Choose the version you are looking at.");
  const l = await load(user, id, deps);
  if (!l.ok) return l;
  const stop = blocked(l.lead);
  if (stop) return stop;
  const listed = await suppressionBlock(user.organizationId!, l.row.toAddress, deps);
  if (listed) return listed;
  const r = await deps.store.chooseVariant({ orgId: user.organizationId!, id, hash: bodyHash, now: deps.now() });
  if (r.result === "chosen" || r.result === "already") {
    if (r.result === "chosen") await leadsStore.addEvent(user.organizationId!, l.row.leadId, { kind: "variant_chosen", data: { messageId: id, strategy: r.row.strategy ?? null }, actor: "user", actorUserId: user.id });
    return { ok: true, message: messageView(r.row), already: r.result === "already" };
  }
  if (r.result === "changed") return fail(409, "changed", "The message changed since you read it. Read it again before choosing.");
  if (r.result === "conflict") return fail(409, "variant_chosen", "Another version was already chosen for this lead. Reload to see it.");
  return fail(409, "not_choosable", "That isn't a version waiting to be chosen.");
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
  if (l.row.status === "sending") return SENDING();
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
  const listed = await suppressionBlock(user.organizationId!, l.row.toAddress, deps);
  if (listed) return listed;
  const next = await deps.store.transition({ orgId: user.organizationId!, id, from: "draft", to: "approved", hash: bodyHash, now: deps.now(), set: { approvedBy: user.id, approvedAt: deps.now() } });
  if (!next) {
    const again = await deps.store.get(user.organizationId!, id);
    if (again?.status === "approved" && again.bodyHash === bodyHash) return { ok: true, message: messageView(again), already: true };
    return fail(409, "changed", "That message changed while you were approving it. Reload and try again.");
  }
  await leadsStore.addEvent(user.organizationId!, l.row.leadId, { kind: "draft_approved", data: { messageId: id }, actor: "user", actorUserId: user.id });
  return { ok: true, message: messageView(next), already: false };
}

export { pathToContacted } from "@shared/outreach-safety";
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
  if (l.row.status !== "approved") return notSendable(l.row.status);
  const orgId = user.organizationId!, now = deps.now();
  // Quick answers first (the same rules), then the decision itself, made in one locked transaction against the state NOW:
  // still approved, the lead not do-not-contact, neither the address nor its domain on the list (message-store.ts).
  const dnc = doNotContact(l.lead);
  if (dnc) return dnc;
  const listed = await suppressionBlock(orgId, l.row.toAddress, deps);
  if (listed) return listed;
  let listOn: boolean;
  try { listOn = await outreachSafetyReady(); } catch { return LIST_UNREADABLE(); }
  // With the outcome tables, the send and its follow-up's outbox entry are recorded in one transaction.
  const rec = await deps.store.recordSentIfAllowed({ orgId, id, now, keys: listOn ? suppressionKeys(l.row.toAddress ?? "") : [], outbox: listOn ? { userId: user.id } : null });
  if (rec.result === "do_not_contact") return doNotContact({ doNotContact: true })!;
  if (rec.result === "suppressed") return listedFail(rec.entry);
  if (rec.result === "not_approved") {
    if (rec.row?.status === "sent") return { ok: true, message: messageView(rec.row), already: true, movedTo: null }; // a second click lost the race
    return notSendable(rec.row?.status ?? "missing");
  }
  const next = rec.row;
  let movedTo: string | null;
  if (listOn) movedTo = await finishAfterSend(orgId, id, deps);
  else {
    // Before the outcome tables exist there is no outbox: the follow-up is best effort, as it always was.
    await recordEventSafely(orgId, { leadId: l.row.leadId, messageId: id, kind: "sent", userId: user.id, now }, deps);
    movedTo = await legacyAfterSend(user, { leadId: l.row.leadId, messageId: id, channel: "manual", now });
  }
  return { ok: true, message: messageView(next), already: false, movedTo };
}

/**
 * Runs a recorded send's follow-up from its outbox entry (message-store.ts completeAfterSend): once, however often it is
 * called. A failure here is logged and left for the repair pass; the send itself is already recorded.
 */
async function finishAfterSend(orgId: string, messageId: number, deps: Pick<OutreachDeps, "store" | "now">): Promise<string | null> {
  try {
    const r = await deps.store.completeAfterSend({ orgId, messageId, now: deps.now() });
    return r.result === "done" ? r.movedTo : null;
  } catch (err) {
    agentLog("error", { errorType: (err as Error)?.name ?? "Error", where: "outreach_after_send" });
    return null;
  }
}

/** Finishes follow-ups a crash left behind (outbox entries without "follow_done"), for one organization or all. Never throws. */
export async function repairAfterSend(orgId: string | undefined, limit = 25, d: Partial<OutreachDeps> = {}): Promise<number> {
  const deps = { ...defaults(), ...d };
  try {
    if (!(await outreachSafetyReady())) return 0;
    let n = 0;
    for (const p of await deps.store.pendingAfterSend({ orgId, limit })) {
      if ((await deps.store.completeAfterSend({ orgId: p.orgId, messageId: p.messageId, now: deps.now() })).result === "done") n++;
    }
    return n;
  } catch (err) {
    agentLog("error", { errorType: (err as Error)?.name ?? "Error", where: "outreach_after_send_repair" });
    return 0;
  }
}

/**
 * What follows a message going out, however it went (recorded by hand, or sent from the person's connected mailbox):
 * the timeline entry, the lead moving on to "contacted", and a follow-up due in a few days. With the outcome tables
 * (always, for Gmail sends) it runs from the outbox entry written with the send: durable, and done once. Returns the
 * stage the lead moved to, if any.
 */
export async function afterMessageSent(user: Who, o: { leadId: number; messageId: number; channel: "manual" | "gmail" | "gmail_confirmed"; now: Date }, d: Partial<OutreachDeps> = {}): Promise<string | null> {
  const deps = { ...defaults(), ...d };
  let outbox = false;
  try { outbox = await outreachSafetyReady(); } catch { outbox = false; }
  if (outbox) return finishAfterSend(user.organizationId!, o.messageId, deps);
  return legacyAfterSend(user, o);
}

/** The follow-up without an outbox (outcome tables not migrated yet): best effort, as before. */
async function legacyAfterSend(user: Who, o: { leadId: number; messageId: number; channel: "manual" | "gmail" | "gmail_confirmed"; now: Date }): Promise<string | null> {
  const orgId = user.organizationId!;
  await leadsStore.addEvent(orgId, o.leadId, { kind: "message_sent", data: { messageId: o.messageId, channel: o.channel }, actor: "user", actorUserId: user.id });
  const got = await getLead(user, o.leadId);
  if (!got.ok) return null;
  const lead = got.detail.lead;
  let movedTo: string | null = null;
  let status = lead.status as LeadStatus;
  for (const step of pathToContacted(status)) {
    if (!canMove(status, step)) break;
    const m = await moveLead(user, o.leadId, step, { actor: "user" });
    if (!m.ok) break;
    status = step; movedTo = step;
  }
  await createTicket(user, o.leadId, { title: `Follow up with ${lead.companyName}`, kind: "follow_up", dueAt: new Date(o.now.getTime() + FOLLOW_UP_DAYS * 86_400_000) }, { actor: "user" });
  return movedTo;
}

/** Throws the draft away (nothing was sent). Works from draft or approved; on a version awaiting a choice, the whole batch goes (it was one proposal). */
export async function cancelMessage(user: Who, id: number, d: Partial<OutreachDeps> = {}): Promise<Result<{ message: MessageView }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await ready())) return NOT_SETUP();
  const l = await load(user, id, deps);
  if (!l.ok) return l;
  if (l.row.status === "cancelled") return { ok: true, message: messageView(l.row) };
  if (l.row.status === "sending") return SENDING();
  if (l.row.status === "variant" && l.row.variantGroup) {
    const n = await deps.store.cancelVariants({ orgId: user.organizationId!, leadId: l.row.leadId, group: l.row.variantGroup, now: deps.now() });
    if (!n) return fail(409, "changed", "That message changed. Reload and try again.");
    await leadsStore.addEvent(user.organizationId!, l.row.leadId, { kind: "draft_cancelled", data: { messageId: id, versions: n }, actor: "user", actorUserId: user.id });
    const row = await deps.store.get(user.organizationId!, id);
    return { ok: true, message: messageView(row ?? { ...l.row, status: "cancelled" }) };
  }
  if (l.row.status !== "draft" && l.row.status !== "approved") return fail(409, "not_cancellable", `That message is already ${l.row.status}.`);
  const next = await deps.store.transition({ orgId: user.organizationId!, id, from: l.row.status as "draft" | "approved", to: "cancelled", now: deps.now() });
  if (!next) return fail(409, "changed", "That message changed. Reload and try again.");
  await leadsStore.addEvent(user.organizationId!, l.row.leadId, { kind: "draft_cancelled", data: { messageId: id }, actor: "user", actorUserId: user.id });
  return { ok: true, message: messageView(next) };
}

/* ── after sending: outcomes, the do-not-contact list, the review queue ─────────── */

/** An audit event, when the outcome tables exist. Never fails the action it records (the action already happened). */
async function recordEventSafely(orgId: string, e: { leadId: number; messageId: number; kind: string; userId: string; now: Date }, deps: OutreachDeps): Promise<boolean> {
  try {
    if (!(await outreachSafetyReady())) return false;
    return (await deps.store.recordEvent(orgId, { ...e, source: "manual", provider: null, providerMessageId: null })).created;
  } catch (err) {
    agentLog("error", { errorType: (err as Error)?.name ?? "Error", where: "outreach_event" });
    return false;
  }
}

/** Cancels every unsent (draft, approved, or version awaiting a choice) message to an address or domain that has just been put on the list. Returns how many. */
async function cancelUnsentTo(user: Who, entry: { kind: string; value: string }, deps: OutreachDeps): Promise<number> {
  const orgId = user.organizationId!;
  let n = 0;
  for (const m of await deps.store.listForOrg(orgId, ["draft", "approved", "variant"], 1000)) {
    if (!suppressionKeys(m.toAddress ?? "").some((k) => k.kind === entry.kind && k.value === entry.value)) continue;
    const done = await deps.store.transition({ orgId, id: m.id, from: m.status as "draft" | "approved" | "variant", to: "cancelled", now: deps.now() });
    if (done) { n++; await leadsStore.addEvent(orgId, m.leadId, { kind: "draft_cancelled", data: { messageId: m.id, why: "suppressed" }, actor: "user", actorUserId: user.id }); }
  }
  return n;
}

/**
 * What happened after the person sent the message from their own email app. Recorded once per message and kind.
 *   replied    the lead moves on to "replied" when its stage allows;
 *   bounced    the address goes on the do-not-contact list (it doesn't work);
 *   opted_out  the address goes on the list, the lead is marked do-not-contact, and anything unsent to it is cancelled.
 */
export async function recordOutcome(user: Who, id: number, raw: unknown, d: Partial<OutreachDeps> = {}): Promise<Result<{ outcome: Outcome; already: boolean; suppressed: boolean; cancelled: number; movedTo: string | null }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await ready())) return NOT_SETUP();
  const outcome = (raw as { outcome?: unknown })?.outcome;
  if (typeof outcome !== "string" || !(OUTCOMES as readonly string[]).includes(outcome)) return fail(400, "invalid", "Say what happened: they replied, it bounced, or they asked not to be contacted.");
  try { if (!(await outreachSafetyReady())) return SAFETY_NOT_SETUP(); } catch { return LIST_UNREADABLE(); }
  const l = await load(user, id, deps);
  if (!l.ok) return l;
  if (l.row.status !== "sent") return fail(409, "not_sent", "Record what happened after the message has been sent.");
  const orgId = user.organizationId!, now = deps.now(), kind = outcome as Outcome;
  const { created } = await deps.store.recordEvent(orgId, { leadId: l.row.leadId, messageId: id, kind, source: "manual", provider: null, providerMessageId: null, userId: user.id, now });
  if (!created) return { ok: true, outcome: kind, already: true, suppressed: false, cancelled: 0, movedTo: null };

  let suppressed = false, cancelled = 0, movedTo: string | null = null;
  const email = suppressionKeys(l.row.toAddress ?? "")[0];
  if ((kind === "bounced" || kind === "opted_out") && email) {
    const entry = await deps.store.addSuppression(orgId, { kind: "email", value: email.value, reason: kind === "bounced" ? "bounce" : "opt_out", sourceMessageId: id, note: null, userId: user.id, now });
    suppressed = true;
    cancelled = await cancelUnsentTo(user, entry.row, deps);
  }
  if (kind === "opted_out" && !l.lead.doNotContact) {
    const u = await updateLead(user, l.row.leadId, { doNotContact: true }, { actor: "user" });
    if (!u.ok) agentLog("error", { errorType: "OptOutNotMarked", where: "outreach_opt_out", code: u.code });
  }
  if (kind === "replied" && canMove(l.lead.status as LeadStatus, "replied")) {
    const m = await moveLead(user, l.row.leadId, "replied", { actor: "user" });
    if (m.ok) movedTo = "replied";
  }
  await leadsStore.addEvent(orgId, l.row.leadId, { kind: `outreach_${kind}`, data: { messageId: id }, actor: "user", actorUserId: user.id });
  return { ok: true, outcome: kind, already: false, suppressed, cancelled, movedTo };
}

export interface SuppressionView { id: number; kind: string; value: string; reason: string; reasonLabel: string; removable: boolean; note: string | null; createdAt: string }
const suppressionView = (r: { id: number; kind: string; value: string; reason: string; note: string | null; createdAt: Date | string }): SuppressionView => ({
  id: r.id, kind: r.kind, value: r.value, reason: r.reason, reasonLabel: SUPPRESSION_REASON_LABEL[r.reason as SuppressionReason] ?? r.reason, removable: isRemovable(r.reason), note: r.note, createdAt: iso(r.createdAt)!,
});

export async function listSuppressions(user: Who, d: Partial<OutreachDeps> = {}): Promise<Result<{ entries: SuppressionView[] }>> {
  const deps = { ...defaults(), ...d };
  const gate = readGate(user);
  if (gate) return gate;
  try { if (!(await outreachSafetyReady())) return SAFETY_NOT_SETUP(); } catch { return LIST_UNREADABLE(); }
  return { ok: true, entries: (await deps.store.listSuppressions(user.organizationId!, 500)).map(suppressionView) };
}

/** Adds an address or a whole domain by hand. Anything unsent to it is cancelled. */
export async function addSuppression(user: Who, raw: unknown, d: Partial<OutreachDeps> = {}): Promise<Result<{ entry: SuppressionView; created: boolean; cancelled: number }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  const p = parseSuppressionInput(raw);
  if (!p.ok) return fail(400, "invalid", p.message);
  try { if (!(await outreachSafetyReady())) return SAFETY_NOT_SETUP(); } catch { return LIST_UNREADABLE(); }
  const r = await deps.store.addSuppression(user.organizationId!, { kind: p.kind, value: p.value, reason: "manual", sourceMessageId: null, note: p.note, userId: user.id, now: deps.now() });
  const cancelled = await cancelUnsentTo(user, r.row, deps);
  return { ok: true, entry: suppressionView(r.row), created: r.created, cancelled };
}

/** Removes an entry the team added by hand. An opt-out, a bounce or a complaint stays: the person asked, or the address doesn't work. */
export async function removeSuppression(user: Who, id: number, d: Partial<OutreachDeps> = {}): Promise<Result<{ removed: true }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  try { if (!(await outreachSafetyReady())) return SAFETY_NOT_SETUP(); } catch { return LIST_UNREADABLE(); }
  const r = await deps.store.removeManualSuppression(user.organizationId!, id);
  if (!r) return fail(404, "not_removable", "That entry isn't in your list, or it records an opt-out or a bounce, which can't be removed.");
  return { ok: true, removed: true };
}

export interface QueueItem {
  message: MessageView;
  lead: { id: number; companyName: string; domain: string | null; status: string; doNotContact: boolean; contactName: string | null; contactRole: string | null; contactSource: string | null };
  /** Where the address came from: the contact the person chose (and how it was found), or the company's own site. */
  recipient: { address: string | null; source: string | null; detail: string | null };
  /** The facts the draft was written from, each with its source. */
  evidence: { id: number; field: string; value: string; status: string; url: string | null; quote: string | null }[];
  outcomes: string[];
  suppressed: boolean;
}

/** Every message waiting for review (draft, approved) and recently sent, across the organization's leads, with its evidence. */
export async function listOutreachQueue(user: Who, raw: { status?: unknown } = {}, d: Partial<OutreachDeps> = {}): Promise<Result<{ items: QueueItem[] }>> {
  const deps = { ...defaults(), ...d };
  const gate = readGate(user);
  if (gate) return gate;
  if (!(await ready())) return NOT_SETUP();
  const orgId = user.organizationId!;
  await repairAfterSend(orgId, 25, deps);
  const wanted = raw.status === "sent" ? ["sent"] : raw.status === "waiting" ? ["draft", "approved", "sending"] : ["draft", "approved", "sending", "sent"];
  const rows = await deps.store.listForOrg(orgId, wanted as ("draft" | "approved" | "sending" | "sent")[], 100);
  let safety = false;
  try { safety = await outreachSafetyReady(); } catch { safety = false; }
  const events = safety ? await deps.store.eventsFor(orgId, rows.map((r) => r.id)) : [];
  const leads = new Map<number, Awaited<ReturnType<typeof getLead>>>();
  const items: QueueItem[] = [];
  for (const m of rows) {
    if (!leads.has(m.leadId)) leads.set(m.leadId, await getLead(user, m.leadId));
    const got = leads.get(m.leadId)!;
    if (!got.ok) continue;
    const { lead, claims } = got.detail;
    const used = new Set(((m.claimIds as number[]) ?? []).map(Number));
    let suppressed = false;
    if (safety && m.toAddress) { try { suppressed = !!(await deps.store.suppressedMatch(orgId, suppressionKeys(m.toAddress))); } catch { suppressed = true; } }
    items.push({
      message: messageView(m),
      lead: { id: lead.id, companyName: lead.companyName, domain: lead.domain ?? null, status: lead.status, doNotContact: !!lead.doNotContact, contactName: lead.contactName ?? null, contactRole: lead.contactRole ?? null, contactSource: lead.contactSource ?? null },
      recipient: { address: m.toAddress, source: m.toSource, detail: m.toSource === "lead" ? lead.contactSource ?? null : m.toSource === "site" ? "Published on the company's own website" : null },
      evidence: claims.filter((c) => used.has(c.id)).map((c) => ({ id: c.id, field: c.field, value: c.value, status: c.status, url: c.evidenceUrl ?? null, quote: c.evidenceSnippet ?? null })),
      // Only what happened after sending (a reply, a bounce, an opt-out): "sent" and "opened" are audit entries, not outcomes.
      outcomes: events.filter((e) => e.messageId === m.id && (OUTCOMES as readonly string[]).includes(e.kind)).map((e) => e.kind),
      suppressed,
    });
  }
  return { ok: true, items };
}

/**
 * The only way the app hands an approved message to the person's email app: re-checked NOW against the lead's flag and
 * the organization's list, for exactly the text the person approved and is looking at (`bodyHash`; a stale page is
 * refused). Returns what to open. Opening is not sending: DealInSec can't see or stop what happens in the email app, so
 * the send is recorded separately (markSent), and checked again then.
 */
export async function openApproved(user: Who, id: number, bodyHash: unknown, d: Partial<OutreachDeps> = {}): Promise<Result<{ to: string; subject: string; body: string }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await ready())) return NOT_SETUP();
  if (typeof bodyHash !== "string" || !/^[a-f0-9]{64}$/.test(bodyHash)) return fail(400, "invalid", "Open the message you are looking at.");
  const l = await load(user, id, deps);
  if (!l.ok) return l;
  if (l.row.status === "sent") return fail(409, "already_sent", "That message is already recorded as sent.");
  if (l.row.status === "sending") return SENDING();
  if (l.row.status !== "approved") return fail(409, "not_approved", l.row.status === "cancelled" ? "That message was discarded, so it can't be opened." : "Approve the message before you open it in your email app.");
  if (l.row.bodyHash !== bodyHash) return fail(409, "changed", "The message changed since you read it. Reload it first.");
  if (!l.row.toAddress) return fail(422, "no_address", "This message has no address.");
  const dnc = doNotContact(l.lead);
  if (dnc) return dnc;
  const listed = await suppressionBlock(user.organizationId!, l.row.toAddress, deps);
  if (listed) return listed;
  await recordEventSafely(user.organizationId!, { leadId: l.row.leadId, messageId: id, kind: "opened", userId: user.id, now: deps.now() }, deps);
  return { ok: true, to: l.row.toAddress, subject: l.row.subject ?? "", body: l.row.body };
}

/**
 * A lead has just been marked do-not-contact: every unsent message to it (draft, approved, or a version awaiting a
 * choice) is discarded, so no earlier approval or pending version can be used. Called by services/leads.ts updateLead.
 * Organization-scoped. Returns how many were discarded.
 */
export async function discardUnsentForLead(orgId: string, leadId: number, actorUserId: string | null, d: Partial<OutreachDeps> = {}): Promise<number> {
  const deps = { ...defaults(), ...d };
  if (!(await ready())) return 0;
  let n = 0;
  for (const m of await deps.store.listForLead(orgId, leadId)) {
    if (m.direction !== "out" || (m.status !== "draft" && m.status !== "approved" && m.status !== "variant")) continue;
    const done = await deps.store.transition({ orgId, id: m.id, from: m.status as "draft" | "approved" | "variant", to: "cancelled", now: deps.now() });
    if (done) { n++; await leadsStore.addEvent(orgId, leadId, { kind: "draft_cancelled", data: { messageId: m.id, why: "do_not_contact" }, actor: "user", actorUserId }); }
  }
  return n;
}
