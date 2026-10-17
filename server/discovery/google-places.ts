/**
 * Google Places API (New) Text Search (POST https://places.googleapis.com/v1/places:searchText, X-Goog-Api-Key).
 * Local business discovery for shared/local-discovery.ts: one request returns up to 20 listings.
 *
 * Field mask: only what the result list shows. places.websiteUri and places.nationalPhoneNumber put the request in the
 * Text Search Enterprise SKU (checked 18 Oct 2026: $35 per 1,000 requests, the first 1,000 a month free; India has its
 * own price list); the rest are Pro fields billed within it. Reviews, photos and ratings are not requested.
 *
 * The listings returned here are never stored (see shared/local-discovery.ts): the caller shows them and keeps place IDs
 * only. One retry for a temporary failure (rate limit, 5xx, timeout); the key never leaves the server.
 */
import { DiscoveryError } from "./types";
import { callJson, str } from "./http";
import { siteHost } from "@shared/research";
import { isPlaceId, mapsUrlFor, type LocalResult } from "@shared/local-discovery";

export const PLACES_FIELD_MASK = [
  "places.id", "places.displayName", "places.formattedAddress", "places.primaryTypeDisplayName",
  "places.googleMapsUri", "places.businessStatus", "places.websiteUri", "places.nationalPhoneNumber",
].join(",");

export type PlaceListing = Omit<LocalResult, "existing">;

export interface LocalBusinessProvider {
  readonly name: string;
  /** Up to `pageSize` (≤ 20) listings for a text query, in a country. Throws DiscoveryError. */
  searchText(query: string, opts: { regionCode: string; pageSize: number; signal?: AbortSignal }): Promise<PlaceListing[]>;
}

const RETRYABLE = new Set(["rate_limited", "unavailable", "timeout"]);

export class GooglePlacesProvider implements LocalBusinessProvider {
  readonly name = "google_places";
  constructor(private readonly apiKey: string, private readonly endpoint = "https://places.googleapis.com/v1/places:searchText", private readonly fetchImpl: typeof fetch = fetch, private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))) {}

  async searchText(query: string, opts: { regionCode: string; pageSize: number; signal?: AbortSignal }): Promise<PlaceListing[]> {
    const init: RequestInit = {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": this.apiKey, "X-Goog-FieldMask": PLACES_FIELD_MASK },
      body: JSON.stringify({ textQuery: query.slice(0, 200), regionCode: opts.regionCode, pageSize: Math.min(20, Math.max(1, opts.pageSize)) }),
    };
    let body: unknown;
    for (let attempt = 0; ; attempt++) {
      try { body = await callJson(this.fetchImpl, this.endpoint, init, { timeoutMs: 12_000, signal: opts.signal, what: "The local business search" }); break; }
      catch (e) {
        if (attempt === 0 && e instanceof DiscoveryError && RETRYABLE.has(e.code)) { await this.sleep(800); continue; }
        throw e;
      }
    }
    const rows = (body as { places?: unknown })?.places;
    if (!Array.isArray(rows)) return [];
    const out: PlaceListing[] = [];
    for (const r of rows) {
      const x = r as Record<string, any>;
      const placeId = str(x?.id, 300);
      const name = str(x?.displayName?.text, 160);
      if (!placeId || !isPlaceId(placeId) || !name) continue;
      let website: string | null = str(x.websiteUri, 300) ?? null, domain: string | null = null;
      if (website) { try { const u = new URL(website); if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("scheme"); domain = siteHost(u.hostname) || null; } catch { website = null; } }
      out.push({
        placeId, name, address: str(x.formattedAddress, 240) ?? null, category: str(x.primaryTypeDisplayName?.text, 80) ?? null,
        website, domain, phone: str(x.nationalPhoneNumber, 40) ?? null,
        mapsUrl: str(x.googleMapsUri, 400) ?? mapsUrlFor(placeId), status: str(x.businessStatus, 30) ?? null,
      });
    }
    return out;
  }
}

export function localBusinessProvider(env: NodeJS.ProcessEnv = process.env): LocalBusinessProvider | null {
  return env.GOOGLE_PLACES_API_KEY ? new GooglePlacesProvider(env.GOOGLE_PLACES_API_KEY, env.GOOGLE_PLACES_URL || undefined) : null;
}
