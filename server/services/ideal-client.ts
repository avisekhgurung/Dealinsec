/**
 * The ideal client: saving it and comparing a lead with it. The REST routes and
 * the agent's tools both call these functions. Permissions follow the lead
 * pipeline (read = whoever may read deals, change = whoever may change leads).
 */
import { formatMoney } from "@shared/money";
import { EMPTY_IDEAL_CLIENT, assessFit, idealClientInputSchema, type FitResult, type IdealClient } from "@shared/fit";
import { MAX_AMOUNT_MINOR, resolveLocaleSettings, toMinor } from "@shared/schema";
import { leadsStore } from "../leads/store";
import { profileStore } from "../leads/profile-store";
import { storage } from "../storage";
import { fail, firstIssue, orgCurrency, readGate, writeGate, type Result, type Who } from "./leads";

const toIdeal = (r: Awaited<ReturnType<typeof profileStore.get>>): IdealClient =>
  r ? { about: r.about, services: r.services ?? [], targetIndustries: r.targetIndustries ?? [], targetLocations: r.targetLocations ?? [], exclusions: r.exclusions ?? [], minDealMinor: r.minDealMinor, currency: r.currency } : EMPTY_IDEAL_CLIENT;

export async function getIdealClient(user: Who): Promise<Result<{ profile: IdealClient; isSet: boolean }>> {
  const gate = readGate(user);
  if (gate) return gate;
  const row = await profileStore.get(user.organizationId!);
  return { ok: true, profile: toIdeal(row), isSet: !!row };
}

const LABELS: Record<string, string> = {
  about: "About you", services: "Services", targetIndustries: "Target industries", targetLocations: "Target locations", exclusions: "Exclusions", minDealMinor: "Minimum deal",
};

/** What saving would change, WITHOUT saving: what a tool shows before asking. Fields left out are kept as they are. */
export async function planIdealClient(user: Who, raw: unknown): Promise<Result<{ before: IdealClient; after: IdealClient; changes: { field: string; label: string; from: string; to: string }[] }>> {
  const gate = writeGate(user);
  if (gate) return gate;
  const parsed = idealClientInputSchema.safeParse(raw);
  if (!parsed.success) return fail(400, "invalid", firstIssue(parsed.error));
  const input = parsed.data;
  const before = toIdeal(await profileStore.get(user.organizationId!));
  const after: IdealClient = { ...before };
  if (input.about !== undefined) after.about = input.about || null;
  for (const k of ["services", "targetIndustries", "targetLocations", "exclusions"] as const) if (input[k] !== undefined) after[k] = input[k]!;
  if (input.minDealMajor !== undefined) {
    if (input.minDealMajor === null) { after.minDealMinor = null; after.currency = before.currency; }
    else {
      const currency = await orgCurrency(user);
      const minor = toMinor(currency === "INR" ? Math.round(input.minDealMajor) : input.minDealMajor, currency);
      if (!Number.isFinite(minor) || minor <= 0 || minor > MAX_AMOUNT_MINOR) return fail(400, "invalid", "That isn't a valid minimum deal size.");
      after.minDealMinor = minor; after.currency = currency;
    }
  }
  const org = await storage.getOrganization(user.organizationId!);
  const locale = resolveLocaleSettings(org, user as any).locale;
  const show = (k: keyof IdealClient, v: IdealClient): string => {
    if (k === "minDealMinor") return v.minDealMinor && v.currency ? formatMoney(v.minDealMinor, v.currency, locale) : "not set";
    const x = v[k];
    return Array.isArray(x) ? (x.length ? x.join(", ") : "not set") : x ? String(x) : "not set";
  };
  const changes = (["about", "services", "targetIndustries", "targetLocations", "exclusions", "minDealMinor"] as const)
    .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map((k) => ({ field: k, label: LABELS[k], from: show(k, before), to: show(k, after) }));
  if (!changes.length) return fail(400, "no_change", "That's already how your ideal client is set.");
  return { ok: true, before, after, changes };
}

export async function saveIdealClient(user: Who, raw: unknown): Promise<Result<{ profile: IdealClient; changes: { field: string; label: string; from: string; to: string }[] }>> {
  const plan = await planIdealClient(user, raw);
  if (!plan.ok) return plan;
  const a = plan.after;
  await profileStore.save(user.organizationId!, { about: a.about, services: a.services, targetIndustries: a.targetIndustries, targetLocations: a.targetLocations, exclusions: a.exclusions, minDealMinor: a.minDealMinor, currency: a.currency }, user.id);
  return { ok: true, profile: a, changes: plan.changes };
}

export async function assessLeadFit(user: Who, leadId: number): Promise<Result<{ fit: FitResult; profileSet: boolean }>> {
  const gate = readGate(user);
  if (gate) return gate;
  const orgId = user.organizationId!;
  const lead = await leadsStore.get(orgId, leadId);
  if (!lead) return fail(404, "not_found", "That lead isn't in your organization.");
  const [row, org] = await Promise.all([profileStore.get(orgId), storage.getOrganization(orgId)]);
  const locale = resolveLocaleSettings(org, user as any).locale;
  const fit = assessFit(toIdeal(row), lead, (m, c) => formatMoney(m, c, locale));
  return { ok: true, fit, profileSet: !!row };
}
