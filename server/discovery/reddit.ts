/**
 * Reddit as a demand source, through Reddit's OFFICIAL Data API and nothing else: an app-only OAuth token
 * (client credentials), then `/search` on oauth.reddit.com. No scraping, no `.json` page endpoints, no logged-in
 * session, no user's cookies.
 *
 * READ THIS BEFORE SWITCHING IT ON. Reddit approves API apps by hand (its Responsible Builder Policy) and its Data
 * API Terms require a separate written agreement for commercial use. DealInSec is a commercial product, so setting
 * REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET is only legitimate once Reddit has approved this use. Without both keys
 * this source does not exist (server/discovery/provider.ts socialSources) and the page says Reddit is not connected.
 * This adapter has only ever run against a fake of the API: its first real call is the operator's to make.
 *
 * What is read: a post's title, text, subreddit, timestamp and permalink. What is not: the author
 * (shared/opportunity-sources.ts redditPostsFrom). One search per service, three at most, newest first, last month.
 */
import { redditPostsFrom, type OpportunityPost } from "@shared/opportunity-sources";
import { redditQueries } from "@shared/social-intent";
import { callJson } from "./http";
import { DiscoveryError, type OpportunitySource, type ScanOptions } from "./types";

const TIMEOUT_MS = 10_000;
/** Reddit asks every client for a descriptive User-Agent. This one names the product only: nothing about the operator or any user. */
export const DEFAULT_REDDIT_USER_AGENT = "web:dealinsec-client-radar:v1";

/** One token per app, shared by every scan in this process and renewed a minute before it runs out. */
const tokens = new Map<string, { value: string; expiresAt: number }>();
export const clearRedditTokens = () => tokens.clear();

export class RedditSource implements OpportunitySource {
  readonly name = "reddit";
  readonly label = "Reddit";
  readonly paid = false;
  constructor(
    private readonly clientId: string, private readonly clientSecret: string,
    private readonly userAgent = DEFAULT_REDDIT_USER_AGENT,
    private readonly base = "https://oauth.reddit.com", private readonly tokenUrl = "https://www.reddit.com/api/v1/access_token",
    private readonly fetchImpl: typeof fetch = fetch, private readonly now: () => number = () => Date.now(),
  ) {}

  private async token(signal?: AbortSignal): Promise<string> {
    const cached = tokens.get(this.clientId);
    if (cached && cached.expiresAt - 60_000 > this.now()) return cached.value;
    const body = await callJson(this.fetchImpl, this.tokenUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded", "User-Agent": this.userAgent,
      },
      body: "grant_type=client_credentials",
    }, { timeoutMs: TIMEOUT_MS, signal, what: "Reddit" });
    const value = (body as { access_token?: unknown })?.access_token;
    const ttl = Number((body as { expires_in?: unknown })?.expires_in);
    // A 200 without a token is Reddit refusing the app (an unapproved or mistyped client): an auth problem, said as one.
    if (typeof value !== "string" || !value) throw new DiscoveryError("auth", "Reddit didn't accept the configured key.");
    tokens.set(this.clientId, { value, expiresAt: this.now() + (Number.isFinite(ttl) && ttl > 0 ? ttl : 3600) * 1000 });
    return value;
  }

  async scan(opts: ScanOptions = {}): Promise<OpportunityPost[]> {
    const queries = redditQueries(opts.services ?? [], opts.keywords ?? []);
    if (!queries.length) return [];
    const token = await this.token(opts.signal);
    const out: OpportunityPost[] = [], seen = new Set<string>();
    for (const q of queries) {
      const url = `${this.base}/search?q=${encodeURIComponent(q)}&sort=new&t=month&limit=25&type=link&raw_json=1`;
      let listing: unknown;
      try {
        listing = await callJson(this.fetchImpl, url, { headers: { Authorization: `Bearer ${token}`, "User-Agent": this.userAgent } }, { timeoutMs: TIMEOUT_MS, signal: opts.signal, what: "Reddit" });
      } catch (e) {
        // A token Reddit no longer accepts is dropped, so the next scan asks for a new one instead of failing forever.
        if (e instanceof DiscoveryError && e.code === "auth") tokens.delete(this.clientId);
        throw e;
      }
      for (const p of redditPostsFrom(listing)) if (!seen.has(p.url)) { seen.add(p.url); out.push(p); }
    }
    return out;
  }
}
