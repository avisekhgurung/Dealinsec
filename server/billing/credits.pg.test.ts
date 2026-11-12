/**
 * Purchased credits against a REAL Postgres: atomic consumption under concurrency, idempotent grants / undos /
 * refunds, the plan-first-then-credits order for Client Radar searches and AI drafts, refund-before-capture through the
 * real payment pipeline, terms frozen at order time, operator grants and deductions, and a ledger that always adds up.
 * Fixture events only: this proves the database guards, not a real Razorpay transaction.
 *
 * Runs only with MAILBOX_PG_TEST_URL set to a disposable LOCAL database with the full schema and
 * script/migrate-credits.ts applied. Fresh ids per case; only their rows are deleted.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const URL_ = process.env.MAILBOX_PG_TEST_URL;
const loopback = (u?: string) => { try { return !!u && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(u).hostname); } catch { return false; } };
const DAY = 86_400_000;

describe.skipIf(!URL_ || !loopback(URL_))("purchased credits (real Postgres)", () => {
  let pg: any, q: any;
  let credits: typeof import("./credits");
  let orders: typeof import("./credit-orders");
  let events: typeof import("./razorpay-events");
  let deps: typeof import("./payment-deps");
  let outbound: typeof import("../outbound/store");
  let messages: typeof import("../sales/message-store");
  let channels: typeof import("../channels/store");
  let dbm: typeof import("../db");
  const orgs: string[] = [], users: string[] = [], packs: number[] = [];
  /** Lead ids are global to the unsent-draft index, so every case uses its own range. */
  let leadSeq = 4_000_000 + Math.floor(Math.random() * 1_000_000);
  const lead = () => ++leadSeq;
  const org = () => { const o = `c-${randomBytes(5).toString("hex")}`; orgs.push(o); return o; };

  beforeAll(async () => {
    const utc = new URL(URL_!); utc.searchParams.set("options", "-c TimeZone=UTC");
    process.env.DATABASE_URL = utc.toString();
    dbm = await import("../db");
    credits = await import("./credits");
    orders = await import("./credit-orders");
    events = await import("./razorpay-events");
    deps = await import("./payment-deps");
    outbound = await import("../outbound/store");
    messages = await import("../sales/message-store");
    channels = await import("../channels/store");
    ({ default: pg } = await import("pg"));
    q = new pg.Client({ connectionString: process.env.DATABASE_URL }); await q.connect();
  });
  afterAll(async () => {
    for (const o of orgs) {
      for (const t of ["credit_ledger", "credit_lots", "credit_purchases", "prospect_runs", "lead_messages", "channel_messages"]) await q.query(`DELETE FROM ${t} WHERE organization_id = $1`, [o]).catch(() => {});
    }
    for (const u of users) {
      await q.query(`DELETE FROM payu_orders WHERE user_id = $1`, [u]).catch(() => {});
      await q.query(`DELETE FROM users WHERE id = $1`, [u]).catch(() => {});
    }
    for (const o of orgs) await q.query(`DELETE FROM organizations WHERE id = $1`, [o]).catch(() => {});
    for (const p of packs) await q.query(`DELETE FROM credit_packs WHERE id = $1`, [p]).catch(() => {});
    await q?.end();
  });

  const lotRows = async (o: string, kind = "search") => (await q.query(`SELECT * FROM credit_lots WHERE organization_id = $1 AND kind = $2 ORDER BY id`, [o, kind])).rows;
  const balance = async (o: string, kind: "search" | "draft" = "search") => (await credits.creditBalances(o))[kind];
  /** The wallet must always add up: every lot's remaining equals the sum of every ledger line for the workspace (per kind). */
  const ledgerBalanced = async (o: string) => {
    for (const kind of ["search", "draft"]) {
      const lots = (await q.query(`SELECT COALESCE(sum(remaining), 0)::int AS n, bool_and(remaining >= 0 AND remaining <= units) AS ok FROM credit_lots WHERE organization_id = $1 AND kind = $2`, [o, kind])).rows[0];
      const led = (await q.query(`SELECT COALESCE(sum(delta), 0)::int AS n FROM credit_ledger WHERE organization_id = $1 AND kind = $2`, [o, kind])).rows[0];
      expect({ kind, remaining: lots.n }).toEqual({ kind, remaining: led.n });
      expect(lots.ok ?? true).toBe(true);
    }
  };
  const addLot = async (o: string, units: number, opts: { kind?: "search" | "draft"; expiresAt?: Date | null } = {}) =>
    credits.adminGrantCredits({ orgId: o, kind: opts.kind ?? "search", units, reason: "test grant", adminUserId: "admin-t", requestId: randomUUID(), expiresAt: opts.expiresAt ?? null });
  const spend = (o: string, ref: string, cost = 1, kind: "search" | "draft" = "search") =>
    dbm.db.transaction((tx) => credits.consumeCreditTx(tx as any, { orgId: o, kind, sourceRef: ref, now: new Date(), cost }));

  async function seedBuyer() {
    const o = org(); const u = `u-${randomBytes(4).toString("hex")}`; users.push(u);
    await q.query(`INSERT INTO organizations (id, name) VALUES ($1, 'Credit test agency')`, [o]);
    await q.query(`INSERT INTO users (id, email, first_name, organization_id, org_role, member_status) VALUES ($1, $2, 'Ana', $3, 'OWNER', 'active')`, [u, `${u}@example.test`, o]);
    return { o, u, user: { id: u, organizationId: o } as any };
  }
  async function seedPack(units = 15, price = 129, kind: "search" | "draft" = "search", expiryMonths: number | null = 12) {
    const r = await q.query(`INSERT INTO credit_packs (kind, units, price_rupees, expiry_months, sort_order) VALUES ($1, $2, $3, $4, 999) RETURNING id`, [kind, units, price, expiryMonths]);
    packs.push(r.rows[0].id); return r.rows[0].id as number;
  }
  const fakeRazorpay = async (a: { amountInRupees: number }) => ({ id: `order_t${randomBytes(5).toString("hex")}`, amount: a.amountInRupees * 100, currency: "INR" });
  const captured = (orderId: string, rupees: number, paymentId = `pay_t${randomBytes(5).toString("hex")}`) =>
    ({ id: paymentId, order_id: orderId, status: "captured", amount: rupees * 100, currency: "INR", created_at: Math.floor(Date.now() / 1000) - 30 });
  const capture = (entity: any) => ({ event: "payment.captured", payload: { payment: { entity } } });
  const refund = (entity: any, full = true) => ({ event: "refund.processed", payload: { refund: { entity: { payment_id: entity.id, amount: full ? entity.amount : 100 } }, payment: { entity: { ...entity, status: "refunded" } } } });
  const fxOf = () => ({ ...deps.paymentEffects, audit: async () => {}, log: () => {} });

  /* ── consumption ───────────────────────────────────────────────────────── */

  it("twenty concurrent consumes against five credits spend exactly five and never go negative", async () => {
    const o = org(); await addLot(o, 5);
    const out = await Promise.all(Array.from({ length: 20 }, (_, i) => spend(o, `run:t-${i}-${randomUUID()}`)));
    expect(out.filter((x) => x !== null)).toHaveLength(5);
    expect((await lotRows(o))[0].remaining).toBe(0);
    expect(await balance(o)).toBe(0);
    await ledgerBalanced(o);
  });

  it("a duplicate consume for the same action is refused by the ledger, not charged twice", async () => {
    const o = org(); await addLot(o, 5);
    const ref = `run:dup-${randomUUID()}`;
    await spend(o, ref);
    await expect(spend(o, ref)).rejects.toThrow(); // unique (reason, source_ref): the whole transaction rolls back
    expect(await balance(o)).toBe(4);
    await ledgerBalanced(o);
  });

  it("a cost of two spans lots earliest-expiry first, and an undo returns exactly those credits once", async () => {
    const o = org();
    await addLot(o, 1, { expiresAt: new Date(Date.now() + 10 * DAY) });
    await addLot(o, 3, { expiresAt: new Date(Date.now() + 90 * DAY) });
    await addLot(o, 4, { expiresAt: null });
    const ref = `run:span-${randomUUID()}`;
    expect(await spend(o, ref, 2)).toHaveLength(2);
    const lots = await lotRows(o);
    expect(lots.map((l: any) => l.remaining)).toEqual([0, 2, 4]);
    expect(await credits.undoCreditConsume({ orgId: o, sourceRef: ref, now: new Date() })).toBe(2);
    expect(await credits.undoCreditConsume({ orgId: o, sourceRef: ref, now: new Date() })).toBe(0);   // replay: nothing
    expect((await lotRows(o)).map((l: any) => l.remaining)).toEqual([1, 3, 4]);
    await ledgerBalanced(o);
  });

  it("an action that needs more credits than are left takes none", async () => {
    const o = org(); await addLot(o, 1);
    expect(await spend(o, `run:short-${randomUUID()}`, 2)).toBeNull();
    expect(await balance(o)).toBe(1);
    await ledgerBalanced(o);
  });

  it("expired credits are neither spendable nor counted, but the lot stays visible", async () => {
    const o = org();
    await addLot(o, 3, { expiresAt: new Date(Date.now() - 1000) });
    expect(await balance(o)).toBe(0);
    expect(await spend(o, `run:exp-${randomUUID()}`)).toBeNull();
    expect(await lotRows(o)).toHaveLength(1);
    const wallet = await credits.creditSummary(o);
    expect(wallet.search.balance).toBe(0);
  });

  it("one workspace's credits never pay for another's", async () => {
    const [a, b] = [org(), org()]; await addLot(a, 3);
    expect(await spend(b, `run:x-${randomUUID()}`)).toBeNull();
    expect(await balance(a)).toBe(3);
  });

  /* ── payments ──────────────────────────────────────────────────────────── */

  it("a pack order grants once under ten concurrent captures plus a replay, and the lot carries the pack's expiry", async () => {
    const { o, u, user } = await seedBuyer(); const pack = await seedPack(15, 129, "search", 12);
    const made = await orders.createCreditPackOrder(user, pack, fakeRazorpay);
    expect(made.ok).toBe(true); if (!made.ok) return;
    const pay = captured(made.order.id, 129);
    const out = await Promise.all(Array.from({ length: 10 }, () => events.handleWebhookEvent(capture(pay), deps.paymentOrderStore, fxOf())));
    expect(out.filter((x) => x.kind === "granted")).toHaveLength(1);
    expect(await balance(o)).toBe(15);
    const [lot] = await lotRows(o);
    expect(lot.units).toBe(15); expect(lot.source).toBe("purchase");
    const months = (new Date(lot.expires_at).getTime() - Date.now()) / DAY;
    expect(months).toBeGreaterThan(360); expect(months).toBeLessThan(367);
    // a late replay of the same capture grants nothing more
    expect(await events.handleWebhookEvent(capture(pay), deps.paymentOrderStore, fxOf())).toMatchObject({ kind: "already_claimed" });
    expect(await balance(o)).toBe(15);
    await ledgerBalanced(o);
    void u;
  });

  it("the terms are frozen at order time: editing or retiring the pack afterwards changes nothing the buyer owns", async () => {
    const { o, user } = await seedBuyer(); const pack = await seedPack(30, 229, "draft", 6);
    const made = await orders.createCreditPackOrder(user, pack, fakeRazorpay);
    if (!made.ok) throw new Error("order");
    await q.query(`UPDATE credit_packs SET units = 1, price_rupees = 1, expiry_months = NULL, active = false WHERE id = $1`, [pack]);
    expect(await events.handleWebhookEvent(capture(captured(made.order.id, 229)), deps.paymentOrderStore, fxOf())).toMatchObject({ kind: "granted" });
    expect(await balance(o, "draft")).toBe(30);
    const [lot] = await lotRows(o, "draft");
    expect(new Date(lot.expires_at).getTime()).toBeGreaterThan(Date.now() + 150 * DAY);
  });

  it("an inactive or unknown pack can't be ordered, and a payment for the wrong amount grants nothing", async () => {
    const { o, user } = await seedBuyer(); const pack = await seedPack(5, 49);
    await q.query(`UPDATE credit_packs SET active = false WHERE id = $1`, [pack]);
    expect(await orders.createCreditPackOrder(user, pack, fakeRazorpay)).toMatchObject({ ok: false, code: "PACK_UNAVAILABLE" });
    expect(await orders.createCreditPackOrder(user, 999_999_999, fakeRazorpay)).toMatchObject({ ok: false, code: "PACK_UNAVAILABLE" });
    expect(await orders.createCreditPackOrder(user, "x", fakeRazorpay)).toMatchObject({ ok: false, code: "INVALID_PACK" });
    await q.query(`UPDATE credit_packs SET active = true WHERE id = $1`, [pack]);
    const made = await orders.createCreditPackOrder(user, pack, fakeRazorpay);
    if (!made.ok) throw new Error("order");
    const out = await events.handleWebhookEvent(capture(captured(made.order.id, 1)), deps.paymentOrderStore, fxOf()); // paid ₹1, not ₹49
    expect(out).toMatchObject({ kind: "needs_review", reason: "amount_mismatch" });
    expect(await balance(o)).toBe(0);
  });

  it("a double click reuses the still-pending order instead of opening a second payment", async () => {
    const { user } = await seedBuyer(); const pack = await seedPack(5, 49);
    let made = 0; const counting = async (a: { amountInRupees: number }) => { made++; return fakeRazorpay(a); };
    const [a, b] = [await orders.createCreditPackOrder(user, pack, counting), await orders.createCreditPackOrder(user, pack, counting)];
    expect(made).toBe(1);
    expect(a.ok && b.ok && a.order.id === b.order.id && b.reused).toBe(true);
  });

  it("a full refund takes back only the unspent credits, once; spent credits stay spent", async () => {
    const { o, user } = await seedBuyer(); const pack = await seedPack(5, 49);
    const made = await orders.createCreditPackOrder(user, pack, fakeRazorpay); if (!made.ok) throw new Error("order");
    const pay = captured(made.order.id, 49);
    await events.handleWebhookEvent(capture(pay), deps.paymentOrderStore, fxOf());
    await spend(o, `run:used1-${randomUUID()}`); await spend(o, `run:used2-${randomUUID()}`);
    expect(await balance(o)).toBe(3);
    const first = await events.handleWebhookEvent(refund(pay), deps.paymentOrderStore, fxOf());
    expect(first).toMatchObject({ kind: "refunded", clawback: "revoked" });
    expect(await balance(o)).toBe(0);
    expect(await events.handleWebhookEvent(refund(pay), deps.paymentOrderStore, fxOf())).toMatchObject({ kind: "ignored" });  // replay
    const refunds = (await q.query(`SELECT delta FROM credit_ledger WHERE organization_id = $1 AND reason = 'refund'`, [o])).rows;
    expect(refunds.map((r: any) => r.delta)).toEqual([-3]);
    await ledgerBalanced(o);
  });

  it("a partial refund is recorded for a person and takes no credits", async () => {
    const { o, user } = await seedBuyer(); const pack = await seedPack(5, 49);
    const made = await orders.createCreditPackOrder(user, pack, fakeRazorpay); if (!made.ok) throw new Error("order");
    const pay = captured(made.order.id, 49);
    await events.handleWebhookEvent(capture(pay), deps.paymentOrderStore, fxOf());
    expect(await events.handleWebhookEvent(refund(pay, false), deps.paymentOrderStore, fxOf())).toMatchObject({ kind: "refund_partial" });
    expect(await balance(o)).toBe(5);
  });

  it("a refund that arrives BEFORE its capture closes the order, and the capture afterwards grants nothing", async () => {
    const { o, user } = await seedBuyer(); const pack = await seedPack(5, 49);
    const made = await orders.createCreditPackOrder(user, pack, fakeRazorpay); if (!made.ok) throw new Error("order");
    const pay = captured(made.order.id, 49);
    expect(await events.handleWebhookEvent(refund(pay), deps.paymentOrderStore, fxOf())).toMatchObject({ kind: "refund_closed_unfulfilled" });
    expect(await events.handleWebhookEvent(capture(pay), deps.paymentOrderStore, fxOf())).toMatchObject({ kind: "already_claimed" });
    expect(await balance(o)).toBe(0);
    expect(await lotRows(o)).toHaveLength(0);
    await ledgerBalanced(o);
  });

  it("a grant that fails reopens the order; the retry delivers once", async () => {
    const { o, user } = await seedBuyer(); const pack = await seedPack(5, 49);
    const made = await orders.createCreditPackOrder(user, pack, fakeRazorpay); if (!made.ok) throw new Error("order");
    const pay = captured(made.order.id, 49);
    const failing = { ...fxOf(), grant: async () => { throw new Error("db hiccup"); } };
    await expect(events.handleWebhookEvent(capture(pay), deps.paymentOrderStore, failing as any)).rejects.toThrow();
    expect(await balance(o)).toBe(0);
    expect(await events.handleWebhookEvent(capture(pay), deps.paymentOrderStore, fxOf())).toMatchObject({ kind: "granted" });
    expect(await balance(o)).toBe(5);
  });

  /* ── plan first, then credits ──────────────────────────────────────────── */

  const startRun = (o: string, limits: any[], over: Partial<{ quantity: number; prospects: any }> = {}) => outbound.outboundStore.createRun({
    id: `pr_${randomUUID()}`, orgId: o, userId: "u", by: "user", request: "x", icp: {}, quantity: over.quantity ?? 10, idemKey: randomUUID(), queries: [], now: new Date(), mode: "deep",
    limits, ...(over.prospects ? { prospects: over.prospects } : {}),
  }).then((r) => r, (e) => (e instanceof outbound.RunLimitReached ? null : Promise.reject(e)));
  const planLimit = (max: number) => ({ since: new Date(Date.now() - 30 * DAY), max, mode: "deep" as const, credit: { cost: 1 } });

  it("searches use the plan first, then credits; concurrent starts spend no more than the plan plus the credits", async () => {
    const o = org(); await addLot(o, 3);
    const runs = await Promise.all(Array.from({ length: 12 }, () => startRun(o, [planLimit(2)])));
    const ok = runs.filter((r) => r !== null) as any[];
    expect(ok).toHaveLength(5);                                           // 2 from the plan + 3 credits, never more
    expect(ok.filter((r) => r.fundedBy === "credit")).toHaveLength(3);
    expect(await balance(o)).toBe(0);
    expect(await outbound.outboundStore.countRunsSince(o, new Date(Date.now() - 30 * DAY), "deep", true)).toBe(2);   // the plan's own count ignores credit runs
    await ledgerBalanced(o);
  });

  it("a search that never searched gives its credit back; one that searched keeps it spent", async () => {
    const o = org(); await addLot(o, 2);
    const first = await startRun(o, [planLimit(1)]); expect(first?.fundedBy).toBeNull();
    const a = await startRun(o, [planLimit(1)]); const b = await startRun(o, [planLimit(1)]);
    expect(a?.fundedBy).toBe("credit"); expect(b?.fundedBy).toBe("credit");
    expect(await balance(o)).toBe(0);
    // a: ended before any web search → credit returned (twice is the same as once)
    await outbound.outboundStore.setRunStatus(o, a!.id, "running", "cancelled", new Date(), "cancelled");
    await outbound.outboundStore.setRunStatus(o, a!.id, "cancelled", "cancelled", new Date()).catch(() => {});
    expect(await balance(o)).toBe(1);
    // b: it searched, then finished → stays spent
    await q.query(`UPDATE prospect_runs SET counters = '{"searched": 3}' WHERE id = $1`, [b!.id]);
    await outbound.outboundStore.setRunStatus(o, b!.id, "running", "cancelled", new Date(), "cancelled");
    expect(await balance(o)).toBe(1);
    await ledgerBalanced(o);
  });

  it("without credits a full plan window still refuses, exactly as before", async () => {
    const o = org();
    expect(await startRun(o, [planLimit(1)])).not.toBeNull();
    expect(await startRun(o, [planLimit(1)])).toBeNull();
  });

  it("a credit-funded search is not trimmed or blocked by the plan's researched-prospects allowance", async () => {
    const o = org(); await addLot(o, 1);
    const prospects = { since: new Date(Date.now() - 30 * DAY), max: 10 };
    const plan = await startRun(o, [planLimit(1)], { quantity: 10, prospects }); expect(plan?.quantity).toBe(10);
    const paid = await startRun(o, [planLimit(1)], { quantity: 10, prospects });
    expect(paid?.fundedBy).toBe("credit"); expect(paid?.quantity).toBe(10);
    expect(await outbound.outboundStore.prospectsHeldSince(o, new Date(Date.now() - 30 * DAY))).toBe(10);   // the plan's prospects ignore the credit run
  });

  it("AI drafts use the plan first, then credits, under concurrency; the plan's count ignores credit drafts", async () => {
    const o = org(); await addLot(o, 3, { kind: "draft" });
    const allowance = { since: new Date(Date.now() - 30 * DAY), max: 2, prefix: "draft-", credit: { cost: 1 } };
    const draft = (leadId: number) => messages.messageStore.create({
      orgId: o, leadId, subject: "s", body: "b", bodyHash: "h", toAddress: "a@b.test", toSource: "lead", researchId: null, claimIds: [], promptVersion: "draft-v2", by: "user", userId: "u", now: new Date(), allowance,
    }).then((r) => r, (e) => (e instanceof messages.DraftAllowanceReached ? null : Promise.reject(e)));
    const out = await Promise.all(Array.from({ length: 10 }, () => draft(lead())));
    const saved = out.filter((r) => r !== null) as any[];
    expect(saved).toHaveLength(5);                                         // 2 plan + 3 credit
    expect(saved.filter((r) => r.fundedBy === "credit")).toHaveLength(3);
    expect(await balance(o, "draft")).toBe(0);
    expect(await messages.messageStore.countAiDrafts(o, allowance.since, "draft-")).toBe(2);
    await ledgerBalanced(o);
  });

  it("a duplicate draft for the same lead is rejected and costs no credit", async () => {
    const o = org(); await addLot(o, 2, { kind: "draft" });
    const allowance = { since: new Date(Date.now() - 30 * DAY), max: 0, prefix: "draft-", credit: { cost: 1 } };
    const dupLead = lead();
    const make = () => messages.messageStore.create({ orgId: o, leadId: dupLead, subject: "s", body: "b", bodyHash: "h", toAddress: "a@b.test", toSource: "lead", researchId: null, claimIds: [], promptVersion: "draft-v2", by: "user", userId: "u", now: new Date(), allowance });
    await make();
    await expect(make()).rejects.toBeInstanceOf(messages.DraftExists);
    expect(await balance(o, "draft")).toBe(1);
    await ledgerBalanced(o);
  });

  it("a batch of message versions costs one draft credit", async () => {
    const o = org(); await addLot(o, 2, { kind: "draft" });
    const allowance = { since: new Date(Date.now() - 30 * DAY), max: 0, prefix: "draft-", credit: { cost: 1 } };
    const rows = await messages.messageStore.createVariants({
      orgId: o, leadId: lead(), toAddress: "a@b.test", toSource: "lead", researchId: null, claimIds: [], by: "user", userId: "u", now: new Date(), group: randomUUID(), allowance,
      variants: [1, 2, 3].map((n) => ({ strategy: `s${n}`, subject: "s", body: `b${n}`, bodyHash: `h${n}`, promptVersion: "draft-v2" })),
    });
    expect(rows).toHaveLength(3);
    expect(await balance(o, "draft")).toBe(1);
  });

  it("channel drafts: five channels cost five credits, and a refusal leaves no draft behind", async () => {
    const o = org(); await addLot(o, 2, { kind: "draft" });
    const allowance = { since: new Date(Date.now() - 30 * DAY), max: 0, prefix: "draft-", credit: { cost: 1 } };
    const mk = (leadId: number, channel: "whatsapp" | "linkedin" | "x") => channels.channelStore.create({
      orgId: o, leadId, channel, kind: "text", body: "hi", bodyHash: `h${leadId}${channel}`, toAddress: "+10000000000", promptVersion: "draft-ch4", claimIds: [], by: "user", userId: "u", now: new Date(), allowance,
    } as any).then((r) => r, (e) => (e instanceof channels.ChannelAllowanceReached ? null : Promise.reject(e)));
    const out = await Promise.all([mk(lead(), "whatsapp"), mk(lead(), "linkedin"), mk(lead(), "x")]);
    expect(out.filter((r) => r !== null)).toHaveLength(2);
    expect(await balance(o, "draft")).toBe(0);
    const left = (await q.query(`SELECT count(*)::int AS n FROM channel_messages WHERE organization_id = $1`, [o])).rows[0].n;
    expect(left).toBe(2);                                                  // the refused draft was rolled back, not saved unpaid
    await ledgerBalanced(o);
  });

  /* ── operator grants ───────────────────────────────────────────────────── */

  it("an operator grant and deduction are idempotent by request id, never go below zero, and are audited with their reason", async () => {
    const o = org(); const req1 = randomUUID(), req2 = randomUUID();
    const g1 = await credits.adminGrantCredits({ orgId: o, kind: "search", units: 4, reason: "goodwill after outage", adminUserId: "admin-t", requestId: req1 });
    const g2 = await credits.adminGrantCredits({ orgId: o, kind: "search", units: 4, reason: "goodwill after outage", adminUserId: "admin-t", requestId: req1 });
    expect(g1.replay).toBe(false); expect(g2.replay).toBe(true);
    expect(await balance(o)).toBe(4);
    const d1 = await credits.adminDeductCredits({ orgId: o, kind: "search", units: 10, reason: "abuse clean-up", adminUserId: "admin-t", requestId: req2 });
    expect(d1).toEqual({ replay: false, removed: 4 });                    // only what was there
    expect((await credits.adminDeductCredits({ orgId: o, kind: "search", units: 10, reason: "abuse clean-up", adminUserId: "admin-t", requestId: req2 })).replay).toBe(true);
    expect(await balance(o)).toBe(0);
    await ledgerBalanced(o);
    const audit = (await q.query(`SELECT action, reason FROM admin_audit_log WHERE detail->>'requestId' IN ($1, $2) ORDER BY id`, [req1, req2])).rows;
    expect(audit).toEqual([{ action: "credits.grant", reason: "goodwill after outage" }, { action: "credits.deduct", reason: "abuse clean-up" }]);
    await q.query(`DELETE FROM admin_audit_log WHERE detail->>'requestId' IN ($1, $2)`, [req1, req2]);
  });

  it("the database refuses a lot that would go negative or above what was bought", async () => {
    const o = org(); const { lotId } = await addLot(o, 2) as any;
    await expect(q.query(`UPDATE credit_lots SET remaining = -1 WHERE id = $1`, [lotId])).rejects.toThrow(/credit_lots_remaining_ck/);
    await expect(q.query(`UPDATE credit_lots SET remaining = 3 WHERE id = $1`, [lotId])).rejects.toThrow(/credit_lots_remaining_ck/);
  });

  it("purchased credits survive the plan lapsing: they belong to the workspace, not to a subscription", async () => {
    const { o, user } = await seedBuyer(); const pack = await seedPack(5, 49);
    const made = await orders.createCreditPackOrder(user, pack, fakeRazorpay); if (!made.ok) throw new Error("order");
    await events.handleWebhookEvent(capture(captured(made.order.id, 49)), deps.paymentOrderStore, fxOf());
    await q.query(`UPDATE users SET plan = 'free', plan_expires_at = now() - interval '1 day' WHERE organization_id = $1`, [o]);
    expect(await balance(o)).toBe(5);
  });

  it("the spend ceiling grows only by what was bought and spent", async () => {
    const { workspaceCeilingMicroUsd } = await import("./spend-ceiling");
    const { workspaceMonthlySpendMicroUsd } = await import("../outbound/limits");
    const o = org(); await addLot(o, 4);
    const base = workspaceMonthlySpendMicroUsd(process.env, o);
    expect(await workspaceCeilingMicroUsd(o)).toBe(base);
    await spend(o, `run:c1-${randomUUID()}`); await spend(o, `run:c2-${randomUUID()}`);
    expect(await workspaceCeilingMicroUsd(o)).toBe(base + 2 * 250_000);   // default headroom $0.25 per search credit
    await credits.undoCreditConsume({ orgId: o, sourceRef: "none", now: new Date() });
  });
});
