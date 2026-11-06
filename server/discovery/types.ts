import type { SearchResult } from "@shared/discovery";

export type DiscoveryErrorCode = "auth" | "rate_limited" | "unavailable" | "bad_response" | "timeout" | "aborted";

/** A search that did not complete. The message is safe to show a person and never contains the key. */
export class DiscoveryError extends Error {
  constructor(readonly code: DiscoveryErrorCode, message: string) {
    super(message);
    this.name = "DiscoveryError";
  }
}

export interface SearchOptions { country?: string; count?: number; signal?: AbortSignal }

/**
 * A community source of DEMAND posts (people publicly asking for the kind of work the person sells), beside the
 * web-search providers below. Official or public APIs only, never scraping against a platform's terms; shared/
 * opportunity-sources.ts does all parsing and filtering, pure. The first is Hacker News (hn.ts).
 */
export interface OpportunitySource {
  /** Short id, for logs, provenance and the OPPORTUNITY_SOURCES configuration ("hn"). */
  readonly name: string;
  /** What to call it in front of a person ("Hacker News"). */
  readonly label: string;
  /** Whether a scan costs money (every current source is free). */
  readonly paid: boolean;
  /** The current demand posts, already filtered to genuine asks for outside help; the caller matches them to the ICP. */
  scan(opts?: { signal?: AbortSignal }): Promise<import("@shared/opportunity-sources").OpportunityPost[]>;
}

/** Anything that can turn a short description into web results. Brave is the first; the interface is what lets it be swapped. */
export interface DiscoveryProvider {
  /** Short id, for logs and configuration. */
  readonly name: string;
  /** What to call it in front of a person ("Brave Search"). */
  readonly label: string;
  /** Whether a search costs money (so the approval card can say so truthfully). */
  readonly paid: boolean;
  /** Whether it can narrow results to a country. If not, none is sent or shown. */
  readonly supportsCountry: boolean;
  search(query: string, opts?: SearchOptions): Promise<SearchResult[]>;
}
