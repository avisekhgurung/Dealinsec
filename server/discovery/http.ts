/**
 * One JSON request to an outside data provider, with a timeout and the failure mapped to a DiscoveryError code
 * (auth, rate_limited, unavailable, bad_response, timeout, aborted). No retries here: the caller decides, because
 * most of these calls are billed. Keys travel only in headers or bodies the caller builds; nothing here logs them.
 * A refused key (401, 403) is the one failure written to the server log, with the provider's reason code.
 */
import { DiscoveryError } from "./types";

/**
 * Why a provider refused a key, as its own short codes only ("PERMISSION_DENIED/API_KEY_IP_ADDRESS_BLOCKED",
 * "invalid_api_key"). Never its prose, and never anything shaped like a secret: a code is all capitals with
 * underscores, or all lower case with underscores; a key is neither.
 */
const REASON_CODE = /^(?:[A-Z][A-Z0-9_]{2,49}|[a-z][a-z_]{2,49})$/;
export function refusalReason(body: unknown): string | undefined {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const e = b.error && typeof b.error === "object" ? (b.error as Record<string, unknown>) : null;
  const details = e && Array.isArray(e.details) ? e.details.map((d) => (d && typeof d === "object" ? (d as Record<string, unknown>).reason : undefined)) : [];
  const picks: unknown[] = e ? [e.status, ...details, e.code, e.type] : [b.error, b.code, b.type];
  const out = Array.from(new Set(picks.filter((x): x is string => typeof x === "string" && REASON_CODE.test(x)))).slice(0, 3);
  return out.length ? out.join("/") : undefined;
}

/**
 * A provider answered 401 or 403. One line goes to the server log saying which host refused and why, because a
 * refused key never fixes itself and nothing else tells the operator: a key locked to the old server's address
 * looks, from outside, exactly like a search that found nothing. The host only (a URL can carry a key), the
 * provider's reason codes only, and never the key.
 */
export async function keyRefused(res: Response, url: string, what: string): Promise<DiscoveryError> {
  let reason: string | undefined;
  try {
    const wait = new Promise<string>((r) => { const t = setTimeout(() => r(""), 2_000); (t as { unref?: () => void }).unref?.(); });
    const text = await Promise.race([res.text(), wait]);
    if (text && text.length <= 20_000) reason = refusalReason(JSON.parse(text));
  } catch { reason = undefined; }
  let host = "";
  try { host = new URL(url).host; } catch { host = ""; }
  console.log(JSON.stringify({ kind: "provider_key_refused", host, status: res.status, reason: reason ?? null }));
  return new DiscoveryError("auth", `${what} didn't accept the configured key.`, reason);
}

export async function callJson(fetchImpl: typeof fetch, url: string, init: RequestInit, opts: { timeoutMs: number; signal?: AbortSignal; what: string }): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DiscoveryError("timeout", `${opts.what} took too long.`)), opts.timeoutMs);
  const onAbort = () => ctrl.abort(new DiscoveryError("aborted", `${opts.what} was cancelled.`));
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal: ctrl.signal });
  } catch {
    const reason = (ctrl.signal.reason as unknown) instanceof DiscoveryError ? (ctrl.signal.reason as DiscoveryError) : null;
    throw reason ?? new DiscoveryError("unavailable", `${opts.what} couldn't be reached.`);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
  if (res.status === 401 || res.status === 403) throw await keyRefused(res, url, opts.what);
  if (res.status === 402 || res.status === 429) throw new DiscoveryError("rate_limited", `${opts.what} is busy or its limit was reached.`);
  if (res.status === 404) return null; // "nothing known about this" for enrichment lookups
  if (!res.ok) throw new DiscoveryError("unavailable", `${opts.what} had a problem.`);
  try { return await res.json(); } catch { throw new DiscoveryError("bad_response", `${opts.what} sent something unreadable.`); }
}

export const str = (v: unknown, max: number): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
