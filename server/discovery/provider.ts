/**
 * The configured search provider, or none. The key is read at call time from
 * BRAVE_SEARCH_API_KEY; without it discovery is simply "not set up" and nothing
 * else in the app is affected. BRAVE_SEARCH_URL exists so a local fake can stand
 * in for the service in end-to-end runs.
 */
import { BraveProvider } from "./brave";
import type { DiscoveryProvider, SearchOptions } from "./types";

export const discoveryConfigured = (): boolean => !!process.env.BRAVE_SEARCH_API_KEY;

export const discoveryProvider: DiscoveryProvider = {
  name: "brave",
  search: (query: string, opts?: SearchOptions) =>
    new BraveProvider(process.env.BRAVE_SEARCH_API_KEY ?? "", process.env.BRAVE_SEARCH_URL || undefined).search(query, opts),
};
