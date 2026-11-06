import { describe, expect, it } from "vitest";
import { HnSource } from "./hn";
import { DiscoveryError } from "./types";

const NOW = () => new Date("2026-11-10T12:00:00Z");
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("the Hacker News source", () => {
  it("asks for the whoishiring stories, then one page of comments per current thread, and returns the parsed asks", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: any) => {
      urls.push(String(url));
      if (String(url).includes("author_whoishiring")) return json({ hits: [
        { objectID: "901", title: "Ask HN: Freelancer? Seeking freelancer? (November 2026)", created_at: "2026-11-01T15:00:00Z" },
      ] });
      return json({ hits: [
        { objectID: "11", comment_text: "SEEKING FREELANCER: brand design help for our studio, paid project. https:&#x2F;&#x2F;example-studio.com", created_at: "2026-11-05T09:00:00Z" },
      ] });
    }) as typeof fetch;
    const posts = await new HnSource("https://hn.test/api/v1", fetchImpl, NOW).scan();
    expect(urls).toEqual([
      "https://hn.test/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=12",
      "https://hn.test/api/v1/search_by_date?tags=comment,story_901&hitsPerPage=1000",
    ]);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ source: "hn", url: "https://news.ycombinator.com/item?id=11", companyUrl: "https://example-studio.com/" });
  });
  it("no current threads = no comment requests and no posts", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: any) => { urls.push(String(url)); return json({ hits: [] }); }) as typeof fetch;
    expect(await new HnSource("https://hn.test/api/v1", fetchImpl, NOW).scan()).toEqual([]);
    expect(urls).toHaveLength(1);
  });
  it("an API failure surfaces as a DiscoveryError (the scan caller records it and carries on)", async () => {
    const fetchImpl = (async () => new Response("busy", { status: 429 })) as typeof fetch;
    await expect(new HnSource("https://hn.test/api/v1", fetchImpl, NOW).scan()).rejects.toBeInstanceOf(DiscoveryError);
  });
});
