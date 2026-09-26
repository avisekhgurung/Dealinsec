/**
 * /llms.txt — a plain-text brief for AI answer engines and LLM crawlers
 * (format: llmstxt.org — H1, a quoted summary, then sections of links).
 *
 * Facts only, the same facts the product, the legal pages and /about state:
 * nothing here may claim a feature, price or credential that isn't true today.
 * The link lists are generated from the page registries, so a new post, tool
 * or comparison page appears here automatically and a removed one disappears;
 * server/seo.test.ts asserts every listed URL is a registered route.
 */
import { POSTS } from "./blog";
import { COMPARISON_PAGES } from "./comparison-pages";
import { TOOLS } from "./tools";

export function llmsTxt(origin: string): string {
  const link = (title: string, path: string, note?: string) =>
    `- [${title}](${origin}${path})${note ? `: ${note}` : ""}`;

  const pillar = COMPARISON_PAGES.find((p) => p.path === "/freelance-business-management-software")!;
  const comparisons = COMPARISON_PAGES.filter((p) => p.path !== pillar.path && p.path !== "/about");
  const globalPosts = POSTS.filter((p) => !p.region);
  const indiaPosts = POSTS.filter((p) => p.region === "IN");

  return `# DealInSec

> DealInSec is web software for freelancers and solo service providers to run each client deal from quotation to payment: a quotation the client can accept online, an agreement the client can sign online, invoices drawn from that agreement, and tracking of what is paid, pending and overdue. It works in 50 currencies and is used by freelancers in any country.

## Key facts

- Maker: DealInSec is a sole proprietorship of Avisekh Gurung, based in Darjeeling, India.
- Contact: support@dealinsec.com
- What it does: deals; quotations with a client acceptance link; agreements with a public signing link (electronic acceptance with an audit record of who signed, when and with which signature — not a certified digital signature); invoices drawn from the agreement; payment status tracking; Protection Check, which flags risky or missing terms (such as unlimited revisions or no advance) before a deal is sent; AI-drafted payment reminders that the user reviews and sends themselves.
- What it does not do: time tracking, a client portal, accounting or expense tracking, meeting scheduling, sending reminders automatically, or collecting payments. Clients pay the freelancer directly; DealInSec records the status.
- Pricing: a free plan (4 deals a month, each with its quotation) and a 7-day Pro trial with no card are open in every country. The paid Pro plan (₹99 a month or ₹999 a year) can currently be bought in India only; payments from other countries are not available yet.
- Free tools: browser-based document tools that need no account and do not store what is typed on DealInSec's servers.

## About

${link("About DealInSec", "/about", "who makes it, what it does and does not do, and how its guides are written")}
${link(pillar.shortLabel, pillar.path, "what freelance business management software is, and where DealInSec fits")}

## Free tools

${TOOLS.map((t) => link(t.title, t.path, t.country ? `${t.country === "IN" ? "India" : "United Kingdom"} only` : undefined)).join("\n")}

## Comparisons

${comparisons.map((p) => link(p.shortLabel, p.path, "prices read from each vendor's own pricing page, with the review date printed")).join("\n")}

## Guides

${globalPosts.map((p) => link(p.title, `/blog/${p.slug}`)).join("\n")}

## Guides written for India

${indiaPosts.map((p) => link(p.title, `/blog/${p.slug}`)).join("\n")}

## Optional

${link("Privacy policy", "/privacy")}
${link("Terms", "/terms")}
`;
}
