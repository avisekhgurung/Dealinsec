import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseDataset } from "./schema";
import { buildWorld, resolveRefs, snapshotWorld } from "./seed";

const dir = path.dirname(new URL(import.meta.url).pathname);
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

describe.each(files)("dataset %s", (file) => {
  const ds = parseDataset(JSON.parse(readFileSync(path.join(dir, file), "utf8")));

  it("passes the schema, with unique ids and a version", () => {
    expect(ds.version).toBeTruthy();
    expect(new Set(ds.cases.map((c) => c.id)).size).toBe(ds.cases.length);
  });

  it("every case seeds a world and every placeholder resolves", () => {
    for (const c of ds.cases) {
      const { refs } = buildWorld(c.world);
      expect(() => resolveRefs({ turns: c.turns, expect: c.expect }, refs), c.id).not.toThrow();
    }
  });

  it("every regular expression compiles", () => {
    for (const c of ds.cases) {
      for (const e of c.expect) if ("pattern" in e) expect(() => new RegExp(e.pattern, e.flags), `${c.id}: ${e.pattern}`).not.toThrow();
    }
  });

  it("every case asserts something about SAFETY, so none can pass on behaviour alone", () => {
    for (const c of ds.cases.filter((x) => !x.tags.includes("chat"))) {
      const safe = c.expect.some((e) => e.safety === true || ["noExecutedMutation", "worldUnchanged", "noEmailsSent", "noUnconfirmedClaim", "noInventedFields"].includes(e.type));
      expect(safe, c.id).toBe(true);
    }
  });
});

describe("seeding", () => {
  it("places foreign records in another organization and snapshots detect changes", () => {
    const { world, refs } = buildWorld({
      audience: "brand_collaboration", plan: "free", autonomy: 0,
      deals: [{ ref: "a", brandName: "A", dealTitle: "T", amountMinor: 100, status: "Pending" }],
      quotes: [], contracts: [], invoices: [], leads: [], foreignLeads: [],
      foreignDeals: [{ ref: "f", brandName: "Rival", dealTitle: "X" }],
    });
    expect(world.deals.find((d) => d.id === refs.deal.f)!.organizationId).toBe("org-2");
    expect(world.billing.get("org-1")).toMatchObject({ plan: "free" });
    const before = snapshotWorld(world);
    world.deals[0].dealAmountMinor = 999;
    expect(snapshotWorld(world)).not.toBe(before);
  });
  it("an unknown placeholder fails loudly", () => {
    expect(() => resolveRefs("{{deal.nope}}", { deal: {}, invoice: {}, contract: {}, lead: {}, prospect: {} })).toThrow(/no matching record/);
    // relative dates: always N days from "now", so a case about the future never expires
    const none = { deal: {}, invoice: {}, contract: {}, lead: {}, prospect: {} };
    const at = new Date("2026-10-10T18:00:00Z");
    expect(resolveRefs("on {{date+14}} or {{date-1}}", none, at)).toBe("on 2026-10-24 or 2026-10-09");
    expect(resolveRefs({ a: ["{{date+0}}"] }, none, at)).toEqual({ a: ["2026-10-10"] });
    // no fixed calendar date in a case's turns may already be in the past (that is how a case silently changes meaning)
    for (const f of files) {
      const ds = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
      for (const c of ds.cases) for (const t of c.turns as string[]) for (const m of t.match(/\b20\d\d-\d\d-\d\d\b/g) ?? []) expect(m >= new Date().toISOString().slice(0, 10), `${f} ${c.id}: "${m}" is in the past`).toBe(true);
    }
  });
});
