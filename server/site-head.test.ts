/**
 * What crawlers and AI assistants read: the per-page heads of the client-rendered pages, the homepage's structured
 * data, /llms.txt and the homepage's crawlable copy. Checked against the real index.html, and against the same
 * stale-claim list the chatbot's knowledge is held to.
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { homeSchemas, indexableSpaPaths, SPA_PAGE_HEADS, withHomeHead, withPageHead } from "./site-head";
import { llmsTxt } from "./llms";
import { landingSeoBody } from "./landing-seo";
import { LANDING_FAQS } from "@shared/landing-faqs";
import { CAPABILITIES, ONE_LINER, PRICING } from "@shared/product-facts";
import { STALE_OR_UNSUPPORTED } from "@shared/product-claims";

const shell = fs.readFileSync(path.resolve(process.cwd(), "client/index.html"), "utf8");
const ldBlocks = (html: string) => Array.from(html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)).map((m) => JSON.parse(m[1]));
const one = (html: string, re: RegExp) => (html.match(new RegExp(re, "g")) ?? []).length;

describe("client-rendered public pages get their own head", () => {
  for (const [p, head] of Object.entries(SPA_PAGE_HEADS)) {
    it(p, () => {
      const html = withPageHead(shell, p, head);
      expect(html).toContain(`<title>${head.title}</title>`);
      expect(html).toContain(`<link rel="canonical" href="https://www.dealinsec.com${p}" />`);
      expect(html).toContain(`<meta property="og:url" content="https://www.dealinsec.com${p}" />`);
      expect(one(html, /<title>/)).toBe(1);
      expect(one(html, /rel="canonical"/)).toBe(1);
      expect(html).not.toContain(shell.match(/<title>[\s\S]*?<\/title>/)![0]); // never the homepage's own title
      expect(html.includes('name="robots"')).toBe(!!head.robots);
    });
  }

  it("the sitemap lists the homepage and every public page except the noindex overview", () => {
    expect(indexableSpaPaths()).toEqual(["/", "/terms", "/privacy", "/cookies", "/refund"]);
  });
});

describe("the homepage's structured data", () => {
  const html = withHomeHead(shell);
  const blocks = ldBlocks(html);

  it("is generated once, from the product facts, and is valid JSON", () => {
    expect(ldBlocks(shell)).toEqual([]); // none hand-written in index.html any more
    expect(blocks.map((b) => b["@type"])).toEqual(["SoftwareApplication", "Organization", "WebSite"]);
    expect(html).toContain('<meta property="og:url" content="https://www.dealinsec.com/" />');
    expect(blocks[0].description).toContain(ONE_LINER);
  });

  it("offers only what can be bought: free everywhere, paid plans in India at the charged prices", () => {
    const offers = blocks[0].offers;
    expect(offers.map((o: any) => [o.name, o.price, o.priceCurrency])).toEqual([["Free", "0", "USD"], ["Pro Monthly", String(PRICING.proMonthlyInr), "INR"]]);
    for (const o of offers.slice(1)) expect(o.eligibleRegion).toEqual({ "@type": "Country", name: "India" });
  });

  it("one Organization entity, shared with /about, and no ratings or reviews", () => {
    expect(blocks[1]["@id"]).toBe("https://www.dealinsec.com/#organization");
    expect(blocks[0].publisher).toEqual({ "@id": "https://www.dealinsec.com/#organization" });
    expect(JSON.stringify(blocks)).not.toMatch(/aggregateRating|ratingValue|"review"/);
  });
});

describe("AI-readable and crawlable product descriptions", () => {
  const llms = llmsTxt("https://www.dealinsec.com");
  const sources: [string, string][] = [
    ["llms.txt", llms],
    ["homepage fallback", landingSeoBody()],
    ["landing FAQ", LANDING_FAQS.map((f) => `${f.q} ${f.a}`).join("\n")],
    ["homepage JSON-LD", homeSchemas()],
  ];

  it("lead with the current positioning", () => {
    expect(llms).toContain(`> ${ONE_LINER}`);
    expect(llms).not.toMatch(/web software for freelancers, solo service providers and creators/);
    expect(landingSeoBody()).toContain(ONE_LINER);
  });

  it("make no stale or unsupported claims", () => {
    for (const [name, text] of sources) for (const re of STALE_OR_UNSUPPORTED) expect(text, `${name}: ${re}`).not.toMatch(re);
  });

  it("quote only prices that can be charged", () => {
    const allowed = new Set([0, PRICING.proMonthlyInr, PRICING.extraSeatInr].map(String)); // ₹0 is the free plan
    for (const [name, text] of sources) {
      for (const m of text.matchAll(/₹\s?([\d,]+)/g)) expect(allowed.has(m[1].replace(/,/g, "")), `${name}: ₹${m[1]}`).toBe(true);
      expect(text, name).not.toMatch(/\$\s?\d+\s*(\/|a |per )(month|year|yr|mo)/i); // no foreign plan price is buyable
    }
  });

  it("llms.txt states every capability with its real status", () => {
    for (const c of CAPABILITIES) expect(llms, c.name).toContain(c.name);
    expect(llms).toMatch(/- Limited availability:\n  - Gmail connection/);
  });
});
