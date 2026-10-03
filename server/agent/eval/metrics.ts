/**
 * Turning run records into numbers a person can act on, and comparing two
 * reports. Pure.
 *
 * What gets measured, and why:
 *  - pass rate: the share of runs where EVERY assertion held
 *  - safety failures: counted on their own and never averaged into the pass
 *    rate — one is enough to fail the evaluation
 *  - flaky cases: passed some repeats and failed others (the model is unsure)
 *  - invalid tool calls: the model asked for something that doesn't exist or
 *    sent arguments that didn't validate
 *  - repeated calls: the same tool with the same arguments twice in one run
 *    (wasted steps, a loop in the making)
 *  - tokens, estimated cost, latency (p50 / p95)
 */
import { runPassed, safetyFailures, type AssertionResult } from "./assertions";
import type { ToolStep } from "./trajectory";

export interface RunRecord {
  caseId: string;
  repeat: number;
  /** Not run: the call budget was already spent. */
  skipped?: boolean;
  assertions: AssertionResult[];
  tools: ToolStep[];
  steps: number;
  modelCalls: number;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  failed: boolean;
  costUsd: number;
  /** Only with --trace, for local triage: what the agent actually said and proposed. */
  trace?: { replies: string[]; approvals: { tool: string; args: Record<string, unknown> }[] };
}

export interface CaseSummary {
  id: string;
  runs: number;
  passRate: number;
  safetyFailures: number;
  /** Passed some repeats and failed others. */
  flaky: boolean;
  /** Which kinds of assertion failed, and how often. */
  failedAssertions: Record<string, number>;
  avgSteps: number;
  avgToolCalls: number;
  invalidCalls: number;
  repeatedCalls: number;
  tokens: number;
  costUsd: number;
  p50Ms: number;
  p95Ms: number;
}

export interface Overall {
  runs: number;
  skipped: number;
  passRate: number;
  /** Runs with at least one safety assertion failing. */
  safetyFailureRuns: number;
  assertionPassRate: number;
  flakyCases: number;
  invalidCallsPerRun: number;
  repeatedCallsPerRun: number;
  avgSteps: number;
  avgToolCalls: number;
  tokensIn: number;
  tokensOut: number;
  modelCalls: number;
  costUsd: number;
  p50Ms: number;
  p95Ms: number;
}

export interface Summary {
  cases: CaseSummary[];
  overall: Overall;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);

/** Nearest-rank percentile; 0 for no data. */
export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

export function repeatedCalls(tools: ToolStep[]): number {
  const seen = new Set<string>();
  let n = 0;
  for (const t of tools) {
    const key = `${t.name}|${t.argsKey}`;
    if (seen.has(key)) n++;
    seen.add(key);
  }
  return n;
}
const invalidCalls = (tools: ToolStep[]) => tools.filter((t) => t.status === "invalid").length;

export function summarize(records: RunRecord[]): Summary {
  const ran = records.filter((r) => !r.skipped);
  const byCase = new Map<string, RunRecord[]>();
  for (const r of ran) byCase.set(r.caseId, [...(byCase.get(r.caseId) ?? []), r]);

  const cases: CaseSummary[] = Array.from(byCase.entries()).map(([id, rs]) => {
    const passes = rs.map((r) => runPassed(r.assertions));
    const failed: Record<string, number> = {};
    for (const r of rs) for (const a of r.assertions) if (!a.pass) failed[a.type] = (failed[a.type] ?? 0) + 1;
    return {
      id,
      runs: rs.length,
      passRate: passes.filter(Boolean).length / rs.length,
      safetyFailures: rs.filter((r) => safetyFailures(r.assertions).length > 0).length,
      flaky: passes.some(Boolean) && passes.some((p) => !p),
      failedAssertions: failed,
      avgSteps: mean(rs.map((r) => r.steps)),
      avgToolCalls: mean(rs.map((r) => r.tools.length)),
      invalidCalls: sum(rs.map((r) => invalidCalls(r.tools))),
      repeatedCalls: sum(rs.map((r) => repeatedCalls(r.tools))),
      tokens: sum(rs.map((r) => r.tokensIn + r.tokensOut)),
      costUsd: sum(rs.map((r) => r.costUsd)),
      p50Ms: percentile(rs.map((r) => r.latencyMs), 50),
      p95Ms: percentile(rs.map((r) => r.latencyMs), 95),
    };
  });

  const allAssertions = ran.flatMap((r) => r.assertions);
  return {
    cases,
    overall: {
      runs: ran.length,
      skipped: records.length - ran.length,
      passRate: ran.length ? ran.filter((r) => runPassed(r.assertions)).length / ran.length : 0,
      safetyFailureRuns: ran.filter((r) => safetyFailures(r.assertions).length > 0).length,
      assertionPassRate: allAssertions.length ? allAssertions.filter((a) => a.pass).length / allAssertions.length : 0,
      flakyCases: cases.filter((c) => c.flaky).length,
      invalidCallsPerRun: ran.length ? sum(ran.map((r) => invalidCalls(r.tools))) / ran.length : 0,
      repeatedCallsPerRun: ran.length ? sum(ran.map((r) => repeatedCalls(r.tools))) / ran.length : 0,
      avgSteps: mean(ran.map((r) => r.steps)),
      avgToolCalls: mean(ran.map((r) => r.tools.length)),
      tokensIn: sum(ran.map((r) => r.tokensIn)),
      tokensOut: sum(ran.map((r) => r.tokensOut)),
      modelCalls: sum(ran.map((r) => r.modelCalls)),
      costUsd: sum(ran.map((r) => r.costUsd)),
      p50Ms: percentile(ran.map((r) => r.latencyMs), 50),
      p95Ms: percentile(ran.map((r) => r.latencyMs), 95),
    },
  };
}

export interface Comparison {
  overall: { passRate: [number, number]; safetyFailureRuns: [number, number]; costUsd: [number, number]; p95Ms: [number, number]; avgSteps: [number, number] };
  improved: { id: string; before: number; after: number }[];
  regressed: { id: string; before: number; after: number }[];
}

/** Before → after, per case: only cases present in both are compared. */
export function compare(before: Summary, after: Summary): Comparison {
  const prev = new Map(before.cases.map((c) => [c.id, c]));
  const improved: Comparison["improved"] = [];
  const regressed: Comparison["regressed"] = [];
  for (const c of after.cases) {
    const p = prev.get(c.id);
    if (!p || p.passRate === c.passRate) continue;
    (c.passRate > p.passRate ? improved : regressed).push({ id: c.id, before: p.passRate, after: c.passRate });
  }
  const pair = <K extends keyof Overall>(k: K): [number, number] => [before.overall[k] as number, after.overall[k] as number];
  return {
    overall: { passRate: pair("passRate"), safetyFailureRuns: pair("safetyFailureRuns"), costUsd: pair("costUsd"), p95Ms: pair("p95Ms"), avgSteps: pair("avgSteps") },
    improved, regressed,
  };
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const usd = (x: number) => `$${x.toFixed(4)}`;
const ms = (x: number) => `${(x / 1000).toFixed(1)}s`;
const arrow = (pair: [number, number], fmt: (n: number) => string) => (pair[0] === pair[1] ? fmt(pair[1]) : `${fmt(pair[0])} → ${fmt(pair[1])}`);

export function formatReport(s: Summary, cmp?: Comparison): string {
  const o = s.overall;
  const lines: string[] = [];
  lines.push(`Runs: ${o.runs}${o.skipped ? ` (+${o.skipped} skipped: call budget reached)` : ""}   model calls: ${o.modelCalls}`);
  lines.push(`Pass rate:        ${cmp ? arrow(cmp.overall.passRate, pct) : pct(o.passRate)}   (every assertion held)`);
  lines.push(`SAFETY failures:  ${cmp ? arrow(cmp.overall.safetyFailureRuns, String) : o.safetyFailureRuns} runs   ${o.safetyFailureRuns === 0 ? "✓ none" : "✗ MUST BE ZERO"}`);
  lines.push(`Assertion pass:   ${pct(o.assertionPassRate)}   flaky cases: ${o.flakyCases}`);
  lines.push(`Tool calls/run:   ${o.avgToolCalls.toFixed(1)}   invalid/run: ${o.invalidCallsPerRun.toFixed(2)}   repeated/run: ${o.repeatedCallsPerRun.toFixed(2)}   steps/run: ${cmp ? arrow(cmp.overall.avgSteps, (n) => n.toFixed(1)) : o.avgSteps.toFixed(1)}`);
  lines.push(`Tokens:           ${o.tokensIn} in / ${o.tokensOut} out   est. cost ${cmp ? arrow(cmp.overall.costUsd, usd) : usd(o.costUsd)}   latency p50 ${ms(o.p50Ms)} p95 ${cmp ? arrow(cmp.overall.p95Ms, ms) : ms(o.p95Ms)}`);
  const bad = s.cases.filter((c) => c.passRate < 1).sort((a, b) => a.passRate - b.passRate);
  if (bad.length) {
    lines.push("", "Cases that did not always pass:");
    for (const c of bad) {
      const why = Object.entries(c.failedAssertions).map(([k, n]) => `${k}×${n}`).join(", ");
      lines.push(`  ${pct(c.passRate).padStart(4)}  ${c.id}${c.flaky ? "  (flaky)" : ""}${c.safetyFailures ? "  [SAFETY]" : ""}   ${why}`);
    }
  }
  if (cmp?.improved.length) lines.push("", `Improved: ${cmp.improved.map((c) => `${c.id} ${pct(c.before)}→${pct(c.after)}`).join(", ")}`);
  if (cmp?.regressed.length) lines.push(`Regressed: ${cmp.regressed.map((c) => `${c.id} ${pct(c.before)}→${pct(c.after)}`).join(", ")}`);
  return lines.join("\n");
}
