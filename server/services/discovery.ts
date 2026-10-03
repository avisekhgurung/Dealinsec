/**
 * Finding companies: one search, one list of candidates. The agent's tool calls
 * this; nothing here creates a lead (adding one is a separate, approved step).
 *
 * Guards, in order: the feature is configured, the person may add leads, the
 * search text is safe to send out, and the organization and the whole app are
 * under their search caps (a paid service with no spending cap of its own).
 */
import { sanitizeQuery, toCandidates, type Candidate } from "@shared/discovery";
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

export interface SearchPlan { query: string; country: string | null; remainingToday: number }

/** Everything that can be checked WITHOUT spending a search: what a tool shows before asking. */
export async function planSearch(user: Who, raw: { query?: unknown; country?: unknown }): Promise<Result<SearchPlan>> {
  const gate = writeGate(user);
  if (gate) return gate;
  if (!discoveryConfigured()) return fail(503, "not_configured", "Finding companies isn't switched on for this workspace yet (no search service is set up).");
  const q = sanitizeQuery(String(raw.query ?? ""));
  if (!q.ok) return fail(400, "invalid", q.reason);
  const country = typeof raw.country === "string" && /^[A-Za-z]{2}$/.test(raw.country.trim()) ? raw.country.trim().toUpperCase() : null;
  if (raw.country !== undefined && raw.country !== null && raw.country !== "" && !country) return fail(400, "invalid", "Use a two-letter country code such as IN or GB, or leave it out.");

  const now = Date.now();
  const [today, month] = await Promise.all([
    searchCount({ since: new Date(now - DAY), orgId: user.organizationId! }),
    searchCount({ since: new Date(now - 30 * DAY) }),
  ]);
  if (today >= dailyLimit()) return fail(429, "daily_limit", `You've used today's ${dailyLimit()} company searches. Try again tomorrow, or add companies you already know.`);
  if (month >= monthlyLimit()) return fail(429, "monthly_limit", "Company search has reached its monthly limit for the whole app. It resets on a rolling 30-day basis.");
  return { ok: true, query: q.query, country, remainingToday: Math.min(dailyLimit() - today, monthlyLimit() - month) };
}

export interface FoundCompany extends Candidate { alreadyLead: number | null }

export async function searchCompanies(user: Who, raw: { query?: unknown; country?: unknown }, signal?: AbortSignal): Promise<Result<{ query: string; companies: FoundCompany[]; remainingToday: number }>> {
  const plan = await planSearch(user, raw);
  if (!plan.ok) return plan;
  let results;
  try {
    results = await discoveryProvider.search(plan.query, { country: plan.country ?? undefined, count: 20, signal });
  } catch (e) {
    if (e instanceof DiscoveryError) {
      agentLog("error", { errorType: "DiscoverySearchFailed", code: e.code });
      return fail(e.code === "rate_limited" ? 429 : 502, `search_${e.code}`, e.message);
    }
    throw e;
  }
  const orgId = user.organizationId!;
  const companies: FoundCompany[] = [];
  for (const c of toCandidates(results)) {
    const existing = await leadsStore.findByDomain(orgId, c.domain);
    companies.push({ ...c, alreadyLead: existing?.id ?? null });
  }
  return { ok: true, query: plan.query, companies, remainingToday: Math.max(0, plan.remainingToday - 1) };
}
