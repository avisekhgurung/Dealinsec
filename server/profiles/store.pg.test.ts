/**
 * The client-profile store against a REAL Postgres: what a fake can't prove — the cap under concurrency, one profile
 * per name, one default per workspace, and workspace isolation in SQL.
 *
 * Runs only with MAILBOX_PG_TEST_URL set to a disposable LOCAL database with the table
 * (script/migrate-acquisition-profiles.ts). Fresh organization ids per case; only their rows are deleted.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acquisitionProfileSchema } from "@shared/acquisition-profile";

const URL_ = process.env.MAILBOX_PG_TEST_URL;
const loopback = (u?: string) => { try { return !!u && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(u).hostname); } catch { return false; } };

describe.skipIf(!URL_ || !loopback(URL_))("client-profile store (real Postgres)", () => {
  let q: any;
  let mod: typeof import("./store");
  const orgs: string[] = [];
  const org = () => { const o = `t-${randomBytes(5).toString("hex")}`; orgs.push(o); return o; };
  const NOW = new Date("2026-11-10T12:00:00Z");
  const input = (name: string, over: Record<string, unknown> = {}) => acquisitionProfileSchema.parse({ name, industries: ["D2C brand"], countries: ["IN"], ...over });
  beforeAll(async () => {
    process.env.DATABASE_URL = URL_!;
    mod = await import("./store");
    const { default: pg } = await import("pg");
    q = new pg.Client({ connectionString: URL_ }); await q.connect();
  });
  afterAll(async () => {
    for (const o of orgs) await q.query(`DELETE FROM acquisition_profiles WHERE organization_id = $1`, [o]).catch(() => {});
    await q?.end();
  });

  it("the table check says the table is there", async () => { expect(await mod.profilesTableReady()).toBe(true); });

  it("twelve saves at once against a cap of 3 keep exactly 3", async () => {
    const o = org();
    const out = await Promise.all(Array.from({ length: 12 }, (_, i) => mod.acquisitionProfileStore.create(o, "u", input(`P${i}`), NOW, 3)));
    expect(out.filter(Boolean)).toHaveLength(3);
    expect((await mod.acquisitionProfileStore.list(o))).toHaveLength(3);
  });

  it("stores every field and reads it back as saved", async () => {
    const o = org();
    const p = input("Brands", { services: ["SEO"], keywords: ["online store"], locations: ["Pune"], employeeMin: 5, employeeMax: 200, exclusions: ["gambling"], signals: ["FUNDING", "HIRING"], requirements: ["decision_maker", "wanted_signal"], roles: ["CMO"], kind: "marketing_agency", outreach: { channels: ["email", "whatsapp"], tone: "direct", note: "Mention Shopify" } });
    const row = (await mod.acquisitionProfileStore.create(o, "ana", p, NOW, 20))!;
    expect(row).toMatchObject({ organizationId: o, createdByUser: "ana", name: "Brands", nameKey: "brands", kind: "marketing_agency", services: ["SEO"], industries: ["D2C brand"], keywords: ["online store"], countries: ["IN"], locations: ["Pune"], employeeMin: 5, employeeMax: 200, exclusions: ["gambling"], signals: ["FUNDING", "HIRING"], requirements: ["decision_maker", "wanted_signal"], roles: ["CMO"], outreach: { channels: ["email", "whatsapp"], tone: "direct", note: "Mention Shopify" }, isDefault: false });
    expect(await mod.acquisitionProfileStore.get(o, row.id)).toEqual(row);
  });

  it("one profile per name in a workspace, whatever the capitals, on create and on rename; another workspace is free to use it", async () => {
    const a = org(), b = org();
    const first = (await mod.acquisitionProfileStore.create(a, "u", input("Brands"), NOW, 20))!;
    await expect(mod.acquisitionProfileStore.create(a, "u", input("BRANDS"), NOW, 20)).rejects.toBeInstanceOf(mod.NameTaken);
    const second = (await mod.acquisitionProfileStore.create(a, "u", input("Startups"), NOW, 20))!;
    await expect(mod.acquisitionProfileStore.update(a, second.id, input("brands"), NOW)).rejects.toBeInstanceOf(mod.NameTaken);
    expect((await mod.acquisitionProfileStore.update(a, first.id, input("Brands", { roles: ["CEO"] }), NOW))?.roles).toEqual(["CEO"]);
    expect(await mod.acquisitionProfileStore.create(b, "u", input("Brands"), NOW, 20)).toBeTruthy();
  });

  it("a workspace has one default at most, even when two are set at once", async () => {
    const a = org(), b = org();
    const [p1, p2] = [(await mod.acquisitionProfileStore.create(a, "u", input("One"), NOW, 20))!, (await mod.acquisitionProfileStore.create(a, "u", input("Two"), NOW, 20))!];
    const other = (await mod.acquisitionProfileStore.create(b, "u", input("One"), NOW, 20))!;
    await mod.acquisitionProfileStore.setDefault(b, other.id, true, NOW);
    await mod.acquisitionProfileStore.setDefault(a, p1.id, true, NOW);
    await Promise.allSettled([mod.acquisitionProfileStore.setDefault(a, p1.id, true, NOW), mod.acquisitionProfileStore.setDefault(a, p2.id, true, NOW)]);
    expect((await mod.acquisitionProfileStore.list(a)).filter((r) => r.isDefault)).toHaveLength(1);
    expect((await mod.acquisitionProfileStore.get(b, other.id))?.isDefault).toBe(true); // the other workspace's default is its own
    const cur = (await mod.acquisitionProfileStore.list(a)).find((r) => r.isDefault)!;
    await mod.acquisitionProfileStore.setDefault(a, cur.id, false, NOW);
    expect((await mod.acquisitionProfileStore.list(a)).filter((r) => r.isDefault)).toHaveLength(0);
  });

  it("another workspace's profile can't be read, changed, made default or deleted", async () => {
    const a = org(), b = org();
    const row = (await mod.acquisitionProfileStore.create(a, "u", input("Mine"), NOW, 20))!;
    expect(await mod.acquisitionProfileStore.get(b, row.id)).toBeNull();
    expect(await mod.acquisitionProfileStore.list(b)).toEqual([]);
    expect(await mod.acquisitionProfileStore.update(b, row.id, input("Stolen"), NOW)).toBeNull();
    expect(await mod.acquisitionProfileStore.setDefault(b, row.id, true, NOW)).toBeNull();
    expect(await mod.acquisitionProfileStore.remove(b, row.id)).toBe(false);
    expect(await mod.acquisitionProfileStore.get(a, row.id)).toMatchObject({ name: "Mine", isDefault: false });
    expect(await mod.acquisitionProfileStore.remove(a, row.id)).toBe(true);
    expect(await mod.acquisitionProfileStore.get(a, row.id)).toBeNull();
  });
});
