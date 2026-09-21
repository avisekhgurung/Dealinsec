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
    a: "DealInSec is a workspace for freelancers to manage a client deal from first quote to final payment. You create the deal, send a quotation, get the agreement signed, send the invoice and track whether it has been paid. Each document is generated from the same deal, so the scope and the numbers always match.",
  },
  {
    q: "Who is DealInSec for?",
    a: "Freelancers, independent consultants, creators and other solo service professionals who quote, agree terms with and bill their own clients: designers, developers, writers, video editors, photographers, marketers and consultants. It is built for one person running client work, not for large teams.",
  },
  {
    q: "Can I use DealInSec with international clients?",
    a: "Yes. You choose your country and billing currency when you sign up, from a list of 50 currencies, and your quotes, agreements and invoices use it. Your client can receive the documents from anywhere and sign the agreement however they prefer; you upload the signed copy. The tax field, bank labels, invoice numbering and agreement wording follow the country you work from.",
  },
  {
    q: "Can I create quotes and agreements?",
    a: "Yes. Create a deal with the client, deliverables, timeline and fee, then generate a quotation from it with standard or custom terms. Once the client agrees, create the agreement from the same deal. Before you send the terms, Protection Check flags risky wording such as unlimited revisions or a missing advance, and suggests lines to add. Nothing is added unless you approve it.",
  },
  {
    q: "Can clients sign agreements online?",
    a: "Not through a signing link yet. You create the agreement with your saved signature applied, download the PDF and send it. Your client signs it however they prefer, and you upload the signed copy as proof, which marks the agreement Signed with the date. It is a record of what was agreed, not a Digital Signature Certificate or a certified e-signature, and DealInSec is not a law firm, so have a lawyer review anything high-value or unusual.",
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
    a: "Yes. The free plan is permanent and covers 4 deals a month, each with a professional quotation. Every new account also starts with a 7-day Pro trial with everything unlocked and no card needed. Signed agreements, invoices and payment tracking are part of Pro. In India, Pro is ₹99 a month or ₹999 a year. Outside India, paid checkout is opening soon at $99, £79 or €89 a year, annual only; the free plan and the trial are open everywhere in the meantime. There are no platform fees on your deal value.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes. Pro is paid for a fixed period, a month or a year, with no auto-debit, so nothing renews behind your back. If you don't renew, your account returns to the free plan. See the refund policy for what applies to a purchase.",
  },
  {
    q: "Can DealInSec create a deal from a client's message?",
    a: "Yes. Paste the client's conversation into DealInSec Copilot and it drafts the deal from what was said: client, scope, amount, dates and terms. It is AI-assisted, so check the draft. Nothing is created until you confirm it, and it never invents an amount that wasn't stated.",
  },
];
