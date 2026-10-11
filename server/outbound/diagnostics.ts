/**
 * Why a run's companies failed, from what the database already holds: each failed or still-retrying item's step and
 * error code (the pipeline stores "research:invalid_response", "enrich:timeout", "research:page_error:unreachable"),
 * and the model calls' outcomes per task. Codes and counts only: no page text, no prompts, no people, no messages.
 * Used by the benchmark harness to keep the evidence a failed run needs before its rows are cleaned up.
 */
export interface ItemRow { domain: string; stage: string; errorCode: string | null; attempts: number }
export interface CallRow { task: string; ok: boolean; errorCode: string | null; n: number; avgLatencyMs?: number | null; maxTokensOut?: number | null }
export interface FailureEntry { domain: string; step: string; code: string; attempts: number }
export interface FailureReport {
  failed: FailureEntry[];
  /** Items that hit an error and were still waiting for a retry when the run ended. */
  retrying: FailureEntry[];
  /** "research:invalid_response" -> 3 */
  byCode: Record<string, number>;
  calls: { task: string; ok: boolean; errorCode: string | null; n: number; avgLatencyMs: number | null; maxTokensOut: number | null }[];
}

/** "research:page_error:unreachable" -> step "research", code "page_error:unreachable". A code from before steps were recorded has step "unknown". */
export function splitFailureCode(code: string | null | undefined): { step: string; code: string } {
  const c = String(code ?? "").trim();
  if (!c) return { step: "unknown", code: "unknown" };
  const m = c.match(/^(verify|enrich|research):(.+)$/);
  return m ? { step: m[1], code: m[2] } : { step: "unknown", code: c };
}

export function failureReport(items: ItemRow[], calls: CallRow[]): FailureReport {
  const entry = (i: ItemRow): FailureEntry => ({ domain: i.domain, ...splitFailureCode(i.errorCode), attempts: i.attempts });
  const failed = items.filter((i) => i.stage === "failed").map(entry);
  // Still waiting: an error was recorded and the item never moved past the stage it failed in.
  const retrying = items.filter((i) => i.stage !== "failed" && i.stage !== "done" && i.stage !== "rejected" && i.attempts > 0 && i.errorCode)
    .map((i) => ({ domain: i.domain, step: { found: "verify", verified: "enrich", enriched: "research" }[i.stage] ?? i.stage, code: String(i.errorCode), attempts: i.attempts }));
  const byCode: Record<string, number> = {};
  for (const f of failed) { const k = `${f.step}:${f.code}`; byCode[k] = (byCode[k] ?? 0) + 1; }
  return {
    failed, retrying, byCode,
    calls: calls.map((c) => ({ task: c.task, ok: c.ok, errorCode: c.errorCode ?? null, n: c.n, avgLatencyMs: c.avgLatencyMs ?? null, maxTokensOut: c.maxTokensOut ?? null })),
  };
}

/** Anything that runs a parameterised query (a pg Pool or Client): kept tiny so the benchmark scripts and tests share it. */
export type Query = (text: string, params: unknown[]) => Promise<{ rows: any[] }>;
/**
 * The failure report for one workspace, read before its rows are cleaned up: items' stage, step:code and attempts, and
 * the model calls' outcomes (task, ok, error code, count, average latency, largest output). No text column is selected.
 */
export async function readFailureReport(query: Query, orgId: string): Promise<FailureReport> {
  const items = (await query(`SELECT p.domain, i.stage, i.error_code, i.attempts FROM prospect_run_items i JOIN prospects p ON p.id = i.prospect_id WHERE i.organization_id = $1`, [orgId])).rows;
  const llm = (await query(`SELECT task, ok, error_code, count(*)::int AS n, round(avg(latency_ms))::int AS lat, max(tokens_out)::int AS maxout FROM llm_calls WHERE organization_id = $1 GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`, [orgId])).rows;
  return failureReport(
    items.map((r) => ({ domain: String(r.domain), stage: String(r.stage), errorCode: r.error_code ?? null, attempts: Number(r.attempts ?? 0) })),
    llm.map((r) => ({ task: String(r.task), ok: !!r.ok, errorCode: r.error_code ?? null, n: Number(r.n), avgLatencyMs: r.lat ?? null, maxTokensOut: r.maxout ?? null })),
  );
}
/** One log line for a person reading a benchmark log: counts and codes only. */
export const failureLine = (r: FailureReport) =>
  `failures: ${r.failed.length} failed, ${r.retrying.length} still retrying ${JSON.stringify(r.byCode)}; model calls ${JSON.stringify(r.calls.map((c) => `${c.task}/${c.ok ? "ok" : c.errorCode ?? "error"}=${c.n}`))}`;
