/**
 * Client side of the lead pipeline: the wire types, how a stage looks, and the
 * one place that talks to /api/leads. The rules (which stage can follow which)
 * come from the server in each lead's `moves`; shared/leads.ts only supplies
 * the labels, so the browser never decides what is allowed.
 */
import { LEAD_STATUSES, leadStatusLabels, type LeadStatus } from "@shared/leads";
import type { Lead, LeadClaim, LeadEvent, LeadTicket } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { parseApiError } from "@/lib/api-error";

export { LEAD_STATUSES, leadStatusLabels };
export type { LeadStatus };

type Wire<T> = { [K in keyof T]: T[K] extends Date ? string : T[K] extends Date | null ? string | null : T[K] };
export type LeadView = Wire<Lead>;
export type LeadRowView = LeadView & { nextTicket: { id: number; title: string; dueAt: string | null } | null };
export type LeadEventView = Wire<LeadEvent>;
export type LeadTicketView = Wire<LeadTicket>;
export type LeadClaimView = Wire<LeadClaim>;

export interface LeadList { rows: LeadRowView[]; total: number; counts: Record<string, number> }
export interface LeadDetailView {
  lead: LeadView; events: LeadEventView[]; tickets: LeadTicketView[]; claims: LeadClaimView[];
  moves: LeadStatus[]; canConvert: boolean;
}

/** Colours per stage: quiet while early, warmer as the deal gets close, green for won, grey for lost. */
export const STAGE_STYLE: Record<LeadStatus, string> = {
  new: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  researching: "bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300",
  qualified: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300",
  contacted: "bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-300",
  replied: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  meeting: "bg-orange-100 text-orange-800 dark:bg-orange-950/60 dark:text-orange-300",
  proposal: "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-950/60 dark:text-fuchsia-300",
  won: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  lost: "bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
};

export const stageLabel = (s: string) => leadStatusLabels[s as LeadStatus] ?? s;

export const listUrl = (o: { status?: string; q?: string; archived?: boolean }) => {
  const p = new URLSearchParams({ limit: "100" });
  if (o.status) p.set("status", o.status);
  if (o.q?.trim()) p.set("q", o.q.trim());
  if (o.archived) p.set("archived", "1");
  return `/api/leads?${p}`;
};
export const detailUrl = (id: number | string) => `/api/leads/${id}`;

/** Refresh every lead list and detail after a change. */
export const refreshLeads = () =>
  queryClient.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith("/api/leads") });

/** A person-readable reason from a failed request. */
export const leadError = (err: unknown, fallback = "Something went wrong. Nothing was changed.") => parseApiError(err).error ?? fallback;

export async function leadCall<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await apiRequest(method, url, body ?? (method === "GET" ? undefined : {}));
  return (await res.json()) as T;
}

export const dateLabel = (d: string | null | undefined, locale = "en-IN") =>
  d ? new Date(d).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" }) : "—";

/** A due date is overdue when its day has passed (a ticket due today is not late yet). */
export const isOverdue = (due: string | null | undefined) => {
  if (!due) return false;
  const d = new Date(due);
  d.setHours(23, 59, 59, 999);
  return d.getTime() < Date.now();
};

export interface FollowUpView { id: number; title: string; kind: string; due: string; leadId: number; companyName: string; leadStatus: string }
export interface FollowUps { today: string; overdue: FollowUpView[]; dueToday: FollowUpView[]; upcoming: FollowUpView[] }
export const FOLLOWUPS_URL = "/api/leads/follow-ups";

export interface IdealClientView { about: string | null; services: string[]; targetIndustries: string[]; targetLocations: string[]; exclusions: string[]; minDealMinor: number | null; currency: string | null }
export interface IdealClientResponse { profile: IdealClientView; isSet: boolean }
export const IDEAL_CLIENT_URL = "/api/ideal-client";
export const fitUrl = (id: number | string) => `/api/leads/${id}/fit`;
export const hasCriteria = (p: IdealClientView | undefined) => !!p && (p.targetIndustries.length > 0 || p.targetLocations.length > 0 || p.exclusions.length > 0 || p.minDealMinor !== null);
/** Anything under /api/ideal-client or a lead's fit changes when the profile does. */
export const refreshProfile = () =>
  queryClient.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && ((q.queryKey[0] as string).startsWith(IDEAL_CLIENT_URL) || (q.queryKey[0] as string).endsWith("/fit")) });
export const profileNotSetUp = (err: unknown) => !!err && String((err as Error).message).includes("PROFILE_NOT_SETUP");
