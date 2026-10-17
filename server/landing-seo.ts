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
import { ONE_LINER, PRICING } from "@shared/product-facts";

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
<p>${ONE_LINER} It helps small SEO, marketing, growth, AI-automation, web and software agencies and B2B consultants research prospects that fit, run a clear pipeline, and turn won work into quotations, signed agreements and invoices, in one connected workspace. Free plan, ${PRICING.trialDays}-day Pro trial, no card needed.</p>
<p>The workflow: Find prospects, Qualify, Deal, Quotation, Agreement, Invoice, Payment tracking.</p>

<h2>Made for founder-led agencies</h2>
<p>About 1 to 10 people, selling and delivering client work in the United States, India and beyond.</p>
<ul>
<li><strong>SEO agencies</strong>: build a list of companies in your niche, with the evidence for each, then quote and bill monthly retainers.</li>
<li><strong>Digital marketing and growth agencies</strong>: keep every lead, proposal and campaign in one pipeline, with a clear next step and follow-ups that don't slip.</li>
<li><strong>B2B marketing agencies</strong>: research accounts before you reach out, then turn won work into an agreement your client signs online.</li>
<li><strong>AI automation agencies</strong>: scope builds as milestones, get the terms signed, and invoice each milestone as it's delivered.</li>
<li><strong>Web design, development and software studios</strong>: quote a fixed-price project or a retainer, get it signed online, and invoice the advance and the final payment.</li>
<li><strong>B2B consultants and specialist services</strong>: independent consultants, content and lead-generation agencies run the same workflow.</li>
</ul>
<p>Working solo? <a href="/for-freelancers">DealInSec for freelancers and consultants</a>. Doing brand deals? <a href="/for-creators">DealInSec for creators</a>. Not sure what a client's message leaves out? The free <a href="/tools/deal-risk-checker">Deal Risk Checker</a> lists what is missing, with no account.</p>

<h2>Winning and billing clients shouldn't take 7 different apps</h2>
<p>Prospects in a spreadsheet, conversations in email and WhatsApp, proposals in docs, invoices in another tool, and who has paid lives in someone's head. In DealInSec a prospect becomes a lead, a won lead becomes a deal, and every document is generated from that deal, so the scope and the numbers always match.</p>

<h2>From finding the client to getting paid</h2>
<ol>
<li><strong>Find prospects</strong>: describe your ideal client; DealInSec researches companies and shows the evidence for each fit.</li>
<li><strong>Reach out</strong>: AI drafts a first message; you approve it, send it from your own email and mark it sent.</li>
<li><strong>Create the deal</strong>: a won lead becomes a deal with the client, scope, timeline and fee.</li>
<li><strong>Send a quote</strong> generated from the deal, with your terms.</li>
<li><strong>Get it signed</strong>: send a signing link and your client signs online without an account.</li>
<li><strong>Invoice and track</strong>: advance, milestone or final invoices, then see what is paid, pending or overdue.</li>
</ol>

<h2>AI Outbound: find clients who fit, with the evidence</h2>
<p>Describe the clients you want, like US dental groups opening new locations. DealInSec researches companies, checks each one against your ideal client and marks it qualified, partial, not a fit or not enough evidence, with the reasons. Evidence shows its source and how recent it is; guesses are labelled as guesses and gaps are shown, not filled in. Add the best prospects to your pipeline. AI drafts a first message; you approve every word, send it from your own email and mark it sent. Your do-not-contact list is checked before anything is drafted or approved. DealInSec doesn't send email for you and never contacts anyone on its own. Research has daily limits per workspace.</p>

<h2>Know exactly what you're owed</h2>
<p>Track every invoice from sent to paid: total invoiced, paid, pending and overdue at a glance. DealInSec tracks payments but does not process them; your client pays you directly and you mark the invoice paid. When something is late, Copilot drafts the follow-up and you review and send it.</p>

<h2>Look professional from the first quote to the final invoice</h2>
<p>Give every client a clear, consistent experience with a professional quotation, agreement and invoice, all generated from the same deal.</p>

<h2>One workspace, set up for how you bill</h2>
<p><strong>Agencies in the United States</strong>: quote, agree and invoice in US dollars with your business details on every document; invoice numbers restart each calendar year; DealInSec doesn't calculate sales tax. Use the free plan and the 7-day Pro trial today; paid plans can't be bought from the US yet.</p>
<p><strong>Agencies in India</strong>: quote, agree and invoice in rupees with your PAN and GSTIN on documents; invoice numbers follow the financial year from 1 April; in-app invoices aren't GST tax invoices, and the free GST invoice generator is built for those. Pro is ₹${PRICING.proMonthlyInr} a month or ₹${PRICING.proYearlyInr} a year, paid through Razorpay (UPI, cards or netbanking).</p>
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
<p>The free plan is permanent and covers ${PRICING.freeMonthlyDeals} deals a month, each with its quotation, plus the leads pipeline and AI Outbound research within its daily limits. Every new account also starts with a ${PRICING.trialDays}-day Pro trial with no card, in every country. Pro adds unlimited deals, agreements your client signs online, invoices, payment tracking and up to 5 team members. In India, Pro is ₹${PRICING.proMonthlyInr} per month or ₹${PRICING.proYearlyInr} per year. In the United States and other countries the free plan and the trial are fully open; paid plans can't be bought from outside India yet. No platform fee on your deal value.</p>

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
