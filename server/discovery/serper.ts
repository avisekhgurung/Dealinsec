/**
 * Serper (Google results) search API (POST https://google.serper.dev/search, X-API-KEY header). Paid per request;
 * one request per search, no retries. Only title, link and snippet are read; it is untrusted web text.
 */
import type { SearchResult } from "@shared/discovery";
import { callJson, str } from "./http";
import type { DiscoveryProvider, SearchOptions } from "./types";

export class SerperProvider implements DiscoveryProvider {
  readonly name = "serper";
  readonly label = "Serper";
  readonly paid = true;
  readonly supportsCountry = true;
  constructor(private readonly apiKey: string, private readonly endpoint = "https://google.serper.dev/search", private readonly fetchImpl: typeof fetch = fetch) {}

  async search(query: string, opts: SearchOptions = {}): Promise<SearchResult[]> {
    const req: Record<string, unknown> = { q: query, num: Math.min(20, Math.max(1, opts.count ?? 20)) };
    if (opts.country && /^[A-Za-z]{2}$/.test(opts.country)) req.gl = opts.country.toLowerCase();
    const body = await callJson(this.fetchImpl, this.endpoint, {
      method: "POST", headers: { "Content-Type": "application/json", "X-API-KEY": this.apiKey }, body: JSON.stringify(req),
    }, { timeoutMs: 12_000, signal: opts.signal, what: "The search service" });
    const rows = (body as { organic?: unknown })?.organic;
    if (!Array.isArray(rows)) return [];
    const out: SearchResult[] = [];
    for (const r of rows) {
      const x = r as Record<string, unknown>;
      const url = str(x?.link, 500), title = str(x?.title, 300);
      if (url && title) out.push({ url, title, snippet: str(x.snippet, 500) });
    }
    return out;
  }
}
