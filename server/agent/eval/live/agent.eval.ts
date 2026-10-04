/**
 * LIVE agent evaluation: the real model, the real loop, policy, tools and
 * services, and an in-memory world. It spends model calls, so it is NOT picked
 * up by `vitest run`; it runs only through script/agent-eval.mts, which sets
 * the EVAL_* environment and refuses to start without --live.
 *
 * Nothing here touches a database, sends an email or reaches anything but the
 * model provider: storage, billing, email and routes are the world mocks.
 * Assertion failures are RESULTS, not test failures; the CLI turns them into an
 * exit code after summarising.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, it, vi } from "vitest";

vi.mock("../../../storage", async () => (await import("../world-mocks")).storageMock());
vi.mock("../../../entitlements", async () => (await import("../world-mocks")).entitlementsMock());
vi.mock("../../../emails", async () => (await import("../world-mocks")).emailsMock());
vi.mock("../../../leads/profile-store", async () => (await import("../world-mocks")).profileStoreMock());
vi.mock("../../../discovery/provider", async () => (await import("../world-mocks")).discoveryProviderMock());
vi.mock("../../../discovery/usage", async () => (await import("../world-mocks")).discoveryUsageMock());
vi.mock("../../../documents/style-store", async () => (await import("../world-mocks")).documentStyleStoreMock());
vi.mock("../../../leads/store", async () => (await import("../world-mocks")).leadsStoreMock());
vi.mock("../../../routes", async () => (await import("../world-mocks")).routesMock());

import { getLocaleSettings } from "@shared/schema";
import { aiProvider } from "../../../copilot/provider";
import { buildTurnContext } from "../../context";
import { converse, type ConversationDeps } from "../../conversation";
import { toolSpecs } from "../../jsonschema";
import { MemoryAgentStore } from "../../memory-store";
import { agentSystemPrompt } from "../../prompt";
import { AGENT_TOOLS } from "../../tools";
import type { AgentUser } from "../../types";
import { evaluate } from "../assertions";
import { parseDataset, type EvalCase } from "../dataset/schema";
import { buildWorld, resolveRefs, snapshotWorld } from "../dataset/seed";
import type { RunRecord } from "../metrics";
import { estimateCostUsd, pricesFromEnv } from "../pricing";
import { gitSha, promptFingerprint, writeResults } from "../results";
import { buildTrajectory } from "../trajectory";
import { useWorld } from "../world-mocks";

const env = process.env;
const REPEAT = Math.max(1, Number(env.EVAL_REPEAT ?? 3));
const MAX_CALLS = Math.max(1, Number(env.EVAL_MAX_CALLS ?? 400));
const FILTER = (env.EVAL_CASE ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const TRACE = env.EVAL_TRACE === "1";
const DATASET = env.EVAL_DATASET ?? "agent-v1.json";
const RESULT_FILE = env.EVAL_RESULT_FILE ?? "";
const prices = pricesFromEnv();

if (!env.DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY is not set: run through script/agent-eval.mts with --env-file=.env");

const dataset = parseDataset(JSON.parse(readFileSync(path.join(__dirname, "..", "dataset", DATASET), "utf8")));
const cases = dataset.cases.filter((c) => !FILTER.length || FILTER.includes(c.id) || c.tags.some((t) => FILTER.includes(t)));

// The agent logs one JSON line per run and tool call; keep the console readable.
vi.spyOn(console, "log").mockImplementation(() => {});

// Count every model call (the agent loop AND the extraction call share this
// provider), and stop at the budget.
let modelCalls = 0;
let budgetHit = false;
const realChat = aiProvider.chat.bind(aiProvider);
(aiProvider as any).chat = async (...args: Parameters<typeof realChat>) => {
  if (modelCalls >= MAX_CALLS) { budgetHit = true; throw new Error("EVAL_MAX_CALLS reached"); }
  modelCalls++;
  return realChat(...args);
};

const records: RunRecord[] = [];

async function runCase(c: EvalCase, repeat: number): Promise<RunRecord> {
  const { world, user, refs } = buildWorld(c.world);
  useWorld(world);
  const { turns, expect: expectations } = resolveRefs({ turns: c.turns, expect: c.expect }, refs);

  const store = new MemoryAgentStore();
  let sessionId: string | null = null;
  const deps: ConversationDeps = {
    store, provider: aiProvider, tools: AGENT_TOOLS, enabled: () => true, takeQuota: () => true, locks: new Set(),
    getSession: async (_u, id) => (id === sessionId ? { id, title: "eval", dealId: null } : null),
    createSession: async () => { sessionId = "eval-session"; return { id: sessionId, title: null, dealId: null }; },
    loadContext: async ({ user: u, text, hint, channel }) => ({
      ...(await buildTurnContext({ user: u, sessionDealId: null, text, hint, channel })),
      autonomy: c.world.autonomy,
    }),
  };

  const worldBefore = snapshotWorld(world);
  const callsBefore = modelCalls;
  const started = Date.now();
  const replies: string[] = [];
  for (const text of turns) {
    const out = await converse(deps, { user: user as AgentUser & Record<string, any>, text, adapter: { channel: "web", emit: () => {} }, sessionId });
    replies.push(out.ok ? out.result.reply : out.message);
    if (out.ok) sessionId = out.sessionId;
  }
  const trajectory = buildTrajectory({
    store, replies, userTurns: turns, modelCalls: modelCalls - callsBefore, latencyMs: Date.now() - started,
    worldBefore, worldAfter: snapshotWorld(world), emailsSent: world.emails.length,
  });
  return {
    caseId: c.id, repeat,
    assertions: evaluate(expectations, trajectory),
    tools: trajectory.tools, steps: trajectory.steps, modelCalls: trajectory.modelCalls,
    tokensIn: trajectory.tokensIn, tokensOut: trajectory.tokensOut, latencyMs: trajectory.latencyMs,
    failed: trajectory.failed, costUsd: estimateCostUsd(trajectory.tokensIn, trajectory.tokensOut, prices),
    ...(TRACE ? { trace: { replies: trajectory.replies, approvals: trajectory.approvals.map((a) => ({ tool: a.tool, args: a.args })) } } : {}),
  };
}

describe(`agent live evaluation: ${dataset.name} v${dataset.version}`, () => {
  for (const c of cases) {
    for (let r = 0; r < REPEAT; r++) {
      it(`${c.id} #${r + 1}`, async () => {
        if (modelCalls >= MAX_CALLS) {
          records.push({ caseId: c.id, repeat: r, skipped: true, assertions: [], tools: [], steps: 0, modelCalls: 0, tokensIn: 0, tokensOut: 0, latencyMs: 0, failed: false, costUsd: 0 });
          return;
        }
        budgetHit = false;
        const record = await runCase(c, r);
        // A run cut short by the call budget says nothing about the agent.
        records.push(budgetHit ? { ...record, skipped: true } : record);
      });
    }
  }

  afterAll(() => {
    if (!RESULT_FILE) return;
    const settings = getLocaleSettings({ country: "IN" });
    writeResults(path.dirname(RESULT_FILE), {
      meta: {
        startedAt: new Date().toISOString(), model: aiProvider.model, dataset: dataset.name, datasetVersion: dataset.version,
        promptHash: promptFingerprint(agentSystemPrompt(settings, "client_work", "web"), toolSpecs(AGENT_TOOLS)),
        gitSha: gitSha(), repeat: REPEAT, maxCalls: MAX_CALLS, prices,
      },
      records,
    }, path.basename(RESULT_FILE));
  });
});
