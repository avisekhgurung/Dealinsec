/**
 * What may be attached to an analytics event.
 *
 * A pasted client or brand message can hold private negotiations, names and
 * money, and none of it may reach Google Analytics. Events carry counts,
 * flags and short labels ("audience", "deal_type", "tool"); this is the guard
 * that makes that a property of the code rather than a habit. It drops any
 * parameter whose NAME suggests free text, and any string long enough to be
 * one, so a future call like trackEvent("x", { text: message }) sends nothing.
 *
 * Pure, so it is unit-tested; client/src/lib/analytics.ts applies it to every
 * event.
 */

/** Parameter names that hold, or may hold, what a person typed or pasted. */
const FREE_TEXT_KEYS = new Set([
  "text", "message", "msg", "body", "content", "terms", "notes", "note", "description",
  "prompt", "input", "query", "draft", "email", "name", "client", "brand", "brand_name",
  "client_name", "phone", "address", "title", "campaign", "usage_rights", "exclusivity",
]);

/** A short label or identifier; anything longer is treated as free text. */
export const MAX_PARAM_STRING = 64;

export type EventParams = Record<string, string | number | boolean>;

export function sanitizeEventParams(params?: Record<string, unknown> | null): EventParams | undefined {
  if (!params) return undefined;
  const out: EventParams = {};
  for (const [key, value] of Object.entries(params)) {
    if (FREE_TEXT_KEYS.has(key.toLowerCase())) continue;
    if (typeof value === "number") {
      if (Number.isFinite(value)) out[key] = value;
    } else if (typeof value === "boolean") {
      out[key] = value;
    } else if (typeof value === "string") {
      if (value.length <= MAX_PARAM_STRING) out[key] = value;
    }
    // Objects, arrays, null and undefined are never sent.
  }
  return out;
}
