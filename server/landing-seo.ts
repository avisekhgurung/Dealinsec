/**
 * Crawlable landing content.
 *
 * The landing page is a client-rendered SPA, so the HTML Google receives for
 * "/" is a ~7KB shell with no <h1> and no copy. Search engines can execute JS,
 * but indexing is slower and less reliable than reading real markup — and every
 * word of our positioning was invisible in the initial response.
 *
 * This injects the same headings, answers and links the page shows, INSIDE
 * <div id="root">. React's createRoot replaces the container's children when it
 * mounts, so a browser sees the real app and a crawler sees real content. It is
 * a fallback, not cloaking: keep the text here honest and in step with
 * landing.tsx.
 *
 * FAQPage structured data lives here too — the questions below are the ones a
 * prospect actually types, so they are the ones worth being eligible for rich
 * results.
 */

interface Faq { q: string; a: string }

/** Kept short and specific — these mirror the on-page FAQ answers. */
const FAQS: Faq[] = [
  {
    q: "What is DealInSec?",
    a: "DealInSec is deal management software for Indian service businesses. It keeps a quotation, an agreement and an invoice on one thread for every client deal, so nothing is retyped and nothing is forgotten, and shows you what is collectible today.",
  },
  {
    q: "Who is it for?",
    a: "Deal-led service businesses in India — real estate consultants and brokers, interior designers, architects, marketing and digital agencies, and construction contractors. If you quote, sign and bill clients, the workflow fits.",
  },
  {
    q: "How do I make a quotation for a client?",
    a: "Create the deal with the client name, amount and deliverables, then generate the quotation from it. The figures carry across, so the quotation, the agreement and the invoice always agree with each other.",
  },
  {
    q: "Does DealInSec create GST invoices?",
    a: "Our free browser tool at dealinsec.com/tools/gst-invoice-generator creates a GST invoice with CGST, SGST and IGST computed, with no sign-up. Invoices inside the app record the agreed contract value and print your PAN and GSTIN, but they do not carry a GST tax computation and are not tax invoices under Rule 46 of the CGST Rules.",
  },
  {
    q: "Are the agreements legally valid?",
    a: "Electronic contracts are recognised in India under Section 10A of the Information Technology Act, 2000. DealInSec records electronic acceptance with an audit record — who accepted the agreement, when, and with which signature. It is not a Digital Signature Certificate or an Aadhaar eSign, and every agreement says so on its face. We are not a law firm; have important agreements reviewed by a lawyer.",
  },
  {
    q: "What does DealInSec cost?",
    a: "Every new account gets a 7-day Pro trial with no card. After that the free plan covers 4 deals a month, each with a quotation. Pro is ₹999 a month or ₹9,999 a year and adds unlimited deals, agreements, invoices, payment tracking and 5 team seats. There is no platform fee on your deal value.",
  },
  {
    q: "Can I bill 50% advance and 50% on delivery?",
    a: "Yes. An agreement can be billed as an advance invoice and a final invoice at any split you choose, or as separate milestone invoices. DealInSec will not let you invoice more than the agreement is worth.",
  },
  {
    q: "Can my team use it with limited access?",
    a: "Yes. Invite teammates and give each a role — an accounts person can be limited to invoices and payments and will not see your deal pipeline. Roles are editable, and reads as well as actions are restricted.",
  },
];

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function faqSchema(): string {
  const data = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
  return `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
}

/** The markup a crawler reads before React takes over. */
export function landingSeoBody(): string {
  const faqs = FAQS.map(
    (f) => `<h3>${escape(f.q)}</h3><p>${escape(f.a)}</p>`,
  ).join("");

  return `<div id="seo-fallback">
<h1>Deal management software for Indian service businesses — quotation, agreement and invoice on one thread</h1>
<p>DealInSec keeps every client deal on one thread — quotation, e-signed agreement, invoice and payment tracking — so you look professional, never chase a client, and get paid on time. Built for India's real estate consultants, interior designers, architects, agencies and contractors.</p>

<h2>One workflow from quotation to payment</h2>
<ul>
<li><strong>Deals</strong> — client, value, deliverables and dates in one record.</li>
<li><strong>Quotations</strong> — generated from the deal, so the numbers always match.</li>
<li><strong>Agreements</strong> — e-signed, with an execution record naming who signed and when.</li>
<li><strong>Invoices</strong> — itemised, numbered consecutively per financial year (INV-2627-0001).</li>
<li><strong>Payment tracking</strong> — what is overdue, due this week, and signed but not yet invoiced.</li>
</ul>

<h2>Why service businesses lose money</h2>
<p>Work starts without a written scope, invoices go out late, and payments are never followed up — because the quotation is in WhatsApp, the agreement is in email and the invoice is in someone's downloads folder. DealInSec puts the four documents on one thread and tells you what to do next.</p>

<h2>Free tools, no sign-up</h2>
<p>Create a <a href="/tools/gst-invoice-generator">GST invoice</a> with CGST, SGST and IGST computed, a <a href="/tools/quotation-maker">quotation</a>, a <a href="/tools/purchase-order-generator">purchase order</a>, a <a href="/tools/service-agreement-template">service agreement</a>, a
<a href="/tools/proforma-invoice-generator">proforma invoice</a> and a
<a href="/tools/gst-calculator">GST calculator</a> — free in your browser, no account needed.</p>

<h2>What DealInSec covers</h2>
<p><a href="/quotation-software">Quotation software</a> · <a href="/proposal-management">proposal management</a> · <a href="/contract-management">contract management</a> · <a href="/e-signature">e-signature</a> · <a href="/invoice-management">invoice management</a> — one thread per deal, from first quote to final payment.</p>

<h2>Guides</h2>
<p>From the <a href="/blog">DealInSec blog</a>: the <a href="/blog/quotation-format">quotation format guide with a free sample</a>, <a href="/blog/how-to-make-a-quotation-online">how to make a quotation online step by step</a>, and <a href="/blog/fake-quotation">when a sample quotation is fine and when it's fraud</a>.</p>

<h2>Pricing</h2>
<p>7-day Pro trial with no card. Free plan covers 4 deals a month. Pro is ₹999 per month or ₹9,999 per year with unlimited deals, agreements, invoices, payment tracking and 5 team seats. No platform fee on your deal value.</p>

<h2>Frequently asked questions</h2>
${faqs}

<p><a href="/auth?mode=signup">Start your free trial</a> · <a href="/pricing">Pricing</a> · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a></p>
</div>`;
}

/**
 * Inject the fallback into the shell's #root. React replaces these children on
 * mount, so this never reaches a real browser's painted output.
 */
export function injectLandingSeo(html: string): string {
  // Structured data goes in <head>, NOT inside #root — React empties the
  // container on mount, and Google reads structured data from the RENDERED
  // DOM. Schema placed in the fallback would vanish before it was ever seen.
  let out = html.includes("</head>")
    ? html.replace("</head>", `${faqSchema()}\n  </head>`)
    : html;

  const marker = '<div id="root"></div>';
  if (out.includes(marker)) {
    out = out.replace(marker, `<div id="root">${landingSeoBody()}</div>`);
  }
  return out;
}
