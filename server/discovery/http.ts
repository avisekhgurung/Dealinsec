/**
 * One JSON request to an outside data provider, with a timeout and the failure mapped to a DiscoveryError code
 * (auth, rate_limited, unavailable, bad_response, timeout, aborted). No retries here: the caller decides, because
 * most of these calls are billed. Keys travel only in headers or bodies the caller builds; nothing here logs them.
 */
import { DiscoveryError } from "./types";

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
  if (res.status === 401 || res.status === 403) throw new DiscoveryError("auth", `${opts.what} didn't accept the configured key.`);
  if (res.status === 402 || res.status === 429) throw new DiscoveryError("rate_limited", `${opts.what} is busy or its limit was reached.`);
  if (res.status === 404) return null; // "nothing known about this" for enrichment lookups
  if (!res.ok) throw new DiscoveryError("unavailable", `${opts.what} had a problem.`);
  try { return await res.json(); } catch { throw new DiscoveryError("bad_response", `${opts.what} sent something unreadable.`); }
}

export const str = (v: unknown, max: number): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
