/**
 * Tavily search API (POST https://api.tavily.com/search, Authorization: Bearer <key>). Paid per request; one
 * request per search, no retries. Only title, url and content (a snippet) are read; it is untrusted web text.
 */
import type { SearchResult } from "@shared/discovery";
import { callJson, str } from "./http";
import type { DiscoveryProvider, SearchOptions } from "./types";

export class TavilyProvider implements DiscoveryProvider {
  readonly name = "tavily";
  readonly label = "Tavily";
  readonly paid = true;
  readonly supportsCountry = false;
  constructor(private readonly apiKey: string, private readonly endpoint = "https://api.tavily.com/search", private readonly fetchImpl: typeof fetch = fetch) {}

  async search(query: string, opts: SearchOptions = {}): Promise<SearchResult[]> {
    const body = await callJson(this.fetchImpl, this.endpoint, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ query, max_results: Math.min(20, Math.max(1, opts.count ?? 20)), search_depth: "basic", include_answer: false }),
    }, { timeoutMs: 15_000, signal: opts.signal, what: "The search service" });
    const rows = (body as { results?: unknown })?.results;
    if (!Array.isArray(rows)) return [];
    const out: SearchResult[] = [];
    for (const r of rows) {
      const x = r as Record<string, unknown>;
      const url = str(x?.url, 500), title = str(x?.title, 300);
      if (url && title) out.push({ url, title, snippet: str(x.content, 500) });
    }
    return out;
  }
}
