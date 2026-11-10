/**
 * Client profiles, the rules: who may read and change them, that a workspace only ever sees its own, the cap, names,
 * the one default, and that a profile becomes a search without spending anything. In-memory store; no database.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { MAX_ACQUISITION_PROFILES, type AcquisitionProfileInput } from "@shared/acquisition-profile";
import type { AcquisitionProfileRow } from "@shared/schema";

vi.mock("../db", () => ({ db: {} }));

let svc: typeof import("./service");
let NameTaken: typeof import("./store").NameTaken;
beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgresql://unused:unused@localhost:5432/unused";
  svc = await import("./service");
  ({ NameTaken } = await import("./store"));
}, 60_000); // the service pulls in the leads rules, a large import on a busy machine

const NOW = new Date("2026-11-10T12:00:00Z");
const ana = { id: "ana", organizationId: "org-a", memberStatus: "active", orgRole: "SALES" } as any;
const bob = { id: "bob", organizationId: "org-b", memberStatus: "active", orgRole: "SALES" } as any;
const viewer = { id: "vic", organizationId: "org-a", memberStatus: "active", orgRole: "VIEWER" } as any;

function memory() {
  const rows: AcquisitionProfileRow[] = [];
  let seq = 0;
  const cols = (p: AcquisitionProfileInput) => ({ ...p, nameKey: p.name.toLowerCase() });
  const clash = (orgId: string, key: string, except?: number) => rows.some((r) => r.organizationId === orgId && r.nameKey === key && r.id !== except);
  const store = {
    list: async (orgId: string) => rows.filter((r) => r.organizationId === orgId),
    get: async (orgId: string, id: number) => rows.find((r) => r.organizationId === orgId && r.id === id) ?? null,
    create: async (orgId: string, userId: string, p: AcquisitionProfileInput, now: Date, max: number) => {
      if (rows.filter((r) => r.organizationId === orgId).length >= max) return null;
      if (clash(orgId, p.name.toLowerCase())) throw new NameTaken();
      const row = { id: ++seq, organizationId: orgId, createdByUser: userId, ...cols(p), isDefault: false, createdAt: now, updatedAt: now } as unknown as AcquisitionProfileRow;
      rows.push(row); return row;
    },
    update: async (orgId: string, id: number, p: AcquisitionProfileInput, now: Date) => {
      const r = rows.find((x) => x.organizationId === orgId && x.id === id);
      if (!r) return null;
      if (clash(orgId, p.name.toLowerCase(), id)) throw new NameTaken();
      Object.assign(r, cols(p), { updatedAt: now }); return r;
    },
    setDefault: async (orgId: string, id: number, on: boolean, now: Date) => {
      const r = rows.find((x) => x.organizationId === orgId && x.id === id);
      if (!r) return null;
      for (const x of rows) if (x.organizationId === orgId) x.isDefault = false;
      r.isDefault = on; r.updatedAt = now; return r;
    },
    remove: async (orgId: string, id: number) => { const i = rows.findIndex((x) => x.organizationId === orgId && x.id === id); if (i < 0) return false; rows.splice(i, 1); return true; },
  };
  return { rows, deps: { store, ready: async () => true, now: () => NOW, savedServices: async (orgId: string) => (orgId === "org-a" ? ["SEO", "  Paid   ads "] : []) } };
}
const body = (over: Record<string, unknown> = {}) => ({ name: "Brands", industries: ["D2C brand", "edtech company"], countries: ["IN"], ...over });

describe("saving a profile", () => {
  it("creates one for the caller's workspace, as validated", async () => {
    const m = memory();
    const r: any = await svc.createProfile(ana, body({ signals: ["FUNDING"], requirements: ["wanted_signal"], roles: ["CMO"] }), m.deps);
    expect(r).toMatchObject({ ok: true, profile: { id: 1, name: "Brands", kind: "custom", industries: ["D2C brand", "edtech company"], countries: ["IN"], signals: ["FUNDING"], requirements: ["wanted_signal"], roles: ["CMO"], isDefault: false } });
    expect(m.rows[0]).toMatchObject({ organizationId: "org-a", createdByUser: "ana" });
  });
  it("says what is wrong in plain words and saves nothing", async () => {
    const m = memory();
    expect(await svc.createProfile(ana, { name: "x", industries: [] }, m.deps)).toMatchObject({ ok: false, status: 400, code: "invalid", message: "Add at least one kind of company to look for." });
    expect(await svc.createProfile(ana, body({ employeeMin: 9, employeeMax: 2 }), m.deps)).toMatchObject({ ok: false, status: 400 });
    expect(await svc.createProfile(ana, null, m.deps)).toMatchObject({ ok: false, status: 400 });
    expect(m.rows).toEqual([]);
  });
  it("one profile per name in a workspace, whatever the capitals; another workspace may use the same name", async () => {
    const m = memory();
    await svc.createProfile(ana, body(), m.deps);
    expect(await svc.createProfile(ana, body({ name: "BRANDS" }), m.deps)).toMatchObject({ ok: false, status: 409, code: "name_taken" });
    expect(await svc.createProfile(bob, body(), m.deps)).toMatchObject({ ok: true });
  });
  it("stops at the cap, and the cap is per workspace", async () => {
    const m = memory();
    for (let i = 0; i < MAX_ACQUISITION_PROFILES; i++) expect((await svc.createProfile(ana, body({ name: `P${i}` }), m.deps)).ok).toBe(true);
    expect(await svc.createProfile(ana, body({ name: "one more" }), m.deps)).toMatchObject({ ok: false, status: 409, code: "too_many" });
    expect((await svc.createProfile(bob, body(), m.deps)).ok).toBe(true);
  });
});

describe("who may do what", () => {
  it("a viewer reads and cannot change; someone with no workspace does neither", async () => {
    const m = memory();
    await svc.createProfile(ana, body(), m.deps);
    expect(await svc.listProfiles(viewer, m.deps)).toMatchObject({ ok: true, profiles: [{ name: "Brands" }] });
    for (const r of [await svc.createProfile(viewer, body({ name: "V" }), m.deps), await svc.updateProfile(viewer, 1, { name: "V" }, m.deps), await svc.duplicateProfile(viewer, 1, m.deps), await svc.deleteProfile(viewer, 1, m.deps), await svc.searchFromProfile(viewer, 1, {}, m.deps), await svc.createFromTemplate(viewer, { kind: "freelancer" }, m.deps)])
      expect(r).toMatchObject({ ok: false, status: 403 });
    expect(await svc.listProfiles({ id: "x", organizationId: null } as any, m.deps)).toMatchObject({ ok: false, status: 403, code: "no_organization" });
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0].name).toBe("Brands");
  });
  it("a workspace never sees, changes, copies, searches from or deletes another workspace's profile", async () => {
    const m = memory();
    await svc.createProfile(ana, body(), m.deps);
    expect(await svc.listProfiles(bob, m.deps)).toMatchObject({ ok: true, profiles: [] });
    for (const r of [await svc.updateProfile(bob, 1, { name: "Mine now" }, m.deps), await svc.updateProfile(bob, 1, { isDefault: true }, m.deps), await svc.duplicateProfile(bob, 1, m.deps), await svc.searchFromProfile(bob, 1, {}, m.deps), await svc.deleteProfile(bob, 1, m.deps)])
      expect(r).toMatchObject({ ok: false, status: 404, code: "not_found" });
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0]).toMatchObject({ name: "Brands", organizationId: "org-a", isDefault: false });
  });
  it("on a server without the table it says so, and touches nothing", async () => {
    const m = memory();
    for (const ready of [async () => false, async () => { throw new Error("db down"); }]) {
      const deps = { ...m.deps, ready };
      for (const r of [await svc.listProfiles(ana, deps), await svc.createProfile(ana, body(), deps), await svc.createFromTemplate(ana, { kind: "freelancer" }, deps), await svc.updateProfile(ana, 1, {}, deps), await svc.duplicateProfile(ana, 1, deps), await svc.deleteProfile(ana, 1, deps), await svc.searchFromProfile(ana, 1, {}, deps)])
        expect(r).toMatchObject({ ok: false, status: 503, code: "PROFILES_NOT_SETUP" });
    }
    expect(m.rows).toEqual([]);
  });
});

describe("changing a profile", () => {
  it("a partial edit keeps the rest, and the whole profile is checked again", async () => {
    const m = memory();
    await svc.createProfile(ana, body({ signals: ["FUNDING"], requirements: ["wanted_signal"], employeeMin: 5, employeeMax: 50 }), m.deps);
    expect(await svc.updateProfile(ana, 1, { roles: ["Founder"] }, m.deps)).toMatchObject({ ok: true, profile: { name: "Brands", roles: ["Founder"], signals: ["FUNDING"], employeeMax: 50 } });
    // Each of these is fine alone and wrong with what is already saved.
    expect(await svc.updateProfile(ana, 1, { signals: [] }, m.deps)).toMatchObject({ ok: false, status: 400 });
    expect(await svc.updateProfile(ana, 1, { employeeMin: 80 }, m.deps)).toMatchObject({ ok: false, status: 400 });
    expect(m.rows[0]).toMatchObject({ signals: ["FUNDING"], employeeMin: 5 });
  });
  it("renaming onto another profile's name is refused; keeping its own name is not", async () => {
    const m = memory();
    await svc.createProfile(ana, body(), m.deps);
    await svc.createProfile(ana, body({ name: "Startups" }), m.deps);
    expect(await svc.updateProfile(ana, 2, { name: "brands" }, m.deps)).toMatchObject({ ok: false, status: 409, code: "name_taken" });
    expect(await svc.updateProfile(ana, 2, { name: "Startups", roles: ["CTO"] }, m.deps)).toMatchObject({ ok: true });
  });
  it("a workspace has at most one default, and it can be cleared", async () => {
    const m = memory();
    await svc.createProfile(ana, body(), m.deps);
    await svc.createProfile(ana, body({ name: "Startups" }), m.deps);
    await svc.createProfile(bob, body(), m.deps);
    await svc.updateProfile(bob, 3, { isDefault: true }, m.deps);
    await svc.updateProfile(ana, 1, { isDefault: true }, m.deps);
    expect(await svc.updateProfile(ana, 2, { isDefault: true }, m.deps)).toMatchObject({ ok: true, profile: { id: 2, isDefault: true } });
    expect(m.rows.map((r) => r.isDefault)).toEqual([false, true, true]); // the other workspace's default is its own
    await svc.updateProfile(ana, 2, { isDefault: false }, m.deps);
    expect(m.rows.map((r) => r.isDefault)).toEqual([false, false, true]);
  });
  it("a copy gets a free name and is never the default", async () => {
    const m = memory();
    await svc.createProfile(ana, body(), m.deps);
    await svc.updateProfile(ana, 1, { isDefault: true }, m.deps);
    expect(await svc.duplicateProfile(ana, 1, m.deps)).toMatchObject({ ok: true, profile: { name: "Brands (copy)", isDefault: false, industries: ["D2C brand", "edtech company"] } });
    expect(await svc.duplicateProfile(ana, 1, m.deps)).toMatchObject({ ok: true, profile: { name: "Brands (copy 2)" } });
    expect(await svc.duplicateProfile(ana, 2, m.deps)).toMatchObject({ ok: true, profile: { name: "Brands (copy 3)" } });
  });
  it("deleting removes only that profile", async () => {
    const m = memory();
    await svc.createProfile(ana, body(), m.deps);
    await svc.createProfile(ana, body({ name: "Startups" }), m.deps);
    expect(await svc.deleteProfile(ana, 1, m.deps)).toMatchObject({ ok: true, deleted: true });
    expect(await svc.deleteProfile(ana, 1, m.deps)).toMatchObject({ ok: false, status: 404 });
    expect(m.rows.map((r) => r.name)).toEqual(["Startups"]);
  });
});

describe("starting points", () => {
  it("creates the profile for that kind of seller, with the workspace's saved services filled in", async () => {
    const m = memory();
    const r: any = await svc.createFromTemplate(ana, { kind: "marketing_agency" }, m.deps);
    expect(r).toMatchObject({ ok: true, profile: { kind: "marketing_agency", name: "Brands that need growth", services: ["SEO", "Paid ads"], countries: ["IN"] } });
    expect(r.profile.industries.length).toBeGreaterThan(1);
    // A workspace with nothing saved gets none invented.
    expect(await svc.createFromTemplate(bob, { kind: "freelancer" }, m.deps)).toMatchObject({ ok: true, profile: { services: [] } });
  });
  it("using the same starting point twice gives a second profile, not an error", async () => {
    const m = memory();
    await svc.createFromTemplate(ana, { kind: "dev_agency" }, m.deps);
    expect(await svc.createFromTemplate(ana, { kind: "dev_agency" }, m.deps)).toMatchObject({ ok: true, profile: { name: "Companies that need software built (2)" } });
  });
  it("refuses a starting point that doesn't exist", async () => {
    const m = memory();
    for (const kind of ["custom", "nope", undefined]) expect(await svc.createFromTemplate(ana, { kind }, m.deps)).toMatchObject({ ok: false, status: 400 });
    expect(m.rows).toEqual([]);
  });
});

describe("a profile as a search", () => {
  it("gives the search to confirm for the chosen kind of company, naming the profile, and writes nothing", async () => {
    const m = memory();
    await svc.createProfile(ana, body({ services: ["SEO"], signals: ["FUNDING"], requirements: ["decision_maker"], locations: ["Pune"] }), m.deps);
    const before = JSON.stringify(m.rows);
    const r: any = await svc.searchFromProfile(ana, 1, { industry: "edtech company" }, m.deps);
    expect(r).toMatchObject({ ok: true, source: "profile", icp: { industry: "edtech company", countries: ["IN"], locations: ["Pune"], services: ["SEO"], signals: ["FUNDING"], requirements: ["decision_maker"], profile: { id: 1, name: "Brands" } } });
    expect(r.searches.length).toBeGreaterThan(0);
    expect(r.description).toContain("edtech company");
    expect(JSON.stringify(m.rows)).toBe(before);
    expect((await svc.searchFromProfile(ana, 1, {}, m.deps) as any).icp.industry).toBe("D2C brand");
    expect((await svc.searchFromProfile(ana, 1, { industry: 42 }, m.deps) as any).icp.industry).toBe("D2C brand");
  });
  it("a stored value this version doesn't know is dropped when read, never passed on", async () => {
    const m = memory();
    await svc.createProfile(ana, body(), m.deps);
    Object.assign(m.rows[0], { signals: ["FUNDING", "MADE_UP"], requirements: "oops", kind: "wizard", outreach: { channels: ["pigeon"] } });
    expect(await svc.listProfiles(ana, m.deps)).toMatchObject({ ok: true, profiles: [{ signals: ["FUNDING"], requirements: [], kind: "custom", outreach: { channels: ["email"], tone: "friendly" } }] });
  });
});
