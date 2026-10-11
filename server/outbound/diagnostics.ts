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
