/**
 * Completing a deal, editing an invoice's due date and note, the workspace
 * profile, and the person's own details: for the agent.
 *
 * Each mirrors the REST route it stands beside (PATCH /api/deals/:id/complete,
 * PATCH /api/brand-invoices/:id, PATCH /api/org, PATCH /api/profile) and its gates:
 * the same permission, the same plan check, the same organization boundary, the
 * same activity line. What the routes allow that these do not is deliberate and
 * listed in shared/workspace.ts. A plan* function answers "what would change"
 * for the approval card without writing; an apply* function re-checks everything
 * and writes, because an approval can be minutes old.
 */
import { memberCan } from "@shared/permissions";
import { PRINTED_FIELDS, invoiceDetailsSchema, myDetailsSchema, workspaceProfileSchema, type InvoiceDetails, type MyDetails, type WorkspaceProfile } from "@shared/workspace";
import { hasProAccess, type BrandInvoice, type Deal, type User } from "@shared/schema";
import { getBillingUser, logOrgActivity } from "../entitlements";
import { storage } from "../storage";
import { fail, firstIssue, type Result, type Who } from "./leads";

type Line = { label: string; value: string };
const inOrg = (r: { organizationId?: string | null; userId?: string | null } | null | undefined, user: Who) =>
  !!r && (r.organizationId ? r.organizationId === user.organizationId : r.userId === user.id);
const show = (v: unknown) => (v === null || v === undefined || v === "" ? "(empty)" : String(v));
const diffLines = (before: Record<string, any>, after: Record<string, any>, labels: Record<string, string>): Line[] =>
  Object.keys(after).filter((k) => (before[k] ?? "") !== after[k]).map((k) => ({ label: labels[k] ?? k, value: `${show(before[k])} → ${show(after[k])}` }));

// ── complete a deal ────────────────────────────────────────────────────────

export async function planCompleteDeal(user: User, dealId: number): Promise<Result<{ deal: Deal; unpaid: number }>> {
  if (!memberCan(user, "deals.edit")) return fail(403, "forbidden", "Your role doesn't allow editing deals. Ask your organization owner.");
  const deal = await storage.getDeal(dealId);
  if (!deal || !inOrg(deal, user)) return fail(404, "not_found", "That deal isn't in your organization.");
  if (deal.status === "Completed") return fail(409, "no_change", `"${deal.dealTitle}" is already completed.`);
  if (deal.status !== "Active") return fail(409, "not_active", `Only an active deal can be completed, and "${deal.dealTitle}" is ${deal.status}. A deal becomes active when the client signs the agreement.`);
  const invoices = user.organizationId ? await storage.getBrandInvoicesByDealIdForOrg(dealId, user.organizationId, user.id) : [];
  return { ok: true, deal, unpaid: invoices.filter((i) => i.status !== "Paid").length };
}

export async function applyCompleteDeal(user: User, dealId: number): Promise<Result<{ deal: Deal }>> {
  const p = await planCompleteDeal(user, dealId);
  if (!p.ok) return p;
  const updated = await storage.updateDeal(dealId, { status: "Completed" } as any);
  if (!updated) return fail(500, "failed", "Couldn't complete the deal.");
  logOrgActivity(user, "completed", "deal", dealId, p.deal.dealTitle || p.deal.brandName || "");
  return { ok: true, deal: updated };
}

// ── an invoice's due date and note ─────────────────────────────────────────

export async function planInvoiceDetails(user: User, raw: unknown): Promise<Result<{ invoice: BrandInvoice; edit: Omit<InvoiceDetails, "invoiceId">; lines: Line[] }>> {
  const parsed = invoiceDetailsSchema.safeParse(raw);
  if (!parsed.success) return fail(400, "invalid", firstIssue(parsed.error));
  const { invoiceId, ...edit } = parsed.data;
  if (edit.dueDate === undefined && edit.notes === undefined) return fail(400, "nothing", "Tell me the new due date or the new note.");
  if (!memberCan(user, "payments.manage")) return fail(403, "forbidden", "Your role doesn't allow editing invoices. Ask your organization owner.");
  if (!hasProAccess(await getBillingUser(user))) return fail(402, "upgrade", "Editing invoices is a Pro feature: upgrade to do this.");
  const invoice = await storage.getBrandInvoice(invoiceId);
  if (!invoice || !inOrg(invoice, user)) return fail(404, "not_found", "That invoice isn't in your organization.");
  // The route's paid lock, and the same words as its refusal.
  if (invoice.status === "Paid") return fail(409, "paid_locked", `${invoice.invoiceNumber} is paid, and a paid invoice can't be edited. Mark it unpaid first if that was a mistake.`);
  if (edit.dueDate !== undefined && invoice.invoiceDate && edit.dueDate < String(invoice.invoiceDate).slice(0, 10)) {
    return fail(400, "invalid", `The due date can't be before the invoice date (${String(invoice.invoiceDate).slice(0, 10)}).`);
  }
  const lines = diffLines({ dueDate: String(invoice.dueDate ?? "").slice(0, 10), notes: invoice.notes }, edit, { dueDate: "Due date", notes: "Note" });
  if (!lines.length) return fail(409, "no_change", "That is already what the invoice says.");
  return { ok: true, invoice, edit, lines: [{ label: "Invoice", value: `${invoice.invoiceNumber} · ${invoice.brandName}` }, ...lines] };
}

export async function applyInvoiceDetails(user: User, raw: unknown): Promise<Result<{ invoice: BrandInvoice }>> {
  const p = await planInvoiceDetails(user, raw);
  if (!p.ok) return p;
  const updated = await storage.updateBrandInvoice(p.invoice.id, p.edit as any);
  if (!updated) return fail(500, "failed", "Couldn't update the invoice.");
  logOrgActivity(user, "edited", "invoice", p.invoice.id, `${p.invoice.invoiceNumber}: ${Object.keys(p.edit).join(", ")}`);
  return { ok: true, invoice: updated };
}

// ── the workspace profile ──────────────────────────────────────────────────

export async function planWorkspaceProfile(user: User, raw: unknown): Promise<Result<{ edit: WorkspaceProfile; lines: Line[] }>> {
  const parsed = workspaceProfileSchema.safeParse(raw);
  if (!parsed.success) return fail(400, "invalid", firstIssue(parsed.error));
  if (!Object.values(parsed.data).some((v) => v !== undefined)) return fail(400, "nothing", "Tell me what to change: the name, the industry, or the work type.");
  if (!memberCan(user, "org.settings")) return fail(403, "forbidden", "Your role doesn't allow changing workspace settings. Ask your organization owner.");
  const org = user.organizationId ? await storage.getOrganization(user.organizationId) : undefined;
  if (!org) return fail(404, "not_found", "There is no workspace on this account.");
  const lines = diffLines(org as any, parsed.data, { name: "Workspace name", industry: "Industry", audience: "Work type" });
  if (!lines.length) return fail(409, "no_change", "That is already what the workspace says.");
  return { ok: true, edit: parsed.data, lines };
}

export async function applyWorkspaceProfile(user: User, raw: unknown): Promise<Result<{ changed: string[] }>> {
  const p = await planWorkspaceProfile(user, raw);
  if (!p.ok) return p;
  const updates: Record<string, unknown> = {};
  if (p.edit.name !== undefined) updates.name = p.edit.name;
  if (p.edit.industry !== undefined) updates.industry = p.edit.industry || null;
  if (p.edit.audience !== undefined) updates.audience = p.edit.audience;
  const org = await storage.updateOrganization(user.organizationId!, updates as any);
  if (!org) return fail(500, "failed", "Couldn't update the workspace.");
  logOrgActivity(user, "updated", "organization", user.organizationId, "Organization settings");
  return { ok: true, changed: Object.keys(updates) };
}

// ── the person's own details ───────────────────────────────────────────────

export async function planMyDetails(user: User, raw: unknown): Promise<Result<{ edit: MyDetails; lines: Line[]; printed: boolean }>> {
  const parsed = myDetailsSchema.safeParse(raw);
  if (!parsed.success) return fail(400, "invalid", firstIssue(parsed.error));
  if (!Object.values(parsed.data).some((v) => v !== undefined)) return fail(400, "nothing", "Tell me which detail to change.");
  const me = await storage.getUser(user.id);
  if (!me) return fail(404, "not_found", "I couldn't find your account.");
  const edit = { ...parsed.data } as MyDetails;
  const lines = diffLines(me as any, edit, { firstName: "First name", lastName: "Last name", phone: "Phone", panNumber: "Tax id (PAN)", gstNumber: "GST/VAT number", billingAddress: "Billing address" });
  if (!lines.length) return fail(409, "no_change", "That is already what your details say.");
  const printed = PRINTED_FIELDS.some((k) => (edit as any)[k] !== undefined && (me as any)[k] !== (edit as any)[k]);
  return { ok: true, edit, lines, printed };
}

export async function applyMyDetails(user: User, raw: unknown): Promise<Result<{ changed: string[] }>> {
  const p = await planMyDetails(user, raw);
  if (!p.ok) return p;
  const updates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p.edit)) if (v !== undefined) updates[k] = v;
  const me = await storage.updateUser(user.id, updates as any);
  if (!me) return fail(500, "failed", "Couldn't save your details.");
  logOrgActivity(user, "updated", "profile", user.id, `Details: ${Object.keys(updates).join(", ")}`);
  return { ok: true, changed: Object.keys(updates) };
}
