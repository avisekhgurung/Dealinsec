/**
 * How the lead pipeline is presented: where a lead came from, how the pipeline
 * splits by stage, what a row says next, where a lead sits in its lifecycle,
 * where a recorded fact came from, and whether a refused add was a duplicate.
 *
 * Pure and presentational: no database, no DOM, no new rules. Every value here
 * is read from what the API already returns (a lead's `source`, the server's
 * per-stage `counts`, the row's `nextTicket`, a claim's evidence, a 409's
 * `existingId`); which moves are allowed still comes only from the server.
 */
import { OPEN_STATUSES, leadStatusLabels, isLeadStatus, type LeadStatus } from "./leads";

/* ── where a lead came from ───────────────────────────────────────────── */

export type LeadSourceKey = "outbound" | "import" | "manual" | "agent" | "other";

export interface LeadSourceView {
  key: LeadSourceKey;
  /** The chip: short, always words. */
  label: string;
  /** The sentence the detail header finishes with " on <date>". */
  origin: string;
}

/**
 * The lead's real `source` column (manual / import / outbound / agent), in words.
 * `mine` says whether the person looking added it (the lead's owner is its creator);
 * left out, a hand-added lead is not claimed for anyone in particular.
 */
export function leadSource(source: string | null | undefined, opts: { mine?: boolean } = {}): LeadSourceView {
  switch (source) {
    case "outbound": return { key: "outbound", label: "AI Outbound", origin: "Found by AI Outbound, added" };
    case "import": return { key: "import", label: "Imported", origin: "Imported" };
    case "agent": return { key: "agent", label: "Added by the agent", origin: "Added by the agent" };
    case "manual": {
      const label = opts.mine === true ? "Added by you" : opts.mine === false ? "Added by a teammate" : "Added by hand";
      return { key: "manual", label, origin: label };
    }
    default: return { key: "other", label: "Added", origin: "Added" };
  }
}

/* ── the pipeline by stage ────────────────────────────────────────────── */

/** The order the summary shows: the open funnel, then the two ends. */
export const SUMMARY_ORDER: readonly LeadStatus[] = [...OPEN_STATUSES, "won", "lost"];

export interface StageSegment {
  status: LeadStatus;
  label: string;
  count: number;
  open: boolean;
  /** This stage's part of the whole pipeline, 0..1 (0 when the pipeline is empty). */
  share: number;
}

export interface PipelineSummary {
  segments: StageSegment[];
  total: number;
  open: number;
  won: number;
  lost: number;
}

const safeCount = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/**
 * One segment per stage from the server's per-stage counts (the whole pipeline,
 * archived leads left out). Unknown keys are ignored; a missing stage counts 0.
 */
export function pipelineSummary(counts: Record<string, number> | null | undefined): PipelineSummary {
  const c = counts ?? {};
  const raw = SUMMARY_ORDER.map((s) => ({ status: s, count: safeCount(c[s]) }));
  const total = raw.reduce((n, r) => n + r.count, 0);
  const open = raw.filter((r) => (OPEN_STATUSES as readonly string[]).includes(r.status)).reduce((n, r) => n + r.count, 0);
  return {
    segments: raw.map((r) => ({
      status: r.status, label: leadStatusLabels[r.status], count: r.count,
      open: (OPEN_STATUSES as readonly string[]).includes(r.status),
      share: total > 0 ? r.count / total : 0,
    })),
    total, open,
    won: raw.find((r) => r.status === "won")!.count,
    lost: raw.find((r) => r.status === "lost")!.count,
  };
}

/**
 * Whether the list shows every matching lead. The API returns at most a page
 * of rows with the full `total`; when it holds back some, say so plainly.
 */
export function listCoverage(shown: number, total: number): { capped: boolean; note: string | null } {
  const s = safeCount(shown), t = safeCount(total);
  if (t <= s) return { capped: false, note: null };
  return { capped: true, note: `Showing the ${s} most recently active of ${t}. Search or pick a stage to find the rest.` };
}

/* ── what a row says next ─────────────────────────────────────────────── */

export interface RowLike {
  status: string;
  updatedAt: string | null;
  nextTicket: { title: string; dueAt: string | null } | null;
}

export type RowNext =
  | { kind: "closed"; label: "Won" | "Closed" }
  | { kind: "step"; title: string; due: string | null; overdue: boolean }
  | { kind: "idle"; lastActivity: string | null };

/** A due date is overdue once its whole day has passed (the same rule as the rest of the leads screens). */
export function isPastDue(due: string | null | undefined, now: Date = new Date()): boolean {
  if (!due) return false;
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return false;
  d.setHours(23, 59, 59, 999);
  return d.getTime() < now.getTime();
}

/**
 * The row's "next": the open next step the API attached (with its due date),
 * or, with none, when the lead last changed. A won or lost lead has no next.
 */
export function rowNext(row: RowLike, now: Date = new Date()): RowNext {
  if (row.status === "won") return { kind: "closed", label: "Won" };
  if (row.status === "lost") return { kind: "closed", label: "Closed" };
  const t = row.nextTicket;
  if (t) return { kind: "step", title: t.title, due: t.dueAt, overdue: isPastDue(t.dueAt, now) };
  return { kind: "idle", lastActivity: row.updatedAt };
}

/* ── where a lead sits in its lifecycle ───────────────────────────────── */

export type StepState = "done" | "current" | "upcoming" | "not_reached";

export interface ProgressStep { status: LeadStatus; label: string; state: StepState }

export interface StageProgress {
  steps: ProgressStep[];
  /** 1-based position of the current step. */
  position: number;
  closed: "won" | "lost" | null;
}

/**
 * The lifecycle as steps: the open funnel, then how it ended (Won, or Lost in
 * its place). A lost lead marks the stages it reached as done when `lostFrom`
 * is known; the rest were not reached. Purely a picture of the current stage:
 * moving a lead still goes through the server's allowed moves.
 */
export function stageProgress(status: string, lostFrom?: string | null): StageProgress {
  const s: LeadStatus = isLeadStatus(status) ? status : "new";
  const end: LeadStatus = s === "lost" ? "lost" : "won";
  const order: LeadStatus[] = [...OPEN_STATUSES, end];
  let reached: number;
  if (s === "lost") {
    const from = lostFrom && isLeadStatus(lostFrom) ? (OPEN_STATUSES as readonly string[]).indexOf(lostFrom) : -1;
    reached = from; // stages up to and including the one it was lost from
  } else {
    reached = order.indexOf(s) - 1;
  }
  const current = order.indexOf(s);
  const steps = order.map((st, i): ProgressStep => ({
    status: st, label: leadStatusLabels[st],
    state: i === current ? "current" : i <= reached ? "done" : s === "lost" ? "not_reached" : "upcoming",
  }));
  return { steps, position: current + 1, closed: s === "won" || s === "lost" ? s : null };
}

/** The stage a lead was in when it was marked lost, from its timeline's latest move to "lost". */
export function lostFromEvents(events: readonly { id?: number; kind: string; data?: unknown }[]): LeadStatus | null {
  let bestId = -Infinity;
  let from: LeadStatus | null = null;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.kind !== "status_changed") continue;
    const d = (e.data ?? {}) as { from?: unknown; to?: unknown };
    if (d.to !== "lost" || !isLeadStatus(d.from)) continue;
    // Newest wins: by id when there is one, otherwise the first listed (the API lists newest first).
    const id = typeof e.id === "number" ? e.id : -i;
    if (id > bestId) { bestId = id; from = d.from; }
  }
  return from;
}

/* ── where a recorded fact came from ──────────────────────────────────── */

export const CLAIM_STATUS_LABEL: Record<string, string> = {
  confirmed: "Confirmed", inferred: "Inferred", unknown: "Unknown", conflicting: "Conflicting",
};

export const CLAIM_STATUS_HINT: Record<string, string> = {
  confirmed: "Stated on the page linked below, in the words quoted.",
  inferred: "A reading of what was seen, not stated outright.",
  unknown: "Not known yet.",
  conflicting: "Sources disagree.",
};

export interface ClaimProvenance {
  /** Who recorded it. */
  by: string;
  /** host + path of the evidence page, for display; null when there is no web page. */
  site: string | null;
  /** The evidence link, only ever http(s). */
  href: string | null;
}

export function claimProvenance(c: { source: string | null | undefined; evidenceUrl: string | null | undefined }): ClaimProvenance {
  const by = c.source === "agent" ? "Recorded by AI" : "Recorded by your team";
  const url = typeof c.evidenceUrl === "string" ? c.evidenceUrl.trim() : "";
  if (!/^https?:\/\//i.test(url)) return { by, site: null, href: null };
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "");
    return { by, site: u.hostname.replace(/^www\./, "") + path, href: url };
  } catch {
    return { by, site: null, href: null };
  }
}

/* ── a refused add that was a duplicate ───────────────────────────────── */

/**
 * The server answers a lead that already exists with
 * `409 {"code":"duplicate","error":"…","existingId":N}` (server/services/leads.ts),
 * and the client throws it as `"409: <body>"`. This reads that back; anything
 * else is not a duplicate.
 */
export function duplicateLead(err: unknown): { existingId: number; message: string } | null {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const m = /^409:\s*([\s\S]*)$/.exec(message);
  if (!m) return null;
  try {
    const body = JSON.parse(m[1]) as { code?: unknown; error?: unknown; existingId?: unknown };
    if (body?.code !== "duplicate") return null;
    const id = body.existingId;
    if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) return null;
    return { existingId: id, message: typeof body.error === "string" ? body.error : "You already have a lead for this company." };
  } catch {
    return null;
  }
}
