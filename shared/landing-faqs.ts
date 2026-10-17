/**
 * The landing-page FAQ — ONE source for the visible accordion
 * (client/src/pages/landing.tsx) and the crawler fallback + FAQPage JSON-LD
 * (server/landing-seo.ts). Structured data must match what a visitor sees, so
 * never fork this list. Every answer must be true of the shipped product, and
 * prices come from shared/product-facts.ts.
 */
import { PRICING } from "./product-facts";
import { OUTBOUND_ALLOWANCE_DEFAULTS as OB } from "./outbound-plans";

export interface LandingFaq {
  q: string;
  a: string;
}

export const LANDING_FAQS: LandingFaq[] = [
  {
    q: "What is DealInSec?",
    a: "DealInSec is an AI-assisted client acquisition and deal-to-payment workspace for small B2B agencies and consultants. It helps you find prospects that fit your ideal client, work them through a pipeline, and turn won work into a quotation, an agreement your client signs and invoices, then track whether you have been paid. Each document is generated from the same deal, so the scope and the numbers always match.",
  },
  {
    q: "Who is DealInSec for?",
    a: "Founder-led agencies and consultants with one to a handful of people, such as SEO, digital marketing, growth, B2B marketing and AI-automation agencies, in the United States, India and elsewhere. Freelancers use it the same way, and creators use it for paid brand collaborations. Pro includes up to 5 team members; it is not built for large sales teams.",
  },
  {
    q: "Does DealInSec find clients for me?",
    a: "AI Outbound helps you research them. Describe the clients you want and confirm the profile it builds; it then researches matching companies, checks each one against your profile and shows the evidence, with its source and how recent it is. Guesses are labelled as guesses, and anything it couldn't find is shown as unknown. You decide who goes into your pipeline. You choose where to look: an agency in India can search the US, the UK, Canada, Australia, the UAE, India or worldwide. Each plan includes a number of searches a month (see “Is there a free plan?”), and contact details are not always available.",
  },
  {
    q: "Does DealInSec work with Gmail?",
    a: "Connecting Gmail is in limited early access for selected workspaces while Google's verification is completed, so it isn't available to everyone yet. Where it is switched on, replies to your outreach appear in an inbox, sorted by fixed rules such as interested, not interested, opt-out or bounce. They are never read by AI: DealInSec never sends Gmail content to an AI model. A reply, opt-out or bounce stops the follow-ups waiting for that conversation.",
  },
  {
    q: "Does DealInSec send emails for me?",
    a: "No. AI drafts a first message from what is known about the prospect, you review and approve the exact text, send it from your own email, and mark it sent in DealInSec, which then adds a follow-up task. Addresses and domains on your do-not-contact list are blocked before anything is drafted or approved. Nothing is sent automatically, including follow-ups and payment reminders.",
  },
  {
    q: "Can freelancers or creators use DealInSec?",
    a: "Yes. DealInSec is built first for small agencies and consultants, but a freelancer runs deals the same way. Creators who do paid brand collaborations can choose “I work with brands” at sign-up for brand wording and a Brand Collaboration deal type with fields for usage rights, exclusivity and approval. It is the same workflow and pricing; it is not a marketplace and it does not find brand deals.",
  },
  {
    q: "Can I use DealInSec with international clients?",
    a: "Yes. You choose your country and billing currency when you sign up, from a list of 50 currencies, and your quotes, agreements and invoices use it. Your client can receive the documents from anywhere and sign the agreement online through a signing link, or on paper, in which case you upload the signed copy. The tax field, bank labels, invoice numbering and agreement wording follow the country you work from.",
  },
  {
    q: "Can I create quotes and agreements?",
    a: "Yes. Create a deal with the client, deliverables, timeline and fee, then generate a quotation from it with standard or custom terms. Once the client agrees, create the agreement from the same deal. Before you send the terms, Protection Check flags risky wording such as unlimited revisions or a missing advance, and suggests lines to add. Nothing is added unless you approve it.",
  },
  {
    q: "Can clients sign agreements online?",
    a: "Yes. Send your client a signing link: they open it without an account, review the agreement and sign online by drawing or typing a signature. The agreement then records who signed, when and with which signature. You can still download the PDF and upload a signed copy as proof if your client prefers to sign on paper. It is electronic acceptance with an audit record, not a Digital Signature Certificate or a certified e-signature, and DealInSec is not a law firm, so have a lawyer review anything high-value or unusual.",
  },
  {
    q: "Can I create invoices?",
    a: "Yes. Invoices are generated from the agreement as an advance and a final invoice at any split you choose, or as separate milestone invoices, and DealInSec will not let you invoice more than the agreement is worth. Your bank details and tax ID are filled in for you. In-app invoices are professional invoices for your client and your own records; they are not Indian GST tax invoices, for which the free GST Invoice Generator in Free Tools is built.",
  },
  {
    q: "Does DealInSec process payments or only track them?",
    a: "It only tracks them. Your client pays you directly, by bank transfer or however you already get paid, and you mark the invoice paid so DealInSec always shows what is paid, pending and overdue. DealInSec never handles your client's money. It also cannot make an unwilling client pay; what it does is make sure the scope is agreed, the invoice goes out on time and the follow-up gets written.",
  },
  {
    q: "What currencies are supported?",
    a: "50 currencies, including USD, EUR, GBP, CAD, AUD, INR and AED. Pick yours at signup and your documents, deal values and payment tracking use it. DealInSec records payments in the currency you billed; it does not convert or move money between countries.",
  },
  {
    q: "Is there a free plan?",
    a: `Yes. The free plan is permanent and covers ${OB.free.monthlySearches} AI Outbound searches a month (up to ${OB.free.maxCompanies} companies each), the leads pipeline, and ${PRICING.freeMonthlyDeals} deals a month, each with a professional quotation. Every new account also starts with a ${PRICING.trialDays}-day Pro trial with everything unlocked and no card needed. DealInSec Pro is one plan with everything: ${OB.pro.monthlySearches} AI Outbound searches a month, unlimited deals, agreements, invoices and payment tracking — no separate fee for AI Outbound or the CRM. In India, Pro is ₹${PRICING.proMonthlyInr} a month, paid monthly with no auto-renewal, paid in rupees through Razorpay (UPI, cards or netbanking). In the United States and other countries outside India, paid plans can't be bought yet; the free plan and the trial are open everywhere. There are no platform fees on your deal value.`,
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes. Pro is paid for a fixed period, a month or a year, with no auto-debit, so nothing renews behind your back. If you don't renew, your account returns to the free plan. See the refund policy for what applies to a purchase.",
  },
  {
    q: "Can DealInSec create a deal from a client's message?",
    a: "Yes. Paste the client's email or brief into DealInSec Copilot and it drafts the deal from what was said: the client, scope, amount, dates and terms. It is AI-assisted, so check the draft. Anything the message doesn't say is left as Not specified, nothing is created until you confirm it, and it never invents an amount that wasn't stated.",
  },
];
