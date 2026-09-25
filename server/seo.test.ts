/**
 * Regression tests for the server-rendered SEO surface (blog, category pages,
 * free tools, and the homepage crawler fallback).
 *
 * Every registry is driven through a stub Express app, so what is asserted is
 * the HTML a crawler would actually receive — not the data structures behind it.
 * Pure logic: nothing here touches the database or the network.
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { SSR_PATH_PATTERN, swNavigationMatcher } from "@shared/ssr-paths";
import { GA_MEASUREMENT_ID, esc, gaSnippet } from "./tools/layout";
import { COPY_SCRIPT, POSTS, blogSitemapPaths, guidesHtml, registerBlogPages, relatedSlugs, tpl } from "./blog";
import { PAGES, registerCategoryPages } from "./category-pages";
import { COMPARISON_PAGES, VENDORS, registerComparisonPages, comparisonSitemapPaths } from "./comparison-pages";
import { registerToolPages } from "./tools";
import { landingSeoBody } from "./landing-seo";

type Handler = (req: unknown, res: any) => void;

/** Registers every SSR route on a stub app and renders each once. */
function renderAll() {
  const routes = new Map<string, Handler>();
  const duplicates: string[] = [];
  const app: any = {
    get: (p: string, h: Handler) => {
      if (routes.has(p)) duplicates.push(p);
      routes.set(p, h);
    },
  };
  registerBlogPages(app);
  registerCategoryPages(app);
  registerComparisonPages(app);
  registerToolPages(app);

  const pages = new Map<string, string>();
  for (const [p, h] of routes) {
    let body = "";
    const res: any = {
      type: () => res,
      setHeader: () => res,
      send: (b: string) => {
        body = b;
        return res;
      },
    };
    h({}, res);
    pages.set(p, body);
  }
  return { pages, duplicates };
}

const { pages, duplicates } = renderAll();
const htmlPages = [...pages].filter(([p]) => !p.endsWith(".js"));

const STATIC_PATHS = new Set(["/", "/auth", "/pricing", "/terms", "/privacy", "/cookies", "/refund", "/pitch"]);

const stripJsonLd = (html: string) => html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, "");

function jsonLdBlocks(html: string): any[] {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
}

describe("route registry", () => {
  it("registers no path twice across blog, category and tool pages", () => {
    expect(duplicates).toEqual([]);
  });

  it("every server-rendered path is covered by the service-worker exclusion pattern", () => {
    const missing = [...pages.keys()].filter((p) => !SSR_PATH_PATTERN.test(p));
    expect(missing).toEqual([]);
  });

  it("the service worker's page-cache matcher is self-contained and agrees with the pattern", () => {
    // It is serialised with toString() into sw.js; a closure reference (e.g. to
    // SSR_PATH_PATTERN) would be a ReferenceError there on every navigation.
    const src = swNavigationMatcher.toString();
    expect(src).not.toContain("SSR_PATH_PATTERN");
    const standalone = new Function(`return (${src})`)();
    const nav = (pathname: string) => standalone({ request: { mode: "navigate" }, url: { pathname } });
    for (const p of pages.keys()) expect(nav(p), p).toBe(false); // SSR pages are never handled by the SPA cache
    for (const p of ["/", "/dashboard", "/auth", "/deals/12"]) expect(nav(p), p).toBe(true);
    expect(standalone({ request: { mode: "cors" }, url: { pathname: "/dashboard" } })).toBe(false);
  });

  it("blog slugs are unique and URL-safe", () => {
    const slugs = POSTS.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9-]+$/);
  });
});

describe("internal links", () => {
  it("every same-site href on every server-rendered page resolves", () => {
    const known = new Set([...pages.keys(), ...STATIC_PATHS]);
    const broken: string[] = [];
    for (const [page, html] of htmlPages) {
      for (const m of stripJsonLd(html).matchAll(/href="(\/[^"]*)"/g)) {
        const target = m[1].replace(/&amp;/g, "&").split("#")[0].split("?")[0];
        if (target === "" || known.has(target) || target.startsWith("/templates/")) continue;
        // Static files served from client/public (favicons, blog images…).
        if (fs.existsSync(path.join(process.cwd(), "client/public", target))) continue;
        broken.push(`${page} -> ${m[1]}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it("downloadable template files that pages link to exist", () => {
    const files = new Set<string>();
    for (const [, html] of htmlPages) for (const m of html.matchAll(/href="(\/templates\/[^"]+)"/g)) files.add(m[1]);
    for (const f of files) expect(fs.existsSync(path.join(process.cwd(), "client/public", f)), f).toBe(true);
  });
});

describe("no stale or misleading claims", () => {
  it("no page promises international checkout is 'opening soon'", () => {
    const hits = htmlPages.filter(([, h]) => /opening soon/i.test(stripJsonLd(h))).map(([p]) => p);
    expect(hits).toEqual([]);
    expect(landingSeoBody()).not.toMatch(/opening soon/i);
  });

  it("no page carries an internal utm_ tag (it would overwrite the organic source in GA4)", () => {
    const hits = htmlPages.filter(([, h]) => /utm_(source|medium|campaign)/.test(h)).map(([p]) => p);
    expect(hits).toEqual([]);
    expect(landingSeoBody()).not.toMatch(/utm_(source|medium)/);
  });

  it("global pages carry no India-only framing", () => {
    const globalBlog = POSTS.filter((p) => !p.region).map((p) => `/blog/${p.slug}`);
    const globalCategory = [...PAGES, ...COMPARISON_PAGES].filter((p) => p.region === "global").map((p) => p.path);
    const offenders: string[] = [];
    for (const path of [...globalBlog, ...globalCategory]) {
      // Framing, not mention: a global article may point to the India guide or
      // name India as one of several jurisdictions, but must not be written *for*
      // India. "Keep reading" cards may also link to guides labelled for India.
      const html = stripJsonLd(pages.get(path) ?? "").replace(/<section class="related">[\s\S]*?<\/section>/, "");
      if (/India's freelancers|Made for India|Indian freelancers|Indian clients|for Indian |India-ready/.test(html)) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });

  it("global category pages advertise only the free plan, never an INR price", () => {
    for (const p of [...PAGES, ...COMPARISON_PAGES].filter((x) => x.region === "global")) {
      const ld = jsonLdBlocks(pages.get(p.path)!).find((b) => b["@type"] === "SoftwareApplication");
      for (const o of ld.offers) expect(o.priceCurrency).not.toBe("INR");
    }
  });
});

describe("structured data matches visible content", () => {
  it("every FAQPage question in the JSON-LD is visible on the page", () => {
    const problems: string[] = [];
    for (const [page, html] of htmlPages) {
      const visible = stripJsonLd(html);
      for (const block of jsonLdBlocks(html)) {
        if (block["@type"] !== "FAQPage") continue;
        for (const q of block.mainEntity) {
          if (!visible.includes(esc(q.name)) && !visible.includes(q.name)) problems.push(`${page}: ${q.name}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("dateModified is the post's updated date, falling back to its published date", () => {
    for (const p of POSTS) {
      const ld = jsonLdBlocks(pages.get(`/blog/${p.slug}`)!).find((b) => b["@type"] === "BlogPosting");
      expect(ld.datePublished).toBe(p.date);
      expect(ld.dateModified).toBe(p.updated ?? p.date);
    }
  });
});

describe("analytics", () => {
  it("the server-page GA4 id is the one the SPA uses", () => {
    const spa = fs.readFileSync(path.join(process.cwd(), "client/index.html"), "utf8");
    expect(spa).toContain(`"${GA_MEASUREMENT_ID}"`);
  });

  it("the injected scripts are syntactically valid JavaScript", () => {
    // A TS template literal silently turns "\/" into "/", which once produced a
    // malformed regex that only threw in the browser. Compile, don't execute.
    for (const snippet of [gaSnippet(), COPY_SCRIPT]) {
      const js = snippet.replace(/^<script>/, "").replace(/<\/script>$/, "");
      expect(() => new Function(js)).not.toThrow();
    }
    // …and every inline <script> on every page.
    const bad: string[] = [];
    for (const [page, html] of htmlPages) {
      for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
        try {
          new Function(m[1]);
        } catch (e: any) {
          bad.push(`${page}: ${e.message}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("the GA click filter matches product links and ignores tool-to-tool navigation", () => {
    const m = gaSnippet().match(/\/\^[^/]*\/\.test\(u\)/) || gaSnippet().match(/if\(a\.hasAttribute\('data-cta'\)\|\|(\/.*?\/)\.test\(u\)\)/);
    const re = new RegExp(m![1].slice(1, -1));
    expect(re.test("/auth?mode=signup")).toBe(true);
    expect(re.test("/pricing")).toBe(true);
    expect(re.test("/?ref=tools")).toBe(true);
    expect(re.test("/tools/quotation-maker")).toBe(false);
    expect(re.test("/blog/x")).toBe(false);
  });

  it("every server-rendered page loads GA4 exactly once and never on localhost", () => {
    for (const [page, html] of htmlPages) {
      expect(html.split(gaSnippet()).length - 1, page).toBe(1);
    }
    expect(gaSnippet()).toContain("location.hostname");
    expect(gaSnippet()).toContain("'localhost'");
    // Unlike the SPA snippet, this one must let the automatic page_view fire.
    expect(gaSnippet()).not.toContain("send_page_view");
  });
});

describe("copy-ready templates", () => {
  it("tpl() escapes markup in the template text", () => {
    const html = tpl(1, "Test <b>", "Subject: Hi\n\n<script>alert(1)</script> {Client name}");
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Template 1 — Test &lt;b&gt;");
  });

  it("the copy script ships on exactly the pages that have a template block", () => {
    for (const [page, html] of htmlPages) {
      const hasTpl = html.includes('class="tpl"');
      expect(html.includes(COPY_SCRIPT), page).toBe(hasTpl);
    }
  });
});

describe("blog topic graph", () => {
  it("'Keep reading' never lists the post itself, never exceeds six, and only links real posts", () => {
    const slugs = new Set(POSTS.map((p) => p.slug));
    for (const p of POSTS) {
      const rel = relatedSlugs(p.slug);
      expect(rel).not.toContain(p.slug);
      expect(rel.length).toBeLessThanOrEqual(6);
      for (const s of rel) expect(slugs.has(s), `${p.slug} -> ${s}`).toBe(true);
    }
  });

  it("explicit related slugs come first and all exist", () => {
    const slugs = new Set(POSTS.map((p) => p.slug));
    for (const p of POSTS) {
      for (const s of p.related ?? []) expect(slugs.has(s), `${p.slug}.related -> ${s}`).toBe(true);
      const rel = relatedSlugs(p.slug);
      const explicit = (p.related ?? []).slice(0, rel.length);
      expect(rel.slice(0, explicit.length)).toEqual(explicit);
    }
  });

  it("the homepage guide list links every post exactly once", () => {
    const html = guidesHtml();
    for (const p of POSTS) expect(html.split(`href="/blog/${p.slug}"`).length - 1, p.slug).toBe(1);
    const landing = landingSeoBody();
    for (const p of POSTS) expect(landing).toContain(`/blog/${p.slug}`);
  });

  it("sitemap lastmod values are real ISO dates", () => {
    for (const e of blogSitemapPaths()) expect(e.lastmod ?? "").toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("comparison pages", () => {
  it("are all global, registered, and carry a real last-reviewed date", () => {
    for (const p of COMPARISON_PAGES) {
      expect(p.region).toBe("global");
      expect(pages.has(p.path), p.path).toBe(true);
      expect(p.updated ?? "").toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    for (const e of comparisonSitemapPaths()) expect(e.lastmod ?? "").toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("every page that shows a vendor's pricing also prints when it was reviewed, and links its own pricing page", () => {
    for (const v of VENDORS) {
      expect(v.reviewedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(v.pricingUrl).toMatch(/^https:\/\//);
      const shown = COMPARISON_PAGES.filter((p) => pages.get(p.path)!.includes(`href="${v.pricingUrl}"`));
      expect(shown.length, `${v.name} is not shown on any page`).toBeGreaterThan(0);
      for (const p of shown) {
        expect(pages.get(p.path), `${p.path} shows ${v.name} without a review date`).toContain(`datetime="${v.reviewedOn}"`);
      }
    }
  });

  it("state DealInSec's real limits and the payment availability plainly", () => {
    for (const path of ["/bonsai-alternatives", "/bonsai-vs-dealinsec", "/freelance-business-management-software"]) {
      const text = stripJsonLd(pages.get(path)!);
      expect(text, path).toMatch(/can currently be bought in India only|bought in India only/);
      expect(text, path).toMatch(/time tracking/i);
    }
  });

  it("never claim to be the best", () => {
    for (const p of COMPARISON_PAGES) {
      // Ignore CSS, and the searcher's own wording in the FAQ question ("What is
      // the best alternative to Bonsai?") whose answer declines to rank anyone.
      const text = stripJsonLd(pages.get(p.path)!)
        .replace(/<style>[\s\S]*?<\/style>/g, "")
        .replace(/What is the best alternative to Bonsai\?/g, "");
      expect(text, p.path).not.toMatch(/\bthe best\b|#1\b|number one/i);
    }
  });
});
