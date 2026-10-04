/**
 * The agent's wire format, shared by the server (which emits it) and the
 * browser (which renders it). Pure: no database, no DOM.
 *
 * Every event marks work that has really just started or finished. The labels
 * below turn those events into the plain-language progress a person reads
 * ("Reading the message", "Found: no payment deadline") — they are derived from
 * the event, never invented, so the UI cannot show progress that didn't happen.
 */

export const AGENT_EVENT_TYPES = [
  "agent.started", "agent.understanding", "agent.extracting", "agent.searching",
  "agent.tool_started", "agent.tool_progress", "agent.tool_completed", "agent.tool_failed",
  "agent.finding", "agent.needs_confirmation", "agent.executing",
  "agent.message", "agent.completed", "agent.failed",
] as const;
export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

export interface AgentEvent {
  type: AgentEventType;
  runId: string;
  seq: number;
  at: string;
  data: Record<string, unknown>;
}

export interface ApprovalPreview {
  title: string;
  /** Short "label: value" lines the user reads before approving. */
  lines: { label: string; value: string }[];
  /** Effects beyond the database, in plain words. */
  effects: string[];
  [k: string]: unknown;
}

export type CardKind = "approval" | "deal" | "findings" | "quotation" | "agreement" | "invoice" | "payment" | "lead" | "companies";

/** A card the UI renders from structured data (never from model prose). */
export interface AgentCard {
  kind: CardKind;
  data: Record<string, unknown>;
}

export type ApprovalStatus = "pending" | "executing" | "done" | "declined" | "expired" | "failed";

/** The server's stored status, as the UI shows it. */
export function approvalStatusFromServer(status: string, expiresAt?: string | Date | null, now = Date.now()): ApprovalStatus {
  if (status === "executed") return "done";
  if (status === "rejected") return "declined";
  if (status === "expired") return "expired";
  if (status === "approved") return "executing";
  if (expiresAt && new Date(expiresAt).getTime() <= now) return "expired";
  return "pending";
}

/* ── tools, in words ──────────────────────────────────────────────────── */

const TOOL_LABELS: Record<string, string> = {
  get_workflow_status: "where the deal stands",
  search_deals: "your deals",
  search_quotations: "your quotations",
  search_agreements: "your agreements",
  search_invoices: "your invoices",
  get_pending_work: "your pending work",
  get_account_status: "your account",
  get_money_radar: "what's collectible",
  get_deal_health: "the deal's health",
  get_recent_activity: "recent activity",
  get_deal: "the deal",
  get_quotation: "the quotation",
  get_agreement: "the agreement",
  get_invoice: "the invoice",
  get_payment_status: "payment status",
  draft_payment_followup: "a payment follow-up",
  analyze_deal_message: "the message",
  run_protection_check: "the Protection Check",
  create_deal: "the deal",
  update_deal: "the deal changes",
  add_protection_term: "the extra term",
  create_quotation: "the quotation",
  share_quotation: "the quotation link",
  create_agreement: "the agreement",
  create_signing_link: "the signing link",
  create_invoice: "the invoice",
  mark_paid: "the payment",
  mark_unpaid: "the payment reversal",
  list_leads: "your leads",
  get_lead: "the lead",
  get_lead_followups: "your lead follow-ups",
  get_ideal_client: "your ideal client",
  update_ideal_client: "your ideal client",
  assess_lead_fit: "how well the lead fits",
  find_companies: "the company search",
  revise_quotation: "the quotation changes",
  revise_agreement: "the agreement changes",
  get_document_style: "how your documents look",
  update_document_style: "the document style",
  complete_deal: "the deal completion",
  update_invoice_details: "the invoice changes",
  update_workspace_profile: "the workspace changes",
  update_my_details: "your details",
  search_knowledge: "your knowledge",
  add_knowledge_note: "the note",
  add_knowledge_url: "the page",
  create_lead: "the lead",
  create_leads: "the leads",
  update_lead: "the lead changes",
  move_lead: "the stage change",
  add_lead_note: "the note",
  create_ticket: "the ticket",
  complete_ticket: "the ticket",
  add_lead_claim: "the fact",
  archive_lead: "the lead",
  convert_lead_to_deal: "the deal",
};
export const toolLabel = (tool: unknown): string => TOOL_LABELS[String(tool)] ?? "that";

/** The button on an approval card, by tool. */
const APPROVE_LABELS: Record<string, string> = {
  create_deal: "Create deal",
  update_deal: "Apply changes",
  add_protection_term: "Add term",
  create_quotation: "Create quotation",
  share_quotation: "Create link",
  create_agreement: "Create agreement",
  create_signing_link: "Create signing link",
  create_invoice: "Create invoice",
  mark_paid: "Record payment",
  mark_unpaid: "Reverse payment",
  create_lead: "Add lead",
  create_leads: "Add leads",
  update_lead: "Apply changes",
  move_lead: "Move lead",
  add_lead_note: "Add note",
  create_ticket: "Add ticket",
  complete_ticket: "Update ticket",
  add_lead_claim: "Record fact",
  archive_lead: "Archive lead",
  update_ideal_client: "Save",
  find_companies: "Search",
  revise_quotation: "Revise quotation",
  revise_agreement: "Revise agreement",
  update_document_style: "Apply style",
  complete_deal: "Complete deal",
  update_invoice_details: "Save invoice",
  update_workspace_profile: "Save",
  update_my_details: "Save",
  add_knowledge_note: "Add note",
  add_knowledge_url: "Add page",
  convert_lead_to_deal: "Create deal",
};
export const approveLabel = (tool: unknown): string => APPROVE_LABELS[String(tool)] ?? "Approve";

/* ── progress ─────────────────────────────────────────────────────────── */

/** A person-readable label for an event, or null when the event isn't a step. */
export function activityLabel(e: Pick<AgentEvent, "type" | "data">): string | null {
  const d = e.data ?? {};
  switch (e.type) {
    case "agent.started": return "Getting started";
    case "agent.understanding": return "Understanding your request";
    case "agent.extracting": return "Reading the message";
    case "agent.searching": return `Looking up ${toolLabel(d.tool)}`;
    case "agent.tool_started": return d.risk === "READ_ONLY" ? null : `Preparing ${toolLabel(d.tool)}`;
    case "agent.tool_progress": return typeof d.message === "string" && d.message ? d.message : null;
    case "agent.finding": return typeof d.title === "string" && d.title ? `Found: ${d.title}` : null;
    case "agent.needs_confirmation": return "Ready for your approval";
    case "agent.executing": return "Making the change";
    case "agent.tool_failed": return typeof d.message === "string" && d.message ? `Couldn't finish: ${d.message}` : "A step didn't work";
    default: return null;
  }
}

export interface ActivityStep {
  id: number;
  label: string;
  state: "active" | "done" | "failed";
}

/** Fold one event into the step list: a labelled event opens a step and closes
 *  the one before it; a failed tool marks the open step failed. */
export function reduceSteps(steps: readonly ActivityStep[], e: Pick<AgentEvent, "type" | "data">): ActivityStep[] {
  if (e.type === "agent.completed" || e.type === "agent.message") {
    return steps.map((s) => (s.state === "active" ? { ...s, state: "done" as const } : s));
  }
  if (e.type === "agent.failed") {
    return steps.map((s) => (s.state === "active" ? { ...s, state: "failed" as const } : s));
  }
  const label = activityLabel(e);
  if (!label) return steps as ActivityStep[];
  const closed = steps.map((s) => (s.state === "active" ? { ...s, state: e.type === "agent.tool_failed" ? ("failed" as const) : ("done" as const) } : s));
  // A failure is its own (already failed) line; every other label is a step in progress.
  const state = e.type === "agent.tool_failed" ? "failed" : "active";
  // The same label twice in a row (two reads of the same kind) stays one step.
  const last = closed[closed.length - 1];
  if (last && last.label === label && state === "active") return closed.map((s, i) => (i === closed.length - 1 ? { ...s, state: "active" as const } : s));
  return [...closed, { id: (last?.id ?? 0) + 1, label, state }];
}

/* ── analytics: which tool completing is a funnel step ───────────────── */

/** An approved tool that moves a deal along the workflow, as a GA4 event name. */
export const FUNNEL_EVENT: Record<string, string> = {
  create_deal: "agent_deal_created",
  create_quotation: "agent_quotation_created",
  share_quotation: "agent_quotation_shared",
  create_agreement: "agent_agreement_created",
  create_signing_link: "agent_signing_link_created",
  create_invoice: "agent_invoice_created",
  mark_paid: "agent_payment_recorded",
};
