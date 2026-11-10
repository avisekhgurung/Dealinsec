import type { SearchResult } from "@shared/discovery";

export type DiscoveryErrorCode = "auth" | "rate_limited" | "unavailable" | "bad_response" | "timeout" | "aborted";

/** A search that did not complete. The message is safe to show a person and never contains the key. */
export class DiscoveryError extends Error {
  constructor(readonly code: DiscoveryErrorCode, message: string) {
    super(message);
    this.name = "DiscoveryError";
  }
}

export interface SearchOptions {
  country?: string; count?: number; signal?: AbortSignal;
  /** Search only these sites (a provider that can't restrict by site ignores it, and the caller filters the results). */
  includeDomains?: readonly string[];
  /** Only results from about this long ago, where the provider supports it. */
  recency?: "week" | "month" | "year";
}

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
  /**
   * The current demand posts; the caller matches them to the person's services. A source that reads fixed threads
   * (Hacker News) ignores `services`; one that has to be asked a question (Reddit, a web search) builds its queries
   * from them and returns nothing without any.
   */
  scan(opts?: ScanOptions): Promise<import("@shared/opportunity-sources").OpportunityPost[]>;
}
export interface ScanOptions {
  signal?: AbortSignal; services?: string[]; keywords?: string[];
  /**
   * How a PAID source makes each billed call: the caller reserves it against its budgets first and settles it after.
   * Resolves to null when the call couldn't be afforded (the source then stops). A paid source given no guard makes
   * no call at all.
   */
  paidCall?: <T>(provider: string, fn: () => Promise<T>) => Promise<T | null>;
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
