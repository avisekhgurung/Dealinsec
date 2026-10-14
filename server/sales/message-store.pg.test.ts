/**
 * Send recording against a REAL Postgres, with deterministic interleavings: each case holds one side's locks, waits until
 * Postgres reports the other side blocked on them (pg_locks), then lets go, so the order is fixed, not timing-dependent.
 *
 * Runs only with OUTREACH_PG_TEST_URL set to a disposable LOCAL database that has the schema (drizzle-kit push) and
 * script/migrate-outreach-safety.ts applied. Each test uses its own organization id and deletes only its own rows.
 * Never point it at a shared or production database: a non-loopback host is refused.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const URL_ = process.env.OUTREACH_PG_TEST_URL;
const loopback = (u?: string) => { try { return !!u && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(u).hostname); } catch { return false; } };

describe.skipIf(!URL_ || !loopback(URL_))("recording a send, serialized against the lead's flag and the do-not-contact list (real Postgres)", () => {
  let store: typeof import("./message-store");
  let pg: any, other: any, third: any;
  const orgs: string[] = [];
  beforeAll(async () => {
    process.env.DATABASE_URL = URL_!;
    store = await import("./message-store");
    const { default: P } = await import("pg");
    pg = P; other = new pg.Client({ connectionString: URL_ }); third = new pg.Client({ connectionString: URL_ });
    await other.connect(); await third.connect();
  });
  afterAll(async () => {
    for (const o of orgs) for (const t of ["outreach_suppressions", "lead_messages", "leads"]) await other.query(`DELETE FROM ${t} WHERE organization_id = $1`, [o]);
    await other?.end(); await third?.end();
  });

  /** A lead with one approved message to `to`, in a fresh organization. */
  async function seed(to = "ceo@acme-agency.test") {
    const org = `test-${randomUUID()}`; orgs.push(org);
    const lead = (await other.query(`INSERT INTO leads (organization_id, owner_user_id, company_name, domain, source, status, do_not_contact, created_at, updated_at) VALUES ($1, 'u1', 'Acme', $2, 'outbound', 'qualified', false, now(), now()) RETURNING id`, [org, to.split("@")[1]])).rows[0].id;
    const msg = (await other.query(`INSERT INTO lead_messages (lead_id, organization_id, direction, channel, subject, body, body_hash, to_address, to_source, status, claim_ids, created_by, created_at, updated_at) VALUES ($1, $2, 'out', 'manual', 's', 'b', $3, $4, 'site', 'approved', '[]', 'user', now(), now()) RETURNING id`, [lead, org, "0".repeat(64), to])).rows[0].id;
    return { org, lead, msg, to, keys: [{ kind: "email" as const, value: to }, { kind: "domain" as const, value: to.split("@")[1] }] };
  }
  const status = async (id: number) => (await other.query(`SELECT status FROM lead_messages WHERE id = $1`, [id])).rows[0].status;
  /** Resolves once some backend is waiting for a lock (the competing operation is blocked behind the held one). */
  async function blocked() {
    for (let i = 0; i < 200; i++) {
      if ((await third.query(`SELECT count(*)::int n FROM pg_locks WHERE NOT granted`)).rows[0].n > 0) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("nothing ever waited: the operations didn't contend");
  }
  /** A send that pauses while holding all its locks, until released. */
  function heldSend(s: { org: string; msg: number; keys: any[] }) {
    let release!: () => void, reached!: () => void;
    const atHold = new Promise<void>((r) => (reached = r));
    const done = store.messageStore.recordSentIfAllowed({ orgId: s.org, id: s.msg, now: new Date(), keys: s.keys, hold: () => { reached(); return new Promise<void>((r) => (release = r)); } });
    return { atHold, done, release: () => release() };
  }

  it("the lead is flagged first (its row locked, committed while the send waits): the send is refused", async () => {
    const s = await seed();
    await other.query("BEGIN"); await other.query(`UPDATE leads SET do_not_contact = true WHERE id = $1`, [s.lead]);
    const send = store.messageStore.recordSentIfAllowed({ orgId: s.org, id: s.msg, now: new Date(), keys: s.keys });
    await blocked(); await other.query("COMMIT");
    expect((await send).result).toBe("do_not_contact");
    expect(await status(s.msg)).toBe("approved");
  });

  it("the send holds its locks first: flagging the lead waits, so the send is recorded before the flag, never after it", async () => {
    const s = await seed();
    const h = heldSend(s); await h.atHold;
    const flag = third.query(`UPDATE leads SET do_not_contact = true WHERE id = $1`, [s.lead]).catch((e: Error) => e);
    // third is the one waiting, so check via `other`
    for (let i = 0; i < 200 && (await other.query(`SELECT count(*)::int n FROM pg_locks WHERE NOT granted`)).rows[0].n === 0; i++) await new Promise((r) => setTimeout(r, 10));
    h.release();
    expect((await h.done).result).toBe("sent");
    expect(await flag).not.toBeInstanceOf(Error);
    expect(await status(s.msg)).toBe("sent");
  });

  it("the ADDRESS is listed first (under its key's lock, committed while the send waits): the send is refused", async () => {
    const s = await seed();
    await other.query("BEGIN");
    await other.query(`SELECT pg_advisory_xact_lock($1::int, hashtext($2))`, [store.OUTREACH_ADDRESS_LOCK, store.addressLockKey(s.org, s.keys[0])]);
    await other.query(`INSERT INTO outreach_suppressions (organization_id, kind, value, reason, created_at) VALUES ($1, 'email', $2, 'opt_out', now())`, [s.org, s.to]);
    const send = store.messageStore.recordSentIfAllowed({ orgId: s.org, id: s.msg, now: new Date(), keys: s.keys });
    await blocked(); await other.query("COMMIT");
    expect(await send).toMatchObject({ result: "suppressed", entry: { kind: "email", value: s.to } });
    expect(await status(s.msg)).toBe("approved");
  });

  it("the DOMAIN is listed first: the send is refused", async () => {
    const s = await seed("sales@blocked-agency.test");
    await other.query("BEGIN");
    await other.query(`SELECT pg_advisory_xact_lock($1::int, hashtext($2))`, [store.OUTREACH_ADDRESS_LOCK, store.addressLockKey(s.org, s.keys[1])]);
    await other.query(`INSERT INTO outreach_suppressions (organization_id, kind, value, reason, created_at) VALUES ($1, 'domain', 'blocked-agency.test', 'manual', now())`, [s.org]);
    const send = store.messageStore.recordSentIfAllowed({ orgId: s.org, id: s.msg, now: new Date(), keys: s.keys });
    await blocked(); await other.query("COMMIT");
    expect(await send).toMatchObject({ result: "suppressed", entry: { kind: "domain" } });
  });

  it("the send holds its locks first: the real addSuppression (address, then domain) waits and is added after the send", async () => {
    for (const k of [0, 1]) {
      const s = await seed(k ? "info@later-agency.test" : "ceo@later-agency.test");
      const h = heldSend(s); await h.atHold;
      const add = store.messageStore.addSuppression(s.org, { kind: s.keys[k].kind, value: s.keys[k].value, reason: "opt_out", sourceMessageId: null, note: null, userId: null, now: new Date() });
      await blocked();
      h.release();
      expect((await h.done).result).toBe("sent");
      expect((await add).created).toBe(true);
      expect(await status(s.msg)).toBe("sent");
    }
  });

  it("a discard committed while the send waits: the send is refused; two simultaneous sends record once", async () => {
    const s = await seed();
    await other.query("BEGIN"); await other.query(`UPDATE lead_messages SET status = 'cancelled' WHERE id = $1`, [s.msg]);
    const send = store.messageStore.recordSentIfAllowed({ orgId: s.org, id: s.msg, now: new Date(), keys: s.keys });
    await blocked(); await other.query("COMMIT");
    expect(await send).toMatchObject({ result: "not_approved", row: { status: "cancelled" } });
    const t = await seed();
    const [a, b] = await Promise.all([1, 2].map(() => store.messageStore.recordSentIfAllowed({ orgId: t.org, id: t.msg, now: new Date(), keys: t.keys })));
    expect([a.result, b.result].sort()).toEqual(["not_approved", "sent"]);
  });

  it("another organization can't record it; and a storm of competing operations never deadlocks", async () => {
    const s = await seed();
    expect(await store.messageStore.recordSentIfAllowed({ orgId: `test-${randomUUID()}`, id: s.msg, now: new Date(), keys: s.keys })).toMatchObject({ result: "not_approved", row: null });
    for (let i = 0; i < 15; i++) {
      const x = await seed(`p${i}@storm-agency.test`);
      const flagger = new pg.Client({ connectionString: URL_ }); await flagger.connect();
      const ops = await Promise.allSettled([
        store.messageStore.recordSentIfAllowed({ orgId: x.org, id: x.msg, now: new Date(), keys: x.keys }),
        store.messageStore.addSuppression(x.org, { kind: "domain", value: "storm-agency.test", reason: "manual", sourceMessageId: null, note: null, userId: null, now: new Date() }),
        store.messageStore.addSuppression(x.org, { kind: "email", value: x.to, reason: "opt_out", sourceMessageId: null, note: null, userId: null, now: new Date() }),
        flagger.query(`UPDATE leads SET do_not_contact = true WHERE id = $1`, [x.lead]),
        store.messageStore.transition({ orgId: x.org, id: x.msg, from: "approved", to: "cancelled", now: new Date() }),
      ]);
      await flagger.end();
      const failures = ops.filter((o) => o.status === "rejected").map((o: any) => o.reason?.code ?? o.reason?.message);
      expect(failures).toEqual([]); // no deadlock (40P01), no lock error
      const send = (ops[0] as PromiseFulfilledResult<any>).value;
      expect(["sent", "do_not_contact", "suppressed", "not_approved"]).toContain(send.result);
      if (send.result === "sent") expect(await status(x.msg)).toBe("sent");
    }
  }, 60_000);
});
