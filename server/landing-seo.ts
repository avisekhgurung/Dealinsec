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
    a: "DealInSec is quotation, agreement and invoice software for freelancers, in 50 currencies. Every client project stays on one thread — quotation, e-signed agreement, invoice and payment tracking — so nothing is retyped and nothing is forgotten, and you can see what is collectible today.",
  },
  {
    q: "Who is it for?",
    a: "Freelancers anywhere — designers, developers, writers, video editors and photographers, marketers and consultants. It is built for solo independent professionals who quote, sign and bill their own clients, in 50 currencies. India is one of the markets it fits most closely: GSTIN and PAN fields, IFSC bank details, ₹ pricing and April–March invoice numbering are all built in.",
  },
  {
    q: "Does DealInSec work outside India?",
    a: "Yes. You pick your country at signup and the app follows it: 50 currencies across 242 countries and territories, 119 of them billed in their own currency. You get the tax field your country actually uses — GSTIN in India, VAT number in the UK and EU, EIN in the US — the right bank labels (IFSC, sort code, routing number), invoice numbering by calendar year outside India and by the April–March financial year inside it, and agreement wording that names your own country's law. The free plan and the 7-day Pro trial are available everywhere. Paid checkout is live for Indian accounts today at ₹99 a month or ₹999 a year; international checkout at $99, £79 or €89 a year, annual only, is opening soon.",
  },
  {
    q: "Will DealInSec make sure my client pays?",
    a: "No software can force an unwilling client to pay. What DealInSec prevents is the non-payment you cause by being disorganised: work starting without a written scope, the invoice going out late or never, follow-ups that feel too awkward to send, and scope creep nobody priced. Your client accepts the scope and fee before you start, the invoice comes off the same record, and Copilot drafts the reminder. If a client later disputes the work, you have a signed, timestamped record of what they agreed to.",
  },
  {
    q: "How do I make a quotation for a client?",
    a: "Create the deal with the client name, amount and deliverables, then generate the quotation from it. The figures carry across, so the quotation, the agreement and the invoice always agree with each other.",
  },
  {
    q: "Can DealInSec create a deal from a WhatsApp chat?",
    a: "Yes. Paste the client conversation into DealInSec Copilot and it extracts the client, scope, amount and payment terms, then drafts the deal for your confirmation — nothing is created until you approve it, and it never invents an amount that wasn't stated. Copilot also runs a Protection Check on every deal's terms (flagging things like unlimited revisions or a missing advance) and drafts payment reminders in English or Hinglish that you copy and send yourself.",
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
    a: "Every new account gets a 7-day Pro trial with no card, in every country. After that the free plan is ₹0 and covers 4 deals a month, each with its quotation. In India, Pro is ₹99 a month or ₹999 a year (about ₹83 a month). Outside India, Pro is listed at $99, £79 or €89 a year — annual only — and international checkout is opening soon, so today payment can only be completed from an Indian account. Pro adds unlimited deals, e-signed agreements, invoices and payment tracking. There is no platform fee on your deal value.",
  },
  {
    q: "Can I bill 50% advance and 50% on delivery?",
    a: "Yes. An agreement can be billed as an advance invoice and a final invoice at any split you choose, or as separate milestone invoices. DealInSec will not let you invoice more than the agreement is worth.",
  },
  {
    q: "How does it help with scope creep?",
    a: "The quotation and the agreement list the deliverables, revision limit and fee your client accepted, so extra work is visibly extra. Before you send the terms, Copilot's Protection Check flags the things that cost freelancers money — unlimited revisions, no advance, a vague \"as per requirement\" scope, no balance timeline — and suggests wording to fix them. When the client asks for more, you quote the extra work instead of absorbing it.",
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
<h1>Quotation, agreement and invoice software for freelancers — one thread per client</h1>
<p>DealInSec keeps every client project on one thread — quotation, e-signed agreement, invoice and payment tracking — so the scope is agreed in writing before you start, the invoice goes out the day the work is done, and you always know who still owes you. It works in 50 currencies, for freelancers in any country: designers, developers, writers, video editors &amp; photographers, marketers and consultants. India is one of the markets it serves most closely, with GSTIN and PAN fields, ₹ pricing, April–March invoice numbering and free GST tools.</p>

<h2>One workflow from quotation to payment</h2>
<ul>
<li><strong>Deals</strong> — client, value, deliverables and dates in one record.</li>
<li><strong>Quotations</strong> — generated from the deal, so the numbers always match.</li>
<li><strong>Agreements</strong> — e-signed, with an execution record naming who signed and when.</li>
<li><strong>Invoices</strong> — itemised and numbered consecutively: INV-2026-0001 by calendar year outside India, INV-2627-0001 by the April–March financial year inside it.</li>
<li><strong>Payment tracking</strong> — what is overdue, due this week, and signed but not yet invoiced.</li>
<li><strong>Copilot AI</strong> — paste a WhatsApp chat to draft the deal, get a Protection Check on risky or missing terms, and payment reminders drafted in English or Hinglish. Numbers are computed from your records, never AI-generated, and every action needs your confirmation.</li>
</ul>

<h2>Works in the country you invoice from</h2>
<p>You pick your country at signup and the paperwork follows it — 50 currencies across 242 countries and territories, 119 of them billed in their own currency. The tax field is the one your country uses: GSTIN in India, VAT number in the UK and the EU, EIN in the US. Bank details are labelled the way your bank labels them — IFSC, sort code or routing number. Invoice numbering runs by calendar year outside India and by the April–March financial year inside it. Agreements name your own country's law. The free plan and the 7-day Pro trial are available everywhere; paid checkout is live in India today, with international checkout opening soon.</p>

<h2>Why freelancers don't get paid</h2>
<p>Unpaid freelance work starts the same way in every currency: a "go ahead" in a chat with no written scope, an invoice raised weeks after delivery, a follow-up that feels too awkward to send, and "one small change" that turns into a second project — because the quotation is in WhatsApp, the agreement is in email and the invoice is in your downloads folder. DealInSec puts the four documents on one thread and tells you what to do next. It cannot force an unwilling client to pay, but it removes the reasons you go unpaid through disorganisation, and leaves a signed, timestamped record if a client disputes what was agreed.</p>

<h2>Free tools, no sign-up</h2>
<p>Create a <a href="/tools/quotation-maker">quotation</a>, a <a href="/tools/bill-generator">bill</a>, a <a href="/tools/purchase-order-generator">purchase order</a>, a <a href="/tools/service-agreement-template">service agreement</a> or a
<a href="/tools/proforma-invoice-generator">proforma invoice</a> — free in your browser, no account needed. There is also an <a href="/tools/invoice-format/for-freelancers">invoice format for freelancers</a>. Country tools: a <a href="/tools/gst-invoice-generator">GST invoice</a> with CGST, SGST and IGST computed and a <a href="/tools/gst-calculator">GST calculator</a> for India, and a <a href="/tools/uk-late-payment-calculator">UK late payment calculator</a> that works out the statutory interest and compensation you can claim when a UK client pays late.</p>

<h2>What DealInSec covers</h2>
<p><a href="/freelancer-invoice-software">Freelancer invoice software</a> · <a href="/quotation-software">quotation software</a> · <a href="/proposal-management">proposal management</a> · <a href="/contract-management">contract management</a> · <a href="/e-signature">e-signature</a> · <a href="/invoice-management">invoice management</a> · <a href="/refrens-alternative">Refrens alternative</a> · <a href="/vyapar-alternative">Vyapar alternative</a> — one thread per deal, from first quote to final payment.</p>

<h2>Guides</h2>
<p>From the <a href="/blog">DealInSec blog</a>: <a href="/blog/what-is-deal-management-software">what deal management software is</a>, the <a href="/blog/quotation-format">quotation format guide with a free sample</a>, <a href="/blog/how-to-make-a-quotation-online">how to make a quotation online</a>, <a href="/blog/quotation-software-vs-excel">quotation software vs Excel</a>, <a href="/blog/quotation-vs-proposal">quotation vs proposal</a>, <a href="/blog/how-to-manage-a-deal-from-quotation-to-invoice">managing a deal from quotation to invoice</a>, and <a href="/blog/fake-quotation">when a sample quotation is fine and when it's fraud</a>. For getting paid: <a href="/blog/client-not-paying">what to do when a client isn't paying</a>, <a href="/blog/payment-reminder-message-to-client">payment reminder messages that work</a>, and <a href="/blog/advance-payment-terms">advance payment terms</a>. Written for India: <a href="/blog/best-quotation-software-india">choosing quotation software in India</a> and <a href="/blog/msme-payment-rule-45-days-samadhaan">the MSME 45-day payment rule</a>.</p>

<h2>Pricing</h2>
<p>7-day Pro trial with no card, in every country. The free plan is ₹0 and covers 4 deals a month, each with its quotation. In India, Pro is ₹99 per month or ₹999 per year (about ₹83 per month). Outside India, Pro is listed at $99, £79 or €89 a year — annual only — and international checkout is opening soon, so today payment can only be completed from an Indian account. Pro includes unlimited deals, e-signed agreements, invoices and payment tracking. No platform fee on your deal value.</p>

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
