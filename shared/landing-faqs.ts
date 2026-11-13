/**
 * The landing-page FAQ — ONE source for the visible accordion
 * (client/src/pages/landing.tsx) and the crawler fallback + FAQPage JSON-LD
 * (server/landing-seo.ts). Structured data must match what a visitor sees, so
 * never fork this list. Every answer must be true of the shipped product, and
 * prices come from shared/product-facts.ts.
 *
 * Order follows the visitor's own questions: what it is and who it's for, how
 * finding clients works, the AI team, what reaches a client, the free deal-to-
 * invoice flow, then plans, limits, boosters and billing, then the edge cases.
 */
import { PRICING } from "./product-facts";
import { OUTBOUND_ALLOWANCE_DEFAULTS as OB, OUTBOUND_WINDOW_DAYS } from "./outbound-plans";
import { LEAGUE_ALLOWANCE_DEFAULTS as LG, LEAGUE_WINDOW_DAYS } from "./ai-league";

export interface LandingFaq {
  q: string;
  a: string;
}

export const LANDING_FAQS: LandingFaq[] = [
  {
    q: "What is DealInSec?",
    a: "DealInSec is client-finding software for freelancers, consultants and small service agencies, built first for India. Describe who you want to work with, and Client Radar researches companies that fit, with a dated reason to reach out and its source. Your AI team drafts the outreach, you approve and send it, and leads, replies and follow-ups stay on one record. When you win the work, the quotation, the agreement your client signs online, the invoice and payment tracking are free on every plan. Find clients. Win deals. Get paid.",
  },
  {
    q: "Who is DealInSec for?",
    a: "People who sell services to clients: freelance web developers, designers, digital marketers and SEO consultants, independent consultants and other solo service providers, and small agencies of about 1 to 10 people (web development, software services, digital marketing, SEO, growth, AI automation, content and lead generation), in India and abroad. Creators doing paid brand collaborations are supported too (see below). Pro includes up to 5 team members; it is not built for large sales teams.",
  },
  {
    q: "How do I find clients as a freelancer in India?",
    a: `Describe the clients you want (D2C brands in Bengaluru, dental clinics in Pune, SaaS startups in the US) and where, confirm the profile DealInSec reads back, and Client Radar researches companies that fit, each with a dated reason to reach out and its source. Save the good ones as leads, approve a first message drafted from those facts, send it from your own email or WhatsApp, and let the follow-up tasks keep the conversation alive. The free plan includes ${OB.free.monthlySearches} searches every ${OUTBOUND_WINDOW_DAYS} days, with no card.`,
  },
  {
    q: "How does AI prospect research work?",
    a: `Client Radar searches the web for companies that match your profile, checks each company's own website, looks for recent, dated reasons to reach out and for named decision makers, and scores each company with its reasons. Every fact shows its source and date; guesses are labelled as guesses. You choose who to save as a lead, and the AI drafts a first message from verified facts for you to edit and approve. Searches are limited per plan and counted over a rolling ${OUTBOUND_WINDOW_DAYS} days.`,
  },
  {
    q: "Can DealInSec find local businesses in my city?",
    a: "Yes. Choose Local businesses, type the kind of business and the city (dentists in Siliguri, coaching institutes in Kota, cafes in Pune), and DealInSec lists matching businesses from Google Maps with their address, phone, website if listed, and a link to the listing. The listings are shown for that search and not kept in DealInSec: you choose which websites it researches, or save a business to Leads under the name you give it. One local search uses one Client Radar search. A listing without a website only means none is listed; it doesn't prove the business has no website or needs one.",
  },
  {
    q: "What are Nibo, Mika and Zee?",
    a: `Your three AI coworkers, in AI Team. Nibo researches companies that fit what you sell and saves the qualified ones to your leads with evidence. Mika drafts first messages and follow-ups for you to approve and send yourself. Zee briefs you each day from your own records: follow-ups due, replies waiting, invoices overdue. They work in the background, ask before anything that spends your allowance or changes something, and never send, pay or sign anything. The free plan includes ${LG.free.monthlyRuns} coworker tasks every ${LEAGUE_WINDOW_DAYS} days and Pro ${LG.pro.monthlyRuns}.`,
  },
  {
    q: "Does DealInSec send emails for me?",
    a: "No. The AI drafts a first message from what is known about the prospect; you review and approve the exact text, send it from your own email, WhatsApp, LinkedIn or other channel, and mark it sent, which adds a follow-up task. Your do-not-contact list is checked before anything is drafted. Nothing is sent automatically, including follow-ups and payment reminders.",
  },
  {
    q: "Does DealInSec work with Gmail?",
    a: "Connecting Gmail is in limited early access for selected workspaces while Google's verification is completed, so it isn't available to everyone yet. Where it is switched on, a reply to your outreach is matched to the lead and shown on its record, the lead moves to Replied, its pending follow-ups stop, and your Today list shows how many leads have replied. Replies are sorted by fixed rules (interested, not interested, opt-out, bounce) and are never read by AI: DealInSec never sends Gmail content to an AI model.",
  },
  {
    q: "Is the deal-to-invoice flow really free?",
    a: "Yes, on every plan, with no monthly cap and no card: create a deal, send a quotation your client accepts online, generate the agreement they sign online, raise invoices and track what's paid, pending and overdue. Pro only buys more AI client research, more AI drafts and team seats. Booster packs never apply to it.",
  },
  {
    q: "How are agreements, invoices and payments managed?",
    a: "The agreement is generated from the deal with your standard and custom terms, and your client signs it online through a link, with an audit record of who signed and when (electronic acceptance, not a certified digital signature). Invoices are generated from the agreement, as one invoice, an advance and a final payment, or milestones, and can never exceed it; your business and tax details are printed. Your client pays you directly; you mark each invoice paid and DealInSec shows what is paid, pending and overdue. It never collects or moves your client's money, and in-app invoices are not GST tax invoices. Protection Check flags risky or missing terms before you send.",
  },
  {
    q: "What is included in the free plan?",
    a: `Permanent and ₹0: the whole deal-to-invoice flow with no monthly cap; the lead pipeline; ${OB.free.monthlySearches} Client Radar searches every ${OUTBOUND_WINDOW_DAYS} days (up to ${OB.free.maxCompanies} companies each); ${OB.free.monthlyDrafts} AI outreach drafts every ${OUTBOUND_WINDOW_DAYS} days; local business search from Google Maps; and ${LG.free.monthlyRuns} coworker tasks every ${LEAGUE_WINDOW_DAYS} days. No card is needed, in every country.`,
  },
  {
    q: "What does Pro unlock?",
    a: `DealInSec Pro is ₹${PRICING.proMonthlyInr} a month in India and raises what the AI may do for you: ${OB.pro.monthlySearches} Client Radar searches every ${OUTBOUND_WINDOW_DAYS} days (up to ${OB.pro.maxCompanies} companies each), ${OB.pro.monthlyDrafts} AI outreach drafts, more coworker tasks, and up to 5 team members. It is one plan, with no separate fee for AI research or the CRM and no annual plan. The deal-to-invoice flow is free for everyone, so Pro is about finding more clients, not unlocking the paperwork.`,
  },
  {
    q: "What happens when I reach my AI search limit?",
    a: `Searches are counted over a rolling ${OUTBOUND_WINDOW_DAYS} days, with at most 5 a day; a search that stopped before searching the web isn't counted. At the limit on Free you can upgrade to Pro, buy a booster pack or wait; on Pro, searches free up as earlier ones pass ${OUTBOUND_WINDOW_DAYS} days, or a booster pack covers the next ones right away. Only searching pauses: your leads, drafts and the whole deal-to-invoice flow keep working, and everything you already found stays in your workspace. Searching is never unlimited.`,
  },
  {
    q: "What are booster packs?",
    a: "One-time credit packs of extra Client Radar searches or extra AI outreach drafts, for when your plan's allowance is used up before it frees up. Buy one in the app under Credits & usage (also on Plan & billing); the pack sizes, prices and validity are shown before you pay. Credits are spent only after your plan's own allowance, never renew, and stay yours if your plan ends. They add capacity to the same features and unlock nothing else.",
  },
  {
    q: "How do billing and cancellation work?",
    a: `Pro is ₹${PRICING.proMonthlyInr} for one month, paid in rupees through Razorpay (UPI, cards or netbanking) by a workspace in India; DealInSec adds no tax on top. It is a one-time payment with no auto-debit, so there is nothing to cancel: if you don't pay again, the account returns to the free plan when the month ends and your records stay. Booster packs are one-time too. The refund policy explains what applies to a purchase. Outside India, including the United States, paid plans can't be bought yet; the free plan is open everywhere.`,
  },
  {
    q: "Does DealInSec guarantee customers or verified contact details?",
    a: "No. DealInSec helps you research and organise potential clients; it does not guarantee clients, replies, meetings or sales. It is not a contact database: contact details are shown only when a company publishes them or a connected data provider returns them, they are not always available, and some markets have thinner coverage. Where the AI suggests a possible opportunity, that is labelled as an inference, not a fact.",
  },
  {
    q: "Can I use DealInSec with international clients?",
    a: "Yes. Client Radar can search the US, the UK, Canada, Australia, the UAE, India and other countries. You choose your own country and billing currency at sign-up, from 50 currencies, and your quotations, agreements and invoices use it; the tax field, bank labels, invoice numbering and agreement wording follow the country you work from. Your client can receive documents anywhere and sign the agreement online, or on paper, in which case you upload the signed copy.",
  },
  {
    q: "Can DealInSec create a deal from a client's message?",
    a: "Yes. Paste the client's email or brief and DealInSec drafts the deal from what was said: the client, scope, amount, dates and terms. Anything the message doesn't state is left as Not specified, nothing is created until you confirm it, and it never invents an amount. It is AI-assisted, so check the draft.",
  },
  {
    q: "Can freelancers or creators use DealInSec?",
    a: "Yes. Freelancers and solo consultants are a main audience and use the same workflow as small agencies. Creators who do paid brand collaborations can choose “I work with brands” at sign-up for brand wording and a Brand Collaboration deal type with fields for usage rights, exclusivity and approval. It is the same workflow and pricing; it is not a marketplace and it does not find brand deals.",
  },
];
