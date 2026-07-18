/**
 * Public free-tool / SEO pages.
 *
 * These are server-rendered HTML (indexable) and MUST be registered before the
 * SPA catch-all in server/index.ts. Add new tools to the TOOLS registry; each
 * gets a route, a card on /tools, and an entry in the sitemap automatically.
 */
import type { Express } from "express";
import { renderToolPage, esc } from "./layout";
import { gstInvoicePage, gstInvoiceMeta } from "./gst-invoice";
import { quotationMakerPage, quotationMakerMeta } from "./quotation-maker";
import { serviceAgreementPage, serviceAgreementMeta } from "./service-agreement";

interface ToolDef {
  slug: string;
  path: string;
  title: string;
  blurb: string;
  render: () => string;
}

export const TOOLS: ToolDef[] = [
  { ...gstInvoiceMeta, render: gstInvoicePage },
  { ...quotationMakerMeta, render: quotationMakerPage },
  { ...serviceAgreementMeta, render: serviceAgreementPage },
];

/** Public paths for the sitemap (the /tools index + each tool). */
export function toolSitemapPaths(): string[] {
  return ["/tools", ...TOOLS.map((t) => t.path)];
}

function toolsIndexPage(): string {
  const cards = TOOLS.map(
    (t) => `<a class="card" href="${esc(t.path)}" style="display:block">
      <h2 style="font-size:18px;margin-bottom:6px">${esc(t.title)}</h2>
      <p class="muted" style="margin:0">${esc(t.blurb)}</p>
      <div style="margin-top:12px;color:var(--green);font-weight:700">Open tool →</div>
    </a>`,
  ).join("\n");

  const body = `
  <div class="hero"><div class="wrap">
    <h1>Free tools for Indian service businesses</h1>
    <p class="sub">Practical, no-sign-up tools for freelancers, agencies, consultants and service vendors — invoices, quotations and agreements, done in your browser.</p>
  </div></div>
  <section><div class="wrap">
    <div class="steps">${cards}</div>
  </div></section>`;

  return renderToolPage({
    title: "Free Tools for Freelancers & Service Businesses (India) | DealInSec",
    description:
      "Free, no-sign-up tools for Indian freelancers, agencies and service businesses — GST invoice generator, quotation maker and more.",
    canonicalPath: "/tools",
    bodyHtml: body,
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: "DealInSec Free Tools",
        url: "https://www.dealinsec.com/tools",
      },
    ],
  });
}

export function registerToolPages(app: Express) {
  app.get("/tools", (_req, res) => res.type("html").send(toolsIndexPage()));
  for (const t of TOOLS) {
    app.get(t.path, (_req, res) => res.type("html").send(t.render()));
  }
}
