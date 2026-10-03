/**
 * Brave Search API client (https://api.search.brave.com/res/v1/web/search,
 * auth header X-Subscription-Token). One request per search; no retries, because
 * every request is billed. The key is passed in and never logged or echoed.
 *
 * Only title, url and description are read. What comes back is untrusted text
 * from the open web; nothing here stores it.
 */
import type { SearchResult } from "@shared/discovery";
import { DiscoveryError, type DiscoveryProvider, type SearchOptions } from "./types";

const DEFAULT_URL = "https://api.search.brave.com/res/v1/web/search";
const TIMEOUT_MS = 10_000;

export class BraveProvider implements DiscoveryProvider {
  readonly name = "brave";
  constructor(private readonly apiKey: string, private readonly endpoint = DEFAULT_URL, private readonly fetchImpl: typeof fetch = fetch) {}

  async search(query: string, opts: SearchOptions = {}): Promise<SearchResult[]> {
    const params = new URLSearchParams({ q: query, count: String(Math.min(20, Math.max(1, opts.count ?? 20))), safesearch: "moderate", text_decorations: "false" });
    if (opts.country && /^[A-Za-z]{2}$/.test(opts.country)) params.set("country", opts.country.toUpperCase());

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new DiscoveryError("timeout", "The search took too long.")), TIMEOUT_MS);
    const onAbort = () => ctrl.abort(new DiscoveryError("aborted", "The search was cancelled."));
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.endpoint}?${params}`, { headers: { Accept: "application/json", "X-Subscription-Token": this.apiKey }, signal: ctrl.signal });
    } catch (e) {
      const reason = (ctrl.signal.reason as unknown) instanceof DiscoveryError ? (ctrl.signal.reason as DiscoveryError) : null;
      throw reason ?? new DiscoveryError("unavailable", "The search service couldn't be reached.");
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    }

    if (res.status === 401 || res.status === 403) throw new DiscoveryError("auth", "The search service didn't accept the configured key.");
    if (res.status === 429) throw new DiscoveryError("rate_limited", "The search service is busy or its limit was reached. Try again later.");
    if (!res.ok) throw new DiscoveryError("unavailable", "The search service had a problem.");

    let body: unknown;
    try { body = await res.json(); } catch { throw new DiscoveryError("bad_response", "The search service sent something unreadable."); }
    const rows = (body as { web?: { results?: unknown } })?.web?.results;
    if (!Array.isArray(rows)) return []; // a valid answer with no web results
    const out: SearchResult[] = [];
    for (const r of rows) {
      const x = r as { title?: unknown; url?: unknown; description?: unknown };
      if (typeof x?.url !== "string" || typeof x?.title !== "string") continue;
      out.push({ title: x.title.slice(0, 300), url: x.url.slice(0, 500), snippet: typeof x.description === "string" ? x.description.slice(0, 500) : undefined });
    }
    return out;
  }
}
