/**
 * The web search providers behind Client Radar. Keys are read at call time and never
 * leave the server. The default single provider:
 *   DISCOVERY_PROVIDER=langsearch|brave   (explicit), otherwise
 *   LANGSEARCH_API_KEY set -> LangSearch (free, no card), otherwise
 *   BRAVE_SEARCH_API_KEY set -> Brave (paid), otherwise none: "not set up".
 * LANGSEARCH_URL / BRAVE_SEARCH_URL point a client at a fake service in tests.
 */
import { BraveProvider } from "./brave";
import { HnSource } from "./hn";
import { LangSearchProvider } from "./langsearch";
import type { DiscoveryProvider, OpportunitySource } from "./types";

export type ProviderName = "langsearch" | "brave";

export function activeProviderName(env: NodeJS.ProcessEnv = process.env): ProviderName | null {
  const want = (env.DISCOVERY_PROVIDER ?? "").trim().toLowerCase();
  if (want === "langsearch") return env.LANGSEARCH_API_KEY ? "langsearch" : null;
  if (want === "brave") return env.BRAVE_SEARCH_API_KEY ? "brave" : null;
  if (env.LANGSEARCH_API_KEY) return "langsearch";
  if (env.BRAVE_SEARCH_API_KEY) return "brave";
  return null;
}

/**
 * The community demand sources a run may scan (Phase 3B), opt-in per deployment: OPPORTUNITY_SOURCES=hn switches
 * Hacker News on; unset (the default) means no scan and exactly the pre-3B behaviour. All current sources are free.
 */
export function opportunitySources(env: NodeJS.ProcessEnv = process.env): OpportunitySource[] {
  const make: Record<string, () => OpportunitySource> = { hn: () => new HnSource(env.HN_ALGOLIA_URL || undefined) };
  const wanted = (env.OPPORTUNITY_SOURCES ?? "").split(",").map((s) => s.trim().toLowerCase()).filter((s) => s in make);
  return wanted.map((n) => make[n]());
}

/**
 * The demand sources Social Intent may scan, in the order they are shown. Each exists only when it can honestly work:
 *   hn      always (a free, keyless, official public API)
 *   reddit  only with BOTH REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET (see reddit.ts: Reddit's approval comes first)
 *   web     only with TAVILY_API_KEY: the one provider here that can restrict a search to given sites, which is what
 *           keeps a paid query on forums instead of on agencies' own sales pages
 * SOCIAL_SOURCES=hn,web narrows the set (a kill switch per source); it can never add one that isn't configured.
 */
export async function socialSources(env: NodeJS.ProcessEnv = process.env): Promise<OpportunitySource[]> {
  const { RedditSource, DEFAULT_REDDIT_USER_AGENT } = await import("./reddit");
  const { WebDiscussionSource } = await import("./web-discussions");
  const { TavilyProvider } = await import("./tavily");
  const make: Record<string, () => OpportunitySource | null> = {
    hn: () => new HnSource(env.HN_ALGOLIA_URL || undefined),
    reddit: () => (env.REDDIT_CLIENT_ID && env.REDDIT_CLIENT_SECRET
      ? new RedditSource(env.REDDIT_CLIENT_ID, env.REDDIT_CLIENT_SECRET, env.REDDIT_USER_AGENT?.trim() || DEFAULT_REDDIT_USER_AGENT, env.REDDIT_API_URL || undefined, env.REDDIT_TOKEN_URL || undefined)
      : null),
    web: () => (env.TAVILY_API_KEY ? new WebDiscussionSource(new TavilyProvider(env.TAVILY_API_KEY, env.TAVILY_URL || undefined)) : null),
  };
  const only = (env.SOCIAL_SOURCES ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return Object.keys(make).filter((n) => !only.length || only.includes(n)).map((n) => make[n]()).filter((x): x is OpportunitySource => !!x);
}

/**
 * Every search provider that has a key, for the Client Radar engine, which may spread its queries over several.
 * OUTBOUND_SEARCH_PROVIDERS=tavily,brave picks and orders them; otherwise the configured discovery provider alone.
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
