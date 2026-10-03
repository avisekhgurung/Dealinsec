/**
 * Finding companies: one search, one list of candidates. The agent's tool calls
 * this; nothing here creates a lead (adding one is a separate, approved step).
 *
 * Guards, in order: the feature is configured, the person may add leads, the
 * search text is safe to send out, and the organization and the whole app are
 * under their search caps (a paid service with no spending cap of its own).
 */
import { sanitizeQuery, type Candidate } from "@shared/discovery";
import { pickBusinesses } from "../discovery/pick";
import { DiscoveryError } from "../discovery/types";
import { discoveryConfigured, discoveryProvider } from "../discovery/provider";
import { searchCount } from "../discovery/usage";
import { leadsStore } from "../leads/store";
import { agentLog } from "../agent/log";
import { fail, writeGate, type Result, type Who } from "./leads";

const DAY = 86_400_000;
const intEnv = (name: string, dflt: number) => { const n = Number(process.env[name]); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : dflt; };
export const dailyLimit = () => intEnv("DISCOVERY_DAILY_LIMIT", 10);
export const monthlyLimit = () => intEnv("DISCOVERY_MONTHLY_LIMIT", 300);

export interface SearchPlan { query: string; country: string | null; remainingToday: number; provider: { label: string; paid: boolean } }

/** Everything that can be checked WITHOUT spending a search: what a tool shows before asking. */
export async function planSearch(user: Who, raw: { query?: unknown; country?: unknown }): Promise<Result<SearchPlan>> {
  const gate = writeGate(user);
  if (gate) return gate;
  if (!discoveryConfigured()) return fail(503, "not_configured", "Finding companies isn't switched on for this workspace yet (no search service is set up).");
  const q = sanitizeQuery(String(raw.query ?? ""));
  if (!q.ok) return fail(400, "invalid", q.reason);
  // A provider with no country filter never gets one, and the card never shows one: the place belongs in the words.
  const wantsCountry = raw.country !== undefined && raw.country !== null && raw.country !== "";
  const code = typeof raw.country === "string" && /^[A-Za-z]{2}$/.test(raw.country.trim()) ? raw.country.trim().toUpperCase() : null;
  if (wantsCountry && !code && discoveryProvider.supportsCountry) return fail(400, "invalid", "Use a two-letter country code such as IN or GB, or leave it out.");
  const country = discoveryProvider.supportsCountry ? code : null;

  const now = Date.now();
  const [today, month] = await Promise.all([
    searchCount({ since: new Date(now - DAY), orgId: user.organizationId! }),
    searchCount({ since: new Date(now - 30 * DAY) }),
  ]);
  if (today >= dailyLimit()) return fail(429, "daily_limit", `You've used today's ${dailyLimit()} company searches. Try again tomorrow, or add companies you already know.`);
  if (month >= monthlyLimit()) return fail(429, "monthly_limit", "Company search has reached its monthly limit for the whole app. It resets on a rolling 30-day basis.");
  return { ok: true, query: q.query, country, remainingToday: Math.min(dailyLimit() - today, monthlyLimit() - month), provider: { label: discoveryProvider.label, paid: discoveryProvider.paid } };
}

export interface FoundCompany extends Candidate { alreadyLead: number | null }

export async function searchCompanies(
  user: Who, raw: { query?: unknown; country?: unknown }, opts: { signal?: AbortSignal; addUsage?: (i: number, o: number) => void } = {},
): Promise<Result<{ query: string; companies: FoundCompany[]; remainingToday: number; provider: string; reviewed: boolean }>> {
  const plan = await planSearch(user, raw);
  if (!plan.ok) return plan;
  let results;
  try {
    results = await discoveryProvider.search(plan.query, { country: plan.country ?? undefined, count: 50, signal: opts.signal });
  } catch (e) {
    if (e instanceof DiscoveryError) {
      agentLog("error", { errorType: "DiscoverySearchFailed", code: e.code });
      return fail(e.code === "rate_limited" ? 429 : 502, `search_${e.code}`, e.message);
    }
    throw e;
  }
  // A model reads the results and picks real businesses; code verifies every pick. There is deliberately
  // no fallback: unreviewed web results are mostly news and directories, and a wrong list is worse than
  // an honest "try again".
  const picked = await pickBusinesses(results, plan.query, { signal: opts.signal, addUsage: opts.addUsage });
  if (picked === null) {
    agentLog("error", { errorType: "DiscoveryReviewFailed" });
    return fail(502, "review_failed", "I searched, but couldn't review the results just now, so I won't show unchecked ones. Try again in a minute.");
  }
  const reviewed = true;
  const candidates = picked;

  const orgId = user.organizationId!;
  const companies: FoundCompany[] = [];
  for (const c of candidates) {
    const existing = c.domain ? await leadsStore.findByDomain(orgId, c.domain) : await leadsStore.findByName(orgId, c.name);
    companies.push({ ...c, alreadyLead: existing?.id ?? null });
  }
  return { ok: true, query: plan.query, companies, remainingToday: Math.max(0, plan.remainingToday - 1), provider: plan.provider.label, reviewed };
}
