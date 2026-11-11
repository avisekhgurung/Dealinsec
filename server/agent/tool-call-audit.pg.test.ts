/**
 * The audit row for a tool call, against a REAL Postgres: a long summary (an approved campaign hand-off's is about
 * 315 characters) must still be recorded, cut to the column, not lost. Runs only with MAILBOX_PG_TEST_URL set to a
 * disposable LOCAL database with the agent tables. Its own run id; only its rows are deleted.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const URL_ = process.env.MAILBOX_PG_TEST_URL;
const loopback = (u?: string) => { try { return !!u && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(u).hostname); } catch { return false; } };

describe.skipIf(!URL_ || !loopback(URL_))("a tool call's audit row (real Postgres)", () => {
  let q: any, store: import("./store").DbAgentStore;
  const runId = `t-audit-${randomBytes(6).toString("hex")}`;
  beforeAll(async () => {
    process.env.DATABASE_URL = URL_!;
    store = (await import("./store")).agentStore;
    const { default: pg } = await import("pg");
    q = new pg.Client({ connectionString: URL_ }); await q.connect();
  });
  afterAll(async () => { await q?.query(`DELETE FROM agent_tool_calls WHERE run_id = $1`, [runId]).catch(() => {}); await q?.end(); });

  it("a summary longer than the column is kept, cut to 300 characters with an ellipsis; short ones are untouched", async () => {
    const long = "Started a campaign for Boutique hotel · Darjeeling — first messages. ".repeat(5); // > 300
    expect(long.length).toBeGreaterThan(300);
    await store.recordToolCall({ runId, tool: "handoff_nibo_to_mika_campaign", risk: "WRITE_INTERNAL" as any, status: "ok", args: null, resultSummary: long, errorCode: null, durationMs: 12 });
    await store.recordToolCall({ runId, tool: "list_campaigns", risk: "READ_ONLY" as any, status: "error", args: null, resultSummary: "short", errorCode: "x".repeat(60), durationMs: 3 });
    const rows = (await q.query(`SELECT tool, result_summary, error_code FROM agent_tool_calls WHERE run_id = $1 ORDER BY id`, [runId])).rows;
    expect(rows).toHaveLength(2);
    expect(rows[0].result_summary).toHaveLength(300);
    expect(rows[0].result_summary.endsWith("…")).toBe(true);
    expect(rows[0].result_summary.startsWith("Started a campaign for Boutique hotel")).toBe(true);
    expect(rows[1].result_summary).toBe("short");
    expect(rows[1].error_code).toHaveLength(40);
  });
});
