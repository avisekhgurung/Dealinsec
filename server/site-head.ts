/**
 * The <head> of the client-rendered pages, as a crawler receives them.
 *
 * Every SPA route is served from one index.html shell, so without this /terms, /privacy, /cookies, /refund and /pitch
 * all carried the homepage's title, description and canonical (pointing at "/"): duplicate titles, and a canonical
 * that tells Google those pages are the homepage. Each public SPA page now gets its own title, description, canonical
 * and og:url; every other route keeps the bare shell (the app's pages behind sign-in aren't indexed).
 *
 * The homepage's structured data is generated here from shared/product-facts.ts (what it is, who it's for, the plans
 * that can actually be bought), so it can't drift from the product the way a hand-written copy in index.html did.
 * Only prices that can be charged today appear as Offers, and the paid ones carry eligibleRegion India.
 */
import { AUDIENCE_LINE, ONE_LINER, PRICING, PRODUCT_NAME, SUMMARY, SUPPORT_EMAIL } from "@shared/product-facts";

export const SITE_ORIGIN = "https://www.dealinsec.com";
export const ORGANIZATION_ID = `${SITE_ORIGIN}/#organization`;

import { OUTBOUND_ALLOWANCE_DEFAULTS as OB, OUTBOUND_WINDOW_DAYS } from "@shared/outbound-plans";

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const json = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;

/** SoftwareApplication, Organization and WebSite for the homepage. */
export function homeSchemas(): string {
  const india = { "@type": "Country", name: "India" };
  return [
    json({
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: PRODUCT_NAME,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      url: `${SITE_ORIGIN}/`,
      description: `${ONE_LINER} For ${AUDIENCE_LINE}. ${SUMMARY}`,
      offers: [
        { "@type": "Offer", name: "Free", price: "0", priceCurrency: "USD", description: `${OB.free.monthlySearches} Client Radar searches every ${OUTBOUND_WINDOW_DAYS} days (up to ${OB.free.maxCompanies} companies each), the leads pipeline, and ${PRICING.freeMonthlyDeals} deals a month, each with its quotation. Available in every country.` },
        { "@type": "Offer", name: "Pro Monthly", price: String(PRICING.proMonthlyInr), priceCurrency: "INR", eligibleRegion: india, description: `${OB.pro.monthlySearches} Client Radar searches every ${OUTBOUND_WINDOW_DAYS} days (up to ${OB.pro.maxCompanies} companies each), unlimited deals, agreements, invoices and payment tracking. Paid monthly in India; it does not renew automatically.` },
      ],
      publisher: { "@id": ORGANIZATION_ID },
    }),
    json({
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": ORGANIZATION_ID,
      name: PRODUCT_NAME,
      url: `${SITE_ORIGIN}/`,
      logo: `${SITE_ORIGIN}/apple-touch-icon.png`,
      email: SUPPORT_EMAIL,
      description: ONE_LINER,
    }),
    json({ "@context": "https://schema.org", "@type": "WebSite", "@id": `${SITE_ORIGIN}/#website`, name: PRODUCT_NAME, url: `${SITE_ORIGIN}/`, publisher: { "@id": ORGANIZATION_ID } }),
  ].join("\n    ");
}

export interface PageHead { title: string; description: string; /** "noindex, follow" keeps a page out of search while its links still count. */ robots?: string }

/** The public pages the SPA renders (the rest of the public site is server-rendered with its own head). */
export const SPA_PAGE_HEADS: Readonly<Record<string, PageHead>> = {
  "/pitch": {
    title: "DealInSec product overview — from prospect to payment",
    description: "A one-page overview of DealInSec: Client Radar prospect research, leads, deals, quotations, agreements signed online, invoices and payment tracking for small B2B agencies and consultants.",
    // A printable sales overview with illustrative figures, not a page to rank: kept out of search and the sitemap.
    robots: "noindex, follow",
  },
  "/terms": { title: "Terms of Service | DealInSec", description: "The terms that govern your use of DealInSec, its plans and its free tools." },
  "/privacy": { title: "Privacy Policy | DealInSec", description: "What DealInSec collects, why, who processes it, how long it is kept, and your choices — including connected Gmail accounts and analytics consent." },
  "/cookies": { title: "Cookie Policy | DealInSec", description: "The cookies DealInSec uses, which are optional, and how to change your choice." },
  "/refund": { title: "Refund Policy | DealInSec", description: "When and how DealInSec refunds a paid plan." },
};

/** The SPA pages that belong in sitemap.xml: "/" and every public page that isn't noindex. */
export const indexableSpaPaths = (): string[] => ["/", ...Object.entries(SPA_PAGE_HEADS).filter(([, h]) => !h.robots?.includes("noindex")).map(([p]) => p)];

/** The shell with this page's title, description, canonical and og:url in place of the homepage's. */
export function withPageHead(shell: string, path: string, head: PageHead): string {
  const url = `${SITE_ORIGIN}${path}`;
  const t = escapeAttr(head.title), d = escapeAttr(head.description);
  return shell
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${t}</title>`)
    .replace(/<meta name="description" content="[^"]*"\s*\/?>/, `<meta name="description" content="${d}" />`)
    .replace(/<meta property="og:title" content="[^"]*"\s*\/?>/, `<meta property="og:title" content="${t}" />`)
    .replace(/<meta property="og:description" content="[^"]*"\s*\/?>/, `<meta property="og:description" content="${d}" />`)
    .replace(/<meta name="twitter:title" content="[^"]*"\s*\/?>/, `<meta name="twitter:title" content="${t}" />`)
    .replace(/<meta name="twitter:description" content="[^"]*"\s*\/?>/, `<meta name="twitter:description" content="${d}" />`)
    .replace(/<link rel="canonical" href="[^"]*"\s*\/?>/, `<link rel="canonical" href="${url}" />\n    <meta property="og:url" content="${url}" />${head.robots ? `\n    <meta name="robots" content="${escapeAttr(head.robots)}" />` : ""}`);
}

/** The homepage: its own og:url and the generated structured data. */
export function withHomeHead(shell: string): string {
  return shell
    .replace(/<link rel="canonical" href="[^"]*"\s*\/?>/, (m) => `${m}\n    <meta property="og:url" content="${SITE_ORIGIN}/" />`)
    .replace("</head>", `    ${homeSchemas()}\n  </head>`);
}
