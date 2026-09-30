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
import { TOOLS, registerToolPages, toolSitemapPaths } from "./tools";
import { CORE_JS as DUE_DATE_CORE_JS, EXAMPLE_INVOICE_DATE, FAQ as DUE_DATE_FAQ } from "./tools/invoice-due-date";
import { EXAMPLES as DEAL_RISK_EXAMPLES, FAQ as DEAL_RISK_FAQ } from "./tools/deal-risk";
import { landingSeoBody } from "./landing-seo";
import { AUDIENCE_DESCRIPTIONS, COMPARISON_DESCRIPTIONS, TOOL_DESCRIPTIONS, llmsTxt } from "./llms";
import { categorySitemapPaths } from "./category-pages";

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

describe("entity and AEO surface", () => {
  const ORIGIN = "https://www.dealinsec.com";

  it("every URL listed in /llms.txt is a real page", () => {
    const known = new Set([...pages.keys(), ...STATIC_PATHS]);
    const txt = llmsTxt(ORIGIN);
    const urls = [...txt.matchAll(/\]\((https?:\/\/[^)]+)\)/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThan(30);
    const bad = urls.filter((u) => !u.startsWith(ORIGIN) || !known.has(u.slice(ORIGIN.length)));
    expect(bad).toEqual([]);
    // Every post, tool and comparison page is listed.
    for (const p of POSTS) expect(txt, p.slug).toContain(`${ORIGIN}/blog/${p.slug})`);
  });

  it("every tool and comparison page in /llms.txt has its own factual description", () => {
    const tools = TOOLS.map((t) => t.slug);
    const comparisons = COMPARISON_PAGES.map((p) => p.path).filter(
      (p) => p !== "/about" && p !== "/freelance-business-management-software",
    );
    expect(tools.filter((s) => !TOOL_DESCRIPTIONS[s])).toEqual([]);
    expect(comparisons.filter((p) => !COMPARISON_DESCRIPTIONS[p])).toEqual([]);
    // No stale entries for tools or pages that no longer exist.
    expect(Object.keys(TOOL_DESCRIPTIONS).filter((s) => !tools.includes(s))).toEqual([]);
    expect(Object.keys(COMPARISON_DESCRIPTIONS).filter((p) => !comparisons.includes(p))).toEqual([]);
  });

  it("/about names the founder as an Organization entity, with no invented profiles", () => {
    const html = pages.get("/about")!;
    expect(html).toBeTruthy();
    const org = jsonLdBlocks(html).find((b) => b["@type"] === "Organization");
    expect(org.founder.name).toBe("Avisekh Gurung");
    expect(org.sameAs).toBeUndefined();
    expect(jsonLdBlocks(html).some((b) => b["@type"] === "AboutPage")).toBe(true);
  });

  it("no page links to a placeholder social profile", () => {
    const hits = htmlPages
      .filter(([, h]) => /href="https:\/\/(twitter\.com|x\.com|www\.linkedin\.com|www\.facebook\.com|www\.instagram\.com)\/?"/.test(h))
      .map(([p]) => p);
    expect(hits).toEqual([]);
  });

  it("a post shows an Updated date only when it was substantively edited after publishing", () => {
    for (const p of POSTS) {
      const html = pages.get(`/blog/${p.slug}`)!;
      const shows = /· Updated <time/.test(html);
      expect(shows, p.slug).toBe(Boolean(p.updated && p.updated !== p.date));
    }
  });

  it("every global post links, in its own body, to a free tool, a commercial page and another guide", () => {
    // Global posts point at global commercial pages (the India category pages are
    // written for Indian readers), and /about is not a commercial page.
    const commercial = new Set(
      [...PAGES, ...COMPARISON_PAGES].filter((p) => p.region === "global" && p.path !== "/about").map((p) => p.path),
    );
    const problems: string[] = [];
    for (const p of POSTS.filter((x) => !x.region)) {
      const hrefs = [...p.body.matchAll(/href="(\/[^"#?]*)/g)].map((m) => m[1]);
      if (!hrefs.some((h) => h.startsWith("/tools/"))) problems.push(`${p.slug}: no free tool`);
      if (!hrefs.some((h) => commercial.has(h))) problems.push(`${p.slug}: no commercial page`);
      if (!hrefs.some((h) => h.startsWith("/blog/") && h !== `/blog/${p.slug}`)) problems.push(`${p.slug}: no other guide`);
    }
    expect(problems).toEqual([]);
  });

  it("the pillar links down to every global guide", () => {
    const html = pages.get("/freelance-business-management-software")!;
    const missing = POSTS.filter((p) => !p.region && !html.includes(`href="/blog/${p.slug}"`)).map((p) => p.slug);
    expect(missing).toEqual([]);
  });
});

describe("invoice due date calculator page", () => {
  const PATH = "/tools/invoice-due-date-calculator";
  const html = pages.get(PATH) ?? "";
  const visible = stripJsonLd(html);

  it("is registered, in the sitemap, and not served by the SPA shell", () => {
    expect(html.length).toBeGreaterThan(1000);
    expect(toolSitemapPaths()).toContain(PATH);
    expect(SSR_PATH_PATTERN.test(PATH)).toBe(true);
  });

  it("has one H1, its own canonical, title and meta description, and the calculator markup", () => {
    expect(html.match(/<h1[\s>]/g)?.length).toBe(1);
    expect(html).toContain(`<link rel="canonical" href="https://www.dealinsec.com${PATH}" />`);
    expect(html).toMatch(/<title>Invoice Due Date Calculator — Net 15, Net 30, Net 45 &amp; Net 60 \| DealInSec<\/title>/);
    expect(html).toMatch(/<meta name="description" content="Calculate an invoice due date from the invoice date and payment terms/);
    for (const id of ["dd-date", "dd-due", "dd-reset", "dd-explain"]) expect(html, id).toContain(`id="${id}"`);
    for (const v of ["0", "7", "15", "30", "45", "60"]) expect(html).toContain(`name="terms" value="${v}"`);
    expect(html).toContain('value="next-business-day"');
  });

  it("marks up only what is visible: FAQ questions and answers match exactly", () => {
    const ld = jsonLdBlocks(html);
    expect(ld.map((b) => b["@type"]).sort()).toEqual(["BreadcrumbList", "FAQPage", "SoftwareApplication"]);
    const faq = ld.find((b) => b["@type"] === "FAQPage");
    expect(faq.mainEntity.map((q: any) => q.name)).toEqual(DUE_DATE_FAQ.map((f) => f.q));
    expect(faq.mainEntity.map((q: any) => q.acceptedAnswer.text)).toEqual(DUE_DATE_FAQ.map((f) => f.a));
    for (const f of DUE_DATE_FAQ) {
      expect(visible).toContain(`<summary>${esc(f.q)}</summary>`);
      expect(visible).toContain(`<p>${esc(f.a)}</p>`);
    }
  });

  it("the dates written in the prose agree with the calculator", () => {
    const { ddCalc } = new Function(`${DUE_DATE_CORE_JS}; return { ddCalc: ddCalc };`)();
    const due = (days: number) => ddCalc(EXAMPLE_INVOICE_DATE, days, "keep").due;
    expect(EXAMPLE_INVOICE_DATE).toBe("2026-10-01");
    expect(due(15)).toBe("2026-10-16");
    expect(visible).toContain("on Net 15 terms is due on 16 October 2026");
    expect(due(30)).toBe("2026-10-31");
    expect(visible).toContain("on Net 30 terms is due on 31 October 2026");
    expect(visible).toContain("the due date is 31 October 2026"); // FAQ
    expect(due(45)).toBe("2026-11-15");
    expect(visible).toContain("on Net 45 terms is due on 15 November 2026");
  });

  it("never presents a weekend or payment rule as law", () => {
    const text = visible.replace(/<[^>]+>/g, " ");
    expect(text).not.toMatch(/legally (required|mandatory|binding)|required by law|by law/i);
  });

  it("links to the payment-terms and reminder resources", () => {
    for (const href of [
      "/blog/freelance-payment-terms",
      "/blog/payment-reminder-email",
      "/blog/overdue-invoice-email",
      "/tools/payment-reminder-email-generator",
    ]) {
      expect(visible, href).toContain(`href="${href}"`);
    }
  });

  it("is linked in context from the pages about due dates and reminders", () => {
    for (const from of [
      "/blog/freelance-payment-terms",
      "/blog/freelance-invoice-guide",
      "/blog/payment-reminder-email",
      "/blog/overdue-invoice-email",
      "/tools/payment-reminder-email-generator",
    ]) {
      // Outside the shared tool navigation, which links every tool anyway.
      const main = (pages.get(from) ?? "").match(/<main>([\s\S]*?)<\/main>|<article[\s\S]*?<\/article>/)?.[0] ?? "";
      expect(main, from).toContain(`href="${PATH}"`);
    }
  });

  it("has one product CTA, tracked by the existing seo_cta_click rule, that says reminders are drafted not sent", () => {
    expect(visible).not.toContain('class="cta-band"');
    expect(visible).toContain('href="/auth?mode=signup&ref=tool_due_date" data-cta');
    expect(visible).toMatch(/It only drafts: you review the reminder and send it yourself/);
  });
});


describe("deal risk checker page", () => {
  const PATH = "/tools/deal-risk-checker";
  const html = pages.get(PATH) ?? "";
  const visible = stripJsonLd(html);
  const text = visible.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ");

  it("is registered, in the sitemap, and not served by the SPA shell", () => {
    expect(html.length).toBeGreaterThan(1000);
    expect(toolSitemapPaths()).toContain(PATH);
    expect(SSR_PATH_PATTERN.test(PATH)).toBe(true);
  });

  it("has one H1, its own canonical, title and description, and the tool markup", () => {
    expect(html.match(/<h1[\s>]/g)?.length).toBe(1);
    expect(html).toContain(`<link rel="canonical" href="https://www.dealinsec.com${PATH}" />`);
    expect(html).toMatch(/<title>Deal Risk Checker — Check a Client or Brand Message Before You Say Yes \| DealInSec<\/title>/);
    expect(html).toMatch(/<meta name="description" content="Paste a client request or a brand offer/);
    for (const id of ["dr-text", "dr-run", "dr-result", "dr-summary", "dr-missing", "dr-findings", "dr-questions", "dr-copy", "dr-ai-run", "dr-cta"]) {
      expect(html, id).toContain(`id="${id}"`);
    }
    expect(html).toContain('name="kind" value="client"');
    expect(html).toContain('name="kind" value="brand"');
  });

  it("marks up only what is visible: FAQ questions and answers match exactly", () => {
    const ld = jsonLdBlocks(html);
    expect(ld.map((b) => b["@type"]).sort()).toEqual(["BreadcrumbList", "FAQPage", "SoftwareApplication"]);
    const faq = ld.find((b) => b["@type"] === "FAQPage");
    expect(faq.mainEntity.map((q: any) => q.name)).toEqual(DEAL_RISK_FAQ.map((f) => f.q));
    expect(faq.mainEntity.map((q: any) => q.acceptedAnswer.text)).toEqual(DEAL_RISK_FAQ.map((f) => f.a));
    for (const f of DEAL_RISK_FAQ) {
      expect(visible).toContain(`<summary>${esc(f.q)}</summary>`);
      expect(visible).toContain(`<p>${esc(f.a)}</p>`);
    }
  });

  it("offers the two examples from the brief", () => {
    for (const e of DEAL_RISK_EXAMPLES) expect(html).toContain(`data-text="${esc(e.text)}"`);
    expect(DEAL_RISK_EXAMPLES.map((e) => e.kind)).toEqual(["client", "brand"]);
  });

  it("says plainly what it is not and where the message goes", () => {
    expect(text).toMatch(/not legal advice/i);
    expect(text).toMatch(/nothing you paste is saved/i);
    expect(text).toMatch(/sends the message to an AI service/i);
    // "not a guarantee of anything" is the hedge we want; only a claim is banned.
    expect(text).toMatch(/not a guarantee/i);
    expect(text).not.toMatch(/legally (required|mandatory|binding)|(?<!not an? )guarantee[ds]?|\bcompliant\b/i);
  });

  it("keeps no draft: the page never writes the pasted message to storage", () => {
    // sessionStorage is used for the sign-up handoff only (the AI draft and the work type),
    // never for the message text.
    expect(html).not.toMatch(/localStorage/);
    const stores = [...html.matchAll(/(?:sessionStorage)\.setItem\('([^']+)'/g)].map((m) => m[1]);
    expect(stores.sort()).toEqual(["dis_audience_intent", "dis_deal_prefill"]);
  });

  it("has one product CTA, tracked by the seo_cta_click rule, and no shared CTA band", () => {
    expect(visible).not.toContain('class="cta-band"');
    expect(visible).toContain('href="/auth?mode=signup&ref=tool_deal_risk" data-cta');
  });

  it("links to the documents, terms guides and the audience pages it belongs with", () => {
    for (const href of [
      "/tools/quotation-maker",
      "/tools/service-agreement-template",
      "/blog/freelance-payment-terms",
      "/tools/invoice-due-date-calculator",
      "/blog/scope-creep",
      "/blog/revision-limits",
      "/blog/freelance-contract-terms",
    ]) {
      expect(visible, href).toContain(`href="${href}"`);
    }
  });

  it("is linked in context from the guides about scope, revisions and contracts", () => {
    for (const from of ["/blog/scope-creep", "/blog/revision-limits", "/blog/freelance-contract-terms", "/for-freelancers", "/for-creators"]) {
      const main = (pages.get(from) ?? "").match(/<main>([\s\S]*?)<\/main>|<article[\s\S]*?<\/article>/)?.[0] ?? "";
      expect(main, from).toContain(`href="${PATH}"`);
    }
  });

  it("appears in the tool switcher, the tools hub and llms.txt", () => {
    expect(pages.get("/tools/quotation-maker")).toContain(`href="${PATH}"`);
    expect(pages.get("/tools")).toContain(`href="${PATH}"`);
    expect(llmsTxt("https://www.dealinsec.com")).toContain(`https://www.dealinsec.com${PATH}`);
    expect(TOOL_DESCRIPTIONS["deal-risk-checker"]).toMatch(/pasted client request or brand offer/);
  });
});

describe("audience pages: /for-freelancers and /for-creators", () => {
  const PATHS = ["/for-freelancers", "/for-creators"];
  const mainOf = (p: string) => (pages.get(p) ?? "").match(/<main>([\s\S]*?)<\/main>/)?.[1] ?? "";
  const textOf = (p: string) => stripJsonLd(mainOf(p)).replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").toLowerCase();

  it("are registered, global, in the sitemap and matched by the SSR pattern", () => {
    for (const p of PATHS) {
      expect(pages.get(p)?.length, p).toBeGreaterThan(1000);
      expect(categorySitemapPaths(), p).toContain(p);
      expect(SSR_PATH_PATTERN.test(p), p).toBe(true);
      expect(PAGES.find((x) => x.path === p)?.region, p).toBe("global");
    }
  });

  it("have one H1, their own canonical, title, description and a FAQ that matches its markup", () => {
    for (const p of PATHS) {
      const html = pages.get(p) ?? "";
      const page = PAGES.find((x) => x.path === p)!;
      expect(html.match(/<h1[\s>]/g)?.length, p).toBe(1);
      expect(html, p).toContain(`<link rel="canonical" href="https://www.dealinsec.com${p}" />`);
      expect(html, p).toContain(`<title>${esc(page.metaTitle)} | DealInSec</title>`);
      expect(page.description.length, `${p} description`).toBeLessThan(200);
      const faq = jsonLdBlocks(html).find((b) => b["@type"] === "FAQPage");
      expect(faq.mainEntity.map((q: any) => q.name), p).toEqual(page.faq.map((f) => f.q));
    }
  });

  it("are not near-duplicates: genuinely different content for each audience", () => {
    const shingles = (t: string) => {
      const w = t.split(" ");
      const set = new Set<string>();
      for (let i = 0; i + 4 <= w.length; i++) set.add(w.slice(i, i + 4).join(" "));
      return set;
    };
    const a = shingles(textOf("/for-freelancers"));
    const b = shingles(textOf("/for-creators"));
    const shared = [...a].filter((x) => b.has(x)).length;
    const jaccard = shared / (a.size + b.size - shared);
    // The shared thread section and the site chrome account for the overlap.
    expect(jaccard).toBeLessThan(0.3);
  });

  it("each speaks to its own audience and to what the other one lacks", () => {
    const creators = textOf("/for-creators");
    const freelancers = textOf("/for-freelancers");
    for (const term of ["usage rights", "exclusivity", "brand", "ugc", "reels"]) expect(creators, term).toContain(term);
    for (const term of ["scope", "deposit", "revision", "milestone"]) expect(freelancers, term).toContain(term);
    expect(freelancers).not.toContain("usage rights");
  });

  it("say what DealInSec does not do, that it is not legal advice, and that unknowns stay unspecified", () => {
    for (const p of PATHS) {
      const t = textOf(p);
      expect(t, p).toContain("not legal advice");
      expect(t, p).toMatch(/doesn.t collect payment|does not collect payments?|doesn.t do/);
      expect(t, p).toContain("not specified");
      expect(t, p).toMatch(/free plan/);
    }
    expect(textOf("/for-creators")).toMatch(/isn.t a marketplace|not a marketplace/);
  });

  it("make no legal, guarantee or payment promise and quote no price", () => {
    for (const p of PATHS) {
      const t = textOf(p);
      expect(t, p).not.toMatch(/legally binding|(?<!not an? )guarantee[ds]?|will pay you|you will get paid|100% safe|fully protected/);
    }
    // Example figures in the illustrative deals are allowed; a plan price is not.
    for (const p of PATHS) {
      expect(mainOf(p), p).not.toMatch(/per month|\/month|\/year|a month or/i);
    }
  });

  it("link to the checker, each other, the pillar and real tools, and never to an India page", () => {
    expect(mainOf("/for-freelancers")).toContain('href="/for-creators"');
    expect(mainOf("/for-creators")).toContain('href="/for-freelancers"');
    for (const p of PATHS) {
      const m = mainOf(p);
      expect(m, p).toContain('href="/tools/deal-risk-checker"');
      expect(m, p).toContain('href="/tools/quotation-maker"');
      for (const india of ["/freelancer-invoice-software", "/refrens-alternative", "/vyapar-alternative", "/tools/gst-"]) {
        expect(m, `${p} -> ${india}`).not.toContain(`href="${india}`);
      }
    }
  });

  it("are listed in llms.txt with a factual description, and linked from the footer and header", () => {
    const llms = llmsTxt("https://www.dealinsec.com");
    for (const p of PATHS) {
      expect(llms).toContain(`https://www.dealinsec.com${p}`);
      expect(AUDIENCE_DESCRIPTIONS[p]).toBeTruthy();
      expect(pages.get("/quotation-software"), p).toContain(`href="${p}"`);
    }
  });

  it("relate only to global pages, so an India-framed page never appears on them", () => {
    for (const p of PATHS) {
      // Only the related-pages grid: the shared footer legitimately links every category page.
      const grid = (pages.get(p) ?? "").match(/The rest of the thread<\/h2>\s*<div class="rel-grid">([\s\S]*?)<\/div>\s*<\/div><\/section>/)?.[1] ?? "";
      expect(grid, p).toContain('class="rel-card"');
      for (const india of ["/refrens-alternative", "/vyapar-alternative", "/quotation-software", "/e-signature", "/freelancer-invoice-software"]) {
        expect(grid, `${p} -> ${india}`).not.toContain(`href="${india}"`);
      }
    }
  });
});

describe("homepage crawler fallback speaks to both audiences", () => {
  const body = landingSeoBody();

  it("leads with the two-audience headline and the workflow", () => {
    expect(body).toContain("<h1>Turn client and brand deals into clear, professional agreements — and get paid</h1>");
    expect(body).toContain("Deal, Protection Check, Quotation, Agreement, Invoice, Payment");
  });

  it("introduces both audiences and links to their pages and the checker", () => {
    for (const href of ["/for-freelancers", "/for-creators", "/tools/deal-risk-checker"]) expect(body, href).toContain(`href="${href}"`);
    expect(body).toContain("For client work: freelancers and independent professionals.");
    expect(body).toContain("For brand collaborations: creators and UGC professionals.");
  });

  it("answers the creator question in its FAQ, without claiming a marketplace", () => {
    expect(body).toContain("Can I use DealInSec for brand deals as a creator?");
    expect(body).toMatch(/not a marketplace and it does not find brand deals/);
  });
});

describe("the tools hub", () => {
  const html = pages.get("/tools") ?? "";

  it("groups the tools: protection first, then documents, then country tools", () => {
    const i = (needle: string) => html.indexOf(needle);
    expect(i("Deal &amp; protection")).toBeGreaterThan(-1);
    expect(i("Deal &amp; protection")).toBeLessThan(i("Quotes, agreements &amp; invoices"));
    expect(i("Built on one country's rules")).toBeGreaterThan(-1);
    expect(i("Quotes, agreements &amp; invoices")).toBeLessThan(i("Built on one country's rules"));
    expect(html.indexOf("/tools/deal-risk-checker")).toBeLessThan(html.indexOf("/tools/quotation-maker"));
  });

  it("is addressed to freelancers and creators", () => {
    expect(html).toMatch(/Free tools for<br \/><span class="accent">freelancers &amp; creators<\/span>/);
    expect(html).toContain("Who are the tools for?");
  });
});
