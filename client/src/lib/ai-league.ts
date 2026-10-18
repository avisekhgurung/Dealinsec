/** Client side of AI League (server/ai-league/routes.ts). Types mirror the server's views. */
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { AgentEndpoints } from "@/hooks/use-agent";
import { isTerminal, type Bot, type BotStatus, type LeagueReport, type LeagueRunStatus, type LeagueTask } from "@shared/ai-league";

export const LEAGUE = "/api/ai-league";
export const ROSTER_URL = `${LEAGUE}/roster`;
export const RUNS_URL = `${LEAGUE}/runs`;
export const APPROVALS_URL = `${LEAGUE}/approvals`;
export const SCHEDULES_URL = `${LEAGUE}/schedules`;
export const USAGE_URL = `${LEAGUE}/usage`;
export const MEMORY_URL = `${LEAGUE}/memory`;
export const STATUS_URL = `${LEAGUE}/status`;
export const runUrl = (id: string) => `${RUNS_URL}/${encodeURIComponent(id)}`;

export interface RunView {
  id: string; bot: Bot; task: LeagueTask; taskLabel: string; status: LeagueRunStatus; statusLabel: string; stage: string;
  request: string | null; source: string; report: LeagueReport | null; errorCode: string | null; unread: boolean; cancelRequested: boolean;
  scheduleId: number | null; createdAt: string; startedAt: string | null; finishedAt: string | null; tokens: number;
}
export interface EventView { id: number; kind: string; message: string; href: string | null; at: string }
export interface BotCard { bot: Bot; status: BotStatus; activeRun: RunView | null; lastRun: RunView | null; unread: number; nextSchedule: string | null; waiting: number }
export interface ApprovalItem {
  kind: "chat" | "draft"; id: string; bot: Bot; title: string; lines: { label: string; value: string }[]; createdAt: string;
  expiresAt: string | null; href: string | null; bodyHash?: string; body?: string; subject?: string; to?: string | null;
}
export interface ScheduleView { id: number; bot: Bot; task: LeagueTask; taskLabel: string; input: Record<string, unknown>; frequency: string; timeOfDay: string; weekday: number | null; timezone: string; status: string; nextRunAt: string | null; lastRunId: string | null; lastRunAt: string | null }
export interface LeagueUsage { tier: string; windowDays: number; runs: { used: number; limit: number }; concurrent: number; schedules: { used: number; limit: number }; byBot: Record<string, number>; tokens: number; failed: number }
export interface MemoryRow { id: number; bot: string; key: string; label: string; value: string; source: string; updatedAt: string | null }

const isActive = (r: RunView | null | undefined) => !!r && !isTerminal(r.status);

export const useLeagueStatus = () => useQuery<{ ready: boolean; providerConfigured: boolean }>({ queryKey: [STATUS_URL], retry: false, staleTime: 60_000 });
export const useRoster = () => useQuery<{ bots: BotCard[]; ready: boolean }>({
  queryKey: [ROSTER_URL], retry: false,
  refetchInterval: (q) => (q.state.data?.bots.some((b) => b.activeRun) ? 5000 : 30_000),
});
export const useRuns = (filter: { bot?: Bot; status?: string; task?: string; days?: number } = {}) => {
  const qs = new URLSearchParams(Object.entries(filter).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)])).toString();
  const key = qs ? `${RUNS_URL}?${qs}` : RUNS_URL;
  return useQuery<{ runs: RunView[] }>({ queryKey: [key], retry: false, refetchInterval: (q) => (q.state.data?.runs.some(isActive) ? 4000 : false) });
};
export const useRun = (id: string | null) => useQuery<{ run: RunView; events: EventView[] }>({
  queryKey: [id ? runUrl(id) : "league-no-run"], enabled: !!id, retry: false,
  refetchInterval: (q) => (q.state.data && isActive(q.state.data.run) ? 2500 : false),
});
export const useApprovals = () => useQuery<{ items: ApprovalItem[] }>({ queryKey: [APPROVALS_URL], retry: false, refetchInterval: 20_000 });
export const useSchedules = () => useQuery<{ schedules: ScheduleView[] }>({ queryKey: [SCHEDULES_URL], retry: false });
export const useLeagueUsage = () => useQuery<{ usage: LeagueUsage }>({ queryKey: [USAGE_URL], retry: false });
export const useMemory = () => useQuery<{ memory: MemoryRow[]; keys: Record<string, { label: string; bots: string[] }> }>({ queryKey: [MEMORY_URL], retry: false });

/** Everything AI League shows, refreshed after a change. */
export const refreshLeague = () => queryClient.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith(LEAGUE) });

export async function leagueCall<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await apiRequest(method, url, body ?? (method === "GET" || method === "DELETE" ? undefined : {}));
  return (await res.json()) as T;
}

/** A fresh key per click, so a double click (or a retried request) starts the task once. */
export const clientKey = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, "");

export const startTask = (task: LeagueTask, input: Record<string, unknown>) => leagueCall<{ run: RunView; existing: boolean }>("POST", RUNS_URL, { task, input, clientKey: clientKey() });

/** A coworker's conversation, through the agent's own chat hook. */
export const leagueEndpoints = (bot: Bot): AgentEndpoints => ({
  transcript: () => `${LEAGUE}/bots/${bot}/conversation`,
  messages: () => `${LEAGUE}/bots/${bot}/messages`,
  approve: (id) => `${LEAGUE}/approvals/${encodeURIComponent(id)}/approve`,
  reject: (id) => `${LEAGUE}/approvals/${encodeURIComponent(id)}/reject`,
});

export const when = (iso: string | null | undefined) => {
  if (!iso) return "";
  try {
    const d = new Date(iso), today = new Date();
    const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    if (d.toDateString() === today.toDateString()) return `today ${time}`;
    return `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${time}`;
  } catch { return ""; }
};
