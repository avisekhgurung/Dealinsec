/**
 * Hacker News as an opportunity source, through the public Algolia HN API (hn.algolia.com) — free, keyless and
 * official. Every month the `whoishiring` account posts a "Freelancer? Seeking freelancer?" thread (people asking
 * to hire freelancers) and a "Who is hiring?" thread; shared/opportunity-sources.ts keeps only genuine asks for
 * outside help from them. Two or three small JSON requests per scan; nothing is scraped, nothing is paid.
 */
import { hnPostsFrom, pickWhoishiringThreads, type OpportunityPost } from "@shared/opportunity-sources";
import { callJson } from "./http";
import type { OpportunitySource } from "./types";

const TIMEOUT_MS = 10_000;

export class HnSource implements OpportunitySource {
  readonly name = "hn";
  readonly label = "Hacker News";
  readonly paid = false;
  constructor(private base = "https://hn.algolia.com/api/v1", private fetchImpl: typeof fetch = fetch, private now: () => Date = () => new Date()) {}

  async scan(opts: { signal?: AbortSignal } = {}): Promise<OpportunityPost[]> {
    const stories = await callJson(this.fetchImpl, `${this.base}/search_by_date?tags=story,author_whoishiring&hitsPerPage=12`, {}, { timeoutMs: TIMEOUT_MS, signal: opts.signal, what: "Hacker News" });
    const threads = pickWhoishiringThreads(stories, this.now());
    const out: OpportunityPost[] = [];
    for (const t of threads) {
      // One page of the newest comments per thread is plenty: asks are matched to the person's services, newest first.
      const comments = await callJson(this.fetchImpl, `${this.base}/search_by_date?tags=comment,story_${t.id}&hitsPerPage=1000`, {}, { timeoutMs: TIMEOUT_MS, signal: opts.signal, what: "Hacker News" });
      out.push(...hnPostsFrom(comments, t));
    }
    return out;
  }
}
