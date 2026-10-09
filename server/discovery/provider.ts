/**
 * The configured search provider, or none. Keys are read at call time and never
 * leave the server. Which provider runs:
 *   DISCOVERY_PROVIDER=langsearch|brave   (explicit), otherwise
 *   LANGSEARCH_API_KEY set -> LangSearch (free, no card), otherwise
 *   BRAVE_SEARCH_API_KEY set -> Brave (paid), otherwise none: "not set up".
 * LANGSEARCH_URL / BRAVE_SEARCH_URL point a client at a fake service in tests.
 */
import { BraveProvider } from "./brave";
import { LangSearchProvider } from "./langsearch";
import type { DiscoveryProvider, SearchOptions } from "./types";

export type ProviderName = "langsearch" | "brave";

export function activeProviderName(env: NodeJS.ProcessEnv = process.env): ProviderName | null {
  const want = (env.DISCOVERY_PROVIDER ?? "").trim().toLowerCase();
  if (want === "langsearch") return env.LANGSEARCH_API_KEY ? "langsearch" : null;
  if (want === "brave") return env.BRAVE_SEARCH_API_KEY ? "brave" : null;
  if (env.LANGSEARCH_API_KEY) return "langsearch";
  if (env.BRAVE_SEARCH_API_KEY) return "brave";
  return null;
}

export const discoveryConfigured = (): boolean => activeProviderName() !== null;

function build(name: ProviderName): DiscoveryProvider {
  return name === "langsearch"
    ? new LangSearchProvider(process.env.LANGSEARCH_API_KEY ?? "", process.env.LANGSEARCH_URL || undefined)
    : new BraveProvider(process.env.BRAVE_SEARCH_API_KEY ?? "", process.env.BRAVE_SEARCH_URL || undefined);
}

/** Delegates to whichever provider is configured right now. Its description (label, paid, country support) is read live. */
export const discoveryProvider: DiscoveryProvider = {
  get name() { return activeProviderName() ?? "none"; },
  get label() { const n = activeProviderName(); return n ? build(n).label : "a search service"; },
  get paid() { const n = activeProviderName(); return n ? build(n).paid : true; },
  get supportsCountry() { const n = activeProviderName(); return n ? build(n).supportsCountry : false; },
  search(query: string, opts?: SearchOptions) {
    const n = activeProviderName();
    if (!n) throw new Error("No search provider is configured.");
    return build(n).search(query, opts);
  },
};

/**
 * Every search provider that has a key, for the AI Outbound engine, which may spread its queries over several.
 * OUTBOUND_SEARCH_PROVIDERS=tavily,brave picks and orders them; otherwise the configured discovery provider alone.
 * The free-text search card above (find_companies) keeps using `discoveryProvider` unchanged.
 */
export async function outboundSearchProviders(env: NodeJS.ProcessEnv = process.env): Promise<DiscoveryProvider[]> {
  const { TavilyProvider } = await import("./tavily");
  const { SerperProvider } = await import("./serper");
  const make: Record<string, () => DiscoveryProvider | null> = {
    langsearch: () => (env.LANGSEARCH_API_KEY ? new LangSearchProvider(env.LANGSEARCH_API_KEY, env.LANGSEARCH_URL || undefined) : null),
    brave: () => (env.BRAVE_SEARCH_API_KEY ? new BraveProvider(env.BRAVE_SEARCH_API_KEY, env.BRAVE_SEARCH_URL || undefined) : null),
    tavily: () => (env.TAVILY_API_KEY ? new TavilyProvider(env.TAVILY_API_KEY, env.TAVILY_URL || undefined) : null),
    serper: () => (env.SERPER_API_KEY ? new SerperProvider(env.SERPER_API_KEY, env.SERPER_URL || undefined) : null),
  };
  const wanted = (env.OUTBOUND_SEARCH_PROVIDERS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter((s) => s in make);
  if (wanted.length) return wanted.map((n) => make[n]()).filter((p): p is DiscoveryProvider => !!p);
  const one = activeProviderName(env);
  if (one) return [make[one]()!];
  // No discovery provider: fall back to whichever paid one has a key.
  return ["tavily", "serper"].map((n) => make[n]()).filter((p): p is DiscoveryProvider => !!p).slice(0, 1);
}
