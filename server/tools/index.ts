/**
 * Public free-tool / SEO pages.
 *
 * These are server-rendered HTML (indexable) and MUST be registered before the
 * SPA catch-all in server/index.ts. Add new tools to the TOOLS registry; each
 * gets a route, a card on /tools, and an entry in the sitemap automatically.
 */
import type { Express } from "express";
import fs from "fs";
import path from "path";
import { renderToolPage, esc } from "./layout";
import { gstInvoicePage, gstInvoiceMeta } from "./gst-invoice";
import { quotationMakerPage, quotationMakerMeta } from "./quotation-maker";
import { serviceAgreementPage, serviceAgreementMeta } from "./service-agreement";

// html-to-image UMD bundle (for PNG export), read once and served self-hosted
// so the tool pages have no external CDN dependency.
let HTML_TO_IMAGE_JS = "";
try {
  HTML_TO_IMAGE_JS = fs.readFileSync(
    path.join(process.cwd(), "node_modules/html-to-image/dist/html-to-image.js"),
    "utf8",
  );
} catch {
  /* library missing — PNG/Share export will no-op gracefully */
}

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

// Distinct line icons per tool (lucide-style), rendered inside the card badge.
const ICONS: Record<string, string> = {
  "gst-invoice-generator": `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 17.5v-11"/></svg>`,
  "quotation-maker": `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>`,
  "service-agreement-template": `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 19.5v.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h7.5L20 8.5"/><path d="M8 18h1"/><path d="M18.4 9.6a2.1 2.1 0 0 1 3 3L17 17l-4 1 1-4 4.4-4.4Z"/></svg>`,
};

const INDEX_FAQ: { q: string; a: string }[] = [
  { q: "Are these tools really free?", a: "Yes — every tool is free to use with no sign-up. You can create and download unlimited invoices, quotations and agreements as PDFs." },
  { q: "Is my data safe?", a: "Everything runs in your browser. What you type is saved only on your own device and is never sent to or stored on our servers." },
  { q: "What do I get if I create an account?", a: "A free DealInSec account lets you save clients, send documents, track payments, and e-sign agreements with counter-signed proof — the full deal workflow in one place." },
];

function toolsIndexPage(): string {
  const cards = TOOLS.map(
    (t) => `<a class="tool-card" href="${esc(t.path)}">
      <div class="tool-ico">${ICONS[t.slug] || ""}</div>
      <h2>${esc(t.title)}</h2>
      <p>${esc(t.blurb)}</p>
      <span class="go">Open tool →</span>
    </a>`,
  ).join("\n");

  const faqHtml = INDEX_FAQ.map((f) => `<h3>${f.q}</h3><p>${f.a}</p>`).join("\n");

  const body = `
  <div class="hero"><div class="wrap">
    <span class="badge">🎁 100% Free · No sign-up · Instant download</span>
    <h1>Free tools for Indian<br /><span class="accent">service businesses</span></h1>
    <p class="sub">Practical, no-sign-up tools for freelancers, agencies, consultants and service vendors — invoices, quotations and agreements, done in your browser.</p>
  </div></div>

  <section><div class="wrap">
    <div class="tool-grid">${cards}</div>
  </div></section>

  <section id="how"><div class="wrap">
    <h2>How it works</h2>
    <div class="steps">
      <div class="step"><div class="n">1</div><b>Pick a tool</b><p class="muted">Choose an invoice, quotation or agreement — no account needed.</p></div>
      <div class="step"><div class="n">2</div><b>Fill it in</b><p class="muted">Enter your details and watch a clean preview build live in your browser.</p></div>
      <div class="step"><div class="n">3</div><b>Download</b><p class="muted">Save a professional PDF instantly, then send it to your client.</p></div>
    </div>
  </div></section>

  <section id="faq"><div class="wrap faq">
    <h2>Frequently asked questions</h2>
    ${faqHtml}
  </div></section>`;

  return renderToolPage({
    title: "Free Tools for Freelancers & Service Businesses (India) | DealInSec",
    description:
      "Free, no-sign-up tools for Indian freelancers, agencies and service businesses — GST invoice generator, quotation maker and service agreement template.",
    canonicalPath: "/tools",
    bodyHtml: body,
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: "DealInSec Free Tools",
        url: "https://www.dealinsec.com/tools",
      },
      {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: INDEX_FAQ.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
    ],
  });
}

export function registerToolPages(app: Express) {
  app.get("/tools/lib/html-to-image.js", (_req, res) => {
    res.type("application/javascript").setHeader("Cache-Control", "public, max-age=86400").send(HTML_TO_IMAGE_JS);
  });
  app.get("/tools", (_req, res) => res.type("html").send(toolsIndexPage()));
  for (const t of TOOLS) {
    app.get(t.path, (_req, res) => res.type("html").send(t.render()));
  }
}
