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
import { billGeneratorPage, billGeneratorMeta } from "./bill-generator";
import { quotationMakerPage, quotationMakerMeta } from "./quotation-maker";
import { quotationTemplatesPage, quotationTemplatesMeta } from "./quotation-templates";
import { serviceAgreementPage, serviceAgreementMeta } from "./service-agreement";
import { gstCalculatorPage, gstCalculatorMeta } from "./gst-calculator";
import { proformaInvoicePage, proformaInvoiceMeta } from "./proforma-invoice";
import { purchaseOrderPage, purchaseOrderMeta } from "./purchase-order";
import { ukLatePaymentPage, ukLatePaymentMeta } from "./uk-late-payment";
import { paymentReminderPage, paymentReminderMeta } from "./payment-reminder-email";
import { registerProgrammaticPages, programmaticSitemapPaths } from "./programmatic";

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
  /** Set for a tool built on one country's rules; absent means any country. */
  country?: "IN" | "GB";
}

// Order is display order on /tools: the tools that work anywhere first.
export const TOOLS: ToolDef[] = [
  { ...quotationMakerMeta, render: quotationMakerPage },
  { ...billGeneratorMeta, render: billGeneratorPage },
  { ...paymentReminderMeta, render: paymentReminderPage },
  { ...serviceAgreementMeta, render: serviceAgreementPage },
  { ...proformaInvoiceMeta, render: proformaInvoicePage },
  { ...purchaseOrderMeta, render: purchaseOrderPage },
  { ...quotationTemplatesMeta, render: quotationTemplatesPage },
  { ...ukLatePaymentMeta, render: ukLatePaymentPage, country: "GB" },
  { ...gstInvoiceMeta, render: gstInvoicePage, country: "IN" },
  { ...gstCalculatorMeta, render: gstCalculatorPage, country: "IN" },
];

const COUNTRY_TAGS: Record<NonNullable<ToolDef["country"]>, string> = {
  IN: "🇮🇳 India",
  GB: "🇬🇧 United Kingdom",
};

/** Public paths for the sitemap (the /tools index + each tool). */
export function toolSitemapPaths(): string[] {
  return ["/tools", ...TOOLS.map((t) => t.path), ...programmaticSitemapPaths()];
}

// Distinct line icons per tool (lucide-style), rendered inside the card badge.
const ICONS: Record<string, string> = {
  "payment-reminder-email-generator": `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>`,
  "uk-late-payment-calculator": `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5"/><path d="M5 3 2.5 5.5M19 3l2.5 2.5"/></svg>`,
  "gst-invoice-generator": `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 17.5v-11"/></svg>`,
  "bill-generator": `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M8 7h8"/><path d="M8 11h8"/><path d="M8 15h5"/></svg>`,
  "quotation-maker": `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>`,
  "quotation-templates": `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m8 11 4 4 4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>`,
  "service-agreement-template": `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 19.5v.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h7.5L20 8.5"/><path d="M8 18h1"/><path d="M18.4 9.6a2.1 2.1 0 0 1 3 3L17 17l-4 1 1-4 4.4-4.4Z"/></svg>`,
  "gst-calculator": `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8"/><path d="M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01"/></svg>`,
  "proforma-invoice-generator": `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M8 13h5"/><path d="M8 17h8"/><path d="M9.5 9.5 8 11l1.5 1.5"/></svg>`,
  "purchase-order-generator": `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>`,
};

const INDEX_FAQ: { q: string; a: string }[] = [
  { q: "Are these tools really free?", a: "Yes — every tool is free to use with no sign-up. You can create and download unlimited invoices, quotations and agreements as PDFs." },
  { q: "Do the tools work outside India?", a: "Yes. The quotation maker, invoice and bill generator, payment reminder email generator, service agreement, proforma invoice and purchase order work in any country: pick your country and currency, and the document follows it — the currency, the date format, the name of your tax (GST, VAT or sales tax) and the tax number your clients expect. A few tools are built on one country's rules and say so: the GST invoice generator and GST calculator for India, and the late-payment calculator for the UK." },
  { q: "Is my data safe?", a: "Everything runs in your browser. What you type is saved only on your own device and is never sent to or stored on our servers." },
  { q: "What do I get if I create an account?", a: "Every client project lives on one thread — quotation, agreement, invoice and payment tracking — instead of scattered across WhatsApp, email and your downloads folder. The free plan covers 4 deals a month, each with its quotation, and every new account starts with a 7-day Pro trial (no card) that unlocks e-signed agreements, invoices and payment tracking. In India, Pro is ₹99 a month or ₹999 a year. Outside India the free plan and the trial are open today; paid plans can't be bought from other countries yet." },
];

function toolCard(t: ToolDef): string {
  const tag = t.country
    ? `<span class="chip" style="align-self:flex-start;margin-bottom:8px;font-size:12px">${COUNTRY_TAGS[t.country]}</span>`
    : "";
  return `<a class="tool-card" href="${esc(t.path)}">
      <div class="tool-ico">${ICONS[t.slug] || ""}</div>
      ${tag}
      <h2>${esc(t.title)}</h2>
      <p>${esc(t.blurb)}</p>
      <span class="go">Open tool →</span>
    </a>`;
}

function toolsIndexPage(): string {
  const anywhere = TOOLS.filter((t) => !t.country).map(toolCard).join("\n");
  const local = TOOLS.filter((t) => t.country).map(toolCard).join("\n");

  const faqHtml = INDEX_FAQ.map((f) => `<h3>${f.q}</h3><p>${f.a}</p>`).join("\n");

  const body = `
  <div class="hero"><div class="wrap">
    <span class="badge">🎁 100% Free · No sign-up · Instant download</span>
    <h1>Free tools for<br /><span class="accent">freelancers</span></h1>
    <p class="sub">Quotations, invoices and agreements for designers, developers, writers, video editors, photographers, marketers and consultants — in your own currency, done in your browser, no sign-up.</p>
  </div></div>

  <section><div class="wrap">
    <h2>Works in any country</h2>
    <p class="muted" style="margin-top:-6px">Pick your country and currency; the document follows its money, dates and tax.</p>
    <div class="tool-grid">${anywhere}</div>
  </div></section>

  <section><div class="wrap">
    <h2>Built on one country's rules</h2>
    <p class="muted" style="margin-top:-6px">Tools that apply a specific country's tax or payment law.</p>
    <div class="tool-grid">${local}</div>
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
    title: "Free Invoice, Quotation & Agreement Tools for Freelancers | DealInSec",
    description:
      "Free, no-sign-up tools for freelancers in any country — quotation maker, invoice generator, payment reminder email generator, service agreement, proforma invoice and purchase order in your own currency, plus GST tools for India and a UK late-payment calculator.",
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
  // Programmatic "{Profession} Invoice Format" long-tail SEO pages.
  registerProgrammaticPages(app);
}
