/**
 * The AI Outbound prospect workspace: one row per prospect of the organization, with filters, sorting, paging and a
 * selection scope. Pure and shared: the server evaluates every query (rows never come from the client), the browser
 * uses the same parsing to keep the URL in sync.
 *
 * Every row field is derived from persisted data by server/outbound/workspace.ts (via the existing prospectCard and
 * readiness rules — nothing here decides qualification). A field the data model doesn't hold is not represented.
 *
 * The four states stay separate:
 *   icpFit       — does the company fit the target profile (the stored fit verdict)
 *   readiness    — is there credible, recent evidence (the existing readiness classification)
 *   contactLevel / emailStatus / phoneStatus — what contact information exists and where it came from
 *   (outreach eligibility isn't modelled for prospects: approval happens on a lead, after "Add to Leads")
 */
import { z } from "zod";

export const PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;
/**
 * The most prospects one organization's workspace evaluates per request: the newest ones, filtered and sorted on the
 * server (never in the browser). Above it the summary says so (`truncated`). A run finds at most 50, so this is many runs.
 */
export const MAX_WORKSPACE_PROSPECTS = 2000;
/** The most rows one export may contain: exports are built synchronously, so they stay bounded. */
export const MAX_EXPORT_ROWS = 2000;
/** From this many rows an export asks the person to confirm first (and the server refuses without that confirmation). */
export const LARGE_EXPORT_ROWS = 250;
/** The largest export file the server will send. */
export const MAX_EXPORT_BYTES = 15 * 1024 * 1024;

export const ICP_FIT = ["match", "partial", "not_qualified", "unknown"] as const;
export type IcpFit = (typeof ICP_FIT)[number];
export const ICP_FIT_LABEL: Record<IcpFit, string> = { match: "Match", partial: "Partial", not_qualified: "Not qualified", unknown: "Unknown" };

/** The existing readiness classification, presented without changing it (shared/prospect.ts readiness, server/outbound/service.ts prospectCard). */
export const READINESS = ["ready", "qualified", "needs_evidence", "stale", "not_a_fit", "rejected"] as const;
export type ReadinessState = (typeof READINESS)[number];
export const READINESS_LABEL: Record<ReadinessState, string> = {
  ready: "Ready", qualified: "Qualified", needs_evidence: "Needs evidence", stale: "Stale evidence", not_a_fit: "Not a fit", rejected: "Set aside",
};

export const CONTACT_LEVEL = ["decision_maker", "employee", "none"] as const;
export type ContactLevel = (typeof CONTACT_LEVEL)[number];
export const CONTACT_LABEL: Record<ContactLevel, string> = { decision_maker: "Decision maker named", employee: "Employee named", none: "No named person" };

/** verified / unverified: a PERSON's email and the provider's own status; company_email: only the company's published address. */
export const EMAIL_STATUS = ["verified", "unverified", "company_email", "none"] as const;
export type EmailStatus = (typeof EMAIL_STATUS)[number];
export const EMAIL_LABEL: Record<EmailStatus, string> = { verified: "Verified (provider)", unverified: "Not verified", company_email: "Company email only", none: "No email" };

/** No person phone numbers are collected; a company number is a confirmed fact from its own site. */
export const PHONE_STATUS = ["company_phone", "none"] as const;
export type PhoneStatus = (typeof PHONE_STATUS)[number];
export const PHONE_LABEL: Record<PhoneStatus, string> = { company_phone: "Company phone", none: "No phone" };

export const SIZE_BUCKETS = ["1-10", "11-50", "51-200", "201+", "unknown"] as const;
export type SizeBucket = (typeof SIZE_BUCKETS)[number];

export const SORT_FIELDS = ["evidence", "name", "domain", "country", "icpFit", "readiness", "evidenceCount", "score", "created", "updated"] as const;
export type SortField = (typeof SORT_FIELDS)[number];
export type SortDir = "asc" | "desc";

/** The most recently dated confirmed signal. Its date is the one the page stated, never the day it was read. */
export interface LatestEvidence {
  /** ISO timestamp of the stated date (for comparisons) and the date at the precision the page gave ("2026-09-14", "2026-09", "2026"). */
  at: string; date: string; precision: "day" | "month" | "year";
  title: string; claim: string; url: string | null; excerpt: string | null; sourceType: string; confidence: string; freshness: string | null; status: string;
}
/** A named person and where THEY came from (the company's site or a contact provider), kept apart from research evidence. */
export interface WorkspaceContact {
  findingId: number; name: string; title: string | null; senior: boolean;
  email: string | null; emailStatus: string | null; source: string; provider: string | null; sourceUrl: string | null; retrievedAt: string | null;
}
export interface WorkspaceRow {
  id: number; name: string; domain: string; website: string;
  country: string | null; location: string | null; industry: string | null; serves: string | null; companySize: string | null; sizeBucket: SizeBucket;
  contact: WorkspaceContact | null; contactLevel: ContactLevel;
  /** The email shown for this row: the contact's when they have one, otherwise the company's. Its source type and when DealInSec read it. */
  emailStatus: EmailStatus; emailSource: string | null; emailCheckedAt: string | null;
  companyEmail: string | null; companyPhone: string | null; phoneStatus: PhoneStatus;
  icpFit: IcpFit; icpMatch: string[]; icpUnmatched: string[];
  readiness: ReadinessState; readinessBlockers: string[];
  latestEvidence: LatestEvidence | null; evidenceCount: number; scoreTotal: number | null; scoreConfidence: string | null;
  status: string; leadId: number | null; latestRunId: string | null; sources: string[];
  createdAt: string; updatedAt: string;
}

// ── filters ──────────────────────────────────────────────────────────────

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "a date as YYYY-MM-DD");
const many = <T extends readonly [string, ...string[]]>(values: T) => z.array(z.enum(values)).max(values.length).optional();
export const filtersSchema = z.object({
  q: z.string().trim().max(100).optional(),
  country: z.array(z.string().regex(/^[A-Z]{2}$/)).max(50).optional(),
  location: z.string().trim().max(80).optional(),
  industry: z.string().trim().max(80).optional(),
  size: many(SIZE_BUCKETS),
  icpFit: many(ICP_FIT),
  readiness: many(READINESS),
  contact: many(CONTACT_LEVEL),
  email: many(EMAIL_STATUS),
  phone: many(PHONE_STATUS),
  source: z.array(z.string().regex(/^[a-z0-9_-]{1,24}$/)).max(10).optional(),
  evidenceFrom: isoDate.optional(), evidenceTo: isoDate.optional(),
  createdFrom: isoDate.optional(), createdTo: isoDate.optional(),
  inLeads: z.enum(["yes", "no"]).optional(),
}).strict();
export type WorkspaceFilters = z.infer<typeof filtersSchema>;

export interface WorkspaceQuery { filters: WorkspaceFilters; sort: SortField; dir: SortDir; page: number; pageSize: number }
export const DEFAULT_SORT: { sort: SortField; dir: SortDir } = { sort: "evidence", dir: "desc" };

const LIST_KEYS = ["country", "size", "icpFit", "readiness", "contact", "email", "phone", "source"] as const;
const TEXT_KEYS = ["q", "location", "industry", "evidenceFrom", "evidenceTo", "createdFrom", "createdTo", "inLeads"] as const;

/**
 * Reads a query from URL/search parameters. strict (the server): anything unknown or invalid is an error.
 * lenient (the browser reading its own URL): invalid parts are dropped.
 */
export function parseWorkspaceQuery(params: Record<string, unknown>, strict = true): { ok: true; query: WorkspaceQuery } | { ok: false; error: string } {
  const one = (v: unknown) => (Array.isArray(v) ? v[0] : v);
  const raw: Record<string, unknown> = {};
  const known = new Set<string>([...LIST_KEYS, ...TEXT_KEYS, "sort", "dir", "page", "pageSize"]);
  for (const k of Object.keys(params)) if (!known.has(k) && strict) return { ok: false, error: `Unknown parameter: ${k.slice(0, 30)}` };
  for (const k of LIST_KEYS) {
    const v = one(params[k]);
    if (typeof v === "string" && v.trim()) raw[k] = Array.from(new Set(v.split(",").map((x) => x.trim()).filter(Boolean)));
  }
  for (const k of TEXT_KEYS) { const v = one(params[k]); if (typeof v === "string" && v.trim()) raw[k] = v; }
  let filters: WorkspaceFilters;
  const f = filtersSchema.safeParse(raw);
  if (f.success) filters = f.data;
  else if (strict) return { ok: false, error: `Invalid filter: ${f.error.errors[0]?.path.join(".") || "value"}` };
  else {
    filters = {};
    for (const [k, v] of Object.entries(raw)) { const one_ = filtersSchema.safeParse({ [k]: v }); if (one_.success) Object.assign(filters, one_.data); }
  }
  const sortRaw = one(params.sort), dirRaw = one(params.dir), pageRaw = one(params.page), sizeRaw = one(params.pageSize);
  const bad = (what: string) => ({ ok: false as const, error: `Invalid ${what}` });
  let sort = DEFAULT_SORT.sort, dir = DEFAULT_SORT.dir, page = 1, pageSize = DEFAULT_PAGE_SIZE;
  if (sortRaw !== undefined) { if ((SORT_FIELDS as readonly string[]).includes(String(sortRaw))) sort = sortRaw as SortField; else if (strict) return bad("sort field"); }
  if (dirRaw !== undefined) { if (dirRaw === "asc" || dirRaw === "desc") dir = dirRaw; else if (strict) return bad("sort direction"); }
  if (pageRaw !== undefined) { const n = Number(pageRaw); if (Number.isInteger(n) && n >= 1 && n <= 100000) page = n; else if (strict) return bad("page"); }
  if (sizeRaw !== undefined) { const n = Number(sizeRaw); if ((PAGE_SIZES as readonly number[]).includes(n)) pageSize = n; else if (strict) return bad("page size"); }
  return { ok: true, query: { filters, sort, dir, page, pageSize } };
}

/** The query as URL/search parameters (defaults left out), the inverse of parseWorkspaceQuery. */
export function workspaceParams(q: Partial<WorkspaceQuery>): Record<string, string> {
  const out: Record<string, string> = {};
  const f = q.filters ?? {};
  for (const k of LIST_KEYS) { const v = f[k] as string[] | undefined; if (v?.length) out[k] = v.join(","); }
  for (const k of TEXT_KEYS) { const v = f[k] as string | undefined; if (v) out[k] = v; }
  if (q.sort && (q.sort !== DEFAULT_SORT.sort || (q.dir ?? DEFAULT_SORT.dir) !== DEFAULT_SORT.dir)) { out.sort = q.sort; out.dir = q.dir ?? "asc"; }
  if (q.page && q.page > 1) out.page = String(q.page);
  if (q.pageSize && q.pageSize !== DEFAULT_PAGE_SIZE) out.pageSize = String(q.pageSize);
  return out;
}

/** A stable identity for a set of filters (key order and value order don't matter). */
export function filtersKey(f: WorkspaceFilters): string {
  const norm: Record<string, unknown> = {};
  for (const k of Object.keys(f).sort()) {
    const v = (f as Record<string, unknown>)[k];
    if (v === undefined || v === "" || (Array.isArray(v) && !v.length)) continue;
    norm[k] = Array.isArray(v) ? [...v].sort() : v;
  }
  return JSON.stringify(norm);
}
export const hasActiveFilters = (f: WorkspaceFilters) => filtersKey(f) !== "{}";

const lc = (s: string | null | undefined) => (s ?? "").toLowerCase();
const day = (iso: string) => iso.slice(0, 10);

export function rowMatches(r: WorkspaceRow, f: WorkspaceFilters): boolean {
  if (f.q) { const t = f.q.toLowerCase(); if (!lc(r.name).includes(t) && !lc(r.domain).includes(t)) return false; }
  if (f.country?.length && !(r.country && f.country.includes(r.country))) return false;
  if (f.location && !lc(r.location).includes(f.location.toLowerCase())) return false;
  if (f.industry) { const t = f.industry.toLowerCase(); if (!lc(r.industry).includes(t) && !lc(r.serves).includes(t)) return false; }
  if (f.size?.length && !f.size.includes(r.sizeBucket)) return false;
  if (f.icpFit?.length && !f.icpFit.includes(r.icpFit)) return false;
  if (f.readiness?.length && !f.readiness.includes(r.readiness)) return false;
  if (f.contact?.length && !f.contact.includes(r.contactLevel)) return false;
  if (f.email?.length && !f.email.includes(r.emailStatus)) return false;
  if (f.phone?.length && !f.phone.includes(r.phoneStatus)) return false;
  if (f.source?.length && !r.sources.some((s) => f.source!.includes(s))) return false;
  if (f.evidenceFrom || f.evidenceTo) {
    if (!r.latestEvidence) return false; // a date range asks for dated evidence
    const d = day(r.latestEvidence.at);
    if (f.evidenceFrom && d < f.evidenceFrom) return false;
    if (f.evidenceTo && d > f.evidenceTo) return false;
  }
  if (f.createdFrom && day(r.createdAt) < f.createdFrom) return false;
  if (f.createdTo && day(r.createdAt) > f.createdTo) return false;
  if (f.inLeads && (f.inLeads === "yes") !== (r.leadId !== null)) return false;
  return true;
}

const FIT_RANK: Record<IcpFit, number> = { match: 3, partial: 2, unknown: 1, not_qualified: 0 };
const READY_RANK: Record<ReadinessState, number> = { ready: 5, qualified: 4, needs_evidence: 3, stale: 2, not_a_fit: 1, rejected: 0 };
/** The value a row sorts by; null = missing, which always sorts last (in either direction). */
function sortValue(r: WorkspaceRow, s: SortField): string | number | null {
  switch (s) {
    case "evidence": return r.latestEvidence ? Date.parse(r.latestEvidence.at) : null;
    case "name": return r.name || null;
    case "domain": return r.domain || null;
    case "country": return r.country;
    case "icpFit": return FIT_RANK[r.icpFit];
    case "readiness": return READY_RANK[r.readiness];
    case "evidenceCount": return r.evidenceCount;
    case "score": return r.scoreTotal;
    case "created": return Date.parse(r.createdAt);
    case "updated": return Date.parse(r.updatedAt);
  }
}
/** Names and domains in one fixed collation (accents and case ignored, numbers by value), so "Ünïcode" sorts with U. */
const COLLATE = new Intl.Collator("en", { sensitivity: "base", numeric: true });
const cmp = (x: string | number, y: string | number) => (typeof x === "string" && typeof y === "string" ? COLLATE.compare(x, y) : x < y ? -1 : x > y ? 1 : 0);
/** Deterministic: the chosen field (missing last), then company name A→Z, then id. */
export function compareRows(a: WorkspaceRow, b: WorkspaceRow, sort: SortField, dir: SortDir): number {
  const va = sortValue(a, sort), vb = sortValue(b, sort);
  if (va === null && vb !== null) return 1;
  if (vb === null && va !== null) return -1;
  const c = va !== null && vb !== null ? cmp(va, vb) : 0;
  if (c) return c * (dir === "asc" ? 1 : -1);
  const n = sort === "name" ? 0 : COLLATE.compare(a.name, b.name);
  return n || a.id - b.id;
}

export interface WorkspaceSummary {
  /** Every prospect of the organization that the workspace evaluates (the newest MAX_WORKSPACE_PROSPECTS). */
  all: number;
  /** In the current filters. */
  filtered: number; ready: number; needsReview: number; withDecisionMaker: number; verifiedEmail: number;
}
export interface WorkspaceFacets { countries: { value: string; count: number }[]; sources: { value: string; count: number }[] }

/** Filters, sorts and pages rows. `asOf` (optional) keeps only prospects that existed then (a frozen "all matching"). */
export function queryRows(rows: WorkspaceRow[], q: WorkspaceQuery, asOf?: string): { rows: WorkspaceRow[]; matched: WorkspaceRow[]; summary: WorkspaceSummary; facets: WorkspaceFacets; page: number; pageCount: number } {
  const cutoff = asOf ? Date.parse(asOf) : null;
  const matched = rows.filter((r) => (cutoff === null || Date.parse(r.createdAt) <= cutoff) && rowMatches(r, q.filters)).sort((a, b) => compareRows(a, b, q.sort, q.dir));
  const pageCount = Math.max(1, Math.ceil(matched.length / q.pageSize));
  const page = Math.min(q.page, pageCount);
  const count = (xs: string[]) => Array.from(xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>())).map(([value, n]) => ({ value, count: n })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  return {
    rows: matched.slice((page - 1) * q.pageSize, page * q.pageSize), matched, page, pageCount,
    summary: {
      all: rows.length, filtered: matched.length,
      ready: matched.filter((r) => r.readiness === "ready").length,
      needsReview: matched.filter((r) => r.readiness === "qualified" || r.readiness === "needs_evidence" || r.readiness === "stale").length,
      withDecisionMaker: matched.filter((r) => r.contactLevel === "decision_maker").length,
      verifiedEmail: matched.filter((r) => r.emailStatus === "verified").length,
    },
    facets: { countries: count(rows.map((r) => r.country).filter((c): c is string => !!c)), sources: count(rows.flatMap((r) => r.sources)) },
  };
}

// ── selection ────────────────────────────────────────────────────────────

/**
 * What a bulk action applies to. "ids": records the person ticked (kept across pages). "filter": every record that
 * matched these filters when it was chosen, frozen at `asOf` so prospects discovered later never join silently.
 */
export type Selection =
  | { mode: "none" }
  | { mode: "ids"; ids: number[] }
  | { mode: "filter"; filters: WorkspaceFilters; key: string; asOf: string; count: number };
export const NO_SELECTION: Selection = { mode: "none" };

export function toggleId(s: Selection, id: number): Selection {
  const ids = s.mode === "ids" ? s.ids : [];
  const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
  return next.length ? { mode: "ids", ids: next } : NO_SELECTION;
}
/** Tick or untick every row on the page (adds to / removes from what is already ticked on other pages). */
export function togglePage(s: Selection, pageIds: number[]): Selection {
  const ids = s.mode === "ids" ? s.ids : [];
  const all = pageIds.length > 0 && pageIds.every((id) => ids.includes(id));
  const next = all ? ids.filter((id) => !pageIds.includes(id)) : Array.from(new Set([...ids, ...pageIds]));
  return next.length ? { mode: "ids", ids: next } : NO_SELECTION;
}
export const selectAllMatching = (filters: WorkspaceFilters, asOf: string, count: number): Selection => ({ mode: "filter", filters, key: filtersKey(filters), asOf, count });
/** A change of filters or search ends any selection: a bulk action must never reach records the person can't see. */
export function afterFiltersChange(s: Selection, prev: WorkspaceFilters, next: WorkspaceFilters): Selection {
  return filtersKey(prev) === filtersKey(next) ? s : NO_SELECTION;
}
export const selectionCount = (s: Selection) => (s.mode === "ids" ? s.ids.length : s.mode === "filter" ? s.count : 0);
export const isSelected = (s: Selection, id: number) => (s.mode === "ids" ? s.ids.includes(id) : s.mode === "filter");

// ── export request (validated on the server) ─────────────────────────────

export const EXPORT_PRESETS = ["full", "companies"] as const;
export type ExportPreset = (typeof EXPORT_PRESETS)[number];
export const exportRequestSchema = z.object({
  format: z.enum(["csv", "xlsx"]),
  preset: z.enum(EXPORT_PRESETS).default("full"),
  /** Required (true) from LARGE_EXPORT_ROWS rows: the person saw the count and confirmed. */
  confirmed: z.boolean().optional(),
  scope: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("ids"), ids: z.array(z.number().int().positive()).min(1).max(MAX_EXPORT_ROWS) }).strict(),
    // expectedCount: what the person was shown and confirmed. If the matching set differs now, the export is refused.
    z.object({ mode: z.literal("filter"), filters: filtersSchema, asOf: z.string().datetime(), expectedCount: z.number().int().min(1).max(MAX_EXPORT_ROWS) }).strict(),
  ]),
  sort: z.enum(SORT_FIELDS).optional(),
  dir: z.enum(["asc", "desc"]).optional(),
}).strict();
export type ExportRequest = z.infer<typeof exportRequestSchema>;

/** The export scope for a selection (null: nothing selected). The filter scope carries the count the person confirmed. */
export function exportScopeOf(s: Selection): ExportRequest["scope"] | null {
  if (s.mode === "ids") return { mode: "ids", ids: [...s.ids].sort((a, b) => a - b) };
  if (s.mode === "filter") return { mode: "filter", filters: s.filters, asOf: s.asOf, expectedCount: s.count };
  return null;
}
/** Whether an export of this many rows can be requested at all, and whether it is large enough to say so in the confirmation. */
export const exportLimits = (count: number) => ({ allowed: count > 0 && count <= MAX_EXPORT_ROWS, large: count >= LARGE_EXPORT_ROWS });
