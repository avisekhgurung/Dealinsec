/**
 * The ideal client: saving it and comparing a lead with it. The REST routes and
 * the agent's tools both call these functions. Permissions follow the lead
 * pipeline (read = whoever may read deals, change = whoever may change leads).
 */
import { formatMoney } from "@shared/money";
import { EMPTY_IDEAL_CLIENT, assessFit, idealClientInputSchema, sizeWanted, type FitResult, type IdealClient } from "@shared/fit";
import { MAX_AMOUNT_MINOR, resolveLocaleSettings, toMinor } from "@shared/schema";
import { leadsStore } from "../leads/store";
import { relatedKnowledge, type RelatedNote } from "./knowledge";
import { profileStore } from "../leads/profile-store";
import { storage } from "../storage";
import { fail, firstIssue, orgCurrency, readGate, writeGate, type Result, type Who } from "./leads";

const toIdeal = (r: Awaited<ReturnType<typeof profileStore.get>>): IdealClient =>
  r ? {
    about: r.about, services: r.services ?? [], targetIndustries: r.targetIndustries ?? [], targetLocations: r.targetLocations ?? [],
    exclusions: r.exclusions ?? [], minEmployees: r.minEmployees ?? null, maxEmployees: r.maxEmployees ?? null,
    minDealMinor: r.minDealMinor, currency: r.currency,
  } : EMPTY_IDEAL_CLIENT;

export async function getIdealClient(user: Who): Promise<Result<{ profile: IdealClient; isSet: boolean; /** When the profile was last saved: lets a caller tell whether a draft predates the current criteria. */ updatedAt: Date | null }>> {
  const gate = readGate(user);
  if (gate) return gate;
  const row = await profileStore.get(user.organizationId!);
  return { ok: true, profile: toIdeal(row), isSet: !!row, updatedAt: row?.updatedAt ?? null };
}

const LABELS: Record<string, string> = {
  about: "About you", services: "Services", targetIndustries: "Target industries", targetLocations: "Target locations", exclusions: "Exclusions",
  minEmployees: "Company size", minDealMinor: "Minimum deal",
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
  for (const k of ["minEmployees", "maxEmployees"] as const) if (input[k] !== undefined) after[k] = input[k] ?? null;
  // The schema checks the pair when both arrive together; this catches one sent on its own against the saved other.
  if (after.minEmployees !== null && after.maxEmployees !== null && after.minEmployees > after.maxEmployees) {
    return fail(400, "invalid", "The smallest company size must not be bigger than the largest.");
  }
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
    if (k === "minEmployees") return sizeWanted(v.minEmployees, v.maxEmployees) || "not set";
    const x = v[k];
    return Array.isArray(x) ? (x.length ? x.join(", ") : "not set") : x ? String(x) : "not set";
  };
  // Company size is two columns but one thing to the person, so it is shown as one line keyed on minEmployees.
  const changed = (k: keyof IdealClient) => JSON.stringify(before[k]) !== JSON.stringify(after[k]);
  const changes = (["about", "services", "targetIndustries", "targetLocations", "exclusions", "minEmployees", "minDealMinor"] as const)
    .filter((k) => (k === "minEmployees" ? changed("minEmployees") || changed("maxEmployees") : changed(k)))
    .map((k) => ({ field: k, label: LABELS[k], from: show(k, before), to: show(k, after) }));
  if (!changes.length) return fail(400, "no_change", "That's already how your ideal client is set.");
  return { ok: true, before, after, changes };
}

export async function saveIdealClient(user: Who, raw: unknown): Promise<Result<{ profile: IdealClient; changes: { field: string; label: string; from: string; to: string }[] }>> {
  const plan = await planIdealClient(user, raw);
  if (!plan.ok) return plan;
  const a = plan.after;
  await profileStore.save(user.organizationId!, {
    about: a.about, services: a.services, targetIndustries: a.targetIndustries, targetLocations: a.targetLocations, exclusions: a.exclusions,
    minEmployees: a.minEmployees, maxEmployees: a.maxEmployees, minDealMinor: a.minDealMinor, currency: a.currency,
  }, user.id);
  return { ok: true, profile: a, changes: plan.changes };
}

/**
 * How this lead compares with the workspace's ideal client. The verdict is the rule in shared/fit.ts, never a model's
 * opinion, and it reads the lead's CONFIRMED facts (the ones with evidence) as more of the company's own words: that is
 * where a stated headcount comes from, and what an exclusion is compared against. An inferred guess never counts.
 *
 * `claims` is for callers that already hold them (server/services/sales.ts), so one request doesn't read them twice.
 * `profileUpdatedAt` lets a caller tell whether a draft was written before the profile was last changed.
 */
export async function assessLeadFit(user: Who, leadId: number, opts: { claims?: { field: string; value: string; status: string }[] } = {}): Promise<Result<{ fit: FitResult; profileSet: boolean; profileUpdatedAt: Date | null; notes: RelatedNote[] }>> {
  const gate = readGate(user);
  if (gate) return gate;
  const orgId = user.organizationId!;
  const lead = opts.claims ? await leadsStore.get(orgId, leadId) : (await leadsStore.detail(orgId, leadId))?.lead ?? null;
  if (!lead) return fail(404, "not_found", "That lead isn't in your organization.");
  const claims = opts.claims ?? (await leadsStore.detail(orgId, leadId))?.claims ?? [];
  const verified = claims.filter((c) => c.status === "confirmed").map((c) => ({ field: c.field, value: c.value }));
  const [row, org] = await Promise.all([profileStore.get(orgId), storage.getOrganization(orgId)]);
  const locale = resolveLocaleSettings(org, user as any).locale;
  const fit = assessFit(toIdeal(row), { ...lead, claims: verified }, (m, c) => formatMoney(m, c, locale));
  // Context, not a score: what the user has written about the same things. The verdict above never depends on it.
  const notes = await relatedKnowledge(user, [lead.companyName, lead.industry, lead.location, lead.fitSummary].filter(Boolean).join(" "));
  return { ok: true, fit, profileSet: !!row, profileUpdatedAt: row?.updatedAt ?? null, notes };
}
