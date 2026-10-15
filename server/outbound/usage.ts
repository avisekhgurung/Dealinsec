/**
 * AI Outbound usage, shown BEFORE a search starts. Read-only and advisory: the server still enforces every limit where
 * the work happens (startRun, the search step's atomic reservation, the model budget's reservation), so this can never
 * let anything through. It counts from the same tables, with the same windows, as that enforcement:
 *
 *   the workspace's own allowances (rolling 24 hours, limits.ts)
 *     prospect searches started · web searches made · contact lookups (only when a contact provider is connected)
 *   the platform's safety caps (every workspace together, per UTC day)
 *     web searches (OUTBOUND_GLOBAL_DAILY_SEARCHES) · the AI Outbound model budget (shared/llm-cost.ts)
 *
 * The workspace's allowances are exact numbers. The platform caps are reported only as a state (available, limited,
 * paused), never as counts or dollars: they are an operational safeguard, not something a workspace is entitled to.
 * Anything that can't be counted is reported as unknown, not as zero or as "available".
 */
import { gte, inArray, sql } from "drizzle-orm";
import { llmCalls } from "@shared/schema";
import { globalDailySpendMicroUsd, poolDailySpendMicroUsd, poolTasks, utcDayStart } from "@shared/llm-cost";
import { runBudget } from "@shared/prospect";
import { DEFAULT_QUANTITY } from "@shared/icp";
import { db } from "../db";
import { fail, readGate, type Result, type Who } from "../services/leads";
import { dailyContactLimit, dailyRunLimit, dailySearchLimit, globalSearchLimit } from "./limits";
import { pipelineDeps, type PipelineDeps } from "./pipeline";
import type { ProspectRunRow } from "@shared/schema";
import { prospectsTablesReady } from "./store";
import { platformState, runCountsTowardLimit, type PlatformState } from "@shared/outbound-usage";

const DAY = 86_400_000;

export interface Allowance { used: number; limit: number; remaining: number; nextFreesAt: string | null }

export interface OutboundUsage {
  asOf: string;
  /** Searching can run on this server at all (a web-search provider is connected). */
  searchReady: boolean;
  /** Starting a search never takes money or credits; it uses the allowances below. */
  charge: "included";
  workspace: { searches: Allowance | null; webSearches: Allowance | null; contactLookups: Allowance | null };
  /** One search plans up to this many web searches (a search that finds enough stops early). */
  perSearch: { webSearches: number };
  platform: { state: PlatformState; resetsAt: string };
}

export interface UsageDeps {
  now: () => Date;
  tablesReady: () => Promise<boolean>;
  searchReady: () => Promise<boolean>;
  contactReady: () => boolean;
  /** Runs started in the window, newest first (enough of them to cover the allowance). */
  recentRuns: (orgId: string, since: Date, limit: number) => Promise<Pick<ProspectRunRow, "status" | "counters" | "createdAt">[]>;
  countProviderCalls: (o: { orgId?: string; operation: string; since: Date }) => Promise<number>;
  /** Model spend since `since`, every workspace: all of it, and the AI Outbound pool's. */
  platformSpend: (since: Date, pool: readonly string[]) => Promise<{ all: number; pool: number }>;
}

function allowance(used: number, limit: number, nextFreesAt: Date | null): Allowance {
  return { used, limit, remaining: Math.max(0, limit - used), nextFreesAt: used >= limit && nextFreesAt ? nextFreesAt.toISOString() : null };
}

/** The usage view. Each part is computed on its own, so one failed count makes only that part unknown. */
export async function outboundUsage(user: Who, d: Partial<UsageDeps> = {}): Promise<Result<{ usage: OutboundUsage }>> {
  const gate = readGate(user);
  if (gate) return gate;
  const deps = { ...defaultUsageDeps(), ...d };
  let tablesReady = false;
  try { tablesReady = await deps.tablesReady(); } catch { tablesReady = false; }
  if (!tablesReady) return fail(503, "PROSPECTS_NOT_SETUP", "AI Outbound isn't set up on this server yet.");
  const orgId = user.organizationId!;
  const now = deps.now(), since = new Date(now.getTime() - DAY), dayStart = utcDayStart(now);
  const perSearch = runBudget(DEFAULT_QUANTITY).queries;
  const safe = async <T>(f: () => Promise<T>): Promise<T | null> => { try { return await f(); } catch { return null; } };

  const searches = await safe(async () => {
    const limit = dailyRunLimit();
    const counted = (await deps.recentRuns(orgId, since, Math.max(20, limit + 5))).filter(runCountsTowardLimit);
    const oldest = counted.length ? counted.reduce((a, r) => (r.createdAt < a ? r.createdAt : a), counted[0].createdAt) : null;
    return allowance(counted.length, limit, oldest ? new Date(new Date(oldest).getTime() + DAY) : null);
  });
  const webSearches = await safe(async () => allowance(await deps.countProviderCalls({ orgId, operation: "search", since }), dailySearchLimit(), null));
  const contactLookups = deps.contactReady()
    ? await safe(async () => allowance(await deps.countProviderCalls({ orgId, operation: "contact", since }), dailyContactLimit(), null))
    : null;

  const state = await safe(async (): Promise<PlatformState> => {
    const searchesLeft = globalSearchLimit() - (await deps.countProviderCalls({ operation: "search", since: dayStart }));
    const spend = await deps.platformSpend(dayStart, poolTasks("outbound"));
    return platformState({ searchesLeft, perSearch, poolLimit: poolDailySpendMicroUsd("outbound"), poolSpent: spend.pool, overallLimit: globalDailySpendMicroUsd(), overallSpent: spend.all });
  });

  return {
    ok: true,
    usage: {
      asOf: now.toISOString(),
      searchReady: (await safe(deps.searchReady)) ?? false,
      charge: "included",
      workspace: { searches, webSearches, contactLookups },
      perSearch: { webSearches: perSearch },
      platform: { state: state ?? "unknown", resetsAt: new Date(dayStart.getTime() + DAY).toISOString() },
    },
  };
}

function defaultUsageDeps(): UsageDeps {
  let p: PipelineDeps | null = null;
  const pipe = () => (p ??= pipelineDeps());
  return {
    now: () => new Date(),
    tablesReady: prospectsTablesReady,
    searchReady: async () => (await pipe().searchProviders()).length > 0,
    contactReady: () => !!pipe().contact,
    recentRuns: (orgId, since, limit) => pipe().store.listRunsSince(orgId, since, limit),
    countProviderCalls: (o) => pipe().store.countProviderCalls(o),
    platformSpend: async (since, pool) => {
      const [r] = await db.select({
        all: sql<string>`coalesce(sum(${llmCalls.costMicroUsd}), 0)::bigint`,
        pool: sql<string>`coalesce(sum(${llmCalls.costMicroUsd}) FILTER (WHERE ${inArray(llmCalls.task, [...pool])}), 0)::bigint`,
      }).from(llmCalls).where(gte(llmCalls.createdAt, since));
      return { all: Number(r?.all ?? 0), pool: Number(r?.pool ?? 0) };
    },
  };
}
