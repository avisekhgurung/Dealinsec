/**
 * Campaigns: the rules. The HTTP routes and the background job both call this file; nothing else writes the tables.
 *
 * What a person can do: group leads into a campaign, have drafts prepared for them in the background, read and
 * approve each draft (through the ordinary outreach screens — there is no "approve all"), and, where the server
 * allows it, let already-approved messages leave from their own Gmail at a steady pace.
 *
 * What the background job does, and what it never does:
 *   draftStep   one lead at a time, AS the person who pressed "Prepare drafts": the existing drafting service writes
 *               the message (verified facts only, the do-not-contact list, the plan's allowance), then the campaign's
 *               footer is added to the DRAFT — before anyone approves it. An allowance running out stops the job and
 *               says why; a lead that can't be written to is skipped with its reason; nothing is invented to fill a gap.
 *   sendStep    one APPROVED message at a time, AS the person who pressed "Start sending", through the existing Gmail
 *               send (every lock, limit and do-not-contact check it has). It sends nothing that lost its opt-out line,
 *               and it pauses the whole queue on anything a person must look at.
 * Neither step approves anything, edits an approved message, or retries a send that may have gone out.
 *
 * Every user-facing call is for the caller's own workspace; a campaign elsewhere is "not found".
 * On a database without the tables the feature answers 503 CAMPAIGNS_NOT_SETUP and nothing else is affected.
 */
import {
  addMembersSchema, CAMPAIGN_MAX_MEMBERS, campaignCreateSchema, campaignRates, campaignUpdateSchema, countMembers, DAILY_LIMIT, DRAFT_TRIES, draftRefusal, EMPTY_COUNTS, GAP_SECONDS,
  followUpView, hasOptOutLine, MAX_CAMPAIGNS, MEMBER_STAGE_LABEL, memberStage, nextSendAt, reasonLabel, sendRefusal, stopLabel, tooManyBounces, withFooter,
  type CampaignCounts, type CampaignRates, type FollowUpView, type MemberStage,
} from "@shared/campaign";
import { LIMITS } from "@shared/outreach-check";
import { hashDraft } from "@shared/outreach-hash";
import type { CampaignRow } from "@shared/schema";
import { fail, firstIssue, readGate, writeGate, type Result, type Who } from "../services/leads";
import { unsubscribeUrl } from "../sales/unsubscribe";
import { campaignStore, campaignTablesReady, type AudienceLead, type CampaignStore, type MemberView } from "./store";

export const DRAFT_LEASE_MS = 3 * 60_000;
export const SEND_LEASE_MS = 6 * 60_000; // longer than the send's own lease: a slow provider call must not let a second pass in
const HOUR = 3_600_000, DAY = 24 * HOUR;
const WAIT_FOR_APPROVALS_MS = 5 * 60_000;

type DraftResult = { ok: true; message: { id: number } } | { ok: false; code: string };
type SendResult = { ok: true; outcome: string; reconnect?: boolean } | { ok: false; code: string };

export interface CampaignDeps {
  store: CampaignStore;
  ready(): Promise<boolean>;
  now(): Date;
  random(): number;
  /** The saved client profile's name, when the campaign was built for one. */
  profileName(orgId: string, id: number): Promise<string | null>;
  /** A member of `orgId` as the services see them (role, custom permissions), or null when they left or were removed. */
  loadUser(orgId: string, userId: string): Promise<Who | null>;
  draft(user: Who, leadId: number): Promise<DraftResult>;
  send(user: Who, messageId: number, bodyHash: string): Promise<SendResult>;
  /** A message's own unsubscribe link for its footer, or null when the server can't sign one (server/sales/unsubscribe.ts). */
  unsubscribeUrl(orgId: string, messageId: number): string | null;
  /** CAMPAIGN_SENDING_ENABLED: the server-wide switch for the paced queue. Off unless set to "true". */
  queueEnabled(): boolean;
  log(event: string, fields?: Record<string, string | number | boolean | null>): void;
  /** Wakes the background job now instead of at its next pass. */
  kick(): void;
}

export const queueSwitch = (env: NodeJS.ProcessEnv = process.env): boolean => env.CAMPAIGN_SENDING_ENABLED === "true";

const defaults = (): CampaignDeps => ({
  store: campaignStore, ready: campaignTablesReady, now: () => new Date(), random: Math.random,
  async profileName(orgId, id) {
    try { const { acquisitionProfileStore, profilesTableReady } = await import("../profiles/store"); return (await profilesTableReady()) ? ((await acquisitionProfileStore.get(orgId, id))?.name ?? null) : null; }
    catch { return null; }
  },
  async loadUser(orgId, userId) {
    const { storage } = await import("../storage");
    const user: any = await storage.getUser(userId);
    if (!user || user.organizationId !== orgId || user.memberStatus === "removed") return null;
    if (user.customRoleId) {
      const role = await storage.getOrgRole(user.customRoleId);
      user.customPermissions = role && role.organizationId === user.organizationId ? role.permissions : [];
    }
    return user;
  },
  async draft(user, leadId) {
    const { draftOutreach } = await import("../sales/outreach");
    const r = await draftOutreach(user, leadId, { by: "agent" });
    return r.ok ? { ok: true, message: { id: r.message.id } } : { ok: false, code: r.code };
  },
  async send(user, messageId, bodyHash) {
    const { sendFromQueue } = await import("../mail/register");
    const r = await sendFromQueue(user as any, messageId, bodyHash);
    return r.ok ? { ok: true, outcome: r.outcome, reconnect: r.reconnect } : { ok: false, code: r.code };
  },
  unsubscribeUrl: (orgId, messageId) => unsubscribeUrl(orgId, messageId),
  queueEnabled: () => queueSwitch(),
  // Ids and codes only: never a name, an address or a word of a message.
  log: (event, fields) => console.log(JSON.stringify({ ts: new Date().toISOString(), src: "campaigns", event, ...(fields ?? {}) })),
  kick: () => { void import("./runner").then((m) => m.campaignRunner.kick()).catch(() => {}); },
});

const NOT_SETUP = () => fail(503, "CAMPAIGNS_NOT_SETUP", "Campaigns aren't set up on this server yet.");
const NOT_FOUND = () => fail(404, "not_found", "That campaign isn't in your workspace.");
const ARCHIVED = () => fail(409, "archived", "That campaign is archived.");
const isReady = async (d: CampaignDeps) => { try { return await d.ready(); } catch { return false; } };
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

export interface CampaignView {
  id: number; name: string; profileName: string | null; status: string; footerNote: string; dailyLimit: number; gapSeconds: number;
  preparing: boolean; prepareStop: string | null; prepareStopLabel: string | null;
  sending: boolean; sendStop: string | null; sendStopLabel: string | null; nextSendAt: string | null;
  createdAt: string; counts: CampaignCounts; rates: CampaignRates;
}
export interface MemberRowView {
  leadId: number; companyName: string; domain: string | null; contactName: string | null; leadStatus: string | null;
  stage: MemberStage; stageLabel: string; note: string | null;
  message: { id: number; status: string; subject: string | null; to: string | null; edited: boolean; approvedAt: string | null; sentAt: string | null; hasOptOutLine?: boolean } | null;
  outcomes: string[]; interested: boolean;
  /** The next follow-up on this lead's sent message, when there is one still open. */
  followUp: FollowUpView | null;
}

const campaignView = (c: CampaignRow, counts: CampaignCounts): CampaignView => ({
  id: c.id, name: c.name, profileName: c.profileName ?? null, status: c.status, footerNote: c.footerNote ?? "", dailyLimit: c.dailyLimit, gapSeconds: c.gapSeconds,
  preparing: c.preparing, prepareStop: c.prepareStop ?? null, prepareStopLabel: c.preparing ? null : stopLabel(c.prepareStop),
  sending: c.sending, sendStop: c.sendStop ?? null, sendStopLabel: c.sending ? null : stopLabel(c.sendStop), nextSendAt: c.sending ? iso(c.nextSendAt) : null,
  createdAt: iso(c.createdAt)!, counts, rates: campaignRates(counts),
});
const factOf = (m: MemberView) => ({ state: m.state, messageStatus: m.message?.status ?? null, outcomes: m.outcomes, interested: m.interested });
function memberView(m: MemberView): MemberRowView {
  const stage = memberStage(factOf(m));
  // One note per row: why it has no draft, or why its approved message is being held back from the queue.
  const held = stage === "approved" && m.holdReason && m.holdHash === m.message?.bodyHash ? m.holdReason : null;
  const note = stage === "skipped" || stage === "failed" ? reasonLabel(m.reason) : held ? reasonLabel(held) : stage === "draft" && m.reason ? reasonLabel(m.reason) : null;
  return {
    leadId: m.leadId, companyName: m.lead?.companyName ?? "(lead removed)", domain: m.lead?.domain ?? null, contactName: m.lead?.contactName ?? null, leadStatus: m.lead?.status ?? null,
    stage, stageLabel: MEMBER_STAGE_LABEL[stage], note,
    message: m.message ? { id: m.message.id, status: m.message.status, subject: m.message.subject, to: m.message.to, edited: m.message.edited, approvedAt: iso(m.message.approvedAt), sentAt: iso(m.message.sentAt) } : null,
    outcomes: m.outcomes, interested: m.interested,
    // Only a message that was sent has a follow-up worth showing; a reply, a bounce or an opt-out has already cancelled it.
    followUp: stage === "sent" ? followUpView(m.followUp) : null,
  };
}

/* ── what a person does ─────────────────────────────────────────────────── */

export async function listCampaigns(user: Who, d: Partial<CampaignDeps> = {}): Promise<Result<{ campaigns: CampaignView[]; queueEnabled: boolean; /** Campaign emails carry an unsubscribe link (the server has a secret to sign them with). */ unsubscribeLinks: boolean; limits: { members: number; campaigns: number; dailyLimit: typeof DAILY_LIMIT; gapSeconds: typeof GAP_SECONDS } }>> {
  const deps = { ...defaults(), ...d };
  const gate = readGate(user);
  if (gate) return gate;
  if (!(await isReady(deps))) return NOT_SETUP();
  const orgId = user.organizationId!;
  const [rows, facts] = await Promise.all([deps.store.list(orgId), deps.store.memberFacts(orgId)]);
  const by = new Map<number, typeof facts>();
  for (const f of facts) { const a = by.get(f.campaignId) ?? []; a.push(f); by.set(f.campaignId, a); }
  return { ok: true, campaigns: rows.map((c) => campaignView(c, by.has(c.id) ? countMembers(by.get(c.id)!) : { ...EMPTY_COUNTS })), queueEnabled: deps.queueEnabled(), unsubscribeLinks: deps.unsubscribeUrl(orgId, 1) !== null, limits: { members: CAMPAIGN_MAX_MEMBERS, campaigns: MAX_CAMPAIGNS, dailyLimit: DAILY_LIMIT, gapSeconds: GAP_SECONDS } };
}

const AUDIENCE_STATUS = new Set(["new", "researching", "qualified"]);
/** Why a lead can't be picked right now, in the person's words; null = it can. */
export function audienceBlock(l: AudienceLead): string | null {
  if (l.doNotContact) return "Marked do-not-contact";
  if (l.inCampaign) return `Already in "${l.inCampaign}"`;
  return null;
}
export async function audience(user: Who, q: Record<string, unknown> = {}, d: Partial<CampaignDeps> = {}): Promise<Result<{ leads: (AudienceLead & { blocked: string | null })[]; limit: number }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await isReady(deps))) return NOT_SETUP();
  const status = typeof q.status === "string" && AUDIENCE_STATUS.has(q.status) ? q.status : null;
  const source = typeof q.source === "string" && /^[a-z_]{1,16}$/.test(q.source) ? q.source : null;
  const text = typeof q.q === "string" ? q.q.replace(/\s+/g, " ").trim().slice(0, 60) : "";
  const pid = Number(q.profileId);
  const profileId = Number.isInteger(pid) && pid > 0 ? pid : null;
  const ready = q.ready === "1" || q.ready === "true" || q.ready === true;
  const limit = 300;
  const leads = await deps.store.audience(user.organizationId!, { status, source, q: text || null, profileId, ready }, limit);
  return { ok: true, leads: leads.map((l) => ({ ...l, blocked: audienceBlock(l) })), limit };
}

export async function createCampaign(user: Who, raw: unknown, d: Partial<CampaignDeps> = {}): Promise<Result<{ campaign: CampaignView; added: number; left: number }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await isReady(deps))) return NOT_SETUP();
  const parsed = campaignCreateSchema.safeParse(raw ?? {});
  if (!parsed.success) return fail(400, "invalid", firstIssue(parsed.error));
  const orgId = user.organizationId!, p = parsed.data;
  // Only the workspace's own, unarchived leads: an id from anywhere else is dropped, never an error that confirms it exists.
  const own = await deps.store.ownLeadIds(orgId, p.leadIds);
  if (!own.length) return fail(400, "invalid", "None of those leads are in your workspace.");
  const profileName = p.profileId ? await deps.profileName(orgId, p.profileId) : null;
  const row = await deps.store.create(orgId, user.id, { name: p.name, profileId: profileName ? p.profileId : null, profileName, footerNote: p.footerNote, dailyLimit: p.dailyLimit, gapSeconds: p.gapSeconds }, own, deps.now(), MAX_CAMPAIGNS);
  if (!row) return fail(409, "too_many", `A workspace can keep ${MAX_CAMPAIGNS} campaigns open. Archive one first.`);
  return { ok: true, campaign: campaignView(row, { ...EMPTY_COUNTS, members: own.length, queued: own.length }), added: own.length, left: p.leadIds.length - own.length };
}

/**
 * One campaign with its members. Opening it on the page also tidies up (a discarded draft that was replaced is
 * re-pointed, and a job that should be running is woken). `readOnly` skips both: it is how a coworker's read tool
 * looks at a campaign, and a read tool must change nothing at all.
 */
export async function getCampaign(user: Who, id: number, d: Partial<CampaignDeps> = {}, opts: { readOnly?: boolean } = {}): Promise<Result<{ campaign: CampaignView; members: MemberRowView[]; queueEnabled: boolean; /** Follow-ups of this campaign's sent messages: how many need the person now, and how many are planned for later. */ followUps: { waiting: number; planned: number } }>> {
  const deps = { ...defaults(), ...d };
  const gate = readGate(user);
  if (gate) return gate;
  if (!(await isReady(deps))) return NOT_SETUP();
  const orgId = user.organizationId!;
  const c = await deps.store.get(orgId, id);
  if (!c) return NOT_FOUND();
  if (!opts.readOnly) await deps.store.relink(orgId, id);
  const members = await deps.store.members(orgId, id);
  if (!opts.readOnly && (c.preparing || c.sending)) deps.kick();
  const rows = members.map(memberView);
  const followUps = { waiting: rows.filter((r) => r.followUp?.waiting).length, planned: rows.filter((r) => r.followUp?.state === "due_later").length };
  return { ok: true, campaign: campaignView(c, countMembers(members.map(factOf))), members: rows, queueEnabled: deps.queueEnabled(), followUps };
}

export async function updateCampaign(user: Who, id: number, raw: unknown, d: Partial<CampaignDeps> = {}): Promise<Result<{ campaign: CampaignView }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await isReady(deps))) return NOT_SETUP();
  const parsed = campaignUpdateSchema.safeParse(raw ?? {});
  if (!parsed.success) return fail(400, "invalid", firstIssue(parsed.error));
  const orgId = user.organizationId!;
  const cur = await deps.store.get(orgId, id);
  if (!cur) return NOT_FOUND();
  if (cur.status !== "active") return ARCHIVED();
  const row = await deps.store.update(orgId, id, parsed.data, deps.now());
  if (!row) return NOT_FOUND();
  return { ok: true, campaign: campaignView(row, countMembers((await deps.store.members(orgId, id)).map(factOf))) };
}

export async function addMembers(user: Who, id: number, raw: unknown, d: Partial<CampaignDeps> = {}): Promise<Result<{ added: number }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await isReady(deps))) return NOT_SETUP();
  const parsed = addMembersSchema.safeParse(raw ?? {});
  if (!parsed.success) return fail(400, "invalid", firstIssue(parsed.error));
  const orgId = user.organizationId!;
  const cur = await deps.store.get(orgId, id);
  if (!cur) return NOT_FOUND();
  if (cur.status !== "active") return ARCHIVED();
  const own = await deps.store.ownLeadIds(orgId, parsed.data.leadIds);
  return { ok: true, added: await deps.store.addMembers(orgId, id, own, deps.now(), CAMPAIGN_MAX_MEMBERS) };
}

export async function removeMember(user: Who, id: number, leadId: number, d: Partial<CampaignDeps> = {}): Promise<Result<{ removed: true }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await isReady(deps))) return NOT_SETUP();
  const orgId = user.organizationId!;
  if (!(await deps.store.get(orgId, id))) return NOT_FOUND();
  const r = await deps.store.removeMember(orgId, id, leadId);
  if (r === "sent") return fail(409, "already_sent", "Its message was sent (or is being sent), so it stays in the campaign's numbers.");
  return r === "removed" ? { ok: true, removed: true } : fail(404, "not_found", "That lead isn't in this campaign.");
}

/** "Prepare drafts": the background job starts writing, as this person, within their plan's allowance. */
export async function startPreparing(user: Who, id: number, d: Partial<CampaignDeps> = {}): Promise<Result<{ campaign: CampaignView; waiting: number }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await isReady(deps))) return NOT_SETUP();
  const orgId = user.organizationId!;
  const cur = await deps.store.get(orgId, id);
  if (!cur) return NOT_FOUND();
  if (cur.status !== "active") return ARCHIVED();
  const before = countMembers((await deps.store.members(orgId, id)).map(factOf));
  if (before.queued + before.failed === 0) return fail(409, "nothing_to_prepare", "Every lead in this campaign already has a draft or was skipped. Add leads to prepare more.");
  const row = await deps.store.setPreparing(orgId, id, { on: true, userId: user.id, stop: null, requeueFailed: true }, deps.now());
  if (!row) return NOT_FOUND();
  deps.kick();
  return { ok: true, campaign: campaignView(row, { ...before, queued: before.queued + before.failed, failed: 0 }), waiting: before.queued + before.failed };
}
export async function stopPreparing(user: Who, id: number, d: Partial<CampaignDeps> = {}): Promise<Result<{ campaign: CampaignView }>> {
  return toggle(user, id, d, (deps, orgId) => deps.store.setPreparing(orgId, id, { on: false, stop: "stopped" }, deps.now()));
}

/** "Start sending": approved messages leave from THIS person's Gmail, one at a time, at the campaign's pace. */
export async function startSending(user: Who, id: number, d: Partial<CampaignDeps> = {}): Promise<Result<{ campaign: CampaignView }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await isReady(deps))) return NOT_SETUP();
  if (!deps.queueEnabled()) return fail(503, "queue_off", "Queued sending isn't switched on for this server. Send each approved message yourself from Outreach.");
  const orgId = user.organizationId!;
  const cur = await deps.store.get(orgId, id);
  if (!cur) return NOT_FOUND();
  if (cur.status !== "active") return ARCHIVED();
  const counts = countMembers((await deps.store.members(orgId, id)).map(factOf));
  if (counts.approved === 0) return fail(409, "nothing_approved", "Nothing is approved yet. Read and approve a draft first: only approved messages are sent.");
  const row = await deps.store.setSending(orgId, id, { on: true, userId: user.id, stop: null, nextSendAt: deps.now() }, deps.now());
  if (!row) return NOT_FOUND();
  deps.log("campaign_send_started", { campaignId: id, approved: counts.approved });
  deps.kick();
  return { ok: true, campaign: campaignView(row, counts) };
}
export async function pauseSending(user: Who, id: number, d: Partial<CampaignDeps> = {}): Promise<Result<{ campaign: CampaignView }>> {
  return toggle(user, id, d, (deps, orgId) => deps.store.setSending(orgId, id, { on: false, stop: "paused" }, deps.now()));
}
/** Archiving stops both jobs. The messages stay where they are, in Outreach and on each lead. */
export async function archiveCampaign(user: Who, id: number, d: Partial<CampaignDeps> = {}): Promise<Result<{ campaign: CampaignView }>> {
  return toggle(user, id, d, async (deps, orgId) => {
    await deps.store.setPreparing(orgId, id, { on: false, stop: "stopped" }, deps.now());
    await deps.store.setSending(orgId, id, { on: false, stop: "paused" }, deps.now());
    return deps.store.update(orgId, id, { status: "archived" }, deps.now());
  });
}
async function toggle(user: Who, id: number, d: Partial<CampaignDeps>, act: (deps: CampaignDeps, orgId: string) => Promise<CampaignRow | null>): Promise<Result<{ campaign: CampaignView }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await isReady(deps))) return NOT_SETUP();
  const orgId = user.organizationId!;
  if (!(await deps.store.get(orgId, id))) return NOT_FOUND();
  const row = (await act(deps, orgId)) ?? (await deps.store.get(orgId, id));
  if (!row) return NOT_FOUND();
  return { ok: true, campaign: campaignView(row, countMembers((await deps.store.members(orgId, id)).map(factOf))) };
}

/* ── what the background job does ───────────────────────────────────────── */

export type DraftOutcome = "idle" | "drafted" | "adopted" | "skipped" | "stopped" | "retry" | "failed";

/** Adds the campaign's footer to a message that is still a draft. Returns a note when it can't. */
async function footer(deps: CampaignDeps, orgId: string, messageId: number, note: string): Promise<string | null> {
  const m = await deps.store.draftBody(orgId, messageId);
  if (!m || m.status !== "draft" || hasOptOutLine(m.body)) return null; // approved already, or it has the line: not ours to change
  const body = withFooter(m.body, note, deps.unsubscribeUrl(orgId, messageId));
  if (body.length > LIMITS.bodyMax) return "footer_too_long";
  await deps.store.setDraftBody(orgId, messageId, m.bodyHash, body, hashDraft(m.subject ?? "", body), deps.now());
  return null;
}

/** Prepares ONE member's draft, if any campaign is waiting for one. Never throws. */
export async function draftStep(d: Partial<CampaignDeps> = {}): Promise<DraftOutcome> {
  const deps = { ...defaults(), ...d };
  let claimed: Awaited<ReturnType<CampaignStore["claimDraft"]>> = null;
  try {
    if (!(await isReady(deps))) return "idle";
    await deps.store.finishPreparing(deps.now());
    claimed = await deps.store.claimDraft(deps.now(), DRAFT_LEASE_MS);
    if (!claimed) return "idle";
    const { member, campaign } = claimed, orgId = campaign.organizationId, now = () => deps.now();
    const back = (attempts = member.attempts - 1) => deps.store.settleMember(member.id, { state: "queued", attempts: Math.max(0, attempts) }, now());
    const user = await deps.loadUser(orgId, campaign.prepareUserId ?? campaign.createdByUser);
    if (!user || writeGate(user)) {
      await back();
      await deps.store.setPreparing(orgId, campaign.id, { on: false, stop: "user_unavailable" }, now());
      return "stopped";
    }
    const adopt = async (): Promise<DraftOutcome> => {
      const existing = await deps.store.unsentMessageId(orgId, member.leadId);
      if (!existing) return "idle";
      const note = await footer(deps, orgId, existing, campaign.footerNote ?? "");
      await deps.store.settleMember(member.id, { state: "drafted", messageId: existing, reason: note }, now());
      return "adopted";
    };
    // A message already waiting for this lead (written by hand, or by a pass that crashed before recording it) is
    // taken as it is: one lead never gets two drafts, and no model call is spent to find that out.
    if ((await adopt()) === "adopted") { await deps.store.finishPreparing(now()); return "adopted"; }
    const r = await deps.draft(user, member.leadId);
    if (r.ok) {
      const note = await footer(deps, orgId, r.message.id, campaign.footerNote ?? "");
      await deps.store.settleMember(member.id, { state: "drafted", messageId: r.message.id, reason: note }, now());
      await deps.store.finishPreparing(now());
      return "drafted";
    }
    const what = draftRefusal(r.code);
    if (what === "adopt") {
      // "A message is waiting" but none is a draft or approved: the lead has several VERSIONS to choose from. That is the
      // person's choice to make; the lead is set aside (not skipped for good) and Prepare picks it up again afterwards.
      const took = (await adopt()) === "adopted";
      if (!took) await deps.store.settleMember(member.id, { state: "failed", reason: "versions_waiting" }, now());
      await deps.store.finishPreparing(now());
      return took ? "adopted" : "failed";
    }
    if (what === "stop") {
      await back();
      await deps.store.setPreparing(orgId, campaign.id, { on: false, stop: r.code.slice(0, 24) }, now());
      deps.log("campaign_prepare_stopped", { campaignId: campaign.id, reason: r.code });
      return "stopped";
    }
    if (what === "retry") {
      if (member.attempts >= DRAFT_TRIES) { await deps.store.settleMember(member.id, { state: "failed", reason: "model_unavailable" }, now()); await deps.store.finishPreparing(now()); return "failed"; }
      await back(member.attempts);
      return "retry";
    }
    await deps.store.settleMember(member.id, { state: "skipped", reason: r.code.slice(0, 24) }, now());
    await deps.store.finishPreparing(now());
    return "skipped";
  } catch (e) {
    deps.log("campaign_step_failed", { where: "draft", errorType: (e as Error)?.name ?? "Error" });
    // The lease simply runs out: the member is tried again on a later pass, and its attempt has been counted.
    return "retry";
  }
}

export type SendStepOutcome = "idle" | "sent" | "held" | "waiting" | "limit" | "paused" | "done" | "later";

/** Sends ONE approved message of one due campaign, or decides why not. Never throws. */
export async function sendStep(d: Partial<CampaignDeps> = {}): Promise<SendStepOutcome> {
  const deps = { ...defaults(), ...d };
  try {
    if (!(await isReady(deps))) return "idle";
    const c = await deps.store.claimSend(deps.now(), SEND_LEASE_MS);
    if (!c) return "idle";
    const orgId = c.organizationId, now = () => deps.now();
    const pause = async (stop: string): Promise<SendStepOutcome> => {
      await deps.store.setSending(orgId, c.id, { on: false, stop: stop.slice(0, 24) }, now());
      deps.log("campaign_send_paused", { campaignId: c.id, reason: stop });
      return stop === "done" ? "done" : "paused";
    };
    const later = async (ms: number, out: SendStepOutcome): Promise<SendStepOutcome> => { await deps.store.releaseSend(c.id, { nextSendAt: new Date(now().getTime() + ms) }, now()); return out; };
    if (!deps.queueEnabled()) return pause("queue_off");
    const user = c.senderUserId ? await deps.loadUser(orgId, c.senderUserId) : null;
    if (!user) return pause("not_member");
    if (writeGate(user)) return pause("not_allowed");
    await deps.store.relink(orgId, c.id);
    const facts = await deps.store.sendFacts(orgId, c.id, new Date(now().getTime() - DAY));
    if (tooManyBounces(facts)) return pause("bounce_rate");
    if (facts.sentSince >= c.dailyLimit) return later(HOUR, "limit");
    const pick = await deps.store.nextApproved(orgId, c.id);
    if (!pick) {
      const counts = countMembers((await deps.store.members(orgId, c.id)).map(factOf));
      // Nothing approved right now. If drafts are still coming or waiting to be read, the queue waits for them.
      return counts.queued + counts.draft + counts.approved + counts.sending > 0 || c.preparing ? later(WAIT_FOR_APPROVALS_MS, "waiting") : pause("done");
    }
    const hold = async (reason: string): Promise<SendStepOutcome> => {
      await deps.store.settleMember(pick.memberId, { holdReason: reason.slice(0, 24), holdHash: pick.bodyHash }, now());
      await deps.store.releaseSend(c.id, { nextSendAt: now() }, now());
      return "held";
    };
    if (!hasOptOutLine(pick.body)) return hold("no_opt_out_line");
    const r = await deps.send(user, pick.messageId, pick.bodyHash);
    if (r.ok) {
      if (r.outcome === "sent" || r.outcome === "already_sent") {
        await deps.store.releaseSend(c.id, { nextSendAt: nextSendAt(now(), c.gapSeconds, deps.random()) }, now());
        deps.log("campaign_message_sent", { campaignId: c.id, messageId: pick.messageId });
        return "sent";
      }
      // "failed": Gmail refused it and the message is approved again. "uncertain": it may have gone out. Either way a person looks first.
      return pause(r.outcome === "uncertain" ? "uncertain" : r.reconnect ? "mailbox_reconnect" : "send_failed");
    }
    const what = sendRefusal(r.code);
    if (what === "hold") return hold(r.code);
    if (what === "later") return later(WAIT_FOR_APPROVALS_MS, "later");
    return pause(r.code);
  } catch (e) {
    deps.log("campaign_step_failed", { where: "send", errorType: (e as Error)?.name ?? "Error" });
    return "later"; // the campaign's lease runs out and it is looked at again; nothing is resent by this
  }
}
