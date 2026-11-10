/**
 * Social Intent: find people publicly asking for the work the person sells, and turn the good ones into leads.
 *
 *   overview       which sources are connected (and, plainly, which platforms can't be searched), the allowance, counts
 *   scan           one look across the chosen sources: read → keep only real asks about the person's services → score
 *   list / status  the opportunities, and the person's decision on each (saved, ignored, contacted)
 *   addManual      a post the person found themselves (LinkedIn, Facebook, anywhere): they paste its link and text
 *   saveToLeads    an opportunity becomes a lead, carrying the post as its evidence, so a drafted message can cite it
 *   profiles       saved searches: create, edit, pause, resume, duplicate, delete, run, and (optionally) schedule
 *
 * What it never does: call a model (every stage here is rules — shared/social-intent.ts), fetch a page from a
 * platform it has no authorised route to, keep an author's name, or contact anyone. A post is a reason to look,
 * not permission to message: the person decides who becomes a lead and what gets sent.
 */
import { z } from "zod";
import { canonicalUrl, domainOf } from "@shared/prospect";
import { OUTBOUND_WINDOW_DAYS, TIER_LABEL, type OutboundTier } from "@shared/outbound-plans";
import type { OpportunityPost } from "@shared/opportunity-sources";
import {
  INTENT_LABEL, QUALIFYING_INTENTS, RETENTION_DAYS, SEARCHABLE_PLATFORMS, SOCIAL_PLATFORMS, TITLE_CHARS, analysePost, excerptOf, isSocialPlatform, platformOfUrl, postUrl,
  type IntentCategory, type PostSignals, type SocialPlatformId, type SocialScore,
} from "@shared/social-intent";
import type { SocialOpportunityRow, SocialProfileRow } from "@shared/schema";
import { utcDayStart } from "@shared/llm-cost";
import { DiscoveryError, type OpportunitySource } from "../discovery/types";
import { socialSources } from "../discovery/provider";
import { addClaim, createLead, fail, readGate, writeGate, type Result, type Who } from "../services/leads";
import { leadsStore } from "../leads/store";
import { profileStore } from "../leads/profile-store";
import { dailySearchLimit, globalSearchLimit, outboundAllowance, workspaceMonthlySpendMicroUsd } from "../outbound/limits";
import { outboundTier } from "../outbound/plan";
import { costMicroUsd } from "../outbound/providers";
import { outboundStore } from "../outbound/store";
import { socialStore, socialTablesReady, type SocialStore, type SourceOutcome } from "./store";

const DAY = 86_400_000;
/** A score from which an opportunity is called high-intent on the dashboard. A label for sorting attention, not a promise. */
export const HIGH_INTENT_SCORE = 70;
/** One scan may take this long across every source; a slow source is cut off and reported, the others are kept. */
const SCAN_BUDGET_MS = 25_000;
const MAX_PROFILES = 10;
const MAX_MANUAL_PER_DAY = 50;

type SearchStore = Pick<typeof outboundStore, "reserveSearch" | "settleProviderCall" | "recordProviderCall" | "countProviderCalls">;
export interface SocialDeps {
  store: SocialStore;
  search: SearchStore;
  sources: () => Promise<OpportunitySource[]>;
  tier: (user: Who) => Promise<OutboundTier>;
  ready: () => Promise<boolean>;
  savedServices: (orgId: string) => Promise<string[]>;
  leads: Pick<typeof leadsStore, "leadIdsByEvidenceUrls">;
  createLead: typeof createLead;
  addClaim: typeof addClaim;
  now: () => Date;
  scheduleEnabled: () => boolean;
  onProfilesChanged: () => void;
}
const defaults = (): SocialDeps => ({
  store: socialStore, search: outboundStore, sources: () => socialSources(), tier: outboundTier, ready: socialTablesReady,
  savedServices: async (orgId) => { try { return (await profileStore.get(orgId))?.services ?? []; } catch { return []; } },
  leads: leadsStore, createLead, addClaim, now: () => new Date(),
  scheduleEnabled: socialScheduleEnabled,
  onProfilesChanged: () => { void import("./schedule").then((m) => m.socialScheduleRunner.kick()).catch(() => {}); },
});

/** Scheduled scans are opt-in per deployment (SOCIAL_SCHEDULE_ENABLED=on): they run with nobody watching. */
export const socialScheduleEnabled = (env: NodeJS.ProcessEnv = process.env) => String(env.SOCIAL_SCHEDULE_ENABLED ?? "").trim().toLowerCase() === "on";

const NOT_SETUP = () => fail(503, "SOCIAL_NOT_SETUP", "Social Intent isn't set up on this server yet.");
async function isReady(deps: SocialDeps): Promise<boolean> { try { return await deps.ready(); } catch { return false; } }

/* ── views ──────────────────────────────────────────────────────────────── */

export interface OpportunityView {
  id: number; source: SocialPlatformId; sourceLabel: string; origin: "scan" | "manual"; url: string; community: string | null; title: string; excerpt: string;
  /** When the platform says it was posted (null = the source gives no date), when we found it, when a scan last still saw it. */
  postedAt: string | null; discoveredAt: string; lastSeenAt: string;
  intent: IntentCategory; intentLabel: string; intentMatched: string | null; service: string | null; signals: Partial<PostSignals>;
  score: number; scoreDetail: SocialScore | null; highIntent: boolean; companyUrl: string | null;
  status: "new" | "saved" | "ignored" | "contacted"; leadId: number | null;
}
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
const labelOf = (id: string) => SOCIAL_PLATFORMS.find((p) => p.id === id)?.label ?? "The web";
export const opportunityView = (r: SocialOpportunityRow): OpportunityView => ({
  id: r.id, source: (isSocialPlatform(r.source) ? r.source : "web"), sourceLabel: labelOf(r.source), origin: r.origin === "manual" ? "manual" : "scan",
  url: r.url, community: r.community, title: r.title, excerpt: r.excerpt,
  postedAt: iso(r.postedAt), discoveredAt: iso(r.discoveredAt)!, lastSeenAt: iso(r.lastSeenAt)!,
  intent: r.intent as IntentCategory, intentLabel: INTENT_LABEL[r.intent as IntentCategory] ?? r.intent, intentMatched: r.intentMatched, service: r.service,
  signals: (r.signals ?? {}) as Partial<PostSignals>, score: r.score,
  scoreDetail: r.scoreDetail && Array.isArray((r.scoreDetail as any).components) ? (r.scoreDetail as unknown as SocialScore) : null,
  highIntent: r.score >= HIGH_INTENT_SCORE && QUALIFYING_INTENTS.includes(r.intent as IntentCategory),
  companyUrl: r.companyUrl, status: (["new", "saved", "ignored", "contacted"].includes(r.status) ? r.status : "new") as OpportunityView["status"], leadId: r.leadId,
});

export interface ProfileView { id: number; name: string; services: string[]; keywords: string[]; platforms: SocialPlatformId[]; minScore: number; status: "active" | "paused"; schedule: "off" | "daily" | "weekly"; lastRunAt: string | null; nextRunAt: string | null }
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
export const profileView = (p: SocialProfileRow): ProfileView => ({
  id: p.id, name: p.name, services: strs(p.services), keywords: strs(p.keywords), platforms: strs(p.platforms).filter(isSocialPlatform),
  minScore: p.minScore, status: p.status === "paused" ? "paused" : "active", schedule: p.schedule === "daily" || p.schedule === "weekly" ? p.schedule : "off",
  lastRunAt: iso(p.lastRunAt), nextRunAt: iso(p.nextRunAt),
});

/* ── overview ───────────────────────────────────────────────────────────── */

export interface SocialOverview {
  /** Every platform, searchable or not, with whether it works HERE: a source without its keys is shown as not connected, never as working. */
  platforms: { id: SocialPlatformId; label: string; mode: "search" | "manual"; connected: boolean; paid: boolean; access: string; limitation: string }[];
  allowance: { used: number; limit: number; remaining: number; windowDays: number; nextFreesAt: string | null; tier: OutboundTier; label: string } | null;
  stats: { total: number; fresh: number; high: number; saved: number };
  /** What the person offers, from their saved ideal client: the scan form starts from it. */
  services: string[];
  highIntentScore: number;
  scheduleEnabled: boolean;
}

export async function overview(user: Who, d: Partial<SocialDeps> = {}): Promise<Result<{ overview: SocialOverview }>> {
  const deps = { ...defaults(), ...d };
  const gate = readGate(user);
  if (gate) return gate;
  if (!(await isReady(deps))) return NOT_SETUP();
  const orgId = user.organizationId!, now = deps.now();
  const connected = new Set((await deps.sources().catch(() => [])).map((s) => s.name));
  const tier = await deps.tier(user).catch(() => "free" as OutboundTier);
  const limit = outboundAllowance(tier).monthlySocialScans;
  const since = new Date(now.getTime() - OUTBOUND_WINDOW_DAYS * DAY);
  let allowance: SocialOverview["allowance"] = null;
  try {
    const used = await deps.store.countScansSince(orgId, since);
    const oldest = used >= limit ? await deps.store.oldestScanSince(orgId, since) : null;
    allowance = { used, limit, remaining: Math.max(0, limit - used), windowDays: OUTBOUND_WINDOW_DAYS, nextFreesAt: oldest ? new Date(oldest.getTime() + OUTBOUND_WINDOW_DAYS * DAY).toISOString() : null, tier, label: TIER_LABEL[tier] };
  } catch { allowance = null; } // couldn't be counted: unknown, never "plenty left"
  return {
    ok: true,
    overview: {
      platforms: SOCIAL_PLATFORMS.map((p) => ({ id: p.id, label: p.label, mode: p.mode, connected: p.mode === "search" && connected.has(p.id), paid: p.paid, access: p.access, limitation: p.limitation })),
      allowance, stats: await deps.store.stats(orgId, HIGH_INTENT_SCORE), services: (await deps.savedServices(orgId)).slice(0, 8),
      highIntentScore: HIGH_INTENT_SCORE, scheduleEnabled: deps.scheduleEnabled(),
    },
  };
}

/* ── scan ───────────────────────────────────────────────────────────────── */

const phrase = z.string().trim().min(2).max(60);
const scanSchema = z.object({
  services: z.array(phrase).max(8).default([]),
  keywords: z.array(phrase).max(8).default([]),
  platforms: z.array(z.string()).max(8).default([]),
  profileId: z.number().int().positive().optional(),
});

export interface ScanSummary { id: number; read: number; kept: number; fresh: number; sources: SourceOutcome[]; purged: number }

function limitFail(tier: OutboundTier, limit: number) {
  return tier === "free"
    ? fail(402, "NO_CREDITS", `You've used the free plan's ${limit} Social Intent scans for this 30-day period. Upgrade to Pro for more.`, { feature: "outbound" })
    : fail(429, "monthly_limit", `You've used the ${limit} Social Intent scans included in ${TIER_LABEL[tier]} for this 30-day period. More become available as earlier scans pass 30 days.`);
}

/**
 * How a paid source makes a billed search here: reserved first against the workspace's daily searches, the platform's
 * daily cap and the workspace's spend ceiling — the SAME budgets a Client Radar web search uses, because it is the
 * same money — and settled afterwards with what really happened. Null = it can't be afforded; the source stops.
 */
function paidCallFor(deps: SocialDeps, orgId: string, why: { reason?: string }) {
  return async <T,>(provider: string, fn: () => Promise<T>): Promise<T | null> => {
    const now = deps.now();
    const used = await deps.search.countProviderCalls({ orgId, operation: "search", since: new Date(now.getTime() - DAY) });
    if (used >= dailySearchLimit(orgId)) { why.reason = "daily_limit"; return null; }
    const reservation = await deps.search.reserveSearch({
      orgId, runId: null, provider, costMicroUsd: costMicroUsd(provider), limit: globalSearchLimit(), since: utcDayStart(now), now,
      workspace: { since: new Date(now.getTime() - OUTBOUND_WINDOW_DAYS * DAY), maxMicroUsd: workspaceMonthlySpendMicroUsd(process.env, orgId) },
    });
    if (reservation === null || reservation === "workspace") { why.reason = reservation === null ? "global_limit" : "workspace_budget"; return null; }
    const t0 = Date.now();
    const settle = (ok: boolean, errorCode: string | null) => deps.search.settleProviderCall(reservation, { ok, errorCode, latencyMs: Date.now() - t0, costMicroUsd: ok || errorCode !== "auth" ? costMicroUsd(provider) : 0 }).catch(() => {});
    try { const r = await fn(); await settle(true, null); return r; }
    catch (e) { await settle(false, e instanceof DiscoveryError ? e.code : "error"); throw e; }
  };
}

const SOURCE_ERROR: Record<string, string> = {
  auth: "its key wasn't accepted", rate_limited: "it is busy or its limit was reached", unavailable: "it couldn't be reached", bad_response: "it sent something unreadable",
  timeout: "it took too long", aborted: "it took too long", daily_limit: "today's web searches are used", global_limit: "the platform's web searches for today are used", workspace_budget: "this workspace's usage limit for the period is reached",
};

export async function scan(user: Who, raw: unknown, opts: { trigger?: "manual" | "scheduled"; freeOnly?: boolean } = {}, d: Partial<SocialDeps> = {}): Promise<Result<{ scan: ScanSummary }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await isReady(deps))) return NOT_SETUP();
  const parsed = scanSchema.safeParse(raw ?? {});
  if (!parsed.success) return fail(400, "invalid", parsed.error.issues[0]?.message ?? "That search isn't valid.");
  const orgId = user.organizationId!, now = deps.now();
  let { services, keywords, platforms } = parsed.data;
  let profile: SocialProfileRow | null = null;
  if (parsed.data.profileId) {
    profile = await deps.store.getProfile(orgId, parsed.data.profileId);
    if (!profile) return fail(404, "not_found", "That saved search isn't in your workspace.");
    ({ services, keywords, platforms } = { services: strs(profile.services), keywords: strs(profile.keywords), platforms: strs(profile.platforms) });
  }
  // A scan with nothing to match would read hundreds of posts and could keep none: say so before using a scan.
  if (!services.length) return fail(422, "no_services", "Say what you offer first (for example “web design”), so I know which asks are for you.");
  const want = platforms.filter((p) => (SEARCHABLE_PLATFORMS as string[]).includes(p));
  const all = await deps.sources();
  const sources = all.filter((s) => (!want.length || want.includes(s.name)) && !(opts.freeOnly && s.paid));
  if (!sources.length) return fail(503, "SOCIAL_NO_SOURCES", want.length ? "None of the sources you picked is connected on this server." : "No Social Intent source is connected on this server yet.");

  const tier = await deps.tier(user);
  const limit = outboundAllowance(tier).monthlySocialScans;
  const row = await deps.store.reserveScan({ orgId, userId: user.id, profileId: profile?.id ?? null, trigger: opts.trigger ?? "manual", since: new Date(now.getTime() - OUTBOUND_WINDOW_DAYS * DAY), max: limit, now });
  if (!row) return limitFail(tier, limit);

  const outcomes: SourceOutcome[] = [];
  const posts: OpportunityPost[] = [];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SCAN_BUDGET_MS);
  try {
    for (const src of sources) {
      const why: { reason?: string } = {};
      const t0 = Date.now();
      try {
        const got = await src.scan({ services, keywords, signal: ctrl.signal, ...(src.paid ? { paidCall: paidCallFor(deps, orgId, why) } : {}) });
        posts.push(...got);
        // A paid source that couldn't afford its first search answered nothing because of a limit: that is a failure to report, not an empty result.
        outcomes.push(why.reason && !got.length ? { name: src.name, ok: false, posts: 0, error: why.reason } : { name: src.name, ok: true, posts: got.length });
        if (!src.paid) await deps.search.recordProviderCall({ orgId, runId: null, provider: src.name, operation: "social", ok: true, errorCode: null, latencyMs: Date.now() - t0, costMicroUsd: 0, now: deps.now() }).catch(() => {});
      } catch (e) {
        const code = e instanceof DiscoveryError ? e.code : "unavailable";
        outcomes.push({ name: src.name, ok: false, posts: 0, error: code });
        if (!src.paid) await deps.search.recordProviderCall({ orgId, runId: null, provider: src.name, operation: "social", ok: false, errorCode: code, latencyMs: Date.now() - t0, costMicroUsd: 0, now: deps.now() }).catch(() => {});
        // The type only, never the message: an error from a source can carry a piece of someone's post.
        console.log(JSON.stringify({ kind: "social_scan_source_failed", source: src.name, errorType: code }));
      }
    }
  } finally { clearTimeout(timer); }

  // No source answered: the person got nothing, so the scan is not charged.
  if (outcomes.every((o) => !o.ok)) {
    await deps.store.dropScan(row.id).catch(() => {});
    const first = outcomes[0]?.error ?? "unavailable";
    return fail(first === "daily_limit" || first === "global_limit" || first === "workspace_budget" ? 429 : 502, "sources_failed",
      `The scan couldn't run: ${outcomes.map((o) => `${labelOf(o.name)} — ${SOURCE_ERROR[o.error ?? ""] ?? "it had a problem"}`).join("; ")}. It wasn't counted.`);
  }

  // One row per post, however many sources returned it; then only real asks about the person's services are kept.
  const seen = new Set<string>();
  let kept = 0, fresh = 0;
  const minScore = profile?.minScore ?? 0;
  const expiresAt = new Date(now.getTime() + RETENTION_DAYS * DAY);
  for (const post of posts) {
    const url = postUrl(post.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const a = analysePost({ text: post.text, postedAt: post.postedAt, services, keywords, companyUrl: post.companyUrl, now });
    if (!a.qualifies || a.score.total < minScore) continue;
    const r = await deps.store.upsertOpportunity(orgId, {
      profileId: profile?.id ?? null, source: post.source, origin: "scan", url, community: post.threadTitle.slice(0, 80) || null,
      title: (post.title || excerptOf(post.text)).slice(0, TITLE_CHARS), excerpt: excerptOf(post.text),
      postedAt: post.postedAt ? new Date(post.postedAt) : null, intent: a.intent.category, intentMatched: a.intent.matched, service: a.service?.slice(0, 80) ?? null,
      signals: a.signals as unknown as Record<string, unknown>, score: a.score.total, scoreDetail: a.score as unknown as Record<string, unknown>,
      companyUrl: post.companyUrl ? post.companyUrl.slice(0, 300) : null, expiresAt,
    }, now);
    kept++;
    if (r.fresh) fresh++;
  }
  await deps.store.finishScan(row.id, { sources: outcomes, read: posts.length, kept, fresh });
  if (profile) await deps.store.markProfileRun(orgId, profile.id, now).catch(() => {});
  const purged = await deps.store.purgeExpired(orgId, now).catch(() => 0);
  return { ok: true, scan: { id: row.id, read: posts.length, kept, fresh, sources: outcomes, purged } };
}

/* ── list, status, delete ───────────────────────────────────────────────── */

const csv = (v: unknown, allowed: readonly string[]): string[] => String(v ?? "").split(",").map((s) => s.trim()).filter((s) => allowed.includes(s));
const STATUSES = ["new", "saved", "ignored", "contacted"] as const;
const PAGE = 30;

export async function list(user: Who, q: Record<string, unknown> = {}, d: Partial<SocialDeps> = {}): Promise<Result<{ opportunities: OpportunityView[]; total: number; page: number; pageCount: number }>> {
  const deps = { ...defaults(), ...d };
  const gate = readGate(user);
  if (gate) return gate;
  if (!(await isReady(deps))) return NOT_SETUP();
  const status = csv(q.status, STATUSES);
  const page = Math.max(1, Math.floor(Number(q.page)) || 1);
  const min = Math.max(0, Math.min(100, Math.floor(Number(q.minScore)) || 0));
  const r = await deps.store.listOpportunities(user.organizationId!, {
    // Ignored opportunities stay out of the way unless they are asked for.
    status: status.length ? status : ["new", "saved", "contacted"],
    intent: csv(q.intent, ["hiring", "recommendation", "partnership", "problem", "discussion"]), source: csv(q.source, SOCIAL_PLATFORMS.map((p) => p.id)),
    minScore: min, limit: PAGE, offset: (page - 1) * PAGE,
  });
  return { ok: true, opportunities: r.rows.map(opportunityView), total: r.total, page, pageCount: Math.max(1, Math.ceil(r.total / PAGE)) };
}

export async function setStatus(user: Who, id: number, raw: unknown, d: Partial<SocialDeps> = {}): Promise<Result<{ opportunity: OpportunityView }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await isReady(deps))) return NOT_SETUP();
  const status = z.enum(["new", "ignored", "contacted"]).safeParse(raw);
  if (!status.success) return fail(400, "invalid", "Choose new, ignored or contacted.");
  const orgId = user.organizationId!, now = deps.now();
  const cur = await deps.store.getOpportunity(orgId, id);
  if (!cur) return fail(404, "not_found", "That opportunity isn't in your workspace.");
  // "Contacted" is the person's own record and is kept; back to new or ignored, it ages out again unless it is a lead.
  const expiresAt = status.data === "contacted" || cur.leadId ? null : new Date(now.getTime() + RETENTION_DAYS * DAY);
  const row = await deps.store.setOpportunity(orgId, id, { status: status.data, expiresAt }, now);
  return row ? { ok: true, opportunity: opportunityView(row) } : fail(404, "not_found", "That opportunity isn't in your workspace.");
}

/** Removes an opportunity for good — the person's own tidy-up, and how a request to delete someone's post is honoured. A lead saved from it is a separate record and stays. */
export async function remove(user: Who, id: number, d: Partial<SocialDeps> = {}): Promise<Result<{ deleted: true }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await isReady(deps))) return NOT_SETUP();
  return (await deps.store.deleteOpportunity(user.organizationId!, id)) ? { ok: true, deleted: true } : fail(404, "not_found", "That opportunity isn't in your workspace.");
}

/* ── a post the person found themselves ─────────────────────────────────── */

const manualSchema = z.object({
  url: z.string().trim().min(8).max(500),
  text: z.string().trim().min(20, "Paste the post's text (at least a sentence), so I can read what they're asking for.").max(4000),
  services: z.array(phrase).max(8).optional(),
});

/**
 * A post from a platform that can't be searched (LinkedIn, Facebook, Instagram, X) or from anywhere else: the person
 * pastes its link and the text they read. Nothing is fetched from the link — the text is theirs to give — so this
 * works for every platform without touching any of them. It is read by the same rules as a scanned post, and kept
 * whatever they say: the person chose it. A post that reads as plain discussion is saved and labelled as one.
 */
export async function addManual(user: Who, raw: unknown, d: Partial<SocialDeps> = {}): Promise<Result<{ opportunity: OpportunityView; existing: boolean }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await isReady(deps))) return NOT_SETUP();
  const parsed = manualSchema.safeParse(raw ?? {});
  if (!parsed.success) return fail(400, "invalid", parsed.error.issues[0]?.message ?? "That isn't valid.");
  const url = postUrl(parsed.data.url);
  if (!url) return fail(400, "invalid", "That doesn't look like a link to a post. Copy the post's own link (it starts with https://).");
  const orgId = user.organizationId!, now = deps.now();
  if ((await deps.store.countManualSince(orgId, new Date(now.getTime() - DAY))) >= MAX_MANUAL_PER_DAY) return fail(429, "daily_limit", `You've added ${MAX_MANUAL_PER_DAY} posts by hand today. Try again tomorrow.`);
  const services = parsed.data.services?.length ? parsed.data.services : await deps.savedServices(orgId);
  const text = parsed.data.text.slice(0, 2000);
  const a = analysePost({ text, postedAt: null, services, companyUrl: null, now });
  const platform = platformOfUrl(url);
  const r = await deps.store.upsertOpportunity(orgId, {
    profileId: null, source: platform, origin: "manual", url, community: null,
    title: excerptOf(text.split("\n").find((l) => l.trim()) ?? text).slice(0, TITLE_CHARS), excerpt: excerptOf(text),
    postedAt: null, intent: a.intent.category, intentMatched: a.intent.matched, service: a.service?.slice(0, 80) ?? null,
    signals: a.signals as unknown as Record<string, unknown>, score: a.score.total, scoreDetail: a.score as unknown as Record<string, unknown>,
    companyUrl: null, expiresAt: new Date(now.getTime() + RETENTION_DAYS * DAY),
  }, now);
  const row = await deps.store.getOpportunity(orgId, r.id);
  return row ? { ok: true, opportunity: opportunityView(row), existing: !r.fresh } : fail(500, "internal", "Something went wrong on our side.");
}

/* ── opportunity → lead ─────────────────────────────────────────────────── */

/**
 * Where what they SAID is filed on the lead, by what kind of ask it was:
 *   looking to engage someone (hire, be recommended one, find a partner) → "hiring", a fact a message may be written from
 *   describing a problem                                                  → "pain_point": they said it, so it is confirmed
 *                                                                           as said — but it is an angle, not a fact about
 *                                                                           the company, so a message still needs research
 * A post that is plain discussion (only ever saved by hand) is kept as "public_post", which no draft reads: there is
 * nothing in it to write a sales message from.
 */
const SAID_FIELD: Partial<Record<IntentCategory, string>> = { hiring: "hiring", recommendation: "hiring", partnership: "hiring", problem: "pain_point" };

/**
 * Makes an opportunity a lead, with the post as its evidence: a CONFIRMED claim that they asked (the post's own
 * words, its link) and an INFERRED one for what they likely need. That split is the point — it is a fact that
 * someone posted this; that they need the person's service is our reading of it — and it is what a drafted message
 * later reads, so the draft can cite the ask without inventing anything around it.
 *
 * The lead's name is the company's domain when the post links a site, otherwise a plain description of the post
 * ("Post in r/smallbusiness: …") — never a guess at who the poster is.
 */
export async function saveToLeads(user: Who, id: number, raw: unknown = {}, d: Partial<SocialDeps> = {}): Promise<Result<{ leadId: number; existing: boolean; opportunity: OpportunityView }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await isReady(deps))) return NOT_SETUP();
  const orgId = user.organizationId!, now = deps.now();
  const opp = await deps.store.getOpportunity(orgId, id);
  if (!opp) return fail(404, "not_found", "That opportunity isn't in your workspace.");
  const done = async (leadId: number, existing: boolean) => {
    const row = await deps.store.setOpportunity(orgId, id, { status: opp.status === "contacted" ? "contacted" : "saved", leadId, expiresAt: null }, now);
    return { ok: true as const, leadId, existing, opportunity: opportunityView(row ?? opp) };
  };
  if (opp.leadId) return done(opp.leadId, true);
  const known = await deps.leads.leadIdsByEvidenceUrls(orgId, [opp.url]);
  if (known.length) return done(known[0].leadId, true);

  const given = z.object({ name: z.string().trim().min(1).max(120).optional() }).safeParse(raw ?? {});
  const site = opp.companyUrl ? canonicalUrl(opp.companyUrl) : null;
  const domain = site ? domainOf(site) : null;
  const where = opp.community ? `Post in ${opp.community}` : `Post on ${labelOf(opp.source)}`;
  const companyName = (given.success && given.data.name) || domain || `${where}: ${opp.title}`.slice(0, 120);
  const created = await deps.createLead(user, { companyName, ...(domain ? { website: `https://${domain}` } : {}) }, { source: "outbound" });
  if (!created.ok) {
    if (created.code === "duplicate" && typeof (created as any).existingId === "number") return done((created as any).existingId, true);
    return created;
  }
  const leadId = created.lead.id;
  const quote = opp.excerpt.length >= 8 ? opp.excerpt : opp.title;
  // The field names are not free text: a drafted message is written ONLY from claims in the fields it knows
  // (server/sales/outreach.ts draftFacts — facts like "hiring", angles like "pain_point" and "opportunity"). A claim
  // filed under any other name would be saved and then never read, and the draft would say nothing about the post.
  const said = `Asked publicly (${where.toLowerCase()}): ${opp.title}`.slice(0, 400);
  const field = SAID_FIELD[opp.intent as IntentCategory] ?? "public_post";
  await deps.addClaim(user, leadId, { field, value: said, status: "confirmed", evidenceUrl: opp.url, evidenceSnippet: quote.slice(0, 500) });
  if (opp.service) await deps.addClaim(user, leadId, { field: "opportunity", value: `Likely needs ${opp.service} (our reading of their post, not something they confirmed to you)`.slice(0, 400), status: "inferred", evidenceUrl: opp.url });
  return done(leadId, false);
}

/* ── saved searches ─────────────────────────────────────────────────────── */

const profileSchema = z.object({
  name: z.string().trim().min(1, "Give the search a name.").max(80),
  services: z.array(phrase).min(1, "Add at least one service you offer.").max(8),
  keywords: z.array(phrase).max(8).default([]),
  platforms: z.array(z.string()).max(8).default([]),
  minScore: z.number().int().min(0).max(100).default(0),
  schedule: z.enum(["off", "daily", "weekly"]).default("off"),
});

const nextRun = (schedule: string, status: string, now: Date): Date | null =>
  status !== "active" || schedule === "off" ? null : new Date(now.getTime() + (schedule === "weekly" ? 7 : 1) * DAY);

export async function listProfiles(user: Who, d: Partial<SocialDeps> = {}): Promise<Result<{ profiles: ProfileView[] }>> {
  const deps = { ...defaults(), ...d };
  const gate = readGate(user);
  if (gate) return gate;
  if (!(await isReady(deps))) return NOT_SETUP();
  return { ok: true, profiles: (await deps.store.listProfiles(user.organizationId!)).map(profileView) };
}

export async function createProfile(user: Who, raw: unknown, d: Partial<SocialDeps> = {}): Promise<Result<{ profile: ProfileView }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await isReady(deps))) return NOT_SETUP();
  const parsed = profileSchema.safeParse(raw ?? {});
  if (!parsed.success) return fail(400, "invalid", parsed.error.issues[0]?.message ?? "That saved search isn't valid.");
  const orgId = user.organizationId!, now = deps.now();
  if ((await deps.store.listProfiles(orgId)).length >= MAX_PROFILES) return fail(409, "too_many", `A workspace can keep ${MAX_PROFILES} saved searches. Delete one first.`);
  // A schedule on a server that doesn't run schedules would be a promise nothing keeps: it is saved as off, and the page says why.
  const schedule = deps.scheduleEnabled() ? parsed.data.schedule : "off";
  const row = await deps.store.createProfile(orgId, user.id, {
    ...parsed.data, platforms: parsed.data.platforms.filter((p) => (SEARCHABLE_PLATFORMS as string[]).includes(p)), schedule, status: "active", nextRunAt: nextRun(schedule, "active", now),
  }, now);
  deps.onProfilesChanged();
  return { ok: true, profile: profileView(row) };
}

export async function updateProfile(user: Who, id: number, raw: unknown, d: Partial<SocialDeps> = {}): Promise<Result<{ profile: ProfileView }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await isReady(deps))) return NOT_SETUP();
  const parsed = profileSchema.partial().extend({ status: z.enum(["active", "paused"]).optional() }).safeParse(raw ?? {});
  if (!parsed.success) return fail(400, "invalid", parsed.error.issues[0]?.message ?? "That saved search isn't valid.");
  const orgId = user.organizationId!, now = deps.now();
  const cur = await deps.store.getProfile(orgId, id);
  if (!cur) return fail(404, "not_found", "That saved search isn't in your workspace.");
  const status = parsed.data.status ?? cur.status;
  const schedule = deps.scheduleEnabled() ? (parsed.data.schedule ?? cur.schedule) : "off";
  // The next run is re-timed only when the timing itself changed: renaming a search must not push its next scan back.
  const retime = status !== cur.status || schedule !== cur.schedule;
  const row = await deps.store.updateProfile(orgId, id, {
    ...parsed.data, ...(parsed.data.platforms ? { platforms: parsed.data.platforms.filter((p) => (SEARCHABLE_PLATFORMS as string[]).includes(p)) } : {}),
    status, schedule, ...(retime ? { nextRunAt: nextRun(schedule, status, now) } : {}),
  }, now);
  deps.onProfilesChanged();
  return row ? { ok: true, profile: profileView(row) } : fail(404, "not_found", "That saved search isn't in your workspace.");
}

export async function duplicateProfile(user: Who, id: number, d: Partial<SocialDeps> = {}): Promise<Result<{ profile: ProfileView }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await isReady(deps))) return NOT_SETUP();
  const orgId = user.organizationId!;
  const cur = await deps.store.getProfile(orgId, id);
  if (!cur) return fail(404, "not_found", "That saved search isn't in your workspace.");
  if ((await deps.store.listProfiles(orgId)).length >= MAX_PROFILES) return fail(409, "too_many", `A workspace can keep ${MAX_PROFILES} saved searches. Delete one first.`);
  // A copy starts unscheduled: two searches scanning on one schedule is rarely what a copy is for.
  const row = await deps.store.createProfile(orgId, user.id, { name: `${cur.name} (copy)`.slice(0, 80), services: strs(cur.services), keywords: strs(cur.keywords), platforms: strs(cur.platforms), minScore: cur.minScore, schedule: "off", status: "active", nextRunAt: null }, deps.now());
  return { ok: true, profile: profileView(row) };
}

export async function deleteProfile(user: Who, id: number, d: Partial<SocialDeps> = {}): Promise<Result<{ deleted: true }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await isReady(deps))) return NOT_SETUP();
  // The opportunities it found stay: they are the person's findings, not the search's.
  return (await deps.store.deleteProfile(user.organizationId!, id)) ? { ok: true, deleted: true } : fail(404, "not_found", "That saved search isn't in your workspace.");
}
