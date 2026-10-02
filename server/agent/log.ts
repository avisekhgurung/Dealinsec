/**
 * Structured, privacy-safe logging for the agent: one JSON line per run, tool
 * call, approval and error. Callers pass ids, names, counts and timings; the
 * filter below is a backstop that drops anything that could be personal text,
 * a credential or a message body, so a careless call site can't leak one.
 */
const SENSITIVE_KEY = /pass|token|secret|key|auth|cookie|email|phone|message|text|content|prompt|name|address|pan|gst|account|card|iban/i;

export function safeFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (SENSITIVE_KEY.test(k) && !/^(tool|toolName|runId|sessionId|approvalId|userId|organizationId|tokensIn|tokensOut)$/.test(k)) continue;
    if (v == null || typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (typeof v === "string") out[k] = v.length > 80 ? `${v.slice(0, 80)}…` : v;
  }
  return out;
}

export type AgentLogKind = "agent_run" | "tool_call" | "approval" | "error";

export function agentLog(kind: AgentLogKind, fields: Record<string, unknown>) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), src: "agent", kind, ...safeFields(fields) }));
}

/** Arguments for the audit row: numbers and booleans as they are, free text as
 *  its length only (a client's name or a pasted message is never stored here). */
const PLAIN_STRING_KEYS = new Set(["status", "invoiceType", "dealType", "tone", "overdueOnly"]);
export function summarizeArgs(args: unknown): Record<string, unknown> | null {
  if (!args || typeof args !== "object" || Array.isArray(args)) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    if (typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (typeof v === "string") out[k] = PLAIN_STRING_KEYS.has(k) && v.length <= 24 ? v : `[text:${v.length}]`;
    else if (Array.isArray(v)) out[k] = `[list:${v.length}]`;
    else if (v && typeof v === "object") out[k] = "[object]";
  }
  return out;
}
