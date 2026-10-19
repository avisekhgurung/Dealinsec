/**
 * Pinned and renamed conversations against a REAL Postgres: only your own conversation can be renamed or pinned, the
 * pin limit holds, pinned ones come first (even old ones), and deleting a conversation removes its pin.
 * Runs only with MAILBOX_PG_TEST_URL set to a disposable LOCAL database with the agent tables applied.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const URL_ = process.env.MAILBOX_PG_TEST_URL;
const loopback = (u?: string) => { try { return !!u && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(u).hostname); } catch { return false; } };

describe.skipIf(!URL_ || !loopback(URL_))("pinned and renamed conversations (real Postgres)", () => {
  let q: any, store: import("./store").DbAgentStore;
  const org = `t-${randomBytes(5).toString("hex")}`;
  const me = { id: `u-${randomBytes(4).toString("hex")}`, organizationId: org } as any;
  const other = { id: `u-${randomBytes(4).toString("hex")}`, organizationId: org } as any;
  beforeAll(async () => {
    const utc = new URL(URL_!); utc.searchParams.set("options", "-c TimeZone=UTC");
    process.env.DATABASE_URL = utc.toString();
    store = (await import("./store")).agentStore;
    const { default: pg } = await import("pg");
    q = new pg.Client({ connectionString: process.env.DATABASE_URL }); await q.connect();
    const { AGENT_PIN_DDL } = await import("./pins");
    for (const s of AGENT_PIN_DDL) await q.query(s);
  });
  afterAll(async () => {
    await q.query("DELETE FROM agent_session_pins WHERE organization_id = $1", [org]).catch(() => {});
    await q.query("DELETE FROM agent_sessions WHERE organization_id = $1", [org]).catch(() => {});
    await q?.end();
  });

  it("rename: only my own conversation", async () => {
    const s = await store.createSession(me, {});
    expect(await store.renameSession(other, s.id, "Not yours")).toBe(false);
    expect(await store.renameSession(me, s.id, "Acme renewal")).toBe(true);
    expect((await store.getSession(me, s.id))?.title).toBe("Acme renewal");
  });

  it("pin: only my own; pinned come first, even one older than the recent window; unpin restores the order", async () => {
    const old = await store.createSession(me, {});
    await q.query("UPDATE agent_sessions SET updated_at = now() - interval '90 days' WHERE id = $1", [old.id]);
    const recent = await store.createSession(me, {});
    expect(await store.setPinned(other, old.id, true)).toBe("not_found");
    expect(await store.setPinned(me, old.id, true)).toBe("ok");
    expect(await store.setPinned(me, old.id, true)).toBe("ok"); // idempotent
    const list = await store.listSessions(me, 1); // a window of one: the old pinned one still shows
    expect(list[0]).toMatchObject({ id: old.id, pinned: true });
    expect(list.some((r) => r.id === recent.id)).toBe(true);
    expect(await store.setPinned(me, old.id, false)).toBe("ok");
    expect((await store.listSessions(me)).find((r) => r.id === old.id)?.pinned).toBe(false);
  });

  it("at most 10 pinned", async () => {
    const { PIN_LIMIT } = await import("./pins");
    await q.query("DELETE FROM agent_session_pins WHERE organization_id = $1", [org]);
    const ids: string[] = [];
    for (let i = 0; i < PIN_LIMIT + 1; i++) ids.push((await store.createSession(me, {})).id);
    for (const id of ids.slice(0, PIN_LIMIT)) expect(await store.setPinned(me, id, true)).toBe("ok");
    expect(await store.setPinned(me, ids[PIN_LIMIT], true)).toBe("limit");
  });

  it("deleting a conversation removes its pin", async () => {
    await q.query("DELETE FROM agent_session_pins WHERE organization_id = $1", [org]);
    const s = await store.createSession(me, {});
    await store.setPinned(me, s.id, true);
    expect(await store.deleteSession(me, s.id)).toBe(true);
    expect((await q.query("SELECT count(*)::int AS n FROM agent_session_pins WHERE session_id = $1", [s.id])).rows[0].n).toBe(0);
  });
});
