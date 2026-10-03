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

/** Anything that can turn a short description into web results. Brave is the first; the interface is what lets it be swapped. */
export interface DiscoveryProvider {
  readonly name: string;
  search(query: string, opts?: SearchOptions): Promise<SearchResult[]>;
}
