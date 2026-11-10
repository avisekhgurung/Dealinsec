/**
 * Client profiles: the rules. The HTTP routes call these; nothing else writes the table.
 *
 *  - Reading follows Client Radar (whoever may see prospects may see the profiles they are found with); changing one
 *    needs the same permission as starting a search. A viewer reads and cannot change.
 *  - Every call is for the caller's own workspace. A profile in another workspace is "not found", never "forbidden".
 *  - What is stored is what shared/acquisition-profile.ts validated: nothing a profile holds is ever sent anywhere by
 *    saving it. No model call, no search, no allowance is spent here.
 *  - A workspace keeps at most MAX_ACQUISITION_PROFILES, on every plan. That is a guard against runaway rows, not a
 *    paywall: the plan limits what a SEARCH may do, and a profile costs nothing until one starts.
 *  - On a database without the table the feature answers 503 PROFILES_NOT_SETUP and nothing else is affected.
 */
import { acquisitionProfileSchema, DEFAULT_OUTREACH, icpFromProfile, MAX_ACQUISITION_PROFILES, outreachPrefsSchema, PROFILE_KINDS, templateFor, type AcquisitionProfile, type AcquisitionProfileInput, type ProfileKind } from "@shared/acquisition-profile";
import { describeIcp, searchStrategies, type Icp } from "@shared/icp";
import { REQUIREMENT_KEYS, WANTED_SIGNALS } from "@shared/profile-keys";
import type { AcquisitionProfileRow } from "@shared/schema";
import { fail, firstIssue, readGate, writeGate, type Result, type Who } from "../services/leads";
import { acquisitionProfileStore, NameTaken, profilesTableReady, type AcquisitionProfileStore } from "./store";

export interface ProfileDeps {
  store: AcquisitionProfileStore;
  ready: () => Promise<boolean>;
  now: () => Date;
  /** The services saved in Settings (the workspace's ideal client), used to pre-fill a template. Never required. */
  savedServices: (orgId: string) => Promise<string[]>;
}
const defaults = (): ProfileDeps => ({
  store: acquisitionProfileStore, ready: profilesTableReady, now: () => new Date(),
  savedServices: async (orgId) => {
    try { const { profileStore, profileTableReady } = await import("../leads/profile-store"); return (await profileTableReady()) ? ((await profileStore.get(orgId))?.services ?? []) : []; }
    catch { return []; }
  },
});

const NOT_SETUP = () => fail(503, "PROFILES_NOT_SETUP", "Saved client profiles aren't set up on this server yet.");
const NOT_FOUND = () => fail(404, "not_found", "That profile isn't in your workspace.");
const isReady = async (d: ProfileDeps) => { try { return await d.ready(); } catch { return false; } };

const strs = (v: unknown, allowed?: readonly string[]): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && (!allowed || allowed.includes(x))) : []);

/** A stored row as the app shows it. Read defensively: a value this version no longer knows is dropped, never passed on. */
export function profileView(r: AcquisitionProfileRow): AcquisitionProfile {
  const outreach = outreachPrefsSchema.safeParse(r.outreach ?? {});
  return {
    id: r.id, name: r.name, kind: ((PROFILE_KINDS as readonly string[]).includes(r.kind) ? r.kind : "custom") as ProfileKind,
    services: strs(r.services), industries: strs(r.industries), keywords: strs(r.keywords), countries: strs(r.countries), locations: strs(r.locations),
    employeeMin: r.employeeMin ?? null, employeeMax: r.employeeMax ?? null, exclusions: strs(r.exclusions),
    signals: strs(r.signals, WANTED_SIGNALS) as AcquisitionProfile["signals"], requirements: strs(r.requirements, REQUIREMENT_KEYS) as AcquisitionProfile["requirements"],
    roles: strs(r.roles), outreach: outreach.success ? outreach.data : DEFAULT_OUTREACH, isDefault: r.isDefault,
    createdAt: new Date(r.createdAt).toISOString(), updatedAt: new Date(r.updatedAt).toISOString(),
  };
}
const inputOf = (v: AcquisitionProfile): AcquisitionProfileInput => {
  const { id: _id, isDefault: _d, createdAt: _c, updatedAt: _u, ...rest } = v;
  return rest;
};

export async function listProfiles(user: Who, d: Partial<ProfileDeps> = {}): Promise<Result<{ profiles: AcquisitionProfile[]; max: number }>> {
  const deps = { ...defaults(), ...d };
  const gate = readGate(user);
  if (gate) return gate;
  if (!(await isReady(deps))) return NOT_SETUP();
  return { ok: true, profiles: (await deps.store.list(user.organizationId!)).map(profileView), max: MAX_ACQUISITION_PROFILES };
}

export async function createProfile(user: Who, raw: unknown, d: Partial<ProfileDeps> = {}): Promise<Result<{ profile: AcquisitionProfile }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await isReady(deps))) return NOT_SETUP();
  const parsed = acquisitionProfileSchema.safeParse(raw ?? {});
  if (!parsed.success) return fail(400, "invalid", firstIssue(parsed.error));
  try {
    const row = await deps.store.create(user.organizationId!, user.id, parsed.data, deps.now(), MAX_ACQUISITION_PROFILES);
    if (!row) return fail(409, "too_many", `A workspace can keep ${MAX_ACQUISITION_PROFILES} client profiles. Delete one first.`);
    return { ok: true, profile: profileView(row) };
  } catch (e) {
    if (e instanceof NameTaken) return fail(409, "name_taken", "You already have a profile with that name. Give this one a different name.");
    throw e;
  }
}

/** A new profile from one of the built-in starting points, with the services saved in Settings filled in. Named so it never collides. */
export async function createFromTemplate(user: Who, raw: unknown, d: Partial<ProfileDeps> = {}): Promise<Result<{ profile: AcquisitionProfile }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await isReady(deps))) return NOT_SETUP();
  const t = templateFor(String((raw as { kind?: unknown })?.kind ?? ""));
  if (!t) return fail(400, "invalid", "Choose one of the starting points.");
  const orgId = user.organizationId!;
  const taken = new Set((await deps.store.list(orgId)).map((r) => r.nameKey));
  let name = t.profile.name;
  for (let n = 2; taken.has(name.toLowerCase()) && n < 100; n++) name = `${t.profile.name} (${n})`;
  const services = (await deps.savedServices(orgId)).map((s) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 60)).filter(Boolean).slice(0, 6);
  return createProfile(user, { ...t.profile, name, services }, deps);
}

export async function updateProfile(user: Who, id: number, raw: unknown, d: Partial<ProfileDeps> = {}): Promise<Result<{ profile: AcquisitionProfile }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await isReady(deps))) return NOT_SETUP();
  const orgId = user.organizationId!;
  const cur = await deps.store.get(orgId, id);
  if (!cur) return NOT_FOUND();
  // A partial edit is merged onto what is saved and the WHOLE profile is validated again, so two fields that are each
  // fine but wrong together (a size range, a requirement with no signal) can't be saved one request at a time.
  const body = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const { isDefault, ...fields } = body;
  const parsed = acquisitionProfileSchema.safeParse({ ...inputOf(profileView(cur)), ...fields });
  if (!parsed.success) return fail(400, "invalid", firstIssue(parsed.error));
  try {
    let row = await deps.store.update(orgId, id, parsed.data, deps.now());
    if (row && typeof isDefault === "boolean" && isDefault !== row.isDefault) row = await deps.store.setDefault(orgId, id, isDefault, deps.now());
    return row ? { ok: true, profile: profileView(row) } : NOT_FOUND();
  } catch (e) {
    if (e instanceof NameTaken) return fail(409, "name_taken", "You already have a profile with that name. Give this one a different name.");
    throw e;
  }
}

export async function duplicateProfile(user: Who, id: number, d: Partial<ProfileDeps> = {}): Promise<Result<{ profile: AcquisitionProfile }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await isReady(deps))) return NOT_SETUP();
  const orgId = user.organizationId!;
  const cur = await deps.store.get(orgId, id);
  if (!cur) return NOT_FOUND();
  const taken = new Set((await deps.store.list(orgId)).map((r) => r.nameKey));
  const base = cur.name.replace(/ \(copy(?: \d+)?\)$/i, "").slice(0, 68);
  let name = `${base} (copy)`;
  for (let n = 2; taken.has(name.toLowerCase()) && n < 100; n++) name = `${base} (copy ${n})`;
  return createProfile(user, { ...inputOf(profileView(cur)), name }, deps);
}

export async function deleteProfile(user: Who, id: number, d: Partial<ProfileDeps> = {}): Promise<Result<{ deleted: true }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await isReady(deps))) return NOT_SETUP();
  // Searches started from it keep their own copy of what they looked for, so nothing else changes.
  return (await deps.store.remove(user.organizationId!, id)) ? { ok: true, deleted: true } : NOT_FOUND();
}

/**
 * The search a profile would start, for one of its kinds of company: the same proposal the person gets after typing a
 * request, built by rules instead of a model. Nothing is searched and no allowance is spent — they still confirm it.
 */
export async function searchFromProfile(user: Who, id: number, raw: unknown, d: Partial<ProfileDeps> = {}): Promise<Result<{ icp: Icp; searches: string[]; description: string; source: "profile" }>> {
  const deps = { ...defaults(), ...d };
  const gate = writeGate(user);
  if (gate) return gate;
  if (!(await isReady(deps))) return NOT_SETUP();
  const cur = await deps.store.get(user.organizationId!, id);
  if (!cur) return NOT_FOUND();
  const icp = icpFromProfile(profileView(cur), typeof (raw as { industry?: unknown })?.industry === "string" ? (raw as { industry: string }).industry : null);
  if (!icp) return fail(422, "not_searchable", "This profile doesn't say what kind of company to look for. Edit it and add one.");
  return { ok: true, icp, searches: searchStrategies(icp), description: describeIcp(icp), source: "profile" };
}
