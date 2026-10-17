/**
 * Outreach on WhatsApp, LinkedIn and X (shared/channels.ts says what each channel can really do, and why).
 *
 *   draft → approved → sent            LinkedIn, X, or WhatsApp without a connected number: the PERSON sends it, outside
 *                                       DealInSec, and records that they did ("You marked it sent")
 *   draft → approved → sending → sent  WhatsApp through the Cloud API, with the workspace's connected business number;
 *                       ↘ failed | uncertain (no answer: never retried by itself)
 *
 * The same rules as email outreach (server/sales/outreach.ts), and the same do-not-contact list:
 *   - a lead marked do-not-contact, archived or closed takes no draft, approval or send (checked again at each step);
 *   - approval is of ONE text: the approver sends the hash of what they read, and sending refuses any other text;
 *   - every status change is one atomic UPDATE … WHERE status IN (expected), so a double click does the work once;
 *   - WhatsApp only to a number with a RECORDED opt-in (who, when, how), never one that asked to stop, and outside the
 *     24-hour window only an approved template; "STOP" in a reply opts the number out and stops follow-ups;
 *   - AI drafts are written only from verified facts, count against the plan's one AI-draft allowance, and are checked
 *     like email drafts (no price, invented link, false history, placeholder);
 *   - a WhatsApp API send counts against the plan's one send allowance (with Gmail), under the same lock;
 *   - message text is never logged; the timeline records ids, channels and counts.
 */
import { z } from "zod";
import {
  KIND_LABEL, CHANNEL_LABEL, checkChannelDraft, checkChannelText, isKindOf, isShortChannel, isStopReply, linkedinUrl, maxFor, normalPhone, statusLabel, xHandle,
  type ChannelStatus, type ChannelMessageStatus, type DeliveryState, type MessageKind, type SendMode, type ShortChannel,
} from "@shared/channels";
import { hashDraft } from "@shared/outreach-hash";
import { pathToContacted } from "@shared/outreach-safety";
import { canMove, type LeadStatus } from "@shared/leads";
import { siteHost } from "@shared/research";
import { modelFor, dailyLimit } from "@shared/llm-cost";
import { OUTBOUND_WINDOW_DAYS, TIER_LABEL, type OutboundTier } from "@shared/outbound-plans";
import type { ChannelMessageRow, WhatsappConnectionRow, WhatsappContactRow } from "@shared/schema";
import type { ScoreClaim } from "@shared/lead-score";
import { ProviderError, type ChatMessage } from "../copilot/provider";
import { agentLog } from "../agent/log";
import { parseJsonObject } from "../agent/extraction";
import { CapExceeded, CapUnavailable, GlobalCapExceeded, WorkspaceBudgetExceeded, assertWithinCap, tracedChat } from "../llm/traced";
import { decryptToken, encryptToken, loadKeyring, TokenCryptoError, type Keyring } from "../mail/token-crypto";
import { leadsStore } from "../leads/store";
import { fail, getLead, readGate, writeGate, type Result, type Who } from "../services/leads";
import { memberCan } from "@shared/permissions";
import { draftFacts } from "../sales/outreach";
import { messageStore, outreachSafetyReady } from "../sales/message-store";
import { AI_DRAFT_VERSION_PREFIX, outboundTier } from "../outbound/plan";
import { outboundAllowance } from "../outbound/limits";
import { CHANNEL_PROMPT_VERSION, channelSystemPrompt, channelUserMessage } from "./prompt";
import { ChannelAllowanceReached, ChannelDraftExists, ConnectionExists, channelStore, channelTablesReady, type ChannelStore } from "./store";
import { WhatsappError, fillTemplate, whatsappClient, type WhatsappClient, type WhatsappTemplate } from "./whatsapp-api";
import { parseNotification, verifySignature } from "./whatsapp-webhook";

const DAY = 86_400_000;
export const WINDOW_MS = 24 * 3_600_000;

/* ── configuration ───────────────────────────────────────────────────────── */

export interface WhatsappConfig { configured: boolean; reason: string | null; appSecret: string | null; verifyToken: string | null; allowed: (orgId: string) => boolean }

/** WhatsApp is available when DealInSec's Meta app is set up on this server (webhook secret and verify token) and tokens can be sealed. */
export function whatsappConfig(env: NodeJS.ProcessEnv = process.env): WhatsappConfig {
  const appSecret = env.WHATSAPP_APP_SECRET?.trim() || null, verifyToken = env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim() || null;
  const allow = (env.WHATSAPP_ALLOWED_ORG_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const allowed = (orgId: string) => !allow.length || allow.includes(orgId);
  if (env.WHATSAPP_ENABLED !== "true") return { configured: false, reason: "WhatsApp Business isn't switched on for DealInSec yet.", appSecret, verifyToken, allowed };
  if (!appSecret || !verifyToken) return { configured: false, reason: "WhatsApp Business isn't fully set up on this server yet.", appSecret, verifyToken, allowed };
  try { loadKeyring(env); } catch { return { configured: false, reason: "Credentials can't be stored securely on this server yet.", appSecret, verifyToken, allowed }; }
  return { configured: true, reason: null, appSecret, verifyToken, allowed };
}

export interface ChannelDeps {
  store: ChannelStore;
  wa: WhatsappClient;
  chat: typeof tracedChat;
  now: () => Date;
  env: NodeJS.ProcessEnv;
  ready: () => Promise<boolean>;
  tier: (user: Who) => Promise<OutboundTier>;
  /** The email outreach's do-not-contact list and follow-ups (shared with email on purpose). */
  safety: Pick<typeof messageStore, "suppressedMatch" | "addSuppression" | "stopLeadFollowups">;
  safetyReady: () => Promise<boolean>;
  /** Provider usage for cost accounting (provider_calls). */
  recordProviderCall: (r: { orgId: string; provider: string; operation: string; ok: boolean; errorCode: string | null; latencyMs: number; costMicroUsd: number; now: Date }) => Promise<void>;
}
const defaults = (): ChannelDeps => ({
  store: channelStore, wa: whatsappClient(), chat: tracedChat, now: () => new Date(), env: process.env,
  ready: async () => { try { return await channelTablesReady(); } catch { return false; } },
  tier: outboundTier, safety: messageStore, safetyReady: async () => { try { return await outreachSafetyReady(); } catch { return false; } },
  recordProviderCall: async (r) => { const { outboundStore } = await import("../outbound/store"); await outboundStore.recordProviderCall({ ...r, runId: null }); },
});

/* ── views ───────────────────────────────────────────────────────────────── */

export interface ChannelMessageView {
  id: number; leadId: number; channel: ShortChannel; kind: string; kindLabel: string; direction: "out" | "in"; body: string | null; bodyHash: string | null;
  to: string | null; template: { name: string; language: string; params: string[] } | null;
  status: ChannelMessageStatus | "received"; statusLabel: string; sentVia: SendMode | null; delivery: DeliveryState | null; errorCode: string | null;
  edited: boolean; createdBy: string; createdAt: string; approvedAt: string | null; sentAt: string | null; deliveredAt: string | null; readAt: string | null; repliedAt: string | null;
}
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
export function channelMessageView(m: ChannelMessageRow): ChannelMessageView {
  const channel = m.channel as ShortChannel, direction = m.direction === "in" ? "in" : "out";
  return {
    id: m.id, leadId: m.leadId, channel, kind: m.kind, kindLabel: direction === "in" ? "Reply" : KIND_LABEL[m.kind as MessageKind] ?? m.kind, direction,
    body: m.body, bodyHash: m.bodyHash, to: m.toAddress,
    template: m.templateName ? { name: m.templateName, language: m.templateLang ?? "", params: Array.isArray(m.templateParams) ? (m.templateParams as string[]) : [] } : null,
    status: m.status as ChannelMessageView["status"],
    statusLabel: direction === "in" ? "Received" : statusLabel({ status: m.status as ChannelMessageStatus, sentVia: m.sentVia as SendMode | null, delivery: m.delivery as DeliveryState | null, repliedAt: iso(m.repliedAt), channel }),
    sentVia: m.sentVia as SendMode | null, delivery: m.delivery as DeliveryState | null, errorCode: m.errorCode, edited: m.edited, createdBy: m.createdBy,
    createdAt: iso(m.createdAt)!, approvedAt: iso(m.approvedAt), sentAt: iso(m.sentAt), deliveredAt: iso(m.deliveredAt), readAt: iso(m.readAt), repliedAt: iso(m.repliedAt),
  };
}
export interface WhatsappContactView { phone: string; optedIn: boolean; optInSource: string | null; optedInAt: string | null; optedOut: boolean; windowOpenUntil: string | null }
const contactView = (c: WhatsappContactRow, now: Date): WhatsappContactView => {
  const until = c.lastInboundAt ? new Date(new Date(c.lastInboundAt).getTime() + WINDOW_MS) : null;
  return { phone: c.phone, optedIn: !!c.optedInAt && !c.optedOutAt, optInSource: c.optInSource, optedInAt: iso(c.optedInAt), optedOut: !!c.optedOutAt, windowOpenUntil: until && until > now ? until.toISOString() : null };
};

/* ── shared refusals ─────────────────────────────────────────────────────── */

const NOT_SETUP = () => fail(503, "CHANNELS_NOT_SETUP", "WhatsApp, LinkedIn and X messages aren't set up on this server yet. Email outreach works as usual.");
const blocked = (lead: { doNotContact?: boolean | null; archivedAt?: Date | string | null; status: string }) =>
  lead.doNotContact ? fail(409, "do_not_contact", "This lead is marked do-not-contact, so no message can be written, approved or sent to it.")
    : lead.archivedAt || lead.status === "won" || lead.status === "lost" ? fail(409, "closed", "This lead is closed, so it can't take a message.") : null;
const LIST_UNREADABLE = () => fail(503, "suppression_unavailable", "Your do-not-contact list couldn't be checked, so nothing was done. Try again shortly.");

async function phoneSuppressed(orgId: string, phone: string, deps: ChannelDeps) {
  let on: boolean;
  try { on = await deps.safetyReady(); } catch { return LIST_UNREADABLE(); }
  if (!on) return null;
  try {
    const hit = await deps.safety.suppressedMatch(orgId, [{ kind: "phone", value: phone }]);
    return hit ? fail(409, "suppressed", "This number is on your do-not-contact list, so nothing can be written or sent to it.") : null;
  } catch { return LIST_UNREADABLE(); }
}

/** A WhatsApp number this workspace may message: opted in (recorded), not opted out, not on the list. */
async function whatsappPermission(orgId: string, phone: string, deps: ChannelDeps): Promise<{ ok: true; contact: WhatsappContactRow } | { ok: false; refusal: ReturnType<typeof fail> }> {
  const listed = await phoneSuppressed(orgId, phone, deps);
  if (listed) return { ok: false, refusal: listed };
  const c = await deps.store.contact(orgId, phone);
  if (c?.optedOutAt) return { ok: false, refusal: fail(409, "opted_out", "This number asked not to get WhatsApp messages from you, so nothing can be sent to it.") };
  if (!c?.optedInAt) return { ok: false, refusal: fail(409, "no_opt_in", "WhatsApp needs their permission first. Record how this person agreed to hear from you on WhatsApp; a phone number found online isn't permission.") };
  return { ok: true, contact: c };
}

/** Where a message goes, normalized for its channel; LinkedIn and X may be left empty (a search link is offered instead). */
function recipient(channel: ShortChannel, raw: unknown): { ok: true; to: string | null } | { ok: false; refusal: ReturnType<typeof fail> } {
  if (channel === "whatsapp") {
    const p = normalPhone(raw);
    return p ? { ok: true, to: p } : { ok: false, refusal: fail(422, "no_phone", "Add their WhatsApp number with the country code, for example +91 98765 43210.") };
  }
  if (raw === undefined || raw === null || (typeof raw === "string" && !raw.trim())) return { ok: true, to: null };
  const to = channel === "linkedin" ? linkedinUrl(raw) : xHandle(raw);
  return to ? { ok: true, to } : { ok: false, refusal: fail(422, "bad_recipient", channel === "linkedin" ? "That isn't a LinkedIn profile or company page link (linkedin.com/in/… or /company/…)." : "That isn't an X handle (letters, digits and _, up to 15).") };
}

/* ── status ──────────────────────────────────────────────────────────────── */

export async function channelStatuses(user: Who, d: Partial<ChannelDeps> = {}): Promise<Result<{ channels: ChannelStatus[] }>> {
  const deps = { ...defaults(), ...d };
  const gate = readGate(user);
  if (gate) return gate;
  const orgId = user.organizationId!;
  const ready = await deps.ready();
  const cfg = whatsappConfig(deps.env);
  let whatsapp: ChannelStatus;
  const waCaps = (send: boolean) => ({ draft: true, send, deliveryStatus: send, replySync: send, openExternal: !send });
  if (!ready) whatsapp = { channel: "whatsapp", state: "not_configured", mode: "manual", capabilities: waCaps(false), note: "WhatsApp messages aren't set up on this server yet." };
  else if (!cfg.configured || !cfg.allowed(orgId)) whatsapp = { channel: "whatsapp", state: "not_configured", mode: "manual", capabilities: waCaps(false), note: `${cfg.reason ?? "WhatsApp Business isn't switched on for your workspace yet."} You can still write a message and send it from your own WhatsApp to someone who agreed to hear from you.` };
  else {
    const conn = await deps.store.liveConnection(orgId);
    if (!conn) whatsapp = { channel: "whatsapp", state: "awaiting_connection", mode: "manual", capabilities: waCaps(false), note: "No WhatsApp Business number is connected. An owner or admin can connect one in Settings → Integrations; until then you send from your own WhatsApp." };
    else if (conn.status === "needs_attention") whatsapp = { channel: "whatsapp", state: "permission_missing", mode: "manual", capabilities: waCaps(false), account: conn.displayPhone, note: "WhatsApp stopped accepting the connected number's access token. An owner or admin needs to reconnect it in Settings → Integrations." };
    else whatsapp = { channel: "whatsapp", state: "ready_to_send", mode: "api", capabilities: waCaps(true), account: conn.displayPhone, note: "Messages go out from your WhatsApp Business number, only to people who agreed to hear from you. Delivery and replies show here." };
  }
  const manualCaps = { draft: true, send: false, deliveryStatus: false, replySync: false, openExternal: true };
  return {
    ok: true,
    channels: [
      whatsapp,
      { channel: "linkedin", state: ready ? "sending_unavailable" : "not_configured", mode: "manual", capabilities: manualCaps, note: "LinkedIn doesn't let apps like DealInSec send messages or connection requests. DealInSec writes the note; you copy it and send it on LinkedIn yourself. Replies don't reach DealInSec, so record them yourself." },
      { channel: "x", state: ready ? "sending_unavailable" : "not_configured", mode: "manual", capabilities: manualCaps, note: "Sending Direct Messages from DealInSec would need X's paid API access, which DealInSec doesn't have. DealInSec writes the message; you copy it and send it on X yourself." },
    ],
  };
}

/* ── list ────────────────────────────────────────────────────────────────── */

export async function listChannelMessages(user: Who, leadId: number, d: Partial<ChannelDeps> = {}): Promise<Result<{ messages: ChannelMessageView[]; whatsappContacts: WhatsappContactView[] }>> {
  const deps = { ...defaults(), ...d };
  const gate = readGate(user);
  if (gate) return gate;
  if (!(await deps.ready())) return NOT_SETUP();
  const got = await getLead(user, leadId);
  if (!got.ok) return got;
  const orgId = user.organizationId!, now = deps.now();
  const [rows, contacts] = await Promise.all([deps.store.listForLead(orgId, leadId), deps.store.contactsForLead(orgId, leadId)]);
  return { ok: true, messages: rows.map(channelMessageView), whatsappContacts: contacts.map((c) => contactView(c, now)) };
}

/* ── draft ───────────────────────────────────────────────────────────────── */

const draftSchema = z.object({
  channel: z.string(), kind: z.string(), to: z.string().max(300).optional().nullable(),
  /** "ai": written by the model from verified facts; "own": the person's own text (or a template's filled-in body). */
  write: z.enum(["ai", "own"]),
  text: z.string().max(10_000).optional(),
  template: z.object({ name: z.string().min(1).max(120), language: z.string().min(2).max(15), params: z.array(z.string().trim().min(1).max(200)).max(10) }).optional(),
  premium: z.boolean().optional(),
});

async function connectionToken(orgId: string, deps: ChannelDeps): Promise<{ ok: true; conn: WhatsappConnectionRow; token: string } | { ok: false; refusal: ReturnType<typeof fail> }> {
  const cfg = whatsappConfig(deps.env);
  if (!cfg.configured || !cfg.allowed(orgId)) return { ok: false, refusal: fail(409, "whatsapp_not_connected", "WhatsApp Business isn't connected for your workspace, so this can't go through WhatsApp from here.") };
  const conn = await deps.store.liveConnection(orgId);
  if (!conn || conn.status !== "active" || !conn.accessTokenEnc) return { ok: false, refusal: fail(409, "whatsapp_not_connected", conn ? "WhatsApp needs the business number reconnected first (Settings → Integrations)." : "No WhatsApp Business number is connected. An owner or admin can connect one in Settings → Integrations.") };
  try {
    const token = decryptToken(conn.accessTokenEnc, { organizationId: orgId, userId: conn.connectedBy, connectionId: conn.id, provider: "whatsapp" }, loadKeyring(deps.env));
    return { ok: true, conn, token };
  } catch (e) {
    agentLog("error", { errorType: e instanceof TokenCryptoError ? `token_${e.code}` : "token_error", where: "whatsapp_token" });
    return { ok: false, refusal: fail(503, "whatsapp_token", "The WhatsApp connection's credentials couldn't be read. An owner or admin needs to reconnect it.") };
  }
}

/** The approved template by name and language, read live from the business account (so a paused or rejected one is never sent). */
async function findTemplate(orgId: string, name: string, language: string, deps: ChannelDeps): Promise<{ ok: true; t: WhatsappTemplate; token: string; conn: WhatsappConnectionRow } | { ok: false; refusal: ReturnType<typeof fail> }> {
  const c = await connectionToken(orgId, deps);
  if (!c.ok) return c;
  let list: WhatsappTemplate[];
  try { list = await deps.wa.templates(c.token, c.conn.wabaId); }
  catch (e) { return { ok: false, refusal: waRefusal(e, orgId, c.conn, deps) }; }
  const t = list.find((x) => x.name === name && x.language === language);
  return t ? { ok: true, t, token: c.token, conn: c.conn } : { ok: false, refusal: fail(409, "template_unavailable", "That template isn't approved for your WhatsApp Business account (or no longer is). Pick another one.") };
}

function waRefusal(e: unknown, orgId: string, conn: WhatsappConnectionRow, deps: ChannelDeps) {
  const code = e instanceof WhatsappError ? e.code : "rejected";
  if (code === "auth" || code === "permission") void deps.store.setConnectionState(orgId, conn.id, { status: "needs_attention", errorCode: code, now: deps.now() }).catch(() => {});
  const msg: Record<string, string> = {
    auth: "WhatsApp no longer accepts the connected number's access token. An owner or admin needs to reconnect it.",
    permission: "The connected WhatsApp token is missing a permission this needs. An owner or admin needs to reconnect it.",
    rate_limited: "WhatsApp is limiting messages from your number right now. Try again later.",
  };
  return fail(code === "rate_limited" ? 429 : 502, `whatsapp_${code}`, msg[code] ?? "WhatsApp refused the request. Try again in a moment.");
}

export async function draftChannelMessage(user: Who, leadId: number, raw: unknown, d: Partial<ChannelDeps> = {}): Promise<Result<{ message: ChannelMessageView; retried: boolean }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await deps.ready())) return NOT_SETUP();
  const parsed = draftSchema.safeParse(raw ?? {});
  if (!parsed.success) return fail(400, "invalid", "That request isn't valid.");
  const i = parsed.data;
  if (!isShortChannel(i.channel) || !isKindOf(i.channel, i.kind)) return fail(400, "invalid", "That channel or message type isn't supported.");
  const channel = i.channel, kind = i.kind as MessageKind;
  const got = await getLead(user, leadId);
  if (!got.ok) return got;
  const { lead, claims } = got.detail;
  const stop = blocked(lead);
  if (stop) return stop;
  const orgId = user.organizationId!;
  const to = recipient(channel, i.to);
  if (!to.ok) return to.refusal;
  if (channel === "whatsapp") {
    const perm = await whatsappPermission(orgId, to.to!, deps);
    if (!perm.ok) return perm.refusal;
  }

  let body: string, promptVersion: string | null = null, claimIds: number[] = [], retried = false;
  let template: { name: string; language: string; params: string[] } | null = null;
  if (kind === "template") {
    if (i.write !== "own" || !i.template) return fail(400, "invalid", "Pick an approved template and fill in its values.");
    const found = await findTemplate(orgId, i.template.name, i.template.language, deps);
    if (!found.ok) return found.refusal;
    if (i.template.params.length !== found.t.params) return fail(422, "template_params", `That template needs ${found.t.params} value${found.t.params === 1 ? "" : "s"}.`);
    template = { name: found.t.name, language: found.t.language, params: i.template.params };
    body = fillTemplate(found.t.body, template.params);
  } else if (i.write === "own") {
    const issues = checkChannelText(i.text ?? "", kind, { premium: i.premium });
    if (issues.length) return fail(422, "invalid_text", issues[0].message, { issues: issues.map((x) => x.code) });
    body = (i.text ?? "").replace(/\r\n/g, "\n").trim();
  } else {
    const ai = await aiDraft(user, lead, claims, channel, kind, deps);
    if (!ai.ok) return ai;
    ({ body, claimIds, retried } = ai);
    promptVersion = CHANNEL_PROMPT_VERSION;
  }

  let row: ChannelMessageRow;
  const tier = promptVersion ? await deps.tier(user) : null;
  const plan = tier ? outboundAllowance(tier) : null;
  try {
    row = await deps.store.create({
      orgId, leadId, channel, kind, body, bodyHash: hashDraft("", body), toAddress: to.to, templateName: template?.name ?? null, templateLang: template?.language ?? null, templateParams: template?.params ?? null,
      promptVersion, claimIds, by: "user", userId: user.id, now: deps.now(),
      ...(plan ? { allowance: { since: new Date(deps.now().getTime() - OUTBOUND_WINDOW_DAYS * DAY), max: plan.monthlyDrafts, prefix: AI_DRAFT_VERSION_PREFIX } } : {}),
    });
  } catch (e) {
    if (e instanceof ChannelDraftExists) return fail(409, "draft_exists", `This lead already has a ${CHANNEL_LABEL[channel]} message waiting. Send or discard it first.`);
    if (e instanceof ChannelAllowanceReached) return draftLimit(tier!, plan!.monthlyDrafts);
    throw e;
  }
  await leadsStore.addEvent(orgId, leadId, { kind: "channel_draft_created", data: { messageId: row.id, channel, kind, ai: !!promptVersion }, actor: "user", actorUserId: user.id });
  return { ok: true, message: channelMessageView(row), retried };
}

const draftLimit = (tier: OutboundTier, max: number) => tier === "free"
  ? fail(402, "NO_CREDITS", `You've used the free plan's ${max} AI drafts for this 30-day period. Upgrade to Pro for more, or write this message yourself.`, { feature: "outbound" })
  : fail(429, "draft_allowance", `You've used the ${max} AI drafts included in ${TIER_LABEL[tier]} for this 30-day period; you can still write this message yourself.`);

async function aiDraft(user: Who, lead: any, claims: any[], channel: ShortChannel, kind: MessageKind, deps: ChannelDeps): Promise<{ ok: true; body: string; claimIds: number[]; retried: boolean } | ReturnType<typeof fail>> {
  if (kind === "template") return fail(400, "invalid", "A template's wording is fixed by WhatsApp; fill in its values instead.");
  const orgId = user.organizationId!;
  const scoreClaims: ScoreClaim[] = claims.map((c) => ({ id: c.id, field: c.field, value: c.value, status: c.status, evidenceUrl: c.evidenceUrl, createdAt: c.createdAt }));
  const { facts, angles } = draftFacts(scoreClaims);
  if (!facts.length) return fail(422, "no_facts", "There is nothing verified about this company to write from yet. Research the lead first, or write the message yourself.");
  const tier = await deps.tier(user);
  const plan = outboundAllowance(tier);
  const since = new Date(deps.now().getTime() - OUTBOUND_WINDOW_DAYS * DAY);
  if ((await deps.store.countAiDrafts(orgId, since, AI_DRAFT_VERSION_PREFIX)) >= plan.monthlyDrafts) return draftLimit(tier, plan.monthlyDrafts);
  const budget = (e: unknown) => e instanceof WorkspaceBudgetExceeded ? fail(429, "workspace_budget", "This workspace's AI usage for the last 30 days has reached its limit.")
    : e instanceof GlobalCapExceeded ? fail(429, "global_limit", "Today's AI budget for drafting is used up for everyone on DealInSec. It resets at midnight UTC.")
      : e instanceof CapExceeded ? fail(429, "daily_limit", `You've used today's ${dailyLimit("draft")} drafts. Try again tomorrow.`)
        : e instanceof CapUnavailable ? fail(503, "SALES_NOT_SETUP", "The writing assistant isn't set up on this server yet.") : null;
  try { await assertWithinCap("draft", orgId); } catch (e) { const r = budget(e); if (r) return r; throw e; }

  const { storage } = await import("../storage");
  const { getIdealClient } = await import("../services/ideal-client");
  const [org, ideal] = await Promise.all([storage.getOrganization(orgId), getIdealClient(user)]);
  const input = {
    sender: { name: [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || org?.name || "The team", business: org?.name ?? "" },
    offer: ideal.ok ? { about: ideal.profile.about, services: ideal.profile.services } : { about: null, services: [] },
    company: lead.companyName, greetName: lead.contactName?.trim() || null, facts, angles, notes: [],
    angle: await import("../outbound/lead-angle").then((m) => m.angleForLead(orgId, lead.id)).catch(() => null),
  };
  const site = siteHost(lead.domain || (() => { try { return new URL(lead.website ?? "").hostname; } catch { return ""; } })());
  const trace = { task: "draft" as const, orgId, userId: user.id, leadId: lead.id, promptVersion: CHANNEL_PROMPT_VERSION };
  const messages: ChatMessage[] = [{ role: "system", content: channelSystemPrompt(channel, kind) }, { role: "user", content: channelUserMessage(input) }];
  let text: string | null = null, issues: { code: string; message: string }[] = [], retried = false;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const reply = await deps.chat(trace, messages, { maxTokens: 1200, model: modelFor("draft") });
      const raw = parseJsonObject(reply.content) as { text?: unknown } | null;
      text = raw && typeof raw.text === "string" ? raw.text.replace(/\r\n/g, "\n").trim() : null;
      issues = text ? checkChannelDraft(text, kind, { siteHost: site }) : [{ code: "body_length", message: "Reply with only the JSON object: {\"text\":...}." }];
      if (!issues.length) break;
      retried = true;
      messages.push({ role: "assistant", content: reply.content ?? "" }, { role: "user", content: `That message cannot be used. Fix these problems and return the JSON object again:\n${issues.map((x) => `- ${x.message}`).join("\n")}` });
    }
  } catch (e) {
    const r = budget(e);
    if (r) return r;
    agentLog("error", { errorType: (e as Error)?.name ?? "Error", where: "channel_draft", code: e instanceof ProviderError ? e.code : "internal" });
    return fail(502, "model_unavailable", "The writing assistant didn't answer. Try again in a moment.");
  }
  if (!text || issues.length) return fail(422, "draft_rejected", "The draft didn't pass the safety checks, so it wasn't saved. Try again, or write the message yourself.", { issues: issues.map((x) => x.code) });
  return { ok: true, body: text, claimIds: [...facts, ...angles].map((f) => f.id), retried };
}

/* ── edit, approve, cancel ───────────────────────────────────────────────── */

async function loadOwn(user: Who, id: number, deps: ChannelDeps) {
  const row = await deps.store.get(user.organizationId!, id);
  if (!row || row.direction !== "out") return { ok: false as const, refusal: fail(404, "not_found", "That message isn't in your workspace.") };
  const got = await getLead(user, row.leadId);
  if (!got.ok) return { ok: false as const, refusal: got };
  return { ok: true as const, row, lead: got.detail.lead };
}

const editSchema = z.object({ text: z.string().max(10_000).optional(), to: z.string().max(300).optional().nullable(), params: z.array(z.string().trim().min(1).max(200)).max(10).optional(), premium: z.boolean().optional() });

export async function editChannelMessage(user: Who, id: number, raw: unknown, d: Partial<ChannelDeps> = {}): Promise<Result<{ message: ChannelMessageView }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await deps.ready())) return NOT_SETUP();
  const parsed = editSchema.safeParse(raw ?? {});
  if (!parsed.success) return fail(400, "invalid", "That edit isn't valid.");
  const l = await loadOwn(user, id, deps);
  if (!l.ok) return l.refusal;
  const stop = blocked(l.lead);
  if (stop) return stop;
  const { row } = l, channel = row.channel as ShortChannel, kind = row.kind as MessageKind;
  if (row.status !== "draft" && row.status !== "approved") return fail(409, "not_editable", "Only a message that hasn't been sent can be changed.");
  let body = row.body ?? "", params = Array.isArray(row.templateParams) ? (row.templateParams as string[]) : null;
  if (kind === "template") {
    if (!parsed.data.params) return fail(400, "invalid", "A template's wording is fixed; change its values.");
    const found = await findTemplate(user.organizationId!, row.templateName ?? "", row.templateLang ?? "", deps);
    if (!found.ok) return found.refusal;
    if (parsed.data.params.length !== found.t.params) return fail(422, "template_params", `That template needs ${found.t.params} value${found.t.params === 1 ? "" : "s"}.`);
    params = parsed.data.params; body = fillTemplate(found.t.body, params);
  } else if (parsed.data.text !== undefined) {
    const issues = checkChannelText(parsed.data.text, kind, { premium: parsed.data.premium });
    if (issues.length) return fail(422, "invalid_text", issues[0].message, { issues: issues.map((x) => x.code) });
    body = parsed.data.text.replace(/\r\n/g, "\n").trim();
  }
  let toAddress = row.toAddress;
  if (parsed.data.to !== undefined) {
    const to = recipient(channel, parsed.data.to);
    if (!to.ok) return to.refusal;
    if (channel === "whatsapp") { const perm = await whatsappPermission(user.organizationId!, to.to!, deps); if (!perm.ok) return perm.refusal; }
    toAddress = to.to;
  }
  const next = await deps.store.transition({ orgId: user.organizationId!, id, from: ["draft", "approved"], set: { body, bodyHash: hashDraft("", body), toAddress, templateParams: params, status: "draft", edited: true, approvedAt: null, approvedBy: null, updatedAt: deps.now() } });
  if (!next) return fail(409, "changed", "That message changed meanwhile. Reload and try again.");
  return { ok: true, message: channelMessageView(next) };
}

const hashOk = (h: unknown): h is string => typeof h === "string" && /^[a-f0-9]{64}$/.test(h);

export async function approveChannelMessage(user: Who, id: number, bodyHash: unknown, d: Partial<ChannelDeps> = {}): Promise<Result<{ message: ChannelMessageView }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await deps.ready())) return NOT_SETUP();
  if (!hashOk(bodyHash)) return fail(400, "invalid", "Approve the message you're looking at.");
  const l = await loadOwn(user, id, deps);
  if (!l.ok) return l.refusal;
  const stop = blocked(l.lead);
  if (stop) return stop;
  if (l.row.status === "approved" && l.row.bodyHash === bodyHash) return { ok: true, message: channelMessageView(l.row) };
  if (l.row.status !== "draft") return fail(409, "not_draft", "Only a draft can be approved.");
  if (l.row.bodyHash !== bodyHash) return fail(409, "changed", "The message changed since you read it. Read it again and approve that.");
  if (l.row.channel === "whatsapp") { const perm = await whatsappPermission(user.organizationId!, l.row.toAddress ?? "", deps); if (!perm.ok) return perm.refusal; }
  const next = await deps.store.transition({ orgId: user.organizationId!, id, from: ["draft"], hash: bodyHash, set: { status: "approved", approvedBy: user.id, approvedAt: deps.now(), updatedAt: deps.now() } });
  if (!next) return fail(409, "changed", "The message changed since you read it. Read it again and approve that.");
  return { ok: true, message: channelMessageView(next) };
}

export async function cancelChannelMessage(user: Who, id: number, d: Partial<ChannelDeps> = {}): Promise<Result<{ message: ChannelMessageView }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await deps.ready())) return NOT_SETUP();
  const l = await loadOwn(user, id, deps);
  if (!l.ok) return l.refusal;
  const next = await deps.store.transition({ orgId: user.organizationId!, id, from: ["draft", "approved", "failed"], set: { status: "cancelled", updatedAt: deps.now() } });
  if (!next) return fail(409, "not_cancellable", l.row.status === "sending" || l.row.status === "uncertain" ? "This message is being sent or waiting for its outcome, so it can't be discarded." : "Only an unsent message can be discarded.");
  return { ok: true, message: channelMessageView(next) };
}

/* ── after a send: the lead moves on, as with email ──────────────────────── */

async function afterSend(orgId: string, leadId: number, channel: ShortChannel, via: SendMode, messageId: number, userId: string | null, deps: ChannelDeps) {
  await leadsStore.addEvent(orgId, leadId, { kind: "channel_message_sent", data: { messageId, channel, via }, actor: "user", actorUserId: userId });
  const lead = await leadsStore.get(orgId, leadId);
  if (!lead) return;
  const path = pathToContacted(lead.status);
  let from = lead.status as LeadStatus;
  for (const to of path) {
    const moved = await leadsStore.setStatus(orgId, leadId, from, to);
    if (!moved) break;
    await leadsStore.addEvent(orgId, leadId, { kind: "status_changed", data: { from, to, via: `${channel}_send` }, actor: "user", actorUserId: userId });
    from = to;
  }
}

/* ── manual send (LinkedIn, X, or WhatsApp from the person's own phone) ──── */

export async function markChannelSent(user: Who, id: number, bodyHash: unknown, d: Partial<ChannelDeps> = {}): Promise<Result<{ message: ChannelMessageView; already: boolean }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await deps.ready())) return NOT_SETUP();
  if (!hashOk(bodyHash)) return fail(400, "invalid", "Record the message you're looking at.");
  const l = await loadOwn(user, id, deps);
  if (!l.ok) return l.refusal;
  const { row } = l, orgId = user.organizationId!;
  if (row.status === "sent") return { ok: true, message: channelMessageView(row), already: true };
  if (row.status !== "approved") return fail(409, "not_approved", row.status === "draft" ? "Approve the message before you record it as sent." : "That message can't be recorded as sent.");
  if (l.lead.doNotContact) return fail(409, "do_not_contact", "This lead is marked do-not-contact, so this message can't be recorded as sent.");
  if (row.channel === "whatsapp") {
    // With a connected number, WhatsApp goes through the API (so delivery and replies are tracked); without one, from their own phone.
    const conn = whatsappConfig(deps.env).configured ? await deps.store.liveConnection(orgId) : null;
    if (conn?.status === "active") return fail(409, "use_api", "Your WhatsApp Business number is connected: send it from DealInSec so delivery and replies are tracked.");
    const perm = await whatsappPermission(orgId, row.toAddress ?? "", deps);
    if (!perm.ok) return perm.refusal;
  }
  const now = deps.now();
  const next = await deps.store.transition({ orgId, id, from: ["approved"], hash: bodyHash, set: { status: "sent", sentVia: "manual", sentAt: now, updatedAt: now } });
  if (!next) return fail(409, "changed", "The message changed since you read it. Reload and try again.");
  await afterSend(orgId, row.leadId, row.channel as ShortChannel, "manual", row.id, user.id, deps);
  return { ok: true, message: channelMessageView(next), already: false };
}

/* ── WhatsApp send through the Cloud API ─────────────────────────────────── */

export async function sendWhatsapp(user: Who, id: number, bodyHash: unknown, d: Partial<ChannelDeps> = {}): Promise<Result<{ message: ChannelMessageView }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await deps.ready())) return NOT_SETUP();
  if (!hashOk(bodyHash)) return fail(400, "invalid", "Send the message you're looking at.");
  const l = await loadOwn(user, id, deps);
  if (!l.ok) return l.refusal;
  const { row } = l, orgId = user.organizationId!;
  if (row.channel !== "whatsapp") return fail(409, "manual_channel", `${CHANNEL_LABEL[row.channel as ShortChannel]} messages are sent by you, outside DealInSec.`);
  if (row.status === "sent") return { ok: true, message: channelMessageView(row) };
  if (row.status !== "approved") return fail(409, "not_approved", row.status === "draft" ? "Approve the message before you send it." : row.status === "sending" || row.status === "uncertain" ? "This message is already being sent, or waiting for its outcome." : "That message can't be sent.");
  if (row.bodyHash !== bodyHash || hashDraft("", row.body ?? "") !== bodyHash) return fail(409, "changed", "The message changed since you approved it. Read it again and approve that.");
  const stop = blocked(l.lead);
  if (stop) return stop;
  const to = row.toAddress ?? "";
  const perm = await whatsappPermission(orgId, to, deps);
  if (!perm.ok) return perm.refusal;
  const now = deps.now();
  if (row.kind === "text") {
    const last = perm.contact.lastInboundAt ? new Date(perm.contact.lastInboundAt).getTime() : 0;
    if (now.getTime() - last >= WINDOW_MS) return fail(409, "window_closed", "It's been more than 24 hours since they last wrote to you, so WhatsApp only allows an approved template now. Write it as a template message instead.");
  }
  // The token, and for a template the live list, before anything is reserved.
  let token: string, conn: WhatsappConnectionRow, template: WhatsappTemplate | null = null;
  if (row.kind === "template") {
    const found = await findTemplate(orgId, row.templateName ?? "", row.templateLang ?? "", deps);
    if (!found.ok) return found.refusal;
    if (fillTemplate(found.t.body, (row.templateParams as string[]) ?? []) !== row.body) return fail(409, "template_changed", "The template's wording changed on WhatsApp since this was approved. Write it again from the template.");
    ({ token, conn } = found); template = found.t;
  } else {
    const c = await connectionToken(orgId, deps);
    if (!c.ok) return c.refusal;
    ({ token, conn } = c);
  }
  const tier = await deps.tier(user);
  const plan = outboundAllowance(tier);
  const reserved = await deps.store.reserveSend({ orgId, id, hash: bodyHash, now, allowance: { since: new Date(now.getTime() - OUTBOUND_WINDOW_DAYS * DAY), max: plan.monthlySends } });
  if (!reserved.ok) {
    if (reserved.code === "not_approved") return fail(409, "changed", "That message changed or is already being sent. Reload and try again.");
    return tier === "free"
      ? fail(402, "NO_CREDITS", `You've used the free plan's ${plan.monthlySends} sends for this 30-day period. Upgrade to Pro for more, or send it from your own phone.`, { feature: "outbound" })
      : fail(429, "plan_send_limit", `You've used the ${plan.monthlySends} sends included in ${TIER_LABEL[tier]} for this 30-day period.`);
  }
  const t0 = Date.now();
  try {
    const sent = row.kind === "template"
      ? await deps.wa.sendTemplate(token, conn.phoneNumberId, to, { name: template!.name, language: template!.language, params: (row.templateParams as string[]) ?? [] })
      : await deps.wa.sendText(token, conn.phoneNumberId, to, row.body ?? "");
    const done = await deps.store.transition({ orgId, id, from: ["sending"], set: { status: "sent", sentVia: "api", sentAt: deps.now(), providerMessageId: sent.id, errorCode: null, updatedAt: deps.now() } });
    await deps.recordProviderCall({ orgId, provider: "whatsapp", operation: row.kind === "template" ? "whatsapp_template" : "whatsapp_text", ok: true, errorCode: null, latencyMs: Date.now() - t0, costMicroUsd: 0, now: deps.now() }).catch(() => {});
    await afterSend(orgId, row.leadId, "whatsapp", "api", row.id, user.id, deps);
    return { ok: true, message: channelMessageView(done ?? (await deps.store.get(orgId, id))!) };
  } catch (e) {
    const code = e instanceof WhatsappError ? e.code : "uncertain";
    await deps.recordProviderCall({ orgId, provider: "whatsapp", operation: row.kind === "template" ? "whatsapp_template" : "whatsapp_text", ok: false, errorCode: code, latencyMs: Date.now() - t0, costMicroUsd: 0, now: deps.now() }).catch(() => {});
    if (code === "uncertain") {
      await deps.store.transition({ orgId, id, from: ["sending"], set: { status: "uncertain", errorCode: "no_answer", updatedAt: deps.now() } });
      return fail(502, "uncertain", "WhatsApp didn't answer, so it isn't known whether the message went out. It won't be sent again by itself; check with them, then mark what happened.");
    }
    await deps.store.transition({ orgId, id, from: ["sending"], set: { status: "failed", errorCode: `whatsapp_${code}`.slice(0, 40), updatedAt: deps.now() } });
    return waRefusal(e, orgId, conn, deps);
  }
}

/** A person settles a WhatsApp send nobody heard back about: it arrived, or it didn't (which frees the message for a new draft). */
export async function resolveUncertain(user: Who, id: number, raw: unknown, d: Partial<ChannelDeps> = {}): Promise<Result<{ message: ChannelMessageView }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await deps.ready())) return NOT_SETUP();
  const outcome = (raw as { outcome?: unknown })?.outcome;
  if (outcome !== "sent" && outcome !== "not_sent") return fail(400, "invalid", "Say whether it arrived.");
  const l = await loadOwn(user, id, deps);
  if (!l.ok) return l.refusal;
  const now = deps.now();
  const next = await deps.store.transition({ orgId: user.organizationId!, id, from: ["uncertain"], set: outcome === "sent"
    ? { status: "sent", sentVia: "api", sentAt: now, errorCode: "confirmed_by_user", updatedAt: now }
    : { status: "failed", errorCode: "resolved_not_sent", updatedAt: now } });
  if (!next) return fail(409, "not_uncertain", "That message isn't waiting for an outcome.");
  if (outcome === "sent") await afterSend(user.organizationId!, l.row.leadId, "whatsapp", "api", id, user.id, deps);
  return { ok: true, message: channelMessageView(next) };
}

/* ── replies recorded by the person (LinkedIn, X, manual WhatsApp) ───────── */

async function onReply(orgId: string, leadId: number, channel: ShortChannel, messageId: number | null, via: "manual" | "provider", userId: string | null, deps: ChannelDeps) {
  // A reply on any channel stops the lead's email follow-ups too: nobody gets "just following up" after answering.
  await deps.safety.stopLeadFollowups({ orgId, leadId, reason: "replied", now: deps.now() }).catch(() => 0);
  await leadsStore.addEvent(orgId, leadId, { kind: "channel_reply", data: { messageId, channel, via }, actor: "user", actorUserId: userId });
  const lead = await leadsStore.get(orgId, leadId);
  if (lead && !lead.archivedAt && canMove(lead.status as LeadStatus, "replied")) {
    const moved = await leadsStore.setStatus(orgId, leadId, lead.status as LeadStatus, "replied");
    if (moved) await leadsStore.addEvent(orgId, leadId, { kind: "status_changed", data: { from: lead.status, to: "replied", via: `${channel}_reply` }, actor: "user", actorUserId: userId });
  }
}

export async function recordChannelReply(user: Who, id: number, d: Partial<ChannelDeps> = {}): Promise<Result<{ message: ChannelMessageView; already: boolean }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await deps.ready())) return NOT_SETUP();
  const l = await loadOwn(user, id, deps);
  if (!l.ok) return l.refusal;
  if (l.row.status !== "sent") return fail(409, "not_sent", "Only a sent message can have a reply.");
  if (l.row.repliedAt) return { ok: true, message: channelMessageView(l.row), already: true };
  const next = await deps.store.transition({ orgId: user.organizationId!, id, from: ["sent"], set: { repliedAt: deps.now(), updatedAt: deps.now() } });
  if (!next) return fail(409, "changed", "That message changed meanwhile. Reload and try again.");
  await onReply(user.organizationId!, l.row.leadId, l.row.channel as ShortChannel, id, "manual", user.id, deps);
  return { ok: true, message: channelMessageView(next), already: false };
}

/* ── WhatsApp opt-in and opt-out ─────────────────────────────────────────── */

const optInSchema = z.object({
  phone: z.string().max(40),
  /** How they agreed, in the person's words: Meta requires the business to have obtained it. */
  source: z.string().trim().min(8, "Say how they agreed, for example \"asked us to WhatsApp them on our website form, 12 Oct\".").max(200),
});

export async function recordWhatsappOptIn(user: Who, leadId: number, raw: unknown, d: Partial<ChannelDeps> = {}): Promise<Result<{ contact: WhatsappContactView }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await deps.ready())) return NOT_SETUP();
  const parsed = optInSchema.safeParse(raw ?? {});
  if (!parsed.success) return fail(400, "invalid", parsed.error.issues[0]?.message ?? "That isn't valid.");
  const phone = normalPhone(parsed.data.phone);
  if (!phone) return fail(422, "no_phone", "Add their WhatsApp number with the country code, for example +91 98765 43210.");
  const got = await getLead(user, leadId);
  if (!got.ok) return got;
  const stop = blocked(got.detail.lead);
  if (stop) return stop;
  const orgId = user.organizationId!;
  const listed = await phoneSuppressed(orgId, phone, deps);
  if (listed) return listed;
  const c = await deps.store.recordOptIn({ orgId, phone, leadId, source: parsed.data.source, userId: user.id, now: deps.now() });
  if (c.optedOutAt) return fail(409, "opted_out", "This number asked not to get WhatsApp messages from you, so permission can't be recorded for it again.");
  await leadsStore.addEvent(orgId, leadId, { kind: "channel_opt_in", data: { channel: "whatsapp" }, actor: "user", actorUserId: user.id });
  return { ok: true, contact: contactView(c, deps.now()) };
}

async function optOut(orgId: string, phone: string, leadId: number | null, userId: string | null, deps: ChannelDeps) {
  const now = deps.now();
  await deps.store.recordOptOut({ orgId, phone, leadId, now });
  if (await deps.safetyReady().catch(() => false)) await deps.safety.addSuppression(orgId, { kind: "phone", value: phone, reason: "opt_out", sourceMessageId: null, note: "Asked to stop on WhatsApp", userId, now });
  await deps.store.cancelUnsentTo(orgId, "whatsapp", phone, now);
  if (leadId) {
    await deps.safety.stopLeadFollowups({ orgId, leadId, reason: "opted_out", now }).catch(() => 0);
    await leadsStore.addEvent(orgId, leadId, { kind: "channel_opted_out", data: { channel: "whatsapp" }, actor: "user", actorUserId: userId });
  }
}

export async function recordWhatsappOptOut(user: Who, leadId: number, raw: unknown, d: Partial<ChannelDeps> = {}): Promise<Result<{ ok: true }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await deps.ready())) return NOT_SETUP();
  const phone = normalPhone((raw as { phone?: unknown })?.phone);
  if (!phone) return fail(422, "no_phone", "That isn't a phone number with a country code.");
  const got = await getLead(user, leadId);
  if (!got.ok) return got;
  await optOut(user.organizationId!, phone, leadId, user.id, deps);
  return { ok: true };
}

/* ── WhatsApp connection (owners and admins) ─────────────────────────────── */

const mayManage = (user: Who) => !!user.organizationId && memberCan(user as any, "org.settings");
const connectSchema = z.object({
  phoneNumberId: z.string().trim().regex(/^\d{5,30}$/, "The phone number ID is the long number shown under your number in WhatsApp Manager / the app's API setup."),
  wabaId: z.string().trim().regex(/^\d{5,30}$/, "The WhatsApp Business Account ID is a long number shown in WhatsApp Manager."),
  accessToken: z.string().trim().min(20).max(1000),
});

export interface WhatsappConnectionView { status: string; displayPhone: string | null; verifiedName: string | null; connectedAt: string; lastErrorCode: string | null }
const connView = (c: WhatsappConnectionRow): WhatsappConnectionView => ({ status: c.status, displayPhone: c.displayPhone, verifiedName: c.verifiedName, connectedAt: iso(c.connectedAt)!, lastErrorCode: c.lastErrorCode });

export async function whatsappConnectionStatus(user: Who, d: Partial<ChannelDeps> = {}): Promise<Result<{ configured: boolean; reason: string | null; canManage: boolean; connection: WhatsappConnectionView | null; webhookPath: string }>> {
  const deps = { ...defaults(), ...d };
  const gate = readGate(user);
  if (gate) return gate;
  const cfg = whatsappConfig(deps.env), ready = await deps.ready();
  const configured = cfg.configured && ready && cfg.allowed(user.organizationId!);
  const conn = configured ? await deps.store.liveConnection(user.organizationId!) : null;
  return { ok: true, configured, reason: configured ? null : !ready ? "WhatsApp messages aren't set up on this server yet." : cfg.reason ?? "WhatsApp Business isn't switched on for your workspace yet.", canManage: mayManage(user), connection: conn ? connView(conn) : null, webhookPath: "/api/webhooks/whatsapp" };
}

export async function connectWhatsapp(user: Who, raw: unknown, d: Partial<ChannelDeps> = {}): Promise<Result<{ connection: WhatsappConnectionView }>> {
  const deps = { ...defaults(), ...d };
  if (!mayManage(user)) return fail(403, "forbidden", "Only an owner or admin can connect the workspace's WhatsApp number.");
  if (!(await deps.ready())) return NOT_SETUP();
  const cfg = whatsappConfig(deps.env);
  if (!cfg.configured || !cfg.allowed(user.organizationId!)) return fail(409, "not_configured", cfg.reason ?? "WhatsApp Business isn't switched on for your workspace yet.");
  const parsed = connectSchema.safeParse(raw ?? {});
  if (!parsed.success) return fail(400, "invalid", parsed.error.issues[0]?.message ?? "Those details aren't valid.");
  const { phoneNumberId, wabaId, accessToken } = parsed.data;
  // Checked with WhatsApp before anything is stored: the token works for this number, and can read its templates.
  let info: { displayPhone: string | null; verifiedName: string | null };
  try { info = await deps.wa.phoneInfo(accessToken, phoneNumberId); await deps.wa.templates(accessToken, wabaId); }
  catch (e) {
    const code = e instanceof WhatsappError ? e.code : "rejected";
    return fail(422, "whatsapp_check_failed", code === "auth" ? "WhatsApp didn't accept that access token." : code === "permission" ? "That token can't use this phone number or business account. Check the IDs and the token's permissions (whatsapp_business_messaging, whatsapp_business_management)." : "WhatsApp couldn't confirm those details. Check the IDs and try again.");
  }
  const orgId = user.organizationId!, now = deps.now(), keyring: Keyring = loadKeyring(deps.env);
  try {
    const conn = await deps.store.createConnection({ orgId, userId: user.id, phoneNumberId, wabaId, displayPhone: info.displayPhone, verifiedName: info.verifiedName, now },
      (id) => encryptToken(accessToken, { organizationId: orgId, userId: user.id, connectionId: id, provider: "whatsapp" }, keyring));
    return { ok: true, connection: connView(conn) };
  } catch (e) {
    if (e instanceof ConnectionExists) return fail(409, "already_connected", "A WhatsApp number is already connected (to this workspace, or this number to another one). Disconnect it first.");
    throw e;
  }
}

export async function disconnectWhatsapp(user: Who, d: Partial<ChannelDeps> = {}): Promise<Result<{ disconnected: boolean }>> {
  const deps = { ...defaults(), ...d };
  if (!mayManage(user)) return fail(403, "forbidden", "Only an owner or admin can disconnect the workspace's WhatsApp number.");
  if (!(await deps.ready())) return NOT_SETUP();
  const conn = await deps.store.liveConnection(user.organizationId!);
  // The sealed token is deleted with the connection. Revoking it at Meta (System User → token) is the owner's step.
  return { ok: true, disconnected: conn ? await deps.store.disconnect(user.organizationId!, conn.id, deps.now()) : false };
}

export async function listWhatsappTemplates(user: Who, d: Partial<ChannelDeps> = {}): Promise<Result<{ templates: WhatsappTemplate[] }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await deps.ready())) return NOT_SETUP();
  const c = await connectionToken(user.organizationId!, deps);
  if (!c.ok) return c.refusal;
  try { return { ok: true, templates: await deps.wa.templates(c.token, c.conn.wabaId) }; }
  catch (e) { return waRefusal(e, user.organizationId!, c.conn, deps); }
}

/* ── the webhook ─────────────────────────────────────────────────────────── */

export interface WebhookOutcome { status: number; applied: { statuses: number; inbound: number; ignored: number } }

/**
 * One signed notification from Meta. Nothing is trusted before the signature checks out. Each event is applied once
 * (a status only moves forward; an inbound message id is stored once), and only to the workspace whose connected number
 * it was sent to; messages from numbers the workspace never dealt with are not stored at all.
 */
export async function handleWhatsappWebhook(raw: Buffer | undefined, signature: unknown, d: Partial<ChannelDeps> = {}): Promise<WebhookOutcome> {
  const deps = { ...defaults(), ...d };
  const cfg = whatsappConfig(deps.env);
  const applied = { statuses: 0, inbound: 0, ignored: 0 };
  if (!cfg.configured || !verifySignature(raw, signature, cfg.appSecret ?? undefined)) return { status: 401, applied };
  if (!(await deps.ready())) return { status: 503, applied };
  let body: unknown;
  try { body = JSON.parse(raw!.toString("utf8")); } catch { return { status: 400, applied }; }
  const { statuses, inbound } = parseNotification(body);
  const conns = new Map<string, WhatsappConnectionRow | null>();
  const connFor = async (pid: string) => { if (!conns.has(pid)) conns.set(pid, await deps.store.connectionByPhoneNumberId(pid)); return conns.get(pid)!; };

  for (const s of statuses) {
    const conn = await connFor(s.phoneNumberId);
    const row = conn ? await deps.store.byProviderId("whatsapp", s.wamid) : null;
    if (!conn || !row || row.organizationId !== conn.organizationId) { applied.ignored++; continue; }
    if (await deps.store.applyStatus({ id: row.id, status: s.status, at: s.at, errorCode: s.errorCode ? `whatsapp_${s.errorCode}`.slice(0, 40) : null })) applied.statuses++;
  }
  for (const m of inbound) {
    const conn = await connFor(m.phoneNumberId);
    if (!conn) { applied.ignored++; continue; }
    const orgId = conn.organizationId;
    const contact = await deps.store.contact(orgId, m.from);
    const lastOut = await deps.store.latestSentTo(orgId, "whatsapp", m.from);
    const leadId = contact?.leadId ?? lastOut?.leadId ?? null;
    if (!leadId) { applied.ignored++; continue; } // someone this workspace never dealt with: nothing is kept
    const created = await deps.store.insertInbound({ orgId, leadId, channel: "whatsapp", from: m.from, providerMessageId: m.wamid, body: m.text, type: m.type, at: m.at });
    if (!created) continue; // a replay
    applied.inbound++;
    if (contact) await deps.store.touchInbound(orgId, m.from, m.at);
    if (isStopReply(m.text)) { await optOut(orgId, m.from, leadId, null, deps); continue; }
    if (lastOut && !lastOut.repliedAt) await deps.store.transition({ orgId, id: lastOut.id, from: ["sent"], set: { repliedAt: m.at, updatedAt: deps.now() } });
    await onReply(orgId, leadId, "whatsapp", lastOut?.id ?? null, "provider", null, deps);
  }
  return { status: 200, applied };
}
