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

/**
 * One factual line per free tool, keyed by slug: what it takes in and what it
 * gives back, as the tool's own code does it. No adjectives, no "free, no
 * sign-up" (the Key facts section says that once). server/seo.test.ts fails if
 * a registered tool has no entry here.
 */
export const TOOL_DESCRIPTIONS: Record<string, string> = {
  "quotation-maker":
    "builds a quotation with line items, optional GST, VAT or sales tax and standard terms in a chosen country's currency, and downloads it as a PDF",
  "bill-generator":
    "builds an item-wise bill or invoice with a total, optional tax, a logo, a signature and an optional PAID stamp, and downloads it as a PDF or PNG",
  "payment-reminder-email-generator":
    "turns an invoice's number, amount and due date into a reminder email in a friendly, firm or final tone, to copy or open in the user's email app; it sends nothing itself",
  "service-agreement-template":
    "generates a freelancer–client service agreement (scope, deliverables, fees, revisions, cancellation, governing law and signature blocks) and downloads it as a PDF",
  "proforma-invoice-generator":
    "builds a proforma invoice that confirms price and terms before the sale, with optional tax and a validity date, and downloads it as a PDF",
  "purchase-order-generator":
    "builds a purchase order with vendor details, a delivery date and totals with optional tax, and downloads it as a PDF",
  "quotation-templates":
    "downloadable quotation templates in Word (.docx) and Excel (.xlsx, with auto-totals), including a GST version for India",
  "uk-late-payment-calculator":
    "for overdue invoices on UK commercial debts: calculates statutory interest at 8% above the Bank of England base rate and the £40, £70 or £100 fixed compensation, and drafts a letter before action",
  "gst-invoice-generator":
    "builds an Indian GST invoice with the CGST and SGST or IGST split and the amount in words, and downloads it as a PDF",
  "gst-calculator":
    "adds or removes Indian GST at 5%, 18% or 40% and shows the CGST and SGST or IGST breakdown",
};

/** One factual line per comparison page, keyed by path (tested like tools). */
export const COMPARISON_DESCRIPTIONS: Record<string, string> = {
  "/bonsai-alternatives":
    "compares Bonsai, Moxie, HoneyBook, Dubsado, Indy and DealInSec on price and features, with prices taken from each vendor's own pricing page and the review date shown",
  "/bonsai-vs-dealinsec":
    "compares Bonsai and DealInSec side by side: Bonsai's current pricing, what each product includes, what DealInSec does not do, and who each suits",
};

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

${TOOLS.map((t) => {
  const where = t.country ? ` (${t.country === "IN" ? "India" : "United Kingdom"} only)` : "";
  return link(t.title, t.path, `${TOOL_DESCRIPTIONS[t.slug]}${where}`);
}).join("\n")}

## Comparisons

${comparisons.map((p) => link(p.shortLabel, p.path, COMPARISON_DESCRIPTIONS[p.path])).join("\n")}

## Guides

${globalPosts.map((p) => link(p.title, `/blog/${p.slug}`)).join("\n")}

## Guides written for India

${indiaPosts.map((p) => link(p.title, `/blog/${p.slug}`)).join("\n")}

## Optional

${link("Privacy policy", "/privacy")}
${link("Terms", "/terms")}
`;
}
