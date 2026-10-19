/**
 * Local business discovery (shared/local-discovery.ts says what may be kept, and why):
 *
 *   localSearch          one Places Text Search; the listings are returned to the person and NOT stored. It uses one of
 *                        the plan's searches (one credit = one search), recorded as a finished run so the allowance and
 *                        the history count it; a search the provider failed is not charged.
 *   researchLocalSites   the person picks listings that give a website; DealInSec researches those websites itself (the
 *                        normal pipeline, seeded): names, facts and evidence come from the sites, and only the place ID
 *                        is kept, as provenance. Uses the researched-prospects allowance and the spend ceiling.
 *   saveLocalLead        a listing without a website becomes a lead the person names: the lead keeps a Google Maps link
 *                        built from the place ID, never the listing's name, address or phone.
 *
 * Places content is never sent to an AI model.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { filterByWebsite, isPlaceId, localQuery, localSearchSchema, mapsUrlFor, type LocalResult } from "@shared/local-discovery";
import { OUTBOUND_WINDOW_DAYS, TIER_LABEL, type OutboundTier } from "@shared/outbound-plans";
import { icpSchema, type Icp } from "@shared/icp";
import { siteHost } from "@shared/research";
import { DiscoveryError } from "../discovery/types";
import { localBusinessProvider, type LocalBusinessProvider } from "../discovery/google-places";
import { addClaim, createLead, fail, writeGate, type Result, type Who } from "../services/leads";
import { leadsStore } from "../leads/store";
import { dailyRunLimit, globalLocalSearchLimit, outboundAllowance, workspaceMonthlySpendMicroUsd } from "./limits";
import { utcDayStart } from "@shared/llm-cost";
import { outboundTier } from "./plan";
import { costMicroUsd } from "./providers";
import { newRunId } from "./pipeline";
import { outboundRunner } from "./runner";
import { outboundStore, prospectsTablesReady, RunLimitReached, type OutboundStore } from "./store";

const DAY = 86_400_000;

export interface LocalDeps {
  store: OutboundStore;
  provider: LocalBusinessProvider | null;
  leads: Pick<typeof leadsStore, "findByDomain" | "leadIdsByEvidenceUrls">;
  tier: (user: Who) => Promise<OutboundTier>;
  now: () => Date;
  kick: () => void;
}
const defaults = (): LocalDeps => ({
  store: outboundStore, provider: localBusinessProvider(), leads: leadsStore, tier: outboundTier,
  now: () => new Date(), kick: () => outboundRunner.kick(),
});

const NOT_SETUP = () => fail(503, "PROSPECTS_NOT_SETUP", "Client Radar isn't set up on this server yet.");
const LOCAL_NOT_SETUP = () => fail(503, "LOCAL_NOT_SETUP", "Local business search isn't switched on yet. Search for companies online meanwhile.");
async function ready(): Promise<boolean> { try { return await prospectsTablesReady(); } catch { return false; } }

/** Whether local business search can run on this server (a source is configured). */
export const localSearchReady = (d: Partial<LocalDeps> = {}) => !!({ ...defaults(), ...d }).provider;

function limitFail(tier: OutboundTier, monthly: number, i: number) {
  if (i === 0) return tier === "free"
    ? fail(402, "NO_CREDITS", `You've used the free plan's ${monthly} Client Radar searches for this 30-day period. Upgrade to Pro for more.`, { feature: "outbound" })
    : fail(429, "monthly_limit", `You've used the ${monthly} Client Radar searches included in ${TIER_LABEL[tier]} for this 30-day period. More become available as earlier searches pass 30 days.`);
  if (i === 1) return fail(429, "daily_limit", `You've started today's ${dailyRunLimit()} prospect searches. Try again tomorrow.`);
  return tier === "free"
    ? fail(402, "NO_CREDITS", "You've used the free plan's researched prospects for this 30-day period. Upgrade to Pro for more.", { feature: "outbound" })
    : fail(429, "monthly_limit", `You've used the researched prospects included in ${TIER_LABEL[tier]} for this 30-day period.`);
}

const icpFor = (i: { category: string; city: string; country: string; quantity: number }): Icp =>
  icpSchema.parse({ industry: i.category, countries: [i.country], locations: [i.city], quantity: i.quantity });

/* ── search ─────────────────────────────────────────────────────────────── */

export async function localSearch(user: Who, raw: unknown, d: Partial<LocalDeps> = {}): Promise<Result<{ runId: string; results: LocalResult[]; source: { name: string; attribution: string } }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await ready())) return NOT_SETUP();
  const parsed = localSearchSchema.safeParse(raw ?? {});
  if (!parsed.success) return fail(400, "invalid", parsed.error.issues[0]?.message ?? "That search isn't valid.");
  const input = parsed.data;
  if (!deps.provider) return LOCAL_NOT_SETUP();
  const orgId = user.organizationId!, now = deps.now();
  const tier = await deps.tier(user);
  const allowance = outboundAllowance(tier);
  const since = new Date(now.getTime() - OUTBOUND_WINDOW_DAYS * DAY);
  const cost = costMicroUsd(deps.provider.name);
  const max = Math.min(input.max, allowance.maxCompanies * 2, 20);
  const query = localQuery(input);
  // One credit for one search, reserved first (under the run-start lock, like any search); refunded below if it fails.
  let runId: string;
  try {
    const run = await deps.store.createRun({
      id: newRunId(), orgId, userId: user.id, by: "user", request: `${input.category} in ${input.city}`.slice(0, 500), icp: icpFor({ ...input, quantity: max }), quantity: max,
      idemKey: `local_${randomUUID()}`, now, queries: [{ q: query, provider: deps.provider.name, done: true, ok: true }],
      limits: [{ since, max: allowance.monthlySearches }, { since: new Date(now.getTime() - DAY), max: dailyRunLimit() }],
      finished: { counters: { searched: 1, results: 0, mode: "local" } },
    });
    runId = run.id;
  } catch (e) {
    if (e instanceof RunLimitReached) return limitFail(tier, allowance.monthlySearches, e.index);
    throw e;
  }
  // Not charged when the search doesn't happen: the run's credit is handed back.
  const refund = (code: string) => deps.store.settleFinishedRun(orgId, runId, { searched: 0, results: 0, mode: "local" }, code).catch(() => {});
  // The provider call itself is reserved under the platform's daily cap and this workspace's 30-day spend ceiling, in one
  // transaction (the same ledger and locks as web searches), then completed with what happened.
  let reservation: number | null | "workspace";
  try {
    reservation = await deps.store.reserveSearch({ orgId, runId, provider: deps.provider.name, operation: "local_search", costMicroUsd: cost, limit: globalLocalSearchLimit(), since: utcDayStart(now), now, workspace: { since, maxMicroUsd: workspaceMonthlySpendMicroUsd() } });
  } catch { reservation = null; }
  if (reservation === "workspace") {
    await refund("workspace_budget");
    return fail(429, "workspace_budget", "This workspace's AI usage for the last 30 days has reached its limit. It frees up as earlier usage passes 30 days.");
  }
  if (reservation === null) {
    await refund("global_limit");
    return fail(429, "local_busy", "Local business search has reached today's limit across DealInSec. Nothing was used from your allowance; try again tomorrow, or search for companies online.");
  }
  const t0 = Date.now();
  let listings: Awaited<ReturnType<LocalBusinessProvider["searchText"]>>;
  try {
    listings = await deps.provider.searchText(query, { regionCode: input.country, pageSize: 20 });
    await deps.store.settleProviderCall(reservation, { ok: true, errorCode: null, latencyMs: Date.now() - t0, costMicroUsd: cost }).catch(() => {});
  } catch (e) {
    const code = e instanceof DiscoveryError ? e.code : "error";
    // A refused key isn't billed; anything else may have been.
    await deps.store.settleProviderCall(reservation, { ok: false, errorCode: code, latencyMs: Date.now() - t0, costMicroUsd: code === "auth" ? 0 : cost }).catch(() => {});
    await refund("search_unavailable");
    return fail(code === "auth" ? 503 : 502, "local_unavailable", "The local business search didn't answer. Nothing was used from your allowance; try again in a moment.");
  }
  const shown = filterByWebsite(listings, input.website).slice(0, max);
  // Already in this workspace: by the website's domain (prospects, leads) or by the place ID (prospects researched from a
  // listing, leads saved from one). Read-only lookups; nothing about the listings is written.
  const domains = Array.from(new Set(shown.map((r) => r.domain).filter((x): x is string => !!x)));
  const [byDomain, byPlace, byLink] = await Promise.all([
    deps.store.prospectsByDomains(orgId, domains),
    deps.store.prospectsByPlaceIds(orgId, shown.map((r) => r.placeId)),
    deps.leads.leadIdsByEvidenceUrls(orgId, shown.map((r) => mapsUrlFor(r.placeId))),
  ]);
  const leadByDomain = new Map<string, number>();
  for (const dm of domains) { const l = await deps.leads.findByDomain(orgId, dm); if (l) leadByDomain.set(dm, l.id); }
  const results: LocalResult[] = shown.map((r) => {
    const p = byPlace.find((x) => x.placeId === r.placeId) ?? (r.domain ? byDomain.find((x) => x.domain === r.domain) : undefined);
    const leadId = p?.leadId ?? byLink.find((x) => x.url === mapsUrlFor(r.placeId))?.leadId ?? (r.domain ? leadByDomain.get(r.domain) : undefined);
    return { ...r, existing: p || leadId ? { ...(p ? { prospectId: p.id } : {}), ...(leadId ? { leadId } : {}) } : null };
  });
  await deps.store.settleFinishedRun(orgId, runId, { searched: 1, results: results.length, mode: "local" }, null).catch(() => {});
  return { ok: true, runId, results, source: { name: deps.provider.name, attribution: "Google Maps" } };
}

/* ── research the websites the person picked ─────────────────────────────── */

const researchSchema = z.object({
  category: z.string().trim().min(2).max(80),
  city: z.string().trim().min(2).max(60),
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
  places: z.array(z.object({ placeId: z.string().refine(isPlaceId, "not a place ID"), website: z.string().trim().max(300) })).min(1).max(20),
});

export async function researchLocalSites(user: Who, raw: unknown, d: Partial<LocalDeps> = {}): Promise<Result<{ runId: string; queued: number; skipped: number }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await ready())) return NOT_SETUP();
  const parsed = researchSchema.safeParse(raw ?? {});
  if (!parsed.success) return fail(400, "invalid", "Pick at least one listing with a website.");
  const orgId = user.organizationId!, now = deps.now();
  // Only real web addresses, one per site.
  const seen = new Set<string>();
  const sites: { placeId: string; domain: string }[] = [];
  for (const p of parsed.data.places) {
    let domain = "";
    try { const u = new URL(p.website); if (u.protocol === "http:" || u.protocol === "https:") domain = siteHost(u.hostname); } catch { domain = ""; }
    if (domain && domain.includes(".") && !seen.has(domain)) { seen.add(domain); sites.push({ placeId: p.placeId, domain }); }
  }
  if (!sites.length) return fail(400, "invalid", "None of those listings gives a website to research.");
  const tier = await deps.tier(user);
  const allowance = outboundAllowance(tier);
  const picked = sites.slice(0, allowance.maxCompanies);
  const since = new Date(now.getTime() - OUTBOUND_WINDOW_DAYS * DAY);
  let run;
  try {
    // No web search is made (the local search already used its credit): this run uses the researched-prospects allowance,
    // under the run-start lock; held from the runner until its companies are attached.
    run = await deps.store.createRun({
      id: newRunId(), orgId, userId: user.id, by: "user", request: `Websites of ${parsed.data.category} in ${parsed.data.city}`.slice(0, 500),
      icp: icpFor({ ...parsed.data, quantity: picked.length }), quantity: picked.length, idemKey: `local_sites_${randomUUID()}`, queries: [], now,
      limits: [{ since: new Date(now.getTime() - DAY), max: dailyRunLimit() }], prospects: { since, max: allowance.monthlyProspects },
      holdUntil: new Date(now.getTime() + 5 * 60_000),
    });
  } catch (e) {
    if (e instanceof RunLimitReached) return limitFail(tier, allowance.monthlySearches, e.index === 0 ? 1 : 2);
    throw e;
  }
  const seeds = picked.slice(0, run.quantity); // trimmed to what's left of the allowance
  for (const s of seeds) {
    const p = await deps.store.upsertProspect(orgId, {
      domain: s.domain, name: s.domain, website: `https://${s.domain}/`,
      sources: [{ provider: "google_places", query: "", url: mapsUrlFor(s.placeId), title: "", at: now.toISOString(), placeId: s.placeId }],
    }, now);
    await deps.store.addRunItem({ runId: run.id, orgId, prospectId: p.id, stage: "found", now });
  }
  await deps.store.setLease(run.id, run.attempts, null);
  deps.kick();
  return { ok: true, runId: run.id, queued: seeds.length, skipped: sites.length - seeds.length };
}

/* ── save a listing without a website as a lead ──────────────────────────── */

const leadSchema = z.object({
  placeId: z.string().refine(isPlaceId, "not a place ID"),
  /** Typed by the person: the listing's own name is not copied. */
  companyName: z.string().trim().min(2, "Type the business name as you'll call them.").max(120),
  location: z.string().trim().max(80).optional(),
});

export async function saveLocalLead(user: Who, raw: unknown, d: Partial<LocalDeps> = {}): Promise<Result<{ leadId: number; existing: boolean }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  const parsed = leadSchema.safeParse(raw ?? {});
  if (!parsed.success) return fail(400, "invalid", parsed.error.issues[0]?.message ?? "That isn't valid.");
  const orgId = user.organizationId!;
  const link = mapsUrlFor(parsed.data.placeId);
  const known = await deps.leads.leadIdsByEvidenceUrls(orgId, [link]);
  if (known.length) return { ok: true, leadId: known[0].leadId, existing: true };
  const created = await createLead(user, { companyName: parsed.data.companyName, ...(parsed.data.location ? { location: parsed.data.location } : {}) }, { source: "outbound" });
  if (!created.ok) return created.code === "duplicate" && typeof created.existingId === "number" ? { ok: true, leadId: created.existingId, existing: true } : created;
  await addClaim(user, created.lead.id, { field: "listing", value: "Google Maps listing: open it for the business's current details", status: "unknown", evidenceUrl: link });
  return { ok: true, leadId: created.lead.id, existing: false };
}
