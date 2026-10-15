/**
 * The landing-page FAQ — ONE source for the visible accordion
 * (client/src/pages/landing.tsx) and the crawler fallback + FAQPage JSON-LD
 * (server/landing-seo.ts). Structured data must match what a visitor sees, so
 * never fork this list. Every answer must be true of the shipped product.
 */
export interface LandingFaq {
  q: string;
  a: string;
}

export const LANDING_FAQS: LandingFaq[] = [
  {
    q: "What is DealInSec?",
    a: "DealInSec is a sales and deal workspace for small agencies and consultants. It helps you find prospects that fit your ideal client, work them through a pipeline, and turn won work into a quotation, an agreement your client signs and invoices, then track whether you have been paid. Each document is generated from the same deal, so the scope and the numbers always match.",
  },
  {
    q: "Who is DealInSec for?",
    a: "Founder-led agencies and consultants with one to a handful of people, such as SEO, digital marketing, growth, B2B marketing and AI-automation agencies, in the United States, India and elsewhere. Freelancers use it the same way, and creators use it for paid brand collaborations. Pro includes up to 5 team members; it is not built for large sales teams.",
  },
  {
    q: "Does DealInSec find clients for me?",
    a: "AI Outbound helps you research them. Describe the clients you want and confirm the profile it builds; it then researches matching companies, checks each one against your profile and shows the evidence, with its source and how recent it is. Guesses are labelled as guesses, and anything it couldn't find is shown as unknown. You decide who goes into your pipeline. Research has daily limits per workspace, and contact details are not always available.",
  },
  {
    q: "Does DealInSec send emails for me?",
    a: "No. AI drafts a first message from what is known about the prospect, you review and approve the exact text, send it from your own email, and mark it sent in DealInSec, which then adds a follow-up task. Addresses and domains on your do-not-contact list are blocked before anything is drafted or approved. Sending through a connected Gmail account is not available yet.",
  },
  {
    q: "Can I use DealInSec for brand deals as a creator?",
    a: "Yes. Choose “I work with brands” when you sign up and the app uses brand wording and offers the Brand Collaboration deal type, with optional fields for campaign, usage rights, usage duration, exclusivity and approval. Protection Check asks about anything the brand's offer leaves out, and the quotation, agreement and invoice state the terms you enter. It is the same workflow and pricing as for client work, it is not a marketplace and it does not find brand deals.",
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
    a: "Yes. The free plan is permanent and covers 4 deals a month, each with a professional quotation, plus the leads pipeline and AI Outbound research within its daily limits. Every new account also starts with a 7-day Pro trial with everything unlocked and no card needed. Signed agreements, invoices and payment tracking are part of Pro. In India, Pro is ₹99 a month or ₹999 a year. In the United States and other countries outside India, paid plans can't be bought yet; the free plan and the trial are open everywhere. There are no platform fees on your deal value.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes. Pro is paid for a fixed period, a month or a year, with no auto-debit, so nothing renews behind your back. If you don't renew, your account returns to the free plan. See the refund policy for what applies to a purchase.",
  },
  {
    q: "Can DealInSec create a deal from a client's or brand's message?",
    a: "Yes. Paste the client's or brand's conversation into DealInSec Copilot and it drafts the deal from what was said: the client or brand, scope, amount, dates and terms, and for a brand deal any usage, exclusivity and approval terms. It is AI-assisted, so check the draft. Anything the message doesn't say is left as Not specified, nothing is created until you confirm it, and it never invents an amount that wasn't stated.",
  },
];
