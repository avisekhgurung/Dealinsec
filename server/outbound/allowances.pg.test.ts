/**
 * The plan allowances and the workspace spend ceiling against a REAL Postgres: each is decided under a lock together
 * with the write it allows, so concurrent requests can't pass it together, and one workspace's usage never limits another.
 *   - the spend ceiling: model-call reservations (trace-store.ts) and web-search reservations (outbound/store.ts) share
 *     one ledger and one per-workspace lock
 *   - researched prospects: createRun trims a new run to what is left, and refuses at zero
 *   - AI drafts: message-store.ts create with an allowance
 *   - prospect feedback: one verdict per prospect per workspace
 *
 * Runs only with MAILBOX_PG_TEST_URL set to a disposable LOCAL database with the full schema, the prospect tables and
 * script/migrate-prospect-feedback.ts applied. Fresh organization ids per case; only their rows are deleted.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const URL_ = process.env.MAILBOX_PG_TEST_URL;
const loopback = (u?: string) => { try { return !!u && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(u).hostname); } catch { return false; } };

describe.skipIf(!URL_ || !loopback(URL_))("plan allowances and the spend ceiling (real Postgres)", () => {
  let pg: any, q: any;
  let traces: typeof import("../llm/trace-store");
  let outbound: typeof import("./store");
  let messages: typeof import("../sales/message-store");
  let feedback: typeof import("./prospect-feedback");
  const orgs: string[] = [];
  const org = () => { const o = `t-${randomBytes(5).toString("hex")}`; orgs.push(o); return o; };
  const DAY = 86_400_000;

  beforeAll(async () => {
    // UTC like production: these columns are zone-less and written as UTC text.
    const utc = new URL(URL_!); utc.searchParams.set("options", "-c TimeZone=UTC");
    process.env.DATABASE_URL = utc.toString();
    traces = await import("../llm/trace-store");
    outbound = await import("./store");
    messages = await import("../sales/message-store");
    feedback = await import("./prospect-feedback");
    ({ default: pg } = await import("pg"));
    q = new pg.Client({ connectionString: process.env.DATABASE_URL }); await q.connect();
  });
  afterAll(async () => {
    for (const o of orgs) for (const t of ["llm_calls", "provider_calls", "prospect_runs", "lead_messages", "prospect_feedback"]) await q.query(`DELETE FROM ${t} WHERE organization_id = $1`, [o]).catch(() => {});
    await q?.end();
  });

  const llmRow = (orgId: string, cost: number) => ({ organizationId: orgId, task: "enrich", model: "m", promptVersion: "t", tokensIn: 0, tokensOut: 0, latencyMs: 0, costMicroUsd: cost, ok: false, errorCode: "reserved" });
  const generous = { since: new Date(Date.now() - DAY), overallMicroUsd: 1e12, poolMicroUsd: 1e12, poolTasks: ["enrich"] as const };

  it("model calls and web searches racing for one workspace's ceiling never pass it together", async () => {
    const o = org();
    const workspace = { since: new Date(Date.now() - 30 * DAY), maxMicroUsd: 100_000 };
    const out = await Promise.all([
      ...Array.from({ length: 8 }, () => traces.traceStore.reserve(llmRow(o, 20_000), { ...generous, workspace })),
      ...Array.from({ length: 8 }, () => outbound.outboundStore.reserveSearch({ orgId: o, runId: null, provider: "tavily", costMicroUsd: 20_000, limit: 1e9, since: new Date(Date.now() - DAY), now: new Date(), workspace })),
    ]);
    expect(out.filter((x) => typeof x === "number")).toHaveLength(5);          // 5 × $0.02 = the $0.10 ceiling
    expect(out.filter((x) => x === "workspace")).toHaveLength(11);
    expect(await traces.traceStore.workspaceSpend(o, workspace.since)).toBe(100_000);
  });

  it("another workspace's spend, and spend older than the window, don't count", async () => {
    const [a, b] = [org(), org()];
    await q.query(`INSERT INTO llm_calls (organization_id, task, model, prompt_version, tokens_in, tokens_out, latency_ms, cost_micro_usd, ok, created_at) VALUES ($1, 'enrich', 'm', 't', 0, 0, 0, 900000, true, now() - interval '31 days'), ($2, 'enrich', 'm', 't', 0, 0, 0, 900000, true, now())`, [a, b]);
    const workspace = { since: new Date(Date.now() - 30 * DAY), maxMicroUsd: 100_000 };
    expect(typeof (await traces.traceStore.reserve(llmRow(a, 50_000), { ...generous, workspace }))).toBe("number");
    expect(await traces.traceStore.reserve(llmRow(b, 50_000), { ...generous, workspace })).toBe("workspace");
  });

  it("researched prospects: concurrent starts hold no more than the allowance, a run is trimmed to what's left, then refused", async () => {
    const o = org();
    const start = (quantity: number) => outbound.outboundStore.createRun({
      id: `pr_${randomUUID()}`, orgId: o, userId: "u", by: "user", request: "x", icp: {}, quantity, idemKey: randomUUID(), queries: [], now: new Date(),
      limits: [], prospects: { since: new Date(Date.now() - 30 * DAY), max: 10 },
    }).then((r) => r.quantity, (e) => (e instanceof outbound.RunLimitReached ? 0 : Promise.reject(e)));
    const held = await Promise.all(Array.from({ length: 6 }, () => start(3)));
    expect(held.reduce((n, x) => n + x, 0)).toBe(10);                          // 3 + 3 + 3 + 1, then refusals
    expect(held.filter((x) => x === 0).length).toBe(2);
    // A finished run frees what it didn't research.
    await q.query(`UPDATE prospect_runs SET status = 'done', counters = '{"searched": 2, "researched": 1}' WHERE organization_id = $1 AND quantity = 1`, [o]);
    expect(await outbound.outboundStore.prospectsHeldSince(o, new Date(Date.now() - 30 * DAY))).toBe(10);
    await q.query(`UPDATE prospect_runs SET status = 'done', counters = '{"searched": 2, "researched": 0}' WHERE organization_id = $1 AND quantity = 1`, [o]);
    expect(await outbound.outboundStore.prospectsHeldSince(o, new Date(Date.now() - 30 * DAY))).toBe(9);
    expect(await start(3)).toBe(1);
  });

  it("AI drafts: concurrent saves can't pass the allowance; template follow-ups and other workspaces don't count", async () => {
    const [o, other] = [org(), org()];
    const allowance = { since: new Date(Date.now() - 30 * DAY), max: 2, prefix: "draft-" };
    const draft = (orgId: string, leadId: number, promptVersion = "draft-v2", withAllowance = true) => messages.messageStore.create({
      orgId, leadId, subject: "s", body: "b", bodyHash: "h", toAddress: "a@b.test", toSource: "lead", researchId: null, claimIds: [], promptVersion, by: "user", userId: "u", now: new Date(),
      ...(withAllowance ? { allowance } : {}),
    }).then(() => "saved", (e) => (e instanceof messages.DraftAllowanceReached ? "limit" : Promise.reject(e)));
    await draft(o, 1_000_001, "followup-v1", false);
    await draft(other, 1_000_002, "draft-v2", false);
    const out = await Promise.all([1, 2, 3, 4].map((i) => draft(o, 1_000_010 + i)));
    expect(out.filter((x) => x === "saved")).toHaveLength(2);
    expect(await messages.messageStore.countAiDrafts(o, allowance.since, "draft-")).toBe(2);
  });

  it("feedback: one verdict per prospect per workspace, the latest wins, null clears it, never read across workspaces", async () => {
    const [o, other] = [org(), org()];
    expect(await feedback.prospectFeedbackReady()).toBe(true);
    await feedback.feedbackStore.set({ orgId: o, prospectId: 7, value: "relevant", userId: "u", now: new Date() });
    await feedback.feedbackStore.set({ orgId: o, prospectId: 7, value: "duplicate", userId: "u", now: new Date() });
    await feedback.feedbackStore.set({ orgId: other, prospectId: 7, value: "not_relevant", userId: "v", now: new Date() });
    expect([...(await feedback.feedbackStore.forProspects(o, [7, 8]))]).toEqual([[7, "duplicate"]]);
    await feedback.feedbackStore.set({ orgId: o, prospectId: 7, value: null, userId: "u", now: new Date() });
    expect((await feedback.feedbackStore.forProspects(o, [7])).size).toBe(0);
    expect([...(await feedback.feedbackStore.forProspects(other, [7]))]).toEqual([[7, "not_relevant"]]);
    await expect(q.query(`INSERT INTO prospect_feedback VALUES ($1, 9, 'great', 'u', now())`, [o])).rejects.toThrow(); // the table refuses an unknown verdict
  });
});
