/**
 * Revising a quotation or an agreement. The agent's tools call these; the rules
 * live here, once.
 *
 * QUOTATION: a quotation is a rendering of its deal, so revising it edits the
 * PENDING deal and regenerates the quotation (a new draft version). A price
 * change is never silent: the tool forces an approval for it.
 *
 * AGREEMENT: the issuer signed it when it was created, so changing it is a legal
 * act, not an edit. It is allowed only
 *   - while the client has NOT signed and no signed copy has been uploaded (a
 *     client signature, and the integrity hash computed from it, mean "unchanged");
 *   - by the person whose signature is on it (nobody else may re-apply it);
 *   - after an explicit confirmation that reads the changes back;
 * and it revokes any signing link already sent (its frozen copy is now stale).
 * The issuer's signature is re-dated, never replaced by someone else's.
 */
import { memberCan } from "@shared/permissions";
import { formatMoney } from "@shared/money";
import { AGREEMENT_LOCKED, appendLines, dealEditSchema, isEmptyEdit, normalizeDeliverables, removeLines, summarizeDeliverables, type DealEdit, type StoredDeliverable } from "@shared/revisions";
import { MAX_AMOUNT_MINOR, amountMinorSchema, resolveLocaleSettings, toMinor, type Contract, type Deal, type Quote, type User } from "@shared/schema";
import { z } from "zod";
import { executeCreateQuotation, inOrg } from "../copilot/tools";
import { logOrgActivity } from "../entitlements";
import { storage } from "../storage";
import { reviseDraftQuote } from "./deals";
import { fail, firstIssue, type Result, type Who } from "./leads";

export type Line = { label: string; value: string };
const newId = () => crypto.randomUUID();
const asUser = (u: Who) => u as User;

async function localeFor(user: Who) {
  const org = user.organizationId ? await storage.getOrganization(user.organizationId) : undefined;
  return resolveLocaleSettings(org, user as User);
}
const money = (minor: number, currency: string, locale: string) => formatMoney(minor, currency, locale);

/** Which deal fields change, with a before → after line for each. Pure apart from reading `deal`. */
function planFields(deal: Deal, edit: DealEdit, currency: string, locale: string): Result<{ updates: Partial<Deal>; lines: Line[]; amountChanged: boolean }> {
  const updates: Record<string, unknown> = {};
  const lines: Line[] = [];
  let amountChanged = false;

  const title = edit.dealTitle?.trim().slice(0, 200);
  if (title && title !== deal.dealTitle) { updates.dealTitle = title; lines.push({ label: "Project", value: `${deal.dealTitle} → ${title}` }); }

  if (edit.dealAmount !== undefined) {
    const major = currency === "INR" ? Math.round(edit.dealAmount) : edit.dealAmount;
    const minor = Number.isFinite(major) ? toMinor(major, currency) : NaN;
    const ok = amountMinorSchema.safeParse(minor);
    if (!ok.success || ok.data <= 0 || ok.data > MAX_AMOUNT_MINOR) return fail(400, "invalid_amount", "That isn't a valid amount.");
    if (ok.data !== deal.dealAmountMinor) {
      updates.dealAmountMinor = ok.data; amountChanged = true;
      lines.push({ label: "Amount", value: `${money(deal.dealAmountMinor, currency, locale)} → ${money(ok.data, currency, locale)}` });
    }
  }

  const start = edit.startDate ?? deal.startDate, end = edit.endDate ?? deal.endDate;
  if ((edit.startDate || edit.endDate) && Date.parse(end) < Date.parse(start)) return fail(400, "invalid_date", "The end date can't be before the start date.");
  if (edit.startDate && edit.startDate !== deal.startDate) { updates.startDate = edit.startDate; lines.push({ label: "Start", value: `${deal.startDate} → ${edit.startDate}` }); }
  if (edit.endDate && edit.endDate !== deal.endDate) { updates.endDate = edit.endDate; lines.push({ label: "End", value: `${deal.endDate} → ${edit.endDate}` }); }

  if (edit.deliverables) {
    const next = normalizeDeliverables(edit.deliverables, newId);
    const before = (deal.deliverables ?? []) as StoredDeliverable[];
    const sig = (xs: StoredDeliverable[]) => JSON.stringify(xs.map((d) => [d.platform, d.contentType, d.quantity, d.frequency, d.notes]));
    if (sig(next) !== sig(before)) {
      updates.deliverables = next;
      lines.push({ label: "Deliverables", value: summarizeDeliverables(next) });
    }
  }

  const termOps = [edit.addTerms, edit.removeTerms, edit.replaceTerms].filter((x) => x !== undefined).length;
  if (edit.replaceTerms !== undefined && termOps > 1) return fail(400, "invalid", "Either replace the terms or add and remove lines, not both.");
  let terms: string | null | undefined = deal.customTerms;
  if (edit.replaceTerms !== undefined) {
    terms = edit.replaceTerms.split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
    if (terms !== (deal.customTerms ?? "")) lines.push({ label: "Terms", value: terms ? `replaced with ${terms.split("\n").length} line(s)` : "all terms removed" });
  } else {
    if (edit.removeTerms) {
      const r = removeLines(terms, edit.removeTerms);
      if (r.missing.length) return fail(400, "term_not_found", `I couldn't find ${r.missing.map((m) => `"${m}"`).join(", ")} on the terms. Terms must be named as they appear.`);
      terms = r.text;
      lines.push({ label: "Remove from terms", value: r.removed.join("; ") });
    }
    if (edit.addTerms && appendLines(terms, edit.addTerms) !== (terms ?? "")) {
      terms = appendLines(terms, edit.addTerms);
      lines.push({ label: "Add to terms", value: edit.addTerms.split("\n").map((l) => l.trim()).filter(Boolean).join("; ") });
    }
  }
  if ((terms ?? "") !== (deal.customTerms ?? "")) updates.customTerms = terms || null;

  if (!lines.length) return fail(400, "no_change", "That's already how it is set up, so there's nothing to change.");
  return { ok: true, updates: updates as Partial<Deal>, lines, amountChanged };
}

function parseEdit(raw: unknown): Result<{ edit: DealEdit }> {
  const p = dealEditSchema.safeParse(raw ?? {});
  if (!p.success) return fail(400, "invalid", firstIssue(p.error));
  if (isEmptyEdit(p.data)) return fail(400, "no_change", "Say what to change.");
  return { ok: true, edit: p.data };
}

/* ── quotation ────────────────────────────────────────────────────────── */

export interface QuotationPlan { deal: Deal; updates: Partial<Deal>; lines: Line[]; amountChanged: boolean; quote: Quote | undefined; linkActive: boolean }

export async function planQuotationRevision(user: Who, dealId: number, raw: unknown): Promise<Result<QuotationPlan>> {
  if (!user.organizationId) return fail(403, "no_organization", "Finish setting up your workspace first.");
  if (!memberCan(asUser(user), "deals.edit") || !memberCan(asUser(user), "quotations.create")) return fail(403, "forbidden", "Your role doesn't allow revising quotations. Ask your organization owner.");
  const parsed = parseEdit(raw);
  if (!parsed.ok) return parsed;
  const deal = await storage.getDeal(dealId);
  if (!deal || !inOrg(deal, asUser(user))) return fail(404, "not_found", "That deal isn't in your organization.");
  if (deal.status !== "Pending") return fail(409, "not_editable", `This deal is already ${deal.status.toLowerCase()}, so its quotation can't be revised. Only a pending deal can.`);
  const { currency, locale } = await localeFor(user);
  const plan = planFields(deal, parsed.edit, currency, locale);
  if (!plan.ok) return plan;
  const quote = await storage.getQuoteByDealId(deal.id);
  return { ...plan, deal, quote, linkActive: !!quote?.shareToken && !quote.shareRevokedAt };
}

export async function applyQuotationRevision(user: Who, dealId: number, raw: unknown): Promise<Result<{ deal: Deal; quoteVersion: number; route: string }>> {
  const plan = await planQuotationRevision(user, dealId, raw);
  if (!plan.ok) return plan;
  const updated = await storage.updateDeal(dealId, plan.updates);
  if (!updated) return fail(500, "failed", "Couldn't update the deal.");
  await reviseDraftQuote(dealId);
  const made = await executeCreateQuotation(dealId, asUser(user));
  if (!made.ok) return fail(409, "quotation_failed", `The deal was updated but the quotation couldn't be regenerated: ${made.message}`);
  const quote = await storage.getQuoteByDealId(dealId);
  logOrgActivity(asUser(user), "revised", "quotation", quote?.id ?? dealId, `Quotation revised: ${updated.dealTitle || updated.brandName} (via Agent)`);
  return { ok: true, deal: updated, quoteVersion: quote?.version ?? 1, route: `/deals/${dealId}/quote` };
}

/* ── agreement ────────────────────────────────────────────────────────── */

export const agreementEditSchema = dealEditSchema.pick({ startDate: true, endDate: true, addTerms: true, removeTerms: true, replaceTerms: true }).extend({
  contractName: z.string().trim().min(1).max(200).optional().describe("The agreement's name"),
  contractValue: z.number().positive().optional().describe("The new agreed fee in whole currency units. Only a figure the user stated."),
  exclusive: z.boolean().optional().describe("Whether the arrangement is exclusive"),
});
export type AgreementEdit = z.infer<typeof agreementEditSchema>;

export interface AgreementPlan { contract: Contract; deal: Deal; contractUpdates: Partial<Contract>; dealUpdates: Partial<Deal>; lines: Line[]; linkActive: boolean }

export async function planAgreementRevision(user: Who, dealId: number, raw: unknown): Promise<Result<AgreementPlan>> {
  if (!user.organizationId) return fail(403, "no_organization", "Finish setting up your workspace first.");
  if (!memberCan(asUser(user), "agreements.create") || !memberCan(asUser(user), "deals.edit")) return fail(403, "forbidden", "Your role doesn't allow revising agreements. Ask your organization owner.");
  const p = agreementEditSchema.safeParse(raw ?? {});
  if (!p.success) return fail(400, "invalid", firstIssue(p.error));
  const edit = p.data;
  if (Object.values(edit).every((v) => v === undefined)) return fail(400, "no_change", "Say what to change.");

  const deal = await storage.getDeal(dealId);
  if (!deal || !inOrg(deal, asUser(user))) return fail(404, "not_found", "That deal isn't in your organization.");
  const contract = await storage.getContractByDealId(dealId);
  if (!contract || contract.organizationId !== user.organizationId) return fail(404, "no_agreement", "There's no agreement for that deal. Create it first.");
  if (contract.signedByBrand || contract.clientSignedAt) return fail(409, "locked", AGREEMENT_LOCKED);
  if (contract.signerUserId && contract.signerUserId !== user.id) {
    return fail(403, "not_the_signer", `Only ${contract.signerName ?? "the person who signed it"}, whose signature is on this agreement, can revise it.`);
  }

  const { currency: orgCurrency, locale } = await localeFor(user);
  const lines: Line[] = [];
  const contractUpdates: Record<string, unknown> = {};

  if (edit.contractName && edit.contractName !== contract.contractName) { contractUpdates.contractName = edit.contractName; lines.push({ label: "Agreement", value: `${contract.contractName} → ${edit.contractName}` }); }
  if (edit.exclusive !== undefined && edit.exclusive !== contract.exclusive) { contractUpdates.exclusive = edit.exclusive; lines.push({ label: "Exclusive", value: `${contract.exclusive ? "yes" : "no"} → ${edit.exclusive ? "yes" : "no"}` }); }

  // The fee keeps the currency the agreement was issued in. If the workspace's currency has changed since, a number
  // typed now would mean something else, so the fee is not changed here.
  let dealEdit: DealEdit = { startDate: edit.startDate, endDate: edit.endDate, addTerms: edit.addTerms, removeTerms: edit.removeTerms, replaceTerms: edit.replaceTerms };
  if (edit.contractValue !== undefined) {
    if (contract.currency !== orgCurrency) return fail(409, "currency_changed", `This agreement was issued in ${contract.currency} and your workspace now uses ${orgCurrency}, so its fee can't be changed from here.`);
    dealEdit = { ...dealEdit, dealAmount: edit.contractValue };
  }
  const startDate = edit.startDate, endDate = edit.endDate;
  const hasDealPart = Object.values(dealEdit).some((v) => v !== undefined);
  let dealUpdates: Partial<Deal> = {};
  if (hasDealPart) {
    const plan = planFields(deal, dealEdit, orgCurrency, locale);
    if (plan.ok) {
      dealUpdates = plan.updates;
      lines.push(...plan.lines);
      if (plan.updates.dealAmountMinor !== undefined) contractUpdates.contractValueMinor = plan.updates.dealAmountMinor;
      if (startDate && plan.updates.startDate !== undefined) contractUpdates.startDate = startDate;
      if (endDate && plan.updates.endDate !== undefined) contractUpdates.endDate = endDate;
    } else if (plan.code !== "no_change") {
      return plan; // a real problem; "nothing changed on the deal" is fine when the agreement's own fields changed
    }
  }
  if (!lines.length) return fail(400, "no_change", "That's already how the agreement is set up, so there's nothing to change.");
  return { ok: true, contract, deal, contractUpdates: contractUpdates as Partial<Contract>, dealUpdates, lines, linkActive: !!contract.clientShareToken && !contract.clientShareRevokedAt };
}

export async function applyAgreementRevision(user: Who, dealId: number, raw: unknown): Promise<Result<{ contract: Contract; route: string; linkRevoked: boolean }>> {
  const plan = await planAgreementRevision(user, dealId, raw);
  if (!plan.ok) return plan;
  const now = new Date();
  const updated = await storage.updateContract(plan.contract.id, {
    ...plan.contractUpdates,
    // The issuer's own signature stays; it is re-dated to the moment they confirmed the revised terms.
    signedByInfluencerDate: now.toISOString(),
    ...(plan.linkActive ? { clientShareRevokedAt: now } : {}),
  });
  if (!updated) return fail(500, "failed", "Couldn't update the agreement.");
  if (Object.keys(plan.dealUpdates).length) await storage.updateDeal(dealId, plan.dealUpdates);
  await reviseDraftQuote(dealId);
  logOrgActivity(asUser(user), "revised", "agreement", updated.id, `Agreement revised: ${updated.brandName} — ${plan.lines.map((l) => l.label).join(", ")} (via Agent)`);
  return { ok: true, contract: updated, route: `/contracts/${updated.id}`, linkRevoked: plan.linkActive };
}
