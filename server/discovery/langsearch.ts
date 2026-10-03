/**
 * LangSearch web search client (POST https://api.langsearch.com/v1/web-search,
 * Authorization: Bearer <key>). A free service with a daily allowance and no
 * card. One request per search, no retries. The key is passed in and never
 * logged or echoed.
 *
 * Only name, url and snippet are read. What comes back is untrusted text from the
 * open web; nothing here stores it. There is no country filter: the place goes in
 * the search words themselves.
 */
import type { SearchResult } from "@shared/discovery";
import { DiscoveryError, type DiscoveryProvider, type SearchOptions } from "./types";

const DEFAULT_URL = "https://api.langsearch.com/v1/web-search";
const TIMEOUT_MS = 12_000;

export class LangSearchProvider implements DiscoveryProvider {
  readonly name = "langsearch";
  readonly label = "LangSearch";
  readonly paid = false;
  readonly supportsCountry = false;
  constructor(private readonly apiKey: string, private readonly endpoint = DEFAULT_URL, private readonly fetchImpl: typeof fetch = fetch) {}

  async search(query: string, opts: SearchOptions = {}): Promise<SearchResult[]> {
    const body = JSON.stringify({ query, count: Math.min(50, Math.max(1, opts.count ?? 20)), freshness: "noLimit" });

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new DiscoveryError("timeout", "The search took too long.")), TIMEOUT_MS);
    const onAbort = () => ctrl.abort(new DiscoveryError("aborted", "The search was cancelled."));
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    let res: Response;
    try {
      res = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body, signal: ctrl.signal,
      });
    } catch {
      const reason = (ctrl.signal.reason as unknown) instanceof DiscoveryError ? (ctrl.signal.reason as DiscoveryError) : null;
      throw reason ?? new DiscoveryError("unavailable", "The search service couldn't be reached.");
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    }

    if (res.status === 401 || res.status === 403) throw new DiscoveryError("auth", "The search service didn't accept the configured key.");
    if (res.status === 402 || res.status === 429) throw new DiscoveryError("rate_limited", "The search service is busy, or today's free allowance is used up. Try again later.");
    if (!res.ok) throw new DiscoveryError("unavailable", "The search service had a problem.");

    let json: unknown;
    try { json = await res.json(); } catch { throw new DiscoveryError("bad_response", "The search service sent something unreadable."); }
    const j = json as { code?: unknown; data?: { webPages?: { value?: unknown } }; webPages?: { value?: unknown } };
    // Some responses wrap a status in the body even on HTTP 200.
    if (typeof j?.code === "number" && j.code !== 200) {
      throw new DiscoveryError(j.code === 429 ? "rate_limited" : j.code === 401 || j.code === 403 ? "auth" : "unavailable", j.code === 429 ? "The search service is busy, or today's free allowance is used up. Try again later." : j.code === 401 || j.code === 403 ? "The search service didn't accept the configured key." : "The search service had a problem.");
    }
    const rows = j?.data?.webPages?.value ?? j?.webPages?.value;
    if (!Array.isArray(rows)) return [];
    const out: SearchResult[] = [];
    for (const r of rows) {
      const x = r as { name?: unknown; url?: unknown; snippet?: unknown };
      if (typeof x?.url !== "string" || typeof x?.name !== "string") continue;
      out.push({ title: x.name.slice(0, 300), url: x.url.slice(0, 500), snippet: typeof x.snippet === "string" ? x.snippet.slice(0, 500) : undefined });
    }
    return out;
  }
}
