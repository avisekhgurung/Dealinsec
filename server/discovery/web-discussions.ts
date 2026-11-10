/**
 * Public web discussions as a demand source: a web search limited to forums and communities where people ask who to
 * hire (shared/social-intent.ts DISCUSSION_DOMAINS). Nothing is fetched from those sites — only what the search
 * provider returns for each result (title, snippet, link) is read, and only the title, a short excerpt and the link
 * are ever kept.
 *
 * It is the one PAID demand source: every query is a billed web search. So it never searches on its own authority:
 * the caller passes `paidCall`, which reserves the search against the platform's daily cap and the workspace's spend
 * ceiling and settles it afterwards. Without that guard — for instance if this source were ever handed to a caller
 * that doesn't know it costs money — it returns nothing rather than spend unreserved money.
 */
import { discussionPostsFrom, type OpportunityPost } from "@shared/opportunity-sources";
import { DISCUSSION_DOMAINS, discussionQueries } from "@shared/social-intent";
import type { DiscoveryProvider, OpportunitySource, ScanOptions } from "./types";

export class WebDiscussionSource implements OpportunitySource {
  readonly name = "web";
  readonly label = "Public web discussions";
  readonly paid = true;
  constructor(private readonly provider: DiscoveryProvider, private readonly domains: readonly string[] = DISCUSSION_DOMAINS) {}

  /** The search provider behind it, for cost accounting. */
  get providerName(): string { return this.provider.name; }

  async scan(opts: ScanOptions = {}): Promise<OpportunityPost[]> {
    if (!opts.paidCall) return [];
    const out: OpportunityPost[] = [], seen = new Set<string>();
    for (const q of discussionQueries(opts.services ?? [], opts.keywords ?? [])) {
      const results = await opts.paidCall(this.provider.name, () => this.provider.search(q, { count: 20, includeDomains: this.domains, recency: "month", signal: opts.signal }));
      // null = the search couldn't be afforded (a cap or the ceiling): stop asking, keep what was found.
      if (results === null) break;
      for (const p of discussionPostsFrom(results, this.domains)) if (!seen.has(p.url)) { seen.add(p.url); out.push(p); }
    }
    return out;
  }
}
