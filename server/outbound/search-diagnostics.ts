/**
 * Where opt-in diagnostics are written: one JSON line per record, in a local directory that git ignores
 * (.diagnostics/outbound-search/ or .diagnostics/outbound-research/<run id>.jsonl by default). Each kind is off unless
 * its switch is set: OUTBOUND_SEARCH_DIAGNOSTICS=1, OUTBOUND_RESEARCH_DIAGNOSTICS=1. Writing never
 * fails a run: a problem is logged by its type only. The records are built by shared/search-diagnostics.ts, which keeps
 * no titles, snippets, URL paths, query text, contact details or keys.
 */
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export const DEFAULT_SEARCH_DIAGNOSTICS_DIR = ".diagnostics/outbound-search";

/** The directory to write to, or null (the default: diagnostics off). */
export function searchDiagnosticsDir(env: Record<string, string | undefined> = process.env): string | null {
  if (env.OUTBOUND_SEARCH_DIAGNOSTICS !== "1") return null;
  return (env.OUTBOUND_SEARCH_DIAGNOSTICS_DIR || DEFAULT_SEARCH_DIAGNOSTICS_DIR).trim() || null;
}

export const DEFAULT_RESEARCH_DIAGNOSTICS_DIR = ".diagnostics/outbound-research";
/** Research date diagnostics (shared/research-diagnostics.ts): off unless OUTBOUND_RESEARCH_DIAGNOSTICS=1. */
export function researchDiagnosticsDir(env: Record<string, string | undefined> = process.env): string | null {
  if (env.OUTBOUND_RESEARCH_DIAGNOSTICS !== "1") return null;
  return (env.OUTBOUND_RESEARCH_DIAGNOSTICS_DIR || DEFAULT_RESEARCH_DIAGNOSTICS_DIR).trim() || null;
}

/** Appends one record as a JSON line (search or research diagnostics alike). */
export async function writeSearchDiagnostic(dir: string, runId: string, record: object): Promise<void> {
  try {
    const file = `${String(runId).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60) || "run"}.jsonl`;
    await mkdir(dir, { recursive: true });
    await appendFile(join(dir, file), `${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`, "utf8");
  } catch (e) {
    console.log(JSON.stringify({ kind: "outbound_search_diagnostics_failed", errorType: (e as Error)?.name ?? "Error" }));
  }
}
