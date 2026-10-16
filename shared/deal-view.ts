/**
 * How the Deals screens read a deal: where it is in its workflow, and which
 * board column it sits in.
 *
 * Pure: no React, no fetching. The pages load the records and hand them in.
 *
 *   Deal → Quotation → Agreement → Invoice → Paid
 *
 * The position is the FURTHEST step the deal's own documents prove, the same
 * way the deal page's stepper has always counted (a signed agreement means the
 * quotation step is behind it, an invoice means the agreement step is):
 *
 *   an invoice exists        → Invoice done; Paid is done only when every
 *                              invoice is paid AND they cover the deal value
 *   an agreement exists      → signed (isAgreementSigned): ready to invoice;
 *                              unsigned: awaiting signature
 *   the latest quotation     → "draft" is the current quote; "revised" means
 *                              the deal was edited and the quote is outdated
 *   nothing                  → no quotation yet
 *
 * A deal's STATUS (Pending / Active / Completed) is a separate, stored fact
 * that only the server changes: Pending at creation, Active when its agreement
 * is created, Completed through "Mark as completed" (Active only). The board
 * groups by that status and never changes it.
 *
 * Honesty rule: when any of the sources (quotations, agreements, invoices)
 * could not be read, the position is unknown — never a guess that could say
 * "No quote yet" about a deal whose quotation we simply couldn't load.
 */
import { isAgreementSigned } from "./agreement-lifecycle";
import { paymentState } from "./paymentState";

// ── Workflow steps ───────────────────────────────────────────────────────

export const WORKFLOW_STEPS = [
  { key: "deal", label: "Deal", step: 1 },
  { key: "quote", label: "Quotation", step: 2 },
  { key: "agreement", label: "Agreement", step: 3 },
  { key: "invoice", label: "Invoice", step: 4 },
  { key: "paid", label: "Paid", step: 5 },
] as const;
export type WorkflowStepKey = (typeof WORKFLOW_STEPS)[number]["key"];
/** The stepper's `currentStep` once every step is done. */
export const WORKFLOW_DONE = WORKFLOW_STEPS.length + 1;

export interface WorkflowQuote { id?: number; status?: string | null; createdAt?: string | Date | null }
export interface WorkflowAgreement { status?: string | null; signedByBrand?: boolean | null; clientSignedAt?: string | Date | null }
export interface WorkflowInvoice { status?: string | null; dueDate?: string | Date | null; amountMinor: number }

export interface WorkflowFacts {
  dealAmountMinor: number;
  /** The deal's latest quotation, or null when it has none. */
  quote: WorkflowQuote | null;
  /** The deal's agreement, or null when none was created. */
  agreement: WorkflowAgreement | null;
  invoices: WorkflowInvoice[];
}

/** todo: the person's move. waiting: on the client. attention: something is wrong. done: nothing left. */
export type WorkflowTone = "todo" | "waiting" | "attention" | "done";

export interface WorkflowPosition {
  /** For WorkflowStepper's currentStep: steps below it are done; WORKFLOW_DONE means all are. */
  step: number;
  /** The step being worked on, or "done". */
  key: WorkflowStepKey | "done";
  /** A short, factual description of where the deal is. */
  label: string;
  tone: WorkflowTone;
}

const at = (step: number, label: string, tone: WorkflowTone): WorkflowPosition => ({
  step,
  key: step >= WORKFLOW_DONE ? "done" : WORKFLOW_STEPS[step - 1].key,
  label,
  tone,
});

/** Where a deal is, from its documents. See the header for the rules. */
export function workflowPosition(f: WorkflowFacts, now: Date = new Date()): WorkflowPosition {
  if (f.invoices.length > 0) {
    const unpaid = f.invoices.filter((i) => i.status !== "Paid");
    if (unpaid.some((i) => paymentState(i, now) === "overdue")) return at(5, "Payment overdue", "attention");
    if (unpaid.length > 0) return at(5, "Awaiting payment", "waiting");
    const invoiced = f.invoices.reduce((s, i) => s + (Number(i.amountMinor) || 0), 0);
    if (invoiced >= f.dealAmountMinor) return at(WORKFLOW_DONE, "Paid in full", "done");
    return at(5, "Part invoiced", "todo");
  }
  if (f.agreement) {
    return isAgreementSigned(f.agreement) ? at(4, "Ready to invoice", "todo") : at(3, "Awaiting signature", "waiting");
  }
  if (f.quote?.status === "draft") return at(3, "Quote ready", "todo");
  if (f.quote?.status === "revised") return at(2, "Quote outdated", "attention");
  return at(2, "No quote yet", "todo");
}

// ── Joining the org-wide lists to their deals (one pass, no per-deal requests) ──

export interface DocumentSources<Q extends WorkflowQuote & { dealId: number }, A extends WorkflowAgreement & { dealId: number }, I extends { dealId: number }> {
  /** null when the list couldn't be read (no access, or it failed): never read as "none". */
  quotes: Q[] | null | undefined;
  agreements: A[] | null | undefined;
  invoices: I[] | null | undefined;
}

export interface DealDocuments<Q, A, I> { quote: Q | null; agreement: A | null; invoices: I[] }

const time = (d: string | Date | null | undefined): number => {
  const t = d ? new Date(d).getTime() : NaN;
  return Number.isFinite(t) ? t : -Infinity;
};

/**
 * Index the three org-wide lists by deal. Null when any list is unknown, so a
 * caller cannot accidentally derive a position from partial facts.
 *
 * The latest quotation wins (newest createdAt, then highest id), matching the
 * server's per-deal lookup; the first agreement for a deal wins, matching the
 * deal page (a deal has at most one: creation is locked per deal).
 */
export function indexDealDocuments<Q extends WorkflowQuote & { dealId: number }, A extends WorkflowAgreement & { dealId: number }, I extends { dealId: number }>(
  src: DocumentSources<Q, A, I>,
): Map<number, DealDocuments<Q, A, I>> | null {
  if (!src.quotes || !src.agreements || !src.invoices) return null;
  const map = new Map<number, DealDocuments<Q, A, I>>();
  const entry = (dealId: number) => {
    let e = map.get(dealId);
    if (!e) { e = { quote: null, agreement: null, invoices: [] }; map.set(dealId, e); }
    return e;
  };
  for (const q of src.quotes) {
    const e = entry(q.dealId);
    const cur = e.quote;
    if (!cur || time(q.createdAt) > time(cur.createdAt) || (time(q.createdAt) === time(cur.createdAt) && (q.id ?? 0) > (cur.id ?? 0))) e.quote = q;
  }
  for (const a of src.agreements) {
    const e = entry(a.dealId);
    if (!e.agreement) e.agreement = a;
  }
  for (const i of src.invoices) entry(i.dealId).invoices.push(i);
  return map;
}

/** Every deal's position, keyed by deal id; null when the facts aren't all known. */
export function workflowPositions<I extends { dealId: number; status?: string | null; dueDate?: string | Date | null; dealAmountMinor?: number | null }>(
  deals: { id: number; dealAmountMinor: number }[],
  src: DocumentSources<WorkflowQuote & { dealId: number }, WorkflowAgreement & { dealId: number }, I>,
  now: Date = new Date(),
): Map<number, WorkflowPosition> | null {
  const index = indexDealDocuments(src);
  if (!index) return null;
  const out = new Map<number, WorkflowPosition>();
  for (const d of deals) {
    const docs = index.get(d.id);
    out.set(d.id, workflowPosition({
      dealAmountMinor: d.dealAmountMinor,
      quote: docs?.quote ?? null,
      agreement: docs?.agreement ?? null,
      invoices: (docs?.invoices ?? []).map((i) => ({ status: i.status, dueDate: i.dueDate, amountMinor: Number(i.dealAmountMinor) || 0 })),
    }, now));
  }
  return out;
}

// ── The board ─────────────────────────────────────────────────────────────

/** The board's columns: the deal statuses the server sets, in the order a deal moves through them. */
export const BOARD_STATUSES = ["Pending", "Active", "Completed"] as const;

export interface BoardColumn<T> { status: string; deals: T[] }

/**
 * Deals grouped into the board's columns by their stored status, keeping the
 * list's order inside each column. The three known columns always appear
 * (empty ones included, so the board's shape never shifts); a status outside
 * them gets its own column after, rather than silently vanishing.
 */
export function groupDealsByStatus<T extends { status: string }>(deals: readonly T[]): BoardColumn<T>[] {
  const cols: BoardColumn<T>[] = BOARD_STATUSES.map((status) => ({ status, deals: [] }));
  for (const d of deals) {
    let col = cols.find((c) => c.status === d.status);
    if (!col) { col = { status: d.status, deals: [] }; cols.push(col); }
    col.deals.push(d);
  }
  return cols;
}

// ── The List | Board choice ──────────────────────────────────────────────

export type DealsView = "list" | "board";
export const DEALS_VIEW_KEY = "dealinsec.deals.view";

/** A stored choice read back: anything unexpected is the list, the default. */
export function parseDealsView(raw: string | null | undefined): DealsView {
  return raw === "board" ? "board" : "list";
}
