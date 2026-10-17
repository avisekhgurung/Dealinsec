/**
 * The channel store against a REAL Postgres (server/channels/store.ts): what the database decides, not the code.
 *   - one unsent message per lead and channel; atomic, hash-fenced status changes;
 *   - concurrent sends of one approved message: one reservation; the plan's send allowance counted with Gmail's
 *     mail_send_jobs under the shared lock, and email's own counts include channel sends and drafts;
 *   - delivery only forward; a provider id and an inbound message stored once; a connection's token pair enforced;
 *   - an opt-out is not undone by recording an opt-in.
 *
 * Runs only with MAILBOX_PG_TEST_URL set to a disposable LOCAL database with the full schema, the mailbox tables and
 * script/migrate-channels.ts applied. Fresh organization ids per case; only their rows are deleted.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const URL_ = process.env.MAILBOX_PG_TEST_URL;
const loopback = (u?: string) => { try { return !!u && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(u).hostname); } catch { return false; } };

describe.skipIf(!URL_ || !loopback(URL_))("channel store (real Postgres)", () => {
  let q: any, mod: typeof import("./store"), sendStore: typeof import("../mail/send-store-pg"), msgStore: typeof import("../sales/message-store");
  const orgs: string[] = [];
  const org = () => { const o = `t-${randomBytes(5).toString("hex")}`; orgs.push(o); return o; };
  const DAY = 86_400_000;
  let lead = 900_000 + Math.floor(Math.random() * 90_000);

  beforeAll(async () => {
    const utc = new URL(URL_!); utc.searchParams.set("options", "-c TimeZone=UTC");
    process.env.DATABASE_URL = utc.toString();
    mod = await import("./store");
    sendStore = await import("../mail/send-store-pg");
    msgStore = await import("../sales/message-store");
    const { default: pg } = await import("pg");
    q = new pg.Client({ connectionString: process.env.DATABASE_URL }); await q.connect();
    const { CHANNEL_DDL } = await import("./ddl");
    for (const s of CHANNEL_DDL) await q.query(s);
  });
  afterAll(async () => {
    for (const o of orgs) for (const t of ["channel_messages", "whatsapp_contacts", "whatsapp_connections", "mail_send_jobs", "lead_messages"]) await q.query(`DELETE FROM ${t} WHERE organization_id = $1`, [o]).catch(() => {});
    await q?.end();
  });
  const s = () => mod.channelStore;
  const draft = (orgId: string, leadId: number, channel = "whatsapp", over: Record<string, unknown> = {}) => s().create({ orgId, leadId, channel, kind: channel === "whatsapp" ? "text" : "dm", body: "Hello there", bodyHash: "a".repeat(64), toAddress: "+919876543210", promptVersion: null, claimIds: [], by: "user", userId: "u", now: new Date(), ...over } as any);
  const approve = async (orgId: string, id: number) => s().transition({ orgId, id, from: ["draft"], hash: "a".repeat(64), set: { status: "approved", approvedAt: new Date() } });

  it("one unsent message per lead and channel; another channel or a sent one doesn't block", async () => {
    const o = org(), l = ++lead;
    const m = await draft(o, l);
    await expect(draft(o, l)).rejects.toBeInstanceOf(mod.ChannelDraftExists);
    await draft(o, l, "x");
    await s().transition({ orgId: o, id: m.id, from: ["draft"], set: { status: "sent", sentVia: "manual", sentAt: new Date() } });
    expect((await draft(o, l)).status).toBe("draft");
    // The database refuses a "sent" without its time and route, and an API send on LinkedIn.
    await expect(q.query(`UPDATE channel_messages SET status = 'sent', sent_at = NULL WHERE id = $1`, [m.id])).rejects.toThrow();
    await expect(q.query(`UPDATE channel_messages SET sent_via = 'api' WHERE organization_id = $1 AND channel = 'x'`, [o])).rejects.toThrow();
  });

  it("status changes are fenced on the expected status and the approved hash; another workspace changes nothing", async () => {
    const o = org(), l = ++lead;
    const m = await draft(o, l);
    expect(await s().transition({ orgId: o, id: m.id, from: ["draft"], hash: "b".repeat(64), set: { status: "approved" } })).toBeNull();
    expect(await s().transition({ orgId: org(), id: m.id, from: ["draft"], set: { status: "cancelled" } })).toBeNull();
    expect((await approve(o, m.id))!.status).toBe("approved");
    expect(await approve(o, m.id)).toBeNull(); // a second approval finds it no longer a draft
  });

  it("concurrent sends: one reservation; the allowance counts Gmail's sends with the channel's, and email's counts include them", async () => {
    const o = org(), l = ++lead;
    const m = await draft(o, l); await approve(o, m.id);
    const allowance = { since: new Date(Date.now() - 30 * DAY), max: 5 };
    const out = await Promise.all(Array.from({ length: 6 }, () => s().reserveSend({ orgId: o, id: m.id, hash: "a".repeat(64), now: new Date(), allowance })));
    expect(out.filter((r) => r.ok)).toHaveLength(1);
    expect(await s().countApiSends(o, allowance.since)).toBe(1); // in flight counts
    // Gmail's sends fill the rest of the allowance: the next channel send is refused under the lock.
    for (let i = 0; i < 4; i++) await q.query(`INSERT INTO mail_send_jobs (organization_id, connection_id, lead_id, message_id, requested_by, body_hash, to_address, rfc_message_id, status, attempts, provider_message_id, sent_at, created_at, updated_at)
      VALUES ($1, 1, $2, $3, 'u', $4, 'a@b.test', $5, 'sent', 1, $6, now(), now(), now())`, [o, l, 800_000_000 + Math.floor(Math.random() * 1e8), "c".repeat(64), `<t-${randomBytes(8).toString("hex")}@x>`, `g-${i}`]);
    const m2 = await draft(o, ++lead); await approve(o, m2.id);
    expect(await s().reserveSend({ orgId: o, id: m2.id, hash: "a".repeat(64), now: new Date(), allowance })).toEqual({ ok: false, code: "plan_send_limit" });
    expect(await sendStore.countWorkspaceSends(o, allowance.since)).toBe(5); // Gmail's count now includes the WhatsApp send
  });

  it("AI drafts are one allowance across email and channels, counted under the same lock", async () => {
    const o = org();
    const allowance = { since: new Date(Date.now() - 30 * DAY), max: 2, prefix: "draft-" };
    await draft(o, ++lead, "x", { promptVersion: "draft-ch1", allowance });
    await msgStore.messageStore.create({ orgId: o, leadId: ++lead, subject: "s", body: "b", bodyHash: "h", toAddress: "a@b.test", toSource: "lead", researchId: null, claimIds: [], promptVersion: "draft-v2", by: "user", userId: "u", now: new Date(), allowance });
    expect(await msgStore.messageStore.countAiDrafts(o, allowance.since, "draft-")).toBe(2);
    await expect(draft(o, ++lead, "linkedin", { promptVersion: "draft-ch1", allowance })).rejects.toBeInstanceOf(mod.ChannelAllowanceReached);
    await expect(msgStore.messageStore.create({ orgId: o, leadId: ++lead, subject: "s", body: "b", bodyHash: "h", toAddress: "a@b.test", toSource: "lead", researchId: null, claimIds: [], promptVersion: "draft-v2", by: "user", userId: "u", now: new Date(), allowance })).rejects.toThrow(/AI drafts/);
  });

  it("delivery only moves forward; a provider id and an inbound message are stored once", async () => {
    const o = org(), l = ++lead;
    const m = await draft(o, l); await approve(o, m.id);
    await s().reserveSend({ orgId: o, id: m.id, hash: "a".repeat(64), now: new Date(), allowance: { since: new Date(0), max: 99 } });
    const wamid = `wamid.${randomBytes(6).toString("hex")}`;
    await s().transition({ orgId: o, id: m.id, from: ["sending"], set: { status: "sent", sentVia: "api", sentAt: new Date(), providerMessageId: wamid } });
    expect(await s().applyStatus({ id: m.id, status: "read", at: new Date(), errorCode: null })).toBe(true);
    expect(await s().applyStatus({ id: m.id, status: "delivered", at: new Date(), errorCode: null })).toBe(false);
    expect(await s().applyStatus({ id: m.id, status: "failed", at: new Date(), errorCode: "whatsapp_131026" })).toBe(false);
    expect((await s().byProviderId("whatsapp", wamid))).toMatchObject({ id: m.id, delivery: "read", status: "sent" });
    const inbound = { orgId: o, leadId: l, channel: "whatsapp", from: "+919876543210", providerMessageId: `wamid.in.${randomBytes(6).toString("hex")}`, body: "Yes", type: "text", at: new Date() };
    expect(await s().insertInbound(inbound)).toBe(true);
    expect(await s().insertInbound(inbound)).toBe(false);
  });

  it("a connection's token is required while live and deleted on disconnect; one live number per workspace and per number", async () => {
    const o = org(), pid = String(Date.now()).slice(-12);
    const c = await s().createConnection({ orgId: o, userId: "u", phoneNumberId: pid, wabaId: "1", displayPhone: null, verifiedName: null, now: new Date() }, (id) => ({ envelope: `sealed-${id}`, keyVersion: 1 }));
    expect(c.accessTokenEnc).toBe(`sealed-${c.id}`); // sealed with its own id
    await expect(s().createConnection({ orgId: org(), userId: "u", phoneNumberId: pid, wabaId: "1", displayPhone: null, verifiedName: null, now: new Date() }, () => ({ envelope: "x", keyVersion: 1 }))).rejects.toBeInstanceOf(mod.ConnectionExists);
    await expect(q.query(`UPDATE whatsapp_connections SET access_token_enc = NULL WHERE id = $1`, [c.id])).rejects.toThrow();
    expect(await s().disconnect(o, c.id, new Date())).toBe(true);
    expect((await q.query(`SELECT access_token_enc, token_key_version FROM whatsapp_connections WHERE id = $1`, [c.id])).rows[0]).toEqual({ access_token_enc: null, token_key_version: null });
  });

  it("an opt-out isn't undone by recording an opt-in", async () => {
    const o = org();
    await s().recordOptIn({ orgId: o, phone: "+919800000001", leadId: 1, source: "website form", userId: "u", now: new Date() });
    await s().recordOptOut({ orgId: o, phone: "+919800000001", leadId: 1, now: new Date() });
    const again = await s().recordOptIn({ orgId: o, phone: "+919800000001", leadId: 1, source: "said yes on a call", userId: "u", now: new Date() });
    expect(again).toMatchObject({ optedInAt: null, optedOutAt: expect.any(Date) });
  });
});
