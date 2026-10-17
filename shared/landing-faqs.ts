/**
 * The landing-page FAQ — ONE source for the visible accordion
 * (client/src/pages/landing.tsx) and the crawler fallback + FAQPage JSON-LD
 * (server/landing-seo.ts). Structured data must match what a visitor sees, so
 * never fork this list. Every answer must be true of the shipped product, and
 * prices come from shared/product-facts.ts.
 */
import { PRICING } from "./product-facts";
import { OUTBOUND_ALLOWANCE_DEFAULTS as OB, OUTBOUND_WINDOW_DAYS } from "./outbound-plans";

export interface LandingFaq {
  q: string;
  a: string;
}

export const LANDING_FAQS: LandingFaq[] = [
  {
    q: "What is DealInSec?",
    a: `DealInSec is a client-acquisition and deal-to-payment workspace for service businesses. It helps you research potential clients with AI, save them as leads, manage deals, send quotations, create agreements your client signs online, generate invoices and track payments, all from one connected record per client. Find Clients. Close Deals. Get Paid.`,
  },
  {
    q: "Who is DealInSec for?",
    a: "Freelancers, solo consultants and small B2B service agencies of about 1 to 10 people, such as web development and software services, digital marketing, SEO, growth, AI automation, content and lead-generation businesses, in India and abroad. Creators can use it for paid brand collaborations too. Pro includes up to 5 team members; it is not built for large sales teams.",
  },
  {
    q: "What is included in the free plan?",
    a: `The free plan is permanent and costs ₹0: ${PRICING.freeMonthlyDeals} new deals a month, each with its quotation; the lead pipeline, where you save researched prospects as leads; ${OB.free.monthlySearches} AI prospect research searches every ${OUTBOUND_WINDOW_DAYS} days (up to ${OB.free.maxCompanies} companies each); outreach drafts you approve; and the dashboard. That is enough to research a prospect, save the lead, create a deal and send a quotation. Every new account also starts with a ${PRICING.trialDays}-day Pro trial with no card.`,
  },
  {
    q: "What does Pro unlock?",
    a: `DealInSec Pro is ₹${PRICING.proMonthlyInr} a month in India and adds unlimited deals and quotations, agreements your client signs online, invoices generated from the agreement, payment tracking, ${OB.pro.monthlySearches} AI prospect research searches every ${OUTBOUND_WINDOW_DAYS} days (up to ${OB.pro.maxCompanies} companies each) and up to 5 team members. It is one plan: there is no separate fee for AI research or the CRM, and no annual plan.`,
  },
  {
    q: "How does AI prospect research work?",
    a: `Describe the clients you want and where to look (any countries or cities, or worldwide), and confirm the profile it reads back. AI Outbound then searches the web, checks each company's own website against your profile, looks for recent, dated reasons to reach out and named decision makers, and scores each company with its reasons. Every fact shows its source and date, and guesses are labelled as guesses. You choose who to save as a lead, and AI drafts a first message from verified facts for you to edit and approve. Searches are limited per plan and counted over ${OUTBOUND_WINDOW_DAYS} days.`,
  },
  {
    q: "Does DealInSec guarantee customers or verified contact details?",
    a: "No. DealInSec helps you research and organise potential clients; it does not guarantee clients, replies, meetings or sales. It is not a contact database: contact details are only shown when a company publishes them or a connected data provider returns them, they are not always available, and some markets have thinner coverage. Where the AI suggests a possible opportunity, that is labelled as an inference, not a fact.",
  },
  {
    q: "How are agreements, invoices and payments managed?",
    a: "On Pro, the agreement is generated from the deal with your standard and custom terms, and your client signs it online through a link, with an audit record of who signed and when (it is electronic acceptance, not a certified digital signature). Invoices are generated from the agreement, as one invoice, an advance and a final payment, or milestones, and can never exceed the agreement. Your client pays you directly; you mark each invoice paid, and DealInSec shows what is paid, pending and overdue. It never collects or moves your client's money, and in-app invoices are not GST tax invoices.",
  },
  {
    q: "How do billing and cancellation work?",
    a: `Pro is ₹${PRICING.proMonthlyInr} for one month, paid in rupees through Razorpay (UPI, cards or netbanking) by a workspace in India; DealInSec adds no tax on top of that price. It is a one-time payment for the month with no auto-debit, so there is nothing to cancel: if you don't pay again, your account returns to the free plan when the month ends, and your records stay. The refund policy explains what applies to a purchase. Outside India, including the United States, paid plans can't be bought yet; the free plan and the trial are open everywhere.`,
  },
  {
    q: "What happens when I reach my AI search limit?",
    a: `Searches are counted over a rolling ${OUTBOUND_WINDOW_DAYS} days, with at most 5 a day, and a search that stopped before searching the web isn't counted. On the free plan you can upgrade to Pro or wait; on Pro, more searches become available as earlier ones pass ${OUTBOUND_WINDOW_DAYS} days. Searching is never unlimited, and everything you already found stays in your workspace.`,
  },
  {
    q: "Does DealInSec send emails for me?",
    a: "No. AI drafts a first message from what is known about the prospect, you review and approve the exact text, send it from your own email, and mark it sent in DealInSec, which then adds a follow-up task. Addresses and domains on your do-not-contact list are blocked before anything is drafted or approved. Nothing is sent automatically, including follow-ups and payment reminders.",
  },
  {
    q: "Does DealInSec work with Gmail?",
    a: "Connecting Gmail is in limited early access for selected workspaces while Google's verification is completed, so it isn't available to everyone yet. Where it is switched on, replies to your outreach appear in an inbox, sorted by fixed rules such as interested, not interested, opt-out or bounce. They are never read by AI: DealInSec never sends Gmail content to an AI model. A reply, opt-out or bounce stops the follow-ups waiting for that conversation.",
  },
  {
    q: "Can I use DealInSec with international clients?",
    a: "Yes. You choose your country and billing currency when you sign up, from a list of 50 currencies, and your quotes, agreements and invoices use it. Your client can receive the documents from anywhere and sign the agreement online through a signing link, or on paper, in which case you upload the signed copy. The tax field, bank labels, invoice numbering and agreement wording follow the country you work from.",
  },
  {
    q: "Can DealInSec create a deal from a client's message?",
    a: "Yes. Paste the client's email or brief into DealInSec Copilot and it drafts the deal from what was said: the client, scope, amount, dates and terms. It is AI-assisted, so check the draft. Anything the message doesn't say is left as Not specified, nothing is created until you confirm it, and it never invents an amount that wasn't stated.",
  },
  {
    q: "Can freelancers or creators use DealInSec?",
    a: "Yes. Freelancers and solo consultants are one of the main audiences and use the same workflow as small agencies. Creators who do paid brand collaborations can choose “I work with brands” at sign-up for brand wording and a Brand Collaboration deal type with fields for usage rights, exclusivity and approval. It is the same workflow and pricing; it is not a marketplace and it does not find brand deals.",
  },
];
