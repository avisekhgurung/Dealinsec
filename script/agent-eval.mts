/**
 * Live agent evaluation: runs the versioned dataset through the REAL model and
 * reports pass rate, safety failures, tool-call quality, tokens, estimated cost
 * and latency. Nothing touches a database or sends an email: the world is
 * in-memory (server/agent/eval/world.ts); only the model provider is reached.
 *
 *   npx tsx --env-file=.env script/agent-eval.mts --live
 *   npx tsx --env-file=.env script/agent-eval.mts --live --repeat 5 --case read
 *   npx tsx --env-file=.env script/agent-eval.mts --live --compare eval-results/baseline.json
 *
 * Flags
 *   --live              required: this spends model calls
 *   --repeat N          runs per case (default 3)
 *   --max-calls N       hard cap on model calls (default 400)
 *   --case a,b          only these case ids or tags
 *   --dataset file      dataset in server/agent/eval/dataset (default agent-v1.json)
 *   --min-pass 0.9      pass-rate threshold for the exit code
 *   --compare file      show before → after against an earlier results file
 *   --name label        write eval-results/<label>.json instead of a timestamp
 *   --trace             also store each run's replies and proposals in the results
 *                       file, for local triage (the file is gitignored)
 *
 * Exit code: 0 when there are no safety failures and the pass rate meets the
 * threshold; 1 otherwise.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseDataset } from "../server/agent/eval/dataset/schema.ts";
import { compare, formatReport, summarize } from "../server/agent/eval/metrics.ts";
import { pricesFromEnv } from "../server/agent/eval/pricing.ts";
import { readResults } from "../server/agent/eval/results.ts";

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string, fallback?: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback; };

if (!flag("live")) {
  console.error("This spends model calls. Re-run with --live (see the header of this file for flags).");
  process.exit(2);
}
if (!process.env.DEEPSEEK_API_KEY) {
  console.error("DEEPSEEK_API_KEY is not set. Run with: npx tsx --env-file=.env script/agent-eval.mts --live");
  process.exit(2);
}

const repeat = Math.max(1, Number(opt("repeat", "3")));
const maxCalls = Math.max(1, Number(opt("max-calls", "400")));
const minPass = Number(opt("min-pass", "0.9"));
const datasetFile = opt("dataset", "agent-v1.json")!;
const filter = (opt("case", "") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const dataset = parseDataset(JSON.parse(readFileSync(path.resolve("server/agent/eval/dataset", datasetFile), "utf8")));
const selected = dataset.cases.filter((c) => !filter.length || filter.includes(c.id) || c.tags.some((t) => filter.includes(t)));
if (!selected.length) { console.error(`No cases match --case ${filter.join(",")}`); process.exit(2); }

// A rough, deliberately pessimistic estimate: about 3 model calls and 10k input tokens per run.
const runs = selected.length * repeat;
const prices = pricesFromEnv();
const estCalls = Math.min(maxCalls, Math.round(runs * 3));
const estUsd = (runs * (10_000 * prices.inputPerM + 500 * prices.outputPerM)) / 1_000_000;
console.log(`Dataset ${dataset.name} v${dataset.version}: ${selected.length} cases × ${repeat} = ${runs} runs`);
console.log(`Estimated ~${estCalls} model calls (hard cap ${maxCalls}), about $${estUsd.toFixed(2)} at list prices (an estimate).\n`);

const name = opt("name") ?? new Date().toISOString().replace(/[:.]/g, "-");
const resultFile = path.resolve("eval-results", `${name}.json`);

const { DATABASE_URL: _never, ...childEnv } = process.env; // an evaluation never needs a database
const run = spawnSync("npx", ["vitest", "run", "--config", "vitest.live.config.ts"], {
  stdio: "inherit",
  env: { ...childEnv, EVAL_REPEAT: String(repeat), EVAL_MAX_CALLS: String(maxCalls), EVAL_CASE: filter.join(","), EVAL_DATASET: datasetFile, EVAL_RESULT_FILE: resultFile, EVAL_TRACE: flag("trace") ? "1" : "" },
});
if (run.status !== 0) { console.error("\nThe evaluation runner failed before producing results."); process.exit(1); }

const results = readResults(resultFile);
const summary = summarize(results.records);
const before = opt("compare");
const cmp = before ? compare(summarize(readResults(path.resolve(before)).records), summary) : undefined;

console.log(`\n── ${results.meta.model} · prompt ${results.meta.promptHash} · ${results.meta.gitSha} · ${path.relative(process.cwd(), resultFile)} ──`);
console.log(formatReport(summary, cmp));

const safe = summary.overall.safetyFailureRuns === 0;
const passes = summary.overall.passRate >= minPass;
console.log(`\n${safe && passes ? "✓ PASS" : "✗ FAIL"}: safety ${safe ? "clean" : "FAILED"}, pass rate ${(summary.overall.passRate * 100).toFixed(0)}% (threshold ${(minPass * 100).toFixed(0)}%)`);
process.exit(safe && passes ? 0 : 1);
