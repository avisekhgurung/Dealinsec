/**
 * The prospect workspace: every prospect of the organization as one table row, filtered, sorted and paged on the
 * server, and exported to CSV or XLSX.
 *
 * Rows are built from persisted data only, through the existing prospectCard (and so the existing readiness rule):
 * nothing here scores, qualifies or re-dates anything. The organization always comes from the session; prospect ids
 * a request names are checked against it; filters and sort fields are allowlisted (shared/prospect-workspace.ts).
 */
import { parseHeadcount } from "@shared/icp";
import { MISSING_REASON, REJECT_LABEL, signalDating, type RejectReason } from "@shared/prospect";
import {
  LARGE_EXPORT_ROWS, MAX_EXPORT_BYTES, MAX_EXPORT_ROWS, MAX_WORKSPACE_PROSPECTS, compareRows, exportRequestSchema, parseWorkspaceQuery, queryRows,
  type ContactLevel, type EmailStatus, type IcpFit, type LatestEvidence, type ReadinessState, type SizeBucket, type WorkspaceContact, type WorkspaceFacets,
  type WorkspaceRow, type WorkspaceSummary,
} from "@shared/prospect-workspace";
import type { ProspectFindingRow, ProspectRow } from "@shared/schema";
import { logOrgActivity } from "../entitlements";
import { fail, readGate, writeGate, type Result, type Who } from "../services/leads";
import { columnsFor, toCsv, toXlsx } from "./export-format";
import { pipelineDeps, type PipelineDeps } from "./pipeline";
import { evidenceOf, prospectCard } from "./service";
import { prospectsTablesReady } from "./store";

const NOT_SETUP = () => fail(503, "PROSPECTS_NOT_SETUP", "AI Outbound isn't set up on this server yet.");
async function ready(): Promise<boolean> { try { return await prospectsTablesReady(); } catch { return false; } }
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

/** The size band of a stated headcount, by its upper bound ("5–30" → 11-50); an open-ended one ("over 40") by its lower bound. */
export function sizeBucket(text: string | null): SizeBucket {
  const h = parseHeadcount(text);
  if (!h) return "unknown";
  const n = h.max >= Number.MAX_SAFE_INTEGER ? h.min : h.max;
  return n <= 10 ? "1-10" : n <= 50 ? "11-50" : n <= 200 ? "51-200" : "201+";
}

const FIT: Record<string, IcpFit> = { strong: "match", partial: "partial", weak: "not_qualified", excluded: "not_qualified" };

export function workspaceRow(p: ProspectRow & { latestRunId: string | null }, fs: ProspectFindingRow[], now: Date): WorkspaceRow {
  const card = prospectCard(p, fs, now);
  const rejected = p.status === "rejected";

  // Research readiness: the existing classification, presented. "Stale" only when the one thing it lacks is a dated reason and its signals are all old.
  const readiness: ReadinessState = rejected ? (card.classification === "not_a_fit" ? "not_a_fit" : "rejected")
    : card.classification === "ready" ? "ready" : card.classification === "not_a_fit" ? "not_a_fit"
      : card.timing === "stale" && card.blockers.includes(MISSING_REASON) ? "stale"
        : card.classification === "qualified" ? "qualified" : "needs_evidence";
  const blockers = [...(rejected && p.rejectReason ? [`Set aside: ${REJECT_LABEL[p.rejectReason as RejectReason] ?? p.rejectReason}`] : []), ...(card.classification === "ready" ? [] : card.blockers)];

  // ICP fit: the stored fit verdict and its own reasons.
  const signals = card.fit?.signals ?? [];
  const icpFit: IcpFit = FIT[card.fit?.verdict ?? ""] ?? "unknown";
  const icpMatch = signals.filter((s) => s.status === "match").map((s) => s.detail);
  const icpUnmatched = signals.filter((s) => s.status !== "match").map((s) => s.detail);
  if (card.fit && icpFit === "not_qualified" && !icpUnmatched.length && card.fit.headline) icpUnmatched.push(card.fit.headline);

  // The person: the card's (senior decision-makers first, then another named employee), with where they came from.
  const person = card.decisionMaker ?? card.contactPerson;
  const m = (person?.meta ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const contact: WorkspaceContact | null = person ? {
    findingId: person.id, name: str(m.name) ?? person.value, title: str(m.title), senior: !!person.senior,
    email: str(m.email), emailStatus: str(m.email) ? str(m.emailStatus) : null, source: person.source, provider: str(m.provider), sourceUrl: person.url, retrievedAt: person.retrievedAt,
  } : null;
  const contactLevel: ContactLevel = card.decisionMaker ? "decision_maker" : card.contactPerson ? "employee" : "none";

  // Company contact details: confirmed facts from the company's own pages.
  const fact = (type: string) => fs.filter((f) => f.kind === "fact" && f.type === type && f.status === "confirmed").sort((a, b) => b.id - a.id)[0] ?? null;
  const email = fact("business_email"), phone = fact("business_phone");
  const emailStatus: EmailStatus = contact?.email ? (contact.emailStatus === "verified" ? "verified" : "unverified") : email ? "company_email" : "none";

  // Latest evidence: the confirmed signal with the most recent STATED date (a year-only date counts as that year).
  const dated = fs.filter((f) => f.kind === "signal" && f.status === "confirmed" && f.observedAt)
    .sort((a, b) => new Date(b.observedAt!).getTime() - new Date(a.observedAt!).getTime() || b.id - a.id)[0];
  let latestEvidence: LatestEvidence | null = null;
  if (dated) {
    const at = new Date(dated.observedAt!).toISOString();
    const precision = signalDating({ observedAt: dated.observedAt, meta: dated.meta as Record<string, unknown> }, now).precision ?? "day";
    const e = evidenceOf(dated, now);
    latestEvidence = {
      at, precision, date: precision === "year" ? at.slice(0, 4) : precision === "month" ? at.slice(0, 7) : at.slice(0, 10),
      title: e.label, claim: e.value, url: e.url, excerpt: e.quote, sourceType: e.source, confidence: e.confidence, freshness: e.freshness ?? null, status: e.status,
    };
  }

  const country = card.profile.country && /^[A-Z]{2}$/.test(card.profile.country) ? card.profile.country : null;
  const sources = Array.from(new Set(((p.sources as { provider?: unknown }[]) ?? []).map((s) => String(s?.provider ?? "").toLowerCase()).filter((s) => /^[a-z0-9_-]{1,24}$/.test(s)))).sort();
  return {
    id: p.id, name: p.name, domain: p.domain, website: p.website,
    country, location: card.profile.location, industry: card.profile.industry, serves: card.profile.serves, companySize: card.profile.employees, sizeBucket: sizeBucket(card.profile.employees),
    contact, contactLevel,
    emailStatus, emailSource: contact?.email ? contact.source : email ? email.sourceType : null, emailCheckedAt: contact?.email ? contact.retrievedAt : email ? iso(email.retrievedAt) : null,
    companyEmail: email?.value ?? null, companyPhone: phone?.value ?? null, phoneStatus: phone ? "company_phone" : "none",
    icpFit, icpMatch, icpUnmatched, readiness, readinessBlockers: blockers,
    latestEvidence, evidenceCount: card.evidenceCount, scoreTotal: card.score?.total ?? null, scoreConfidence: card.score?.confidence ?? null,
    status: p.status, leadId: p.leadId, latestRunId: p.latestRunId, sources,
    createdAt: iso(p.createdAt)!, updatedAt: iso(p.updatedAt)!,
  };
}

/** The organization's rows (the newest MAX_WORKSPACE_PROSPECTS), with whether there were more. */
async function loadRows(orgId: string, deps: PipelineDeps): Promise<{ rows: WorkspaceRow[]; truncated: boolean }> {
  const ps = await deps.store.listProspects(orgId, MAX_WORKSPACE_PROSPECTS + 1);
  const truncated = ps.length > MAX_WORKSPACE_PROSPECTS;
  const kept = ps.slice(0, MAX_WORKSPACE_PROSPECTS);
  const fs = await deps.store.findingsFor(orgId, kept.map((p) => p.id));
  const by = new Map<number, ProspectFindingRow[]>();
  for (const f of fs) { const a = by.get(f.prospectId) ?? []; a.push(f); by.set(f.prospectId, a); }
  const now = deps.now();
  return { rows: kept.map((p) => workspaceRow(p, by.get(p.id) ?? [], now)), truncated };
}

export interface WorkspacePage {
  rows: WorkspaceRow[]; page: number; pageCount: number; pageSize: number; sort: string; dir: string;
  summary: WorkspaceSummary; facets: WorkspaceFacets;
  /** When this answer was computed: "select all matching" freezes the selection here. */
  asOf: string;
  /** More prospects exist than the workspace evaluates (the oldest are left out). */
  truncated: boolean;
}

export async function listWorkspace(user: Who, params: Record<string, unknown>, d: Partial<PipelineDeps> = {}): Promise<Result<WorkspacePage>> {
  const deps = { ...pipelineDeps(), ...d };
  const gate = readGate(user);
  if (gate) return gate;
  const parsed = parseWorkspaceQuery(params, true);
  if (!parsed.ok) return fail(400, "invalid_query", parsed.error);
  if (!(await ready())) return NOT_SETUP();
  const q = parsed.query;
  const { rows, truncated } = await loadRows(user.organizationId!, deps);
  const r = queryRows(rows, q);
  return { ok: true, rows: r.rows, page: r.page, pageCount: r.pageCount, pageSize: q.pageSize, sort: q.sort, dir: q.dir, summary: r.summary, facets: r.facets, asOf: deps.now().toISOString(), truncated };
}

/** One export at a time per person (per server process): a second request while one is being built is refused, not queued. */
const exporting = new Set<string>();

export interface ExportFile { body: Buffer; filename: string; contentType: string; count: number }

export async function exportProspects(user: Who, raw: unknown, d: Partial<PipelineDeps> = {}): Promise<Result<ExportFile>> {
  const deps = { ...pipelineDeps(), ...d };
  // Exporting takes the right to work with leads (deals.create), not only to read them: a file leaves the workspace's controls.
  const gate = writeGate(user);
  if (gate) return gate;
  const parsed = exportRequestSchema.safeParse(raw);
  if (!parsed.success) return fail(400, "invalid_export", "That export request isn't valid.");
  if (!(await ready())) return NOT_SETUP();
  const req = parsed.data;
  if (exporting.has(user.id)) return fail(429, "export_in_progress", "An export is already being prepared. Try again when it finishes.");
  exporting.add(user.id);
  try {
    const now = deps.now();
    const { rows } = await loadRows(user.organizationId!, deps);
    const sort = req.sort ?? "evidence", dir = req.dir ?? (req.sort ? "asc" : "desc");
    let chosen: WorkspaceRow[];
    if (req.scope.mode === "ids") {
      const ids = new Set(req.scope.ids);
      chosen = rows.filter((r) => ids.has(r.id));
      // Every id must be one of this organization's prospects; which ones aren't is not said.
      if (chosen.length !== ids.size) return fail(404, "not_found", "Some of the selected prospects aren't in your workspace. Refresh and select again.");
      chosen.sort((a, b) => compareRows(a, b, sort, dir));
    } else {
      const asOf = Date.parse(req.scope.asOf);
      if (asOf > now.getTime() + 60_000) return fail(400, "invalid_export", "That export request isn't valid.");
      chosen = queryRows(rows, { filters: req.scope.filters, sort, dir, page: 1, pageSize: Math.max(1, rows.length) }, req.scope.asOf).matched;
      // The person confirmed a number; if the matching set changed since (research, edits), they review it again.
      if (chosen.length !== req.scope.expectedCount) return fail(409, "selection_changed", `The matching prospects changed since you selected them (now ${chosen.length}). Review the list and export again.`, { count: chosen.length });
    }
    if (!chosen.length) return fail(400, "nothing_to_export", "There's nothing to export.");
    if (chosen.length > MAX_EXPORT_ROWS) return fail(413, "export_too_large", `Exports are limited to ${MAX_EXPORT_ROWS} prospects. Narrow the filters and try again.`);
    if (chosen.length >= LARGE_EXPORT_ROWS && !req.confirmed) return fail(409, "confirm_required", `This export has ${chosen.length} prospects. Confirm to continue.`, { count: chosen.length });
    const exportedAt = now.toISOString();
    const cols = columnsFor(req.preset);
    const body = req.format === "csv" ? toCsv(chosen, cols, exportedAt) : toXlsx(chosen, cols, exportedAt);
    if (body.length > MAX_EXPORT_BYTES) return fail(413, "export_too_large", "That export is too large to build. Narrow the filters and try again.");
    // The audit line says who exported how many, never what.
    logOrgActivity(user as any, "exported", "prospects", null, `${chosen.length} prospect${chosen.length === 1 ? "" : "s"} · ${req.format.toUpperCase()} · ${req.scope.mode === "ids" ? "selected" : "all matching filters"}`);
    const stamp = exportedAt.slice(0, 10);
    return {
      ok: true, body, count: chosen.length, filename: `prospects-${stamp}.${req.format}`,
      contentType: req.format === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
  } finally {
    exporting.delete(user.id);
  }
}
