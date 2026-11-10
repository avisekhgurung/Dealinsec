/**
 * The Social Intent sources against FAKES of their APIs: what each asks for, what it keeps, and — the part that
 * matters most — what it refuses to do. No network. Neither Reddit nor Tavily is called from this file.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { discussionPostsFrom, redditPostsFrom } from "@shared/opportunity-sources";
import { DISCUSSION_DOMAINS } from "@shared/social-intent";
import { socialSources } from "./provider";
import { clearRedditTokens, RedditSource } from "./reddit";
import { DiscoveryError } from "./types";
import { WebDiscussionSource } from "./web-discussions";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const t3 = (over: Record<string, unknown> = {}) => ({ kind: "t3", data: {
  title: "[Hiring] React developer for our startup", selftext: "We need a contractor. Site: https://acme-tools.io budget $3k",
  permalink: "/r/forhire/comments/abc/hiring_react/", subreddit: "forhire", created_utc: 1794300000, author: "some_person", over_18: false, stickied: false, ...over,
} });

describe("reading a Reddit listing", () => {
  it("keeps the post's words, subreddit, date and link — and never the author", () => {
    const [p] = redditPostsFrom({ data: { children: [t3()] } });
    expect(p).toMatchObject({ source: "reddit", threadTitle: "r/forhire", title: "[Hiring] React developer for our startup", url: "https://www.reddit.com/r/forhire/comments/abc/hiring_react/", companyUrl: "https://acme-tools.io/" });
    expect(p.postedAt).toBe(new Date(1794300000 * 1000).toISOString());
    expect(JSON.stringify(p)).not.toContain("some_person");
  });
  it("skips removed, deleted, adult and pinned posts, comments, and anything without a permalink", () => {
    const rows = [
      t3({ selftext: "[removed]" }), t3({ selftext: "[deleted]" }), t3({ removed_by_category: "moderator" }),
      t3({ over_18: true }), t3({ stickied: true }), t3({ permalink: "" }), t3({ title: "" }),
      { kind: "t1", data: { body: "a comment" } },
    ];
    expect(redditPostsFrom({ data: { children: rows } })).toEqual([]);
  });
  it("a malformed listing is nothing, not a crash", () => {
    for (const x of [null, {}, { data: {} }, { data: { children: "no" } }, "text"]) expect(redditPostsFrom(x)).toEqual([]);
  });
});

describe("the Reddit source", () => {
  beforeEach(() => clearRedditTokens());
  function fake(opts: { token?: unknown; tokenStatus?: number; searchStatus?: number } = {}) {
    const calls: { url: string; init: RequestInit }[] = [];
    const f = (async (url: any, init: any = {}) => {
      calls.push({ url: String(url), init });
      if (String(url).includes("access_token")) return json(opts.token ?? { access_token: "tok-1", expires_in: 3600 }, opts.tokenStatus ?? 200);
      return json({ data: { children: [t3()] } }, opts.searchStatus ?? 200);
    }) as typeof fetch;
    return { f, calls };
  }
  const src = (f: typeof fetch, now = () => 1_000_000) => new RedditSource("cid", "secret", "web:test:v1", "https://oauth.fake", "https://www.fake/api/v1/access_token", f, now);

  it("authenticates app-only over OAuth, then searches the official API with the token", async () => {
    const { f, calls } = fake();
    const posts = await src(f).scan({ services: ["React development"] });
    expect(posts).toHaveLength(1);
    expect(calls[0].url).toBe("https://www.fake/api/v1/access_token");
    expect(calls[0].init.body).toBe("grant_type=client_credentials");
    expect((calls[0].init.headers as any).Authorization).toBe(`Basic ${Buffer.from("cid:secret").toString("base64")}`);
    expect(calls[1].url).toMatch(/^https:\/\/oauth\.fake\/search\?q=/);
    expect(calls[1].url).toContain("sort=new");
    expect(calls[1].url).toContain("t=month");
    expect(decodeURIComponent(calls[1].url)).toContain('"React development"');
    expect((calls[1].init.headers as any).Authorization).toBe("Bearer tok-1");
    expect((calls[1].init.headers as any)["User-Agent"]).toBe("web:test:v1");
  });
  it("one search per service, three at most, and the token is asked for once", async () => {
    const { f, calls } = fake();
    await src(f).scan({ services: ["a1b", "b2c", "c3d", "d4e", "e5f"] });
    expect(calls.filter((c) => c.url.includes("access_token"))).toHaveLength(1);
    expect(calls.filter((c) => c.url.includes("/search?"))).toHaveLength(3);
  });
  it("reuses the token across scans until a minute before it expires", async () => {
    const { f, calls } = fake();
    let now = 0;
    const s = src(f, () => now);
    await s.scan({ services: ["seo"] });
    now = 3_500_000; await s.scan({ services: ["seo"] }); // 58 min in: still good
    expect(calls.filter((c) => c.url.includes("access_token"))).toHaveLength(1);
    now = 3_550_000; await s.scan({ services: ["seo"] }); // inside the last minute: renewed
    expect(calls.filter((c) => c.url.includes("access_token"))).toHaveLength(2);
  });
  it("with nothing to search for, it makes no call at all — not even for a token", async () => {
    const { f, calls } = fake();
    expect(await src(f).scan({ services: [] })).toEqual([]);
    expect(calls).toEqual([]);
  });
  it("an app Reddit hasn't approved is an auth failure, not an empty result", async () => {
    await expect(src(fake({ token: { error: "invalid_grant" } }).f).scan({ services: ["seo"] })).rejects.toMatchObject({ code: "auth" });
    await expect(src(fake({ tokenStatus: 401 }).f).scan({ services: ["seo"] })).rejects.toBeInstanceOf(DiscoveryError);
  });
  it("a rejected token is forgotten, so the next scan asks for a new one", async () => {
    const bad = fake({ searchStatus: 401 });
    await expect(src(bad.f).scan({ services: ["seo"] })).rejects.toMatchObject({ code: "auth" });
    const good = fake();
    await src(good.f).scan({ services: ["seo"] });
    expect(good.calls.filter((c) => c.url.includes("access_token"))).toHaveLength(1);
  });
  it("a rate limit surfaces as one, and is never retried", async () => {
    const { f, calls } = fake({ searchStatus: 429 });
    await expect(src(f).scan({ services: ["seo", "ads"] })).rejects.toMatchObject({ code: "rate_limited" });
    expect(calls.filter((c) => c.url.includes("/search?"))).toHaveLength(1);
  });
});

describe("public web discussions", () => {
  const hit = (url: string, title = "Looking for a web developer", snippet = "need someone to rebuild our store") => ({ url, title, snippet });
  it("keeps only results on the discussion sites that were asked for", () => {
    const posts = discussionPostsFrom([
      hit("https://www.reddit.com/r/smallbusiness/comments/1/looking/"),
      hit("https://www.indiehackers.com/post/abc"),
      hit("https://some-agency.com/hire-us"), // an agency's own sales page slipped in
      hit("https://evil-reddit.com/r/x/comments/1/"), // not reddit.com, whatever it calls itself
      hit("javascript:alert(1)"),
    ], DISCUSSION_DOMAINS);
    expect(posts.map((p) => p.threadTitle)).toEqual(["r/smallbusiness", "indiehackers.com"]);
    expect(posts[0]).toMatchObject({ source: "web", postedAt: null, companyUrl: null });
  });
  it("one post per page, however many times the search returns it", () => {
    expect(discussionPostsFrom([hit("https://reddit.com/r/a/comments/1/x/"), hit("https://www.reddit.com/r/a/comments/1/x")], DISCUSSION_DOMAINS)).toHaveLength(1);
  });

  const provider = (results: unknown[] = [hit("https://www.reddit.com/r/a/comments/1/x/")]) => {
    const calls: { q: string; opts: any }[] = [];
    return { calls, p: { name: "tavily", label: "Tavily", paid: true, supportsCountry: false, search: async (q: string, opts: any) => { calls.push({ q, opts }); return results as any; } } };
  };
  // The money rule. A paid source handed to a caller that doesn't reserve its calls must spend nothing.
  it("without a paid-call guard it searches nothing", async () => {
    const { p, calls } = provider();
    expect(await new WebDiscussionSource(p).scan({ services: ["web design"] })).toEqual([]);
    expect(calls).toEqual([]);
  });
  it("every search goes through the guard, restricted to the discussion sites and to the last month", async () => {
    const { p, calls } = provider();
    const guarded: string[] = [];
    const posts = await new WebDiscussionSource(p).scan({ services: ["web design", "seo", "ads"], paidCall: async (name, fn) => { guarded.push(name); return fn(); } });
    expect(guarded).toEqual(["tavily", "tavily"]); // two queries at most
    expect(calls[0].opts).toMatchObject({ includeDomains: DISCUSSION_DOMAINS, recency: "month" });
    expect(posts).toHaveLength(1);
  });
  it("stops at the first search it can't afford, keeping what it already found", async () => {
    const { p, calls } = provider();
    let n = 0;
    const posts = await new WebDiscussionSource(p).scan({ services: ["web design", "seo"], paidCall: async (_n, fn) => (n++ === 0 ? fn() : null) });
    expect(calls).toHaveLength(1);
    expect(posts).toHaveLength(1);
  });
});

describe("which sources exist", () => {
  const names = async (env: Record<string, string>) => (await socialSources(env as any)).map((s) => s.name);
  it("Hacker News always; Reddit only with BOTH keys; web discussions only with a Tavily key", async () => {
    expect(await names({})).toEqual(["hn"]);
    expect(await names({ REDDIT_CLIENT_ID: "a" })).toEqual(["hn"]);
    expect(await names({ REDDIT_CLIENT_ID: "a", REDDIT_CLIENT_SECRET: "b" })).toEqual(["hn", "reddit"]);
    expect(await names({ TAVILY_API_KEY: "k" })).toEqual(["hn", "web"]);
    expect(await names({ LANGSEARCH_API_KEY: "k" })).toEqual(["hn"]); // a provider that can't restrict by site isn't used
  });
  it("SOCIAL_SOURCES narrows the set and can never add an unconfigured source", async () => {
    expect(await names({ TAVILY_API_KEY: "k", SOCIAL_SOURCES: "web" })).toEqual(["web"]);
    expect(await names({ SOCIAL_SOURCES: "reddit,web" })).toEqual([]);
  });
});
