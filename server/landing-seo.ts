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

import { LANDING_FAQS } from "@shared/landing-faqs";

const FAQS = LANDING_FAQS;

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
<h1>Freelance work, from deal to paid</h1>
<p>DealInSec helps freelancers, independent consultants, creators and solo service professionals manage the whole client deal in one place: create the deal, send a professional quote, get the agreement signed, send the invoice and track every payment. It is freelance deal management built around what happens between getting a client and getting paid, for freelancers worldwide, in 50 currencies.</p>

<h2>Your freelance business shouldn't live across 7 different apps</h2>
<p>Client messages in WhatsApp, scope in Google Docs, quotes in PDFs, invoices in another tool and payment tracking in a spreadsheet. DealInSec replaces the scatter with one connected workflow: quote, agreement, invoice, payment. One client, one deal, one source of truth.</p>

<h2>From client conversation to paid</h2>
<ol>
<li><strong>Create a deal</strong> with the client, scope, timeline and fee.</li>
<li><strong>Send a quote</strong> generated from the deal, with standard or custom terms.</li>
<li><strong>Get the agreement signed</strong>: you sign with your saved signature, send the PDF and upload the client's signed copy as proof.</li>
<li><strong>Send the invoice</strong> as an advance, milestone or final invoice drawn from the agreement.</li>
<li><strong>Track payment</strong> and see what is paid, pending or overdue.</li>
</ol>

<h2>Get the scope clear before the work begins</h2>
<p>Define deliverables, timelines, revisions and payment terms before you start, so everyone is on the same page. Protection Check reads your terms and flags risky wording such as unlimited revisions or a missing advance. It is a written record of what was agreed, not legal advice, and it cannot force a client to pay.</p>

<h2>Know exactly what you're owed</h2>
<p>Track every invoice from sent to paid, so nothing gets lost in your inbox: total invoiced, paid, pending and overdue at a glance. DealInSec tracks payments but does not process them; your client pays you directly and you mark the invoice paid. When something is late, Copilot drafts the follow-up and you review and send it.</p>

<h2>Look professional from the first quote to the final invoice</h2>
<p>Give every client a clear, consistent experience with a professional quotation, agreement and invoice, all generated from the same deal.</p>

<h2>Built for freelancers, wherever you work</h2>
<p>Work with clients across borders while keeping your deals, documents and invoices organized in one place. Choose from 50 currencies, including USD, EUR, GBP, CAD, AUD, INR and AED. The tax field, bank labels, invoice numbering and agreement wording follow the country you work from.</p>

<h2>Spend less time turning conversations into paperwork</h2>
<p>Paste a client's message into Copilot and it drafts the deal: client, budget, timeline, deliverables and terms. It is AI-assisted, so you review and edit the draft, and nothing is created until you confirm.</p>

<h2>Everything you need to manage the client deal</h2>
<ul>
<li><strong>Win the deal</strong>: deals, quotes and your own terms.</li>
<li><strong>Protect the work</strong>: agreements, scope and deliverables, signatures and signed-copy proof.</li>
<li><strong>Get paid</strong>: invoices, payment tracking and payment reminders.</li>
<li><strong>Stay organized</strong>: a dashboard, and every document as a PDF.</li>
</ul>

<h2>Free tools, no sign-up</h2>
<p>Create a <a href="/tools/quotation-maker">quotation</a>, a <a href="/tools/bill-generator">bill</a>, a <a href="/tools/purchase-order-generator">purchase order</a>, a <a href="/tools/service-agreement-template">service agreement</a> or a
<a href="/tools/proforma-invoice-generator">proforma invoice</a> — free in your browser, no account needed. There is also an <a href="/tools/invoice-format/for-freelancers">invoice format for freelancers</a>. Country tools: a <a href="/tools/gst-invoice-generator">GST invoice</a> with CGST, SGST and IGST computed and a <a href="/tools/gst-calculator">GST calculator</a> for India, and a <a href="/tools/uk-late-payment-calculator">UK late payment calculator</a> that works out the statutory interest and compensation you can claim when a UK client pays late.</p>

<h2>What DealInSec covers</h2>
<p><a href="/freelancer-invoice-software">Freelancer invoice software</a> · <a href="/quotation-software">quotation software</a> · <a href="/proposal-management">proposal management</a> · <a href="/contract-management">contract management</a> · <a href="/e-signature">e-signature</a> · <a href="/invoice-management">invoice management</a> · <a href="/refrens-alternative">Refrens alternative</a> · <a href="/vyapar-alternative">Vyapar alternative</a> — one thread per deal, from first quote to final payment.</p>

<h2>Guides</h2>
<p>From the <a href="/blog">DealInSec blog</a>: <a href="/blog/what-is-deal-management-software">what deal management software is</a>, the <a href="/blog/quotation-format">quotation format guide with a free sample</a>, <a href="/blog/how-to-make-a-quotation-online">how to make a quotation online</a>, <a href="/blog/quotation-software-vs-excel">quotation software vs Excel</a>, <a href="/blog/quotation-vs-proposal">quotation vs proposal</a>, <a href="/blog/how-to-manage-a-deal-from-quotation-to-invoice">managing a deal from quotation to invoice</a>, and <a href="/blog/fake-quotation">when a sample quotation is fine and when it's fraud</a>. For getting paid: <a href="/blog/client-not-paying">what to do when a client isn't paying</a>, <a href="/blog/payment-reminder-message-to-client">payment reminder messages that work</a>, and <a href="/blog/advance-payment-terms">advance payment terms</a>. Written for India: <a href="/blog/best-quotation-software-india">choosing quotation software in India</a> and <a href="/blog/msme-payment-rule-45-days-samadhaan">the MSME 45-day payment rule</a>.</p>

<h2>Start simple. Grow when you need to.</h2>
<p>The free plan is permanent and covers 4 deals a month, each with its quotation. Every new account also starts with a 7-day Pro trial with no card, in every country. Pro adds unlimited deals, agreements with signature, invoices and payment tracking. In India, Pro is ₹99 per month or ₹999 per year. Outside India, Pro is listed at $99, £79 or €89 a year, annual only, and international checkout is opening soon. No platform fee on your deal value.</p>

<h2>Frequently asked questions</h2>
${faqs}

<p><a href="/auth?mode=signup">Start for free</a> · <a href="/pricing">Pricing</a> · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a></p>
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
