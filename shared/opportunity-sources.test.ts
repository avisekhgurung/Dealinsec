import { describe, expect, it } from "vitest";
import { MAX_DIRECT_ASKS, directAskOf, hnPostsFrom, pickWhoishiringThreads, relevantAsks, siteLinkOf, stripHtml, type HnThread, type OpportunityPost } from "./opportunity-sources";

const NOW = new Date("2026-11-10T12:00:00Z");

describe("picking the monthly HN threads", () => {
  const story = (title: string, id: string, at = "2026-11-01T15:00:00Z") => ({ objectID: id, title, created_at: at });
  it("finds the seekers thread and the hiring thread, newest month only, one each", () => {
    const t = pickWhoishiringThreads({ hits: [
      story("Ask HN: Who is hiring? (November 2026)", "901"),
      story("Ask HN: Freelancer? Seeking freelancer? (November 2026)", "902"),
      story("Ask HN: Who wants to be hired? (November 2026)", "903"),
      story("Ask HN: Freelancer? Seeking freelancer? (October 2026)", "800", "2026-10-01T15:00:00Z"),
    ] }, NOW);
    expect(t).toEqual([
      { id: "901", title: "Ask HN: Who is hiring? (November 2026)", kind: "hiring" },
      { id: "902", title: "Ask HN: Freelancer? Seeking freelancer? (November 2026)", kind: "seekers" },
    ]);
  });
  it("a stale thread (over 45 days) or rubbish input gives nothing", () => {
    expect(pickWhoishiringThreads({ hits: [story("Ask HN: Freelancer? Seeking freelancer? (June 2026)", "1", "2026-06-01T15:00:00Z")] }, NOW)).toEqual([]);
    expect(pickWhoishiringThreads(null, NOW)).toEqual([]);
    expect(pickWhoishiringThreads({ hits: [{ objectID: "", title: "Ask HN: Who is hiring?" }] }, NOW)).toEqual([]);
  });
});

describe("reading comments as demand posts", () => {
  const seekers: HnThread = { id: "902", title: "Ask HN: Freelancer? Seeking freelancer? (November 2026)", kind: "seekers" };
  const hiring: HnThread = { id: "901", title: "Ask HN: Who is hiring? (November 2026)", kind: "hiring" };
  const c = (id: string, html: string, at = "2026-11-05T09:00:00Z") => ({ objectID: id, comment_text: html, created_at: at });

  it("keeps SEEKING FREELANCER entries with their own words, date, link and site; drops SEEKING WORK (the competitors)", () => {
    const posts = hnPostsFrom({ hits: [
      c("11", "SEEKING FREELANCER: We need a brand designer for our studio site.<p>Remote, budget agreed up front. More at <a href=\"https:&#x2F;&#x2F;example-studio.com\">https:&#x2F;&#x2F;example-studio.com</a>"),
      c("12", "SEEKING WORK: I am a freelance brand designer with 10 years of experience looking for projects."),
      c("13", "We are a small agency and want help with web development on a contract basis. Email us at hello@tiny.agency"),
    ] }, seekers);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      source: "hn", threadTitle: seekers.title,
      url: "https://news.ycombinator.com/item?id=11",
      postedAt: "2026-11-05T09:00:00.000Z",
      companyUrl: "https://example-studio.com/",
    });
    expect(posts[0].title).toContain("SEEKING FREELANCER: We need a brand designer");
  });
  it("from the hiring thread, only wording that asks for outside help counts; a plain full-time post never does", () => {
    const posts = hnPostsFrom({ hits: [
      c("21", "Acme Robotics | Senior Engineer | Full-time | On-site SF | Benefits include equity. Apply at https://acme-robotics.example"),
      c("22", "Tiny Studio | Contract | Remote | We're looking for a freelance web development partner for client overflow. https://tiny-studio.example"),
    ] }, hiring);
    expect(posts.map((p) => p.url)).toEqual(["https://news.ycombinator.com/item?id=22"]);
    expect(posts[0].companyUrl).toBe("https://tiny-studio.example/");
  });
  it("a post that opens with template fields is labelled by its first descriptive line, not by 'Location: …'", () => {
    const posts = hnPostsFrom({ hits: [
      c("41", "Location: Andalucía, Spain (CET)<p>Remote: yes<p>We need freelance brand design help for our indie product site."),
    ] }, hiring);
    expect(posts[0].title).toBe("We need freelance brand design help for our indie product site.");
  });
  it("tiny or empty comments are ignored; rubbish input gives nothing", () => {
    expect(hnPostsFrom({ hits: [c("31", "SEEKING FREELANCER: hi")] }, seekers)).toEqual([]);
    expect(hnPostsFrom(null, seekers)).toEqual([]);
  });
});

describe("HTML stripping and site links", () => {
  it("decodes the usual entities and keeps paragraph breaks", () => {
    expect(stripHtml("Line one<p>Line two &amp; three &#x27;quoted&#x27;")).toBe("Line one\nLine two & three 'quoted'");
  });
  it("a link to HN, a platform or a mail address is not a company site; trailing punctuation is trimmed", () => {
    expect(siteLinkOf("details at https://news.ycombinator.com/item?id=5 only")).toBeNull();
    expect(siteLinkOf("see https://github.com/someone and https://linkedin.com/in/someone")).toBeNull();
    expect(siteLinkOf("our site: https://real-company.example/about.")).toBe("https://real-company.example/about");
    expect(siteLinkOf("no links here")).toBeNull();
  });
  it("a page on shared hosting is not the company's own domain (found live: a netlify.app link seeded Netlify); a later real site still wins", () => {
    expect(siteLinkOf("our prototype: https://my-studio.netlify.app/work")).toBeNull();
    expect(siteLinkOf("https://someone.github.io/portfolio and more")).toBeNull();
    expect(siteLinkOf("demo https://my-studio.netlify.app but company site https://my-studio.example")).toBe("https://my-studio.example/");
  });
});

describe("matching posts to the offer", () => {
  const post = (text: string, at: string, url = "https://news.ycombinator.com/item?id=1"): OpportunityPost =>
    ({ source: "hn", threadTitle: "t", title: text.slice(0, 120), url, text, postedAt: at, companyUrl: null });
  it("keeps only posts naming the services, newest first, capped; no services = nothing", () => {
    const posts = [
      post("Need help with brand design for our shop", "2026-11-02T00:00:00Z", "https://news.ycombinator.com/item?id=1"),
      post("Looking for a Rust compiler engineer", "2026-11-03T00:00:00Z", "https://news.ycombinator.com/item?id=2"),
      post("Seeking a designer for our brand refresh", "2026-11-04T00:00:00Z", "https://news.ycombinator.com/item?id=3"),
    ];
    const kept = relevantAsks(posts, { services: ["Brand design"] });
    expect(kept.map((p) => p.url)).toEqual(["https://news.ycombinator.com/item?id=3", "https://news.ycombinator.com/item?id=1"]);
    expect(relevantAsks(posts, { services: [] })).toEqual([]);
    expect(relevantAsks(posts, {})).toEqual([]);
  });
  it("the cap holds", () => {
    const many = Array.from({ length: 40 }, (_, i) => post(`brand design task ${i}`, `2026-11-0${(i % 9) + 1}T00:00:00Z`, `https://news.ycombinator.com/item?id=${i}`));
    expect(relevantAsks(many, { services: ["brand design"] })).toHaveLength(MAX_DIRECT_ASKS);
  });
  it("a direct ask is the post's own title, link and date, nothing invented", () => {
    const p = post("Need brand design help", "2026-11-02T00:00:00Z");
    expect(directAskOf(p)).toEqual({ source: "hn", title: "Need brand design help", url: p.url, date: "2026-11-02T00:00:00Z" });
  });
});
