/**
 * The campaign store against a REAL Postgres: the SQL a fake can't prove — the cap and the two claims under
 * concurrency, the joins the numbers come from, holds, relinking, and workspace isolation.
 *
 * Runs only with MAILBOX_PG_TEST_URL set to a disposable LOCAL database with the campaign tables
 * (script/migrate-campaigns.ts) and the outreach tables. Fresh organization ids per case; only their rows are deleted.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const URL_ = process.env.MAILBOX_PG_TEST_URL;
const loopback = (u?: string) => { try { return !!u && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(u).hostname); } catch { return false; } };

describe.skipIf(!URL_ || !loopback(URL_))("campaign store (real Postgres)", () => {
  let q: any;
  let mod: typeof import("./store");
  const orgs: string[] = [];
  const org = () => { const o = `t-${randomBytes(5).toString("hex")}`; orgs.push(o); return o; };
  const NOW = new Date("2026-11-10T12:00:00Z");
  const MIN = 60_000;
  const base = { name: "Diwali", profileId: null, profileName: null, footerNote: "", dailyLimit: 20, gapSeconds: 180 };
  beforeAll(async () => {
    process.env.DATABASE_URL = URL_!;
    mod = await import("./store");
    const { default: pg } = await import("pg");
    q = new pg.Client({ connectionString: URL_ }); await q.connect();
  });
  afterAll(async () => {
    for (const o of orgs) for (const t of ["campaign_members", "campaigns", "outreach_events", "lead_messages", "leads"]) await q.query(`DELETE FROM ${t} WHERE organization_id = $1`, [o]).catch(() => {});
    await q?.end();
  });
  const lead = async (o: string, name: string, over: Record<string, unknown> = {}) => {
    const v = { status: "new", source: "manual", contact_email: `${name.toLowerCase()}@x.example`, do_not_contact: false, industry: null, ...over };
    const r = await q.query(`INSERT INTO leads (organization_id, owner_user_id, company_name, status, source, contact_email, do_not_contact, industry) VALUES ($1, 'u', $2, $3, $4, $5, $6, $7) RETURNING id`, [o, name, v.status, v.source, v.contact_email, v.do_not_contact, v.industry]);
    return Number(r.rows[0].id);
  };
  const message = async (o: string, leadId: number, status: string, over: { body?: string; hash?: string; approvedAt?: Date | null; sentAt?: Date | null } = {}) => {
    const r = await q.query(`INSERT INTO lead_messages (lead_id, organization_id, direction, subject, body, body_hash, to_address, status, approved_at, sent_at, created_at, updated_at) VALUES ($1, $2, 'out', 'Hello', $3, $4, 'a@x.example', $5, $6, $7, $8, $8) RETURNING id`,
      [leadId, o, over.body ?? "Body", over.hash ?? randomBytes(32).toString("hex"), status, over.approvedAt ?? null, over.sentAt ?? null, NOW]);
    return Number(r.rows[0].id);
  };
  const event = (o: string, leadId: number, messageId: number, kind: string) => q.query(`INSERT INTO outreach_events (organization_id, lead_id, message_id, kind, source, created_at) VALUES ($1, $2, $3, $4, 'manual', $5)`, [o, leadId, messageId, kind, NOW]);
  const memberOf = async (campaignId: number, leadId: number) => (await q.query(`SELECT * FROM campaign_members WHERE campaign_id = $1 AND lead_id = $2`, [campaignId, leadId])).rows[0];

  it("the table check says the tables are there", async () => { expect(await mod.campaignTablesReady()).toBe(true); });

  it("creates a campaign with its members in one go, and ten at once against a cap of 2 keep exactly 2", async () => {
    const o = org();
    const l1 = await lead(o, "One"), l2 = await lead(o, "Two");
    const out = await Promise.all(Array.from({ length: 10 }, (_, i) => mod.campaignStore.create(o, "u", { ...base, name: `C${i}` }, [l1, l2], NOW, 2)));
    expect(out.filter(Boolean)).toHaveLength(2);
    const list = await mod.campaignStore.list(o);
    expect(list).toHaveLength(2);
    expect((await mod.campaignStore.members(o, list[0].id)).map((m) => [m.leadId, m.state, m.lead?.companyName, m.message])).toEqual([[l1, "queued", "One", null], [l2, "queued", "Two", null]]);
    // An archived campaign frees its place.
    await mod.campaignStore.update(o, list[0].id, { status: "archived" }, NOW);
    expect(await mod.campaignStore.create(o, "u", base, [l1], NOW, 2)).toBeTruthy();
  });

  it("adds each lead once and stops at the member cap; removes a lead unless its message was sent", async () => {
    const o = org();
    const ids = [await lead(o, "A"), await lead(o, "B"), await lead(o, "C"), await lead(o, "D")];
    const c = (await mod.campaignStore.create(o, "u", base, [ids[0]], NOW, 50))!;
    expect(await mod.campaignStore.addMembers(o, c.id, [ids[0], ids[1], ids[2], ids[3]], NOW, 3)).toBe(2);
    expect(await mod.campaignStore.addMembers(o, c.id, [ids[3]], NOW, 3)).toBe(0);
    const sent = await message(o, ids[0], "sent", { sentAt: NOW });
    await mod.campaignStore.settleMember((await memberOf(c.id, ids[0])).id, { state: "drafted", messageId: sent }, NOW);
    expect(await mod.campaignStore.removeMember(o, c.id, ids[0])).toBe("sent");
    expect(await mod.campaignStore.removeMember(o, c.id, ids[1])).toBe("removed");
    expect(await mod.campaignStore.removeMember(o, c.id, ids[1])).toBe("missing");
  });

  it("twelve passes at once each take a different member to draft for, and only from a campaign that is preparing", async () => {
    const o = org();
    const ids = [await lead(o, "A"), await lead(o, "B"), await lead(o, "C")];
    const c = (await mod.campaignStore.create(o, "u", base, ids, NOW, 50))!;
    // Other tests' rows may be preparing too: count only this campaign's claims.
    const mine = async () => (await Promise.all(Array.from({ length: 12 }, () => mod.campaignStore.claimDraft(NOW, 3 * MIN)))).filter((x) => x?.campaign.id === c.id);
    expect(await mine()).toHaveLength(0);
    await mod.campaignStore.setPreparing(o, c.id, { on: true, userId: "u" }, NOW);
    const got = await mine();
    expect(got.map((g) => g!.member.leadId).sort()).toEqual([...ids].sort());
    expect(got.every((g) => g!.member.attempts === 1)).toBe(true);
    expect(await mine()).toHaveLength(0); // all leased
    // A lease that ran out is taken again; a settled member is not.
    await mod.campaignStore.settleMember(got[0]!.member.id, { state: "drafted", messageId: await message(o, got[0]!.member.leadId, "draft") }, NOW);
    const later = new Date(NOW.getTime() + 4 * MIN);
    const again = (await Promise.all(Array.from({ length: 6 }, () => mod.campaignStore.claimDraft(later, 3 * MIN)))).filter((x) => x?.campaign.id === c.id);
    expect(again).toHaveLength(2);
    expect(again.every((g) => g!.member.attempts === 2)).toBe(true);
    for (const g of again) await mod.campaignStore.settleMember(g!.member.id, { state: "skipped", reason: "no_address" }, later);
    await mod.campaignStore.finishPreparing(later);
    expect((await mod.campaignStore.get(o, c.id))!.preparing).toBe(false);
  });

  it("failed members go back in the queue when preparing is started again", async () => {
    const o = org();
    const l = await lead(o, "A");
    const c = (await mod.campaignStore.create(o, "u", base, [l], NOW, 50))!;
    await mod.campaignStore.settleMember((await memberOf(c.id, l)).id, { state: "failed", reason: "model_unavailable", attempts: 3 }, NOW);
    await mod.campaignStore.setPreparing(o, c.id, { on: true, userId: "u", requeueFailed: true }, NOW);
    expect(await memberOf(c.id, l)).toMatchObject({ state: "queued", reason: null, attempts: 0 });
  });

  it("only one of several passes takes a due campaign to send from; a lease, a later time or a pause keeps the rest out", async () => {
    const o = org();
    const c = (await mod.campaignStore.create(o, "u", base, [await lead(o, "A")], NOW, 50))!;
    const mine = async (at: Date) => (await Promise.all(Array.from({ length: 8 }, () => mod.campaignStore.claimSend(at, 6 * MIN)))).filter((x) => x?.id === c.id);
    expect(await mine(NOW)).toHaveLength(0); // not sending
    await mod.campaignStore.setSending(o, c.id, { on: true, userId: "u", nextSendAt: NOW }, NOW);
    expect(await mine(NOW)).toHaveLength(1);
    expect(await mine(NOW)).toHaveLength(0); // leased
    await mod.campaignStore.releaseSend(c.id, { nextSendAt: new Date(NOW.getTime() + 3 * MIN) }, NOW);
    expect(await mine(new Date(NOW.getTime() + 2 * MIN))).toHaveLength(0); // not due yet
    expect(await mine(new Date(NOW.getTime() + 3 * MIN))).toHaveLength(1);
    await mod.campaignStore.setSending(o, c.id, { on: false, stop: "paused" }, NOW);
    expect(await mine(new Date(NOW.getTime() + 60 * MIN))).toHaveLength(0);
  });

  it("the next message to send is the oldest APPROVED one that isn't on hold for its current text", async () => {
    const o = org();
    const ids = [await lead(o, "A"), await lead(o, "B"), await lead(o, "C"), await lead(o, "D")];
    const c = (await mod.campaignStore.create(o, "u", base, ids, NOW, 50))!;
    const draft = await message(o, ids[0], "draft");
    const held = await message(o, ids[1], "approved", { hash: "a".repeat(64), approvedAt: new Date(NOW.getTime() - 9 * MIN) });
    const second = await message(o, ids[2], "approved", { approvedAt: new Date(NOW.getTime() - 2 * MIN), body: "second" });
    const first = await message(o, ids[3], "approved", { approvedAt: new Date(NOW.getTime() - 5 * MIN), body: "first" });
    for (const [l, m] of [[ids[0], draft], [ids[1], held], [ids[2], second], [ids[3], first]] as const) await mod.campaignStore.settleMember((await memberOf(c.id, l)).id, { state: "drafted", messageId: m }, NOW);
    await mod.campaignStore.settleMember((await memberOf(c.id, ids[1])).id, { holdReason: "suppressed", holdHash: "a".repeat(64) }, NOW);
    expect(await mod.campaignStore.nextApproved(o, c.id)).toMatchObject({ messageId: first, leadId: ids[3], body: "first" });
    await q.query(`UPDATE lead_messages SET status = 'sent', sent_at = $2 WHERE id = $1`, [first, NOW]);
    expect((await mod.campaignStore.nextApproved(o, c.id))?.messageId).toBe(second);
    await q.query(`UPDATE lead_messages SET status = 'sent', sent_at = $2 WHERE id = $1`, [second, NOW]);
    expect(await mod.campaignStore.nextApproved(o, c.id)).toBeNull(); // the held one and the draft are never offered
    // The held message is edited and approved again: a new text, so the hold no longer applies.
    await q.query(`UPDATE lead_messages SET body_hash = $2 WHERE id = $1`, [held, "b".repeat(64)]);
    expect((await mod.campaignStore.nextApproved(o, c.id))?.messageId).toBe(held);
  });

  it("the numbers come from the members' own messages and their recorded outcomes", async () => {
    const o = org();
    const ids = [await lead(o, "A"), await lead(o, "B"), await lead(o, "C")];
    const c = (await mod.campaignStore.create(o, "u", base, ids, NOW, 50))!;
    const old = await message(o, ids[0], "sent", { sentAt: new Date(NOW.getTime() - 30 * 3_600_000) });
    const fresh = await message(o, ids[1], "sent", { sentAt: new Date(NOW.getTime() - MIN) });
    for (const [l, m] of [[ids[0], old], [ids[1], fresh]] as const) await mod.campaignStore.settleMember((await memberOf(c.id, l)).id, { state: "drafted", messageId: m }, NOW);
    await event(o, ids[0], old, "bounced"); await event(o, ids[1], fresh, "replied"); await event(o, ids[1], fresh, "sent");
    expect(await mod.campaignStore.sendFacts(o, c.id, new Date(NOW.getTime() - 24 * 3_600_000))).toEqual({ sentSince: 1, sent: 2, bounced: 1 });
    const ms = await mod.campaignStore.members(o, c.id);
    expect(ms.map((m) => [m.message?.status ?? null, m.outcomes])).toEqual([["sent", ["bounced"]], ["sent", ["replied"]], [null, []]]);
    expect((await mod.campaignStore.memberFacts(o)).filter((f) => f.campaignId === c.id).map((f) => [f.state, f.messageStatus, f.outcomes])).toEqual(expect.arrayContaining([["drafted", "sent", ["bounced"]], ["drafted", "sent", ["replied"]], ["queued", null, []]]));
  });

  it("a discarded draft that was replaced points the member at the newer message; a draft's text is replaced only if it is still the one read", async () => {
    const o = org();
    const l = await lead(o, "A");
    const c = (await mod.campaignStore.create(o, "u", base, [l], NOW, 50))!;
    const gone = await message(o, l, "cancelled");
    await mod.campaignStore.settleMember((await memberOf(c.id, l)).id, { state: "drafted", messageId: gone, holdReason: "changed", holdHash: "x" }, NOW);
    await mod.campaignStore.relink(o, c.id);
    expect((await memberOf(c.id, l)).message_id).toBe(gone); // nothing newer: left alone
    const next = await message(o, l, "draft", { hash: "c".repeat(64), body: "v1" });
    await mod.campaignStore.relink(o, c.id);
    expect(await memberOf(c.id, l)).toMatchObject({ message_id: next, hold_reason: null, hold_hash: null });
    expect(await mod.campaignStore.unsentMessageId(o, l)).toBe(next);
    expect(await mod.campaignStore.setDraftBody(o, next, "wrong-hash", "v2", "d".repeat(64), NOW)).toBe(false);
    expect(await mod.campaignStore.setDraftBody(o, next, "c".repeat(64), "v2", "d".repeat(64), NOW)).toBe(true);
    expect(await mod.campaignStore.draftBody(o, next)).toMatchObject({ body: "v2", bodyHash: "d".repeat(64), status: "draft" });
    await q.query(`UPDATE lead_messages SET status = 'approved' WHERE id = $1`, [next]);
    expect(await mod.campaignStore.setDraftBody(o, next, "d".repeat(64), "v3", "e".repeat(64), NOW)).toBe(false); // an approved message is never rewritten
  });

  it("the audience lists open leads, newest first, with what stands in the way of picking each", async () => {
    const o = org();
    const plain = await lead(o, "Plain", { industry: "Edtech" });
    const dnc = await lead(o, "Dnc", { do_not_contact: true });
    const taken = await lead(o, "Taken");
    const drafted = await lead(o, "Drafted");
    await lead(o, "Won", { status: "won" });
    await lead(o, "NoMail", { contact_email: null });
    await mod.campaignStore.create(o, "u", { ...base, name: "First wave" }, [taken], NOW, 50);
    await message(o, drafted, "draft");
    const all = await mod.campaignStore.audience(o, {}, 50);
    const by = new Map(all.map((l) => [l.companyName, l]));
    expect([...by.keys()].sort()).toEqual(["Dnc", "Drafted", "NoMail", "Plain", "Taken"]); // a won lead isn't offered
    expect(by.get("Dnc")!.doNotContact).toBe(true);
    expect(by.get("Taken")!.inCampaign).toBe("First wave");
    expect(by.get("Drafted")!.hasUnsent).toBe(true);
    expect(by.get("NoMail")!.hasEmail).toBe(false);
    expect(by.get("Plain")).toMatchObject({ id: plain, hasEmail: true, hasUnsent: false, inCampaign: null, doNotContact: false });
    expect((await mod.campaignStore.audience(o, { q: "edtech" }, 50)).map((l) => l.companyName)).toEqual(["Plain"]);
    expect((await mod.campaignStore.audience(o, { q: "100%_" }, 50))).toEqual([]); // typed wildcards are just characters
    expect((await mod.campaignStore.audience(o, { status: "qualified" }, 50))).toEqual([]);
    expect(await mod.campaignStore.audience(o, {}, 2)).toHaveLength(2);
  });

  it("the audience knows which client profile's search found a lead and whether it was Ready, and can be narrowed to either", async () => {
    const o = org(), other = org();
    const fromBrands = await lead(o, "FromBrands"), fromStartups = await lead(o, "FromStartups"), typed = await lead(o, "TypedSearch"), byHand = await lead(o, "ByHand");
    const prospect = async (orgId: string, leadId: number, ready: boolean) => Number((await q.query(
      `INSERT INTO prospects (organization_id, domain, name, website, status, ready, lead_id, created_at, updated_at) VALUES ($1, $2, 'P', 'https://p.example', 'ready', $3, $4, $5, $5) RETURNING id`,
      [orgId, `p${leadId}-${orgId}.example`, ready, leadId, NOW])).rows[0].id);
    const run = async (orgId: string, prospectId: number, profile: { id: number; name: string } | null) => {
      const id = `pr_t${randomBytes(8).toString("hex")}`;
      await q.query(`INSERT INTO prospect_runs (id, organization_id, created_by_user, request, icp, quantity, status, stage, idem_key, created_at, updated_at) VALUES ($1, $2, 'u', 'x', $3, 5, 'done', 'done', $1, $4, $4)`,
        [id, orgId, JSON.stringify({ industry: "D2C brand", ...(profile ? { profile } : {}) }), NOW]);
      await q.query(`INSERT INTO prospect_run_items (run_id, organization_id, prospect_id, stage, updated_at) VALUES ($1, $2, $3, 'done', $4)`, [id, orgId, prospectId, NOW]);
    };
    await run(o, await prospect(o, fromBrands, true), { id: 7, name: "Brands" });
    await run(o, await prospect(o, fromStartups, false), { id: 8, name: "Startups" });
    await run(o, await prospect(o, typed, true), null);
    // The same profile id in another workspace is another profile.
    const theirs = await lead(other, "Theirs");
    await run(other, await prospect(other, theirs, true), { id: 7, name: "Their Brands" });
    try {
      const by = new Map((await mod.campaignStore.audience(o, {}, 50)).map((l) => [l.companyName, l]));
      expect([by.get("FromBrands")!.profileName, by.get("FromBrands")!.ready]).toEqual(["Brands", true]);
      expect([by.get("FromStartups")!.profileName, by.get("FromStartups")!.ready]).toEqual(["Startups", false]);
      expect([by.get("TypedSearch")!.profileName, by.get("TypedSearch")!.ready]).toEqual([null, true]);
      expect([by.get("ByHand")!.profileName, by.get("ByHand")!.ready]).toEqual([null, false]);
      expect((await mod.campaignStore.audience(o, { profileId: 7 }, 50)).map((l) => l.companyName)).toEqual(["FromBrands"]);
      expect((await mod.campaignStore.audience(o, { profileId: 999 }, 50))).toEqual([]);
      expect((await mod.campaignStore.audience(o, { ready: true }, 50)).map((l) => l.companyName).sort()).toEqual(["FromBrands", "TypedSearch"]);
      expect((await mod.campaignStore.audience(o, { ready: true, profileId: 8 }, 50))).toEqual([]);
      expect((await mod.campaignStore.audience(other, { profileId: 7 }, 50)).map((l) => l.companyName)).toEqual(["Theirs"]);
    } finally {
      for (const orgId of [o, other]) for (const t of ["prospect_run_items", "prospect_runs", "prospects"]) await q.query(`DELETE FROM ${t} WHERE organization_id = $1`, [orgId]).catch(() => {});
    }
  });

  it("each member carries the next OPEN follow-up on its message: planned, on hold, or a draft waiting; never one that is finished", async () => {
    const o = org();
    const ids = [await lead(o, "Planned"), await lead(o, "Drafted"), await lead(o, "Finished"), await lead(o, "None")];
    const c = (await mod.campaignStore.create(o, "u", base, ids, NOW, 50))!;
    const roots: number[] = [];
    for (const l of ids) { const m = await message(o, l, "sent", { sentAt: NOW }); roots.push(m); await mod.campaignStore.settleMember((await memberOf(c.id, l)).id, { state: "drafted", messageId: m }, NOW); }
    const followup = (leadId: number, root: number, step: number, status: string, due: string, draft: number | null = null) =>
      q.query(`INSERT INTO outreach_followups (organization_id, lead_id, root_message_id, after_message_id, step, due_at, status, draft_message_id, created_at, updated_at) VALUES ($1, $2, $3, $3, $4, $5::timestamp, $6, $7, $8, $8)`, [o, leadId, root, step, due, status, draft, NOW]);
    try {
      await followup(ids[0], roots[0], 1, "scheduled", "2026-11-14 09:00:00");
      const draft = await message(o, ids[1], "draft");
      await followup(ids[1], roots[1], 1, "sent", "2026-11-05 09:00:00");            // step 1 already went out: history
      await followup(ids[1], roots[1], 2, "drafted", "2026-11-09 09:00:00", draft);  // step 2 is the open one
      await followup(ids[2], roots[2], 1, "cancelled", "2026-11-09 09:00:00");
      const ms = await mod.campaignStore.members(o, c.id);
      expect(ms.map((m) => m.followUp)).toEqual([
        { status: "scheduled", step: 1, dueAt: "2026-11-14T09:00:00.000Z", draftStatus: null },
        { status: "drafted", step: 2, dueAt: "2026-11-09T09:00:00.000Z", draftStatus: "draft" },
        null,
        null,
      ]);
      // Once the lead has moved on, the planned step would be skipped when due, so it is no longer shown as planned.
      // A draft already waiting is still something to act on, whatever the lead's stage.
      await q.query(`UPDATE leads SET status = 'replied' WHERE organization_id = $1 AND id = ANY($2)`, [o, [ids[0], ids[1]]]);
      const moved = await mod.campaignStore.members(o, c.id);
      expect(moved[0].followUp).toBeNull();
      expect(moved[1].followUp).toMatchObject({ status: "drafted", step: 2 });
      await q.query(`UPDATE leads SET status = 'contacted' WHERE organization_id = $1 AND id = $2`, [o, ids[0]]);
      expect((await mod.campaignStore.members(o, c.id))[0].followUp).toMatchObject({ status: "scheduled", step: 1 });
    } finally { await q.query(`DELETE FROM outreach_followups WHERE organization_id = $1`, [o]).catch(() => {}); }
  });

  it("another workspace's campaign, members and leads can't be read or changed", async () => {
    const a = org(), b = org();
    const la = await lead(a, "Mine"), lb = await lead(b, "Theirs");
    const c = (await mod.campaignStore.create(a, "u", base, [la], NOW, 50))!;
    expect(await mod.campaignStore.get(b, c.id)).toBeNull();
    expect(await mod.campaignStore.list(b)).toEqual([]);
    expect(await mod.campaignStore.members(b, c.id)).toEqual([]);
    expect(await mod.campaignStore.update(b, c.id, { name: "Stolen" }, NOW)).toBeNull();
    expect(await mod.campaignStore.addMembers(b, c.id, [lb], NOW, 50)).toBe(0);
    expect(await mod.campaignStore.removeMember(b, c.id, la)).toBe("missing");
    expect(await mod.campaignStore.setPreparing(b, c.id, { on: true, userId: "x" }, NOW)).toBeNull();
    expect(await mod.campaignStore.setSending(b, c.id, { on: true, userId: "x" }, NOW)).toBeNull();
    expect(await mod.campaignStore.ownLeadIds(a, [la, lb])).toEqual([la]);
    expect(await mod.campaignStore.nextApproved(b, c.id)).toBeNull();
    expect(await mod.campaignStore.get(a, c.id)).toMatchObject({ name: "Diwali", preparing: false, sending: false });
    expect(await mod.campaignStore.members(a, c.id)).toHaveLength(1);
  });
});
