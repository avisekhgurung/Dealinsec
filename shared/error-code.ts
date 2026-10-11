/**
 * Every stored error code goes into a varchar(30) column (prospect_run_items, prospect_runs, provider_calls, llm_calls):
 * a longer value makes the database refuse the write, which would crash the step writing it. Codes are shaped to fit
 * where they are made, and every store clips them again before writing, so a long code can never stall a run.
 */
export const ERROR_CODE_MAX = 30;
/** A code made safe for that column: letters, digits, "_" and ":" only, at most 30 characters, never empty. */
export const clipCode = (code: string): string => String(code ?? "").replace(/[^A-Za-z0-9_:]/g, "").slice(0, ERROR_CODE_MAX) || "error";
/** clipCode for a value that may be null (null stays null). */
export const clipCodeOrNull = (code: string | null | undefined): string | null => (code == null ? null : clipCode(code));
