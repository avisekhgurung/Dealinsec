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
import { guidesHtml } from "./blog";
import { ONE_LINER, PRICING, WORKFLOW } from "@shared/product-facts";
import { OUTBOUND_ALLOWANCE_DEFAULTS as OB, OUTBOUND_WINDOW_DAYS } from "@shared/outbound-plans";

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
<h1>Find Clients. Close Deals. Get Paid.</h1>
<p>${ONE_LINER} DealInSec helps service businesses research prospects, manage deals, send quotations, create agreements, generate invoices and track payments in one connected workspace. AI researches and drafts; you approve every message, and nothing is sent automatically. Free plan: ${PRICING.freeMonthlyDeals} new deals a month with quotations, the lead pipeline and ${OB.free.monthlySearches} AI research searches every ${OUTBOUND_WINDOW_DAYS} days. Pro: ₹${PRICING.proMonthlyInr} a month in India.</p>

<h2>How it works: from a potential client to a paid invoice</h2>
<ol>
<li><strong>Research a potential client</strong> (Free): describe who you want and where; AI Outbound checks each company's own website against your profile and shows recent, dated signals with their sources. Inferences are labelled as possible opportunities, not facts.</li>
<li><strong>Save the prospect and manage the lead</strong> (Free): stages, next steps, follow-up dates and the facts with their sources. AI drafts a first message from verified facts; you approve it and send it from your own email. DealInSec doesn't send email for you and never contacts anyone on its own.</li>
<li><strong>Create a deal and send a quotation</strong> (Free, ${PRICING.freeMonthlyDeals} deals a month): the deal records the engagement model, scope, fee and dates; the quotation is generated from it, with a link your client can accept online. Protection Check flags missing terms first.</li>
<li><strong>Create an agreement and collect a signature</strong> (Pro): your client signs online through a link, with an audit record of who signed and when. It isn't a certified digital signature.</li>
<li><strong>Generate an invoice and track payment</strong> (Pro): invoices come from the agreement, single or as an advance and a final payment; you mark them paid and see what is paid, pending and overdue. DealInSec does not process payments.</li>
</ol>

<h2>What DealInSec does</h2>
<ul>
<li><strong>AI-assisted prospect research</strong>: a score with reasons, dated signals with sources, and first messages drafted from verified facts. Contact details aren't always available, and DealInSec doesn't guarantee clients, replies or meetings.</li>
<li><strong>Lead and deal management</strong>: a lead pipeline, deals by engagement model (retainer, fixed price, hourly, milestones and more) and a dashboard of what needs you today.</li>
<li><strong>Quotations and client proposals</strong>: versioned quotations your client accepts online, as a link or a PDF.</li>
<li><strong>Agreements and signatures</strong>: standard and custom terms, signed online or uploaded as a signed paper copy.</li>
<li><strong>Invoices and payment tracking</strong>: invoices bounded by the agreement, payment status, and follow-up messages drafted for late invoices.</li>
<li><strong>A connected client workflow</strong>: the prospect becomes the lead, the lead the deal, and every document comes from that deal, so the scope and the numbers match.</li>
</ul>

<h2>Why keep the client journey in one place</h2>
<p>Prospects in browser tabs and spreadsheets, outreach in an inbox, quotations and agreements in documents, invoices in another tool and payments in a bank app means re-typing the client, the scope and the fee at every step. In DealInSec one record carries the client from research to payment. It doesn't replace accounting software.</p>

<h2>Who DealInSec is for</h2>
<p>Freelancers, solo consultants and small B2B service agencies of about 1 to 10 people, in India and abroad:</p>
<ul>
<li><strong>Freelancers and solo consultants</strong>: find clients, quote them properly, get the scope signed and know what you're owed. See <a href="/for-freelancers">DealInSec for freelancers and consultants</a>.</li>
<li><strong>Web development and software services</strong>: research accounts, scope builds as milestones and invoice each stage.</li>
<li><strong>Digital marketing, SEO and growth agencies</strong>: find companies in your niche with evidence, then quote, sign and bill retainers.</li>
<li><strong>AI automation businesses</strong>: spot companies showing repetitive work publicly, such as support or operations hiring, with dated sources.</li>
</ul>
<p>Doing brand deals? <a href="/for-creators">DealInSec for creators</a>. Not sure what a client's message leaves out? The free <a href="/tools/deal-risk-checker">Deal Risk Checker</a> lists what is missing, with no account.</p>

<h2>Know exactly what you're owed</h2>
<p>Track every invoice from sent to paid: total invoiced, paid, pending and overdue at a glance. DealInSec tracks payments but does not process them; your client pays you directly and you mark the invoice paid. When something is late, Copilot drafts the follow-up and you review and send it.</p>

<h2>Look professional from the first quote to the final invoice</h2>
<p>Give every client a clear, consistent experience with a professional quotation, agreement and invoice, all generated from the same deal.</p>

<h2>One workspace, set up for how you bill</h2>
<p><strong>Agencies in the United States</strong>: quote, agree and invoice in US dollars with your business details on every document; invoice numbers restart each calendar year; DealInSec doesn't calculate sales tax. Use the free plan and the 7-day Pro trial today; paid plans can't be bought from the US yet.</p>
<p><strong>Agencies in India</strong>: quote, agree and invoice in rupees with your PAN and GSTIN on documents; invoice numbers follow the financial year from 1 April; in-app invoices aren't GST tax invoices, and the free GST invoice generator is built for those. Pro is ₹${PRICING.proMonthlyInr} a month, paid through Razorpay (UPI, cards or netbanking).</p>
<p>Clients elsewhere? Bill in any of 50 currencies, including EUR, GBP, CAD, AUD and AED.</p>

<h2>Built so you stay in charge</h2>
<ul>
<li><strong>Nothing goes out without you</strong>: every outreach message, quotation share and signing link is your decision.</li>
<li><strong>Do-not-contact, respected</strong>: add an address or a whole domain once and DealInSec won't draft or approve messages to it.</li>
<li><strong>Your clients' money never touches us</strong>: DealInSec tracks what's paid; your client pays you directly.</li>
<li><strong>Signatures with an audit record</strong>: who signed, when, from which IP, and a fingerprint of the exact agreement. It isn't a certified digital signature.</li>
<li><strong>Roles for your team</strong>: Owner, Admin, Sales and Accounts roles, or your own.</li>
<li><strong>AI you can check</strong>: AI drafts from real records and labels what it inferred; nothing is created until you confirm it.</li>
</ul>

<h2>Free tools, no sign-up</h2>
<p>Check a client request or brand offer with the <a href="/tools/deal-risk-checker">Deal Risk Checker</a>, or create a <a href="/tools/quotation-maker">quotation</a>, a <a href="/tools/bill-generator">bill</a>, a <a href="/tools/payment-reminder-email-generator">payment reminder email</a>, a <a href="/tools/purchase-order-generator">purchase order</a>, a <a href="/tools/service-agreement-template">service agreement</a> or a
<a href="/tools/proforma-invoice-generator">proforma invoice</a> — free in your browser, no account needed. There is also an <a href="/tools/invoice-format/for-freelancers">invoice format for freelancers</a>. Country tools: a <a href="/tools/gst-invoice-generator">GST invoice</a> with CGST, SGST and IGST computed and a <a href="/tools/gst-calculator">GST calculator</a> for India, and a <a href="/tools/uk-late-payment-calculator">UK late payment calculator</a> that works out the statutory interest and compensation you can claim when a UK client pays late.</p>

<h2>What DealInSec covers</h2>
<p><a href="/for-freelancers">For freelancers</a> · <a href="/for-creators">For creators</a> · <a href="/freelancer-invoice-software">Freelancer invoice software</a> · <a href="/quotation-software">quotation software</a> · <a href="/proposal-management">proposal management</a> · <a href="/contract-management">contract management</a> · <a href="/e-signature">e-signature</a> · <a href="/invoice-management">invoice management</a> · <a href="/freelance-business-management-software">freelance business management software</a> · <a href="/bonsai-alternatives">Bonsai alternatives</a> · <a href="/bonsai-vs-dealinsec">Bonsai vs DealInSec</a> · <a href="/refrens-alternative">Refrens alternative</a> · <a href="/vyapar-alternative">Vyapar alternative</a> — one thread per deal, from first quote to final payment.</p>

<h2>Guides</h2>
<p>From the <a href="/blog">DealInSec blog</a>:</p>
${guidesHtml()}

<h2>Start simple. Grow when you need to.</h2>
<p>The free plan is permanent: ${OB.free.monthlySearches} AI Outbound searches every ${OUTBOUND_WINDOW_DAYS} days (up to ${OB.free.maxCompanies} companies each), the leads pipeline, and ${PRICING.freeMonthlyDeals} deals a month, each with its quotation. Every new account also starts with a ${PRICING.trialDays}-day Pro trial (${OB.trial.monthlySearches} AI searches) with no card, in every country. Pro is ₹${PRICING.proMonthlyInr} a month in India and includes ${OB.pro.monthlySearches} AI searches every ${OUTBOUND_WINDOW_DAYS} days (up to ${OB.pro.maxCompanies} companies each), unlimited deals, agreements your client signs online, invoices, payment tracking and up to 5 team members. Searches are counted over a rolling ${OUTBOUND_WINDOW_DAYS} days, with at most 5 a day; when you reach the limit, more become available as earlier searches pass ${OUTBOUND_WINDOW_DAYS} days, and nothing is unlimited. Pro is paid once a month with no auto-renewal: pay again to extend, or it returns to the free plan. In the United States and other countries the free plan and the trial are open; paid plans can't be bought from outside India yet. No platform fee on your deal value.</p>

<h2>Frequently asked questions</h2>
${faqs}

<p><a href="/auth?mode=signup">Start for free</a> · <a href="/#pricing">Pricing</a> · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a></p>
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
