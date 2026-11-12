/**
 * A workspace's 30-day AI spend counts its coworker chat turns too (12 Nov 2026), priced from their recorded tokens:
 * a chat-heavy workspace reaches its ceiling like any other. Real Postgres only (MAILBOX_PG_TEST_URL, a local database).
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const URL_ = process.env.MAILBOX_PG_TEST_URL;
const loopback = (u?: string) => { try { return !!u && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(u).hostname); } catch { return false; } };

describe.skipIf(!URL_ || !loopback(URL_))("workspace AI spend includes coworker chats (real Postgres)", () => {
  let q: any, ts: typeof import("./trace-store");
  const org = `t-spend-${randomBytes(5).toString("hex")}`;
  beforeAll(async () => {
    process.env.DATABASE_URL = URL_!;
    ts = await import("./trace-store");
    const { default: pg } = await import("pg");
    q = new pg.Client({ connectionString: URL_ }); await q.connect();
  });
  afterAll(async () => {
    await q.query(`DELETE FROM llm_calls WHERE organization_id = $1`, [org]).catch(() => {});
    await q.query(`DELETE FROM agent_runs WHERE organization_id = $1`, [org]).catch(() => {});
    await q?.end();
  });

  it("model calls plus chat turns at list price; an old chat turn falls out of the window", async () => {
    const now = new Date();
    const since = new Date(now.getTime() - 30 * 86_400_000);
    await q.query(`INSERT INTO llm_calls (organization_id, task, model, prompt_version, cost_micro_usd, ok, created_at) VALUES ($1, 'draft', 'm', 'draft-v8:direct', 1000, true, $2)`, [org, now.toISOString()]);
    // 1,000,000 tokens in and 100,000 out at $0.27 and $1.10 a million: 270,000 + 110,000 micro-USD.
    await q.query(`INSERT INTO agent_runs (session_id, organization_id, user_id, status, tokens_in, tokens_out, started_at) VALUES ('s-spend', $1, 'u', 'completed', 1000000, 100000, $2)`, [org, now.toISOString()]);
    await q.query(`INSERT INTO agent_runs (session_id, organization_id, user_id, status, tokens_in, tokens_out, started_at) VALUES ('s-spend', $1, 'u', 'completed', 9000000, 0, $2)`, [org, new Date(now.getTime() - 40 * 86_400_000).toISOString()]);
    expect(await ts.traceStore.workspaceSpend(org, since)).toBe(1000 + 270_000 + 110_000);
  });
});
