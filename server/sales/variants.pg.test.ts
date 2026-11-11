/**
 * Message versions against a REAL Postgres: the partial unique index (one unsent message per lead) deciding a
 * race between two chooses, the batch insert being all-or-nothing behind the allowance lock, and one batch
 * counting as ONE AI draft.
 *
 * Runs only with OUTREACH_PG_TEST_URL set to a disposable LOCAL database that has the schema (drizzle-kit push),
 * script/migrate-lead-messages.ts and script/migrate-draft-variants.ts applied. Each test uses its own
 * organization id and deletes only its own rows. Never point it at a shared or production database: a
 * non-loopback host is refused.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const URL_ = process.env.OUTREACH_PG_TEST_URL;
const loopback = (u?: string) => { try { return !!u && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(u).hostname); } catch { return false; } };

describe.skipIf(!URL_ || !loopback(URL_))("message versions under the one-unsent-per-lead index (real Postgres)", () => {
  let store: typeof import("./message-store");
  let q: any;
  const orgs: string[] = [];
  beforeAll(async () => {
    process.env.DATABASE_URL = URL_!;
    store = await import("./message-store");
    const { default: P } = await import("pg");
    q = new P.Client({ connectionString: URL_ });
    await q.connect();
  });
  afterAll(async () => {
    for (const o of orgs) for (const t of ["lead_messages", "leads"]) await q.query(`DELETE FROM ${t} WHERE organization_id = $1`, [o]);
    await q?.end();
  });

  const org = () => { const o = `test-${randomUUID()}`; orgs.push(o); return o; };
  const allowance = (max = 10) => ({ since: new Date(Date.now() - 30 * 86_400_000), max, prefix: "draft-" });
  async function seedLead(o: string) {
    // One lead per organization and domain (leads_org_domain_uniq), so each seeded lead gets its own.
    return (await q.query(`INSERT INTO leads (organization_id, owner_user_id, company_name, domain, source, status, do_not_contact, created_at, updated_at) VALUES ($1, 'u1', 'Acme', $2, 'outbound', 'qualified', false, now(), now()) RETURNING id`, [o, `${randomUUID().slice(0, 8)}.acme.test`])).rows[0].id as number;
  }
  const newVariants = (o: string, leadId: number, strategies = ["trigger", "problem", "direct"]) => ({
    orgId: o, leadId, toAddress: "ceo@acme.test", toSource: "site" as const, researchId: null, claimIds: [1, 2],
    by: "user" as const, userId: "u1", now: new Date(), group: randomUUID(), allowance: allowance(),
    variants: strategies.map((s, i) => ({ strategy: s, subject: `s${i}`, body: `body ${s}`, bodyHash: `${i}`.repeat(64), promptVersion: `draft-v6:${s}` })),
  });
  const statuses = async (o: string, leadId: number) =>
    (await q.query(`SELECT status, count(*)::int n FROM lead_messages WHERE organization_id = $1 AND lead_id = $2 GROUP BY status`, [o, leadId])).rows
      .reduce((m: Record<string, number>, r: any) => ({ ...m, [r.status]: r.n }), {});

  it("two people choosing different versions at the same moment: exactly one becomes the draft, the other is told", async () => {
    const o = org(), lead = await seedLead(o);
    const rows = await store.messageStore.createVariants(newVariants(o, lead));
    expect(rows).toHaveLength(3);
    const [a, b] = [rows[0], rows[1]];
    const now = new Date();
    const [ra, rb] = await Promise.all([
      store.messageStore.chooseVariant({ orgId: o, id: a.id, hash: a.bodyHash, now }),
      store.messageStore.chooseVariant({ orgId: o, id: b.id, hash: b.bodyHash, now }),
    ]);
    expect([ra.result, rb.result].sort()).toEqual(["chosen", "conflict"]);
    expect(await statuses(o, lead)).toEqual({ draft: 1, cancelled: 2 });
  });

  it("the index holds even against a draft the guards never saw: choosing then is a conflict, not a second unsent message", async () => {
    const o = org(), lead = await seedLead(o);
    const rows = await store.messageStore.createVariants(newVariants(o, lead));
    // A draft slipped in behind the guards (nothing in the app can do this; the index must still decide).
    await q.query(`INSERT INTO lead_messages (lead_id, organization_id, direction, channel, subject, body, body_hash, to_address, to_source, status, claim_ids, created_by, created_at, updated_at) VALUES ($1, $2, 'out', 'manual', 's', 'b', $3, 'ceo@acme.test', 'site', 'draft', '[]', 'user', now(), now())`, [lead, o, "f".repeat(64)]);
    const r = await store.messageStore.chooseVariant({ orgId: o, id: rows[0].id, hash: rows[0].bodyHash, now: new Date() });
    expect(r.result).toBe("conflict");
    expect((await statuses(o, lead)).draft).toBe(1);
  });

  it("a batch is refused while anything unsent or pending exists, and is all-or-nothing", async () => {
    const o = org(), lead = await seedLead(o);
    await store.messageStore.createVariants(newVariants(o, lead));
    await expect(store.messageStore.createVariants(newVariants(o, lead))).rejects.toThrow(/unsent message/);
    expect((await statuses(o, lead)).variant).toBe(3); // the refused batch wrote nothing
    const lead2 = await seedLead(o);
    await store.messageStore.create({ orgId: o, leadId: lead2, subject: "s", body: "b", bodyHash: "e".repeat(64), toAddress: "x@acme.test", toSource: "lead", researchId: null, claimIds: [], promptVersion: "draft-v6:direct", strategy: "direct", by: "user", userId: "u1", now: new Date(), allowance: allowance() });
    await expect(store.messageStore.createVariants(newVariants(o, lead2))).rejects.toThrow(/unsent message/);
  });

  it("one batch of three counts as ONE AI draft; a single draft still counts as one", async () => {
    const o = org(), lead = await seedLead(o);
    await store.messageStore.createVariants(newVariants(o, lead));
    expect(await store.messageStore.countAiDrafts(o, allowance().since, "draft-")).toBe(1);
    const lead2 = await seedLead(o);
    await store.messageStore.create({ orgId: o, leadId: lead2, subject: "s", body: "b", bodyHash: "e".repeat(64), toAddress: "x@acme.test", toSource: "lead", researchId: null, claimIds: [], promptVersion: "draft-v6:direct", strategy: "direct", by: "user", userId: "u1", now: new Date(), allowance: allowance() });
    expect(await store.messageStore.countAiDrafts(o, allowance().since, "draft-")).toBe(2);
    const lead3 = await seedLead(o);
    await expect(store.messageStore.createVariants({ ...newVariants(o, lead3), allowance: allowance(2) })).rejects.toThrow(/AI drafts/);
    expect((await statuses(o, lead3)).variant).toBeUndefined();
  });

  it("a message the person wrote themselves is stored with no prompt version, is never counted as an AI draft, and still obeys one-unsent-per-lead", async () => {
    const o = org();
    const a = await seedLead(o), b = await seedLead(o);
    const own = (leadId: number) => store.messageStore.create({
      orgId: o, leadId, subject: "Hello from a neighbour", body: "My own words, written by hand.", bodyHash: "a".repeat(64), toAddress: "ceo@acme.test", toSource: "lead",
      researchId: null, claimIds: [], promptVersion: null, by: "user", userId: "u1", now: new Date(),
    });
    const row = await own(a);
    expect(row).toMatchObject({ status: "draft", promptVersion: null, createdBy: "user", edited: false });
    expect(await store.messageStore.countAiDrafts(o, allowance().since, "draft-")).toBe(0);
    await expect(own(a)).rejects.toBeInstanceOf(store.DraftExists);                      // the index decides, as for any draft
    // With the AI allowance at nothing, an AI draft is refused and the person's own still goes in.
    await expect(store.messageStore.create({
      orgId: o, leadId: b, subject: "s", body: "b", bodyHash: "b".repeat(64), toAddress: "ceo@acme.test", toSource: "lead",
      researchId: null, claimIds: [], promptVersion: "draft-v7:direct", by: "user", userId: "u1", now: new Date(), allowance: allowance(0),
    })).rejects.toBeInstanceOf(store.DraftAllowanceReached);
    expect((await own(b)).status).toBe("draft");
    expect(await store.messageStore.countAiDrafts(o, allowance().since, "draft-")).toBe(0);
  });

  it("a stale hash or a cancelled version can't be chosen; the chosen one answers a second click once", async () => {
    const o = org(), lead = await seedLead(o);
    const rows = await store.messageStore.createVariants(newVariants(o, lead));
    expect((await store.messageStore.chooseVariant({ orgId: o, id: rows[0].id, hash: "a".repeat(64), now: new Date() })).result).toBe("changed");
    const chosen = await store.messageStore.chooseVariant({ orgId: o, id: rows[0].id, hash: rows[0].bodyHash, now: new Date() });
    expect(chosen.result).toBe("chosen");
    expect((await store.messageStore.chooseVariant({ orgId: o, id: rows[0].id, hash: rows[0].bodyHash, now: new Date() })).result).toBe("already");
    expect((await store.messageStore.chooseVariant({ orgId: o, id: rows[1].id, hash: rows[1].bodyHash, now: new Date() })).result).toBe("conflict");
  });

  it("cancelVariants discards the pending batch and nothing else", async () => {
    const o = org(), lead = await seedLead(o);
    const rows = await store.messageStore.createVariants(newVariants(o, lead));
    const group = rows[0].variantGroup!;
    expect(await store.messageStore.cancelVariants({ orgId: o, leadId: lead, group, now: new Date() })).toBe(3);
    expect(await statuses(o, lead)).toEqual({ cancelled: 3 });
    expect(await store.messageStore.cancelVariants({ orgId: o, leadId: lead, group, now: new Date() })).toBe(0);
  });
});
