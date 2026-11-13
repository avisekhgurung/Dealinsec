/**
 * What DealInSec is, who it is for, what works today and what doesn't: the ONE source every public and AI-readable
 * description is built from. The landing-page chatbot ("Ask DealInSec"), the in-app Copilot and agent (as an always-
 * included knowledge document), /llms.txt and the product-claim tests all read this file, so a capability, a price or a
 * limit is changed here once and nowhere else.
 *
 * Rules for editing:
 * - A capability is "live" only when it works in production for any workspace without a special switch. Anything behind
 *   an off-by-default flag, an allowlist or an unfinished verification is "limited"; anything not built is "not_available".
 * - Prices come from the code that charges them (GLOBAL_PLANS' INR row, the seat price default in razorpayClient.ts,
 *   checked by product-facts.test.ts). Never write a price here by hand.
 * - No dates for unbuilt things ("coming soon", "next month"): say what is true today.
 */
import { GLOBAL_PLANS } from "./globalPlans";
import { PRO_INCLUDED_SEATS } from "./permissions";
import { OUTBOUND_ALLOWANCE_DEFAULTS, OUTBOUND_WINDOW_DAYS } from "./outbound-plans";
import { LEAGUE_ALLOWANCE_DEFAULTS as LG, LEAGUE_LIMITS, LEAGUE_WINDOW_DAYS } from "./ai-league";

const OB = OUTBOUND_ALLOWANCE_DEFAULTS;

export const PRODUCT_NAME = "DealInSec";
/** The brand line: what the product does, in the order it happens. The homepage h1, the auth page and every SSR
 *  call-to-action say exactly this, so search and answer engines meet one claim everywhere. */
export const TAGLINE = "Find clients. Win deals. Get paid.";
export const SUPPORT_EMAIL = "support@dealinsec.com";

/** One sentence: what it is. */
export const ONE_LINER =
  "DealInSec is an AI team that finds clients for freelancers, consultants and small service agencies, built first for India: describe who you want to work with, and it researches companies with evidence, drafts outreach you approve and keeps your leads and follow-ups in one place.";

/** The line under the headline: the client journey in one place, and what the AI coworkers help with. */
export const SUPPORTING_LINE =
  "Your AI coworkers research potential clients, prepare the outreach and keep follow-ups moving; you approve everything that reaches a client. When you win the work, the quotation, the agreement your client signs online, the invoice and payment tracking are free on every plan.";

/** A short paragraph for summaries, meta descriptions and the top of AI-readable files. */
export const SUMMARY =
  "DealInSec finds clients for service businesses: describe the clients you want, and Client Radar searches the web or lists local businesses in a city, checks each company's own website against your profile, shows dated signals with their sources and drafts a first message. You review and approve before anything reaches a client, and you send it yourself; leads, replies and follow-ups stay on one record. Deal, quotation, agreement and invoice records exist for work you win, but finding clients is the product.";

/** The primary audience, in the order the homepage and assistants name it. */
export const PRIMARY_AUDIENCE = [
  "freelancers and solo consultants",
  "web development and software services agencies",
  "digital marketing, SEO and growth agencies",
  "AI automation agencies and consultants",
  "social media, content and lead-generation agencies",
  "independent B2B consultants and specialist service providers",
] as const;
export const AUDIENCE_LINE =
  "freelancers, solo consultants and small B2B service agencies of about 1 to 10 people, including web development and software services, digital marketing, SEO, growth, AI automation, content and lead-generation businesses";
/** Kept, but never the headline: older pages and tools for these still exist. */
export const SECONDARY_AUDIENCE = ["creators who do paid brand collaborations"] as const;

export const MARKETS =
  "Launching first in India: plans are priced and paid in rupees, and onboarding, support and billing are set up for Indian agencies. Indian agencies can find clients in India and abroad: Client Radar searches the United States, the United Kingdom, Canada, Australia, the UAE, India and other countries, whichever you choose, wherever your own business is, and can list local businesses in a city (Siliguri, Pune, Austin or anywhere else) from Google Maps. Workspaces in other countries can use the free plan; documents follow each workspace's country and currency (50 currencies are supported).";

/** The intended connected workflow. Every stage below is live today (see CAPABILITIES for the details and limits). */
export const WORKFLOW = ["Prospect", "Lead", "Deal", "Quotation", "Agreement", "Invoice", "Payment tracking"] as const;

export type CapabilityStatus = "live" | "limited" | "not_available";
export interface Capability {
  key: string;
  name: string;
  status: CapabilityStatus;
  /** Which plan has it: "all" (the free plan included), "pro" (Pro). Not for not_available. */
  plan?: "all" | "pro";
  /** What it does, plainly, including its limits. */
  text: string;
}

export const CAPABILITIES: readonly Capability[] = [
  {
    key: "ai_outbound", name: "Client Radar (prospect research)", status: "live", plan: "all",
    text: `The hero feature. Describe the companies you want to reach and choose where (any countries, regions or cities: the US, the UK, Canada, Australia, the UAE, India and others, or worldwide); you confirm the profile, then it searches the web, checks each company's own website against your ideal-client profile, looks for recent, dated reasons to reach out and named decision makers, and scores each one. For local businesses (dentists in Siliguri, cafes in Pune), it can instead list businesses in a city from Google Maps: the listings are shown for that search and not kept, you choose which listed websites DealInSec researches the same way, and you can save a business to Leads under the name you give it, with a link to its listing. A listing without a website says only that; it doesn't mean the business has no website or needs one. Every finding shows its source and date; guesses and unknowns are labelled, and thin markets are said plainly. Nothing is contacted and no lead is created until you add one. One credit is one search: the free plan includes ${OB.free.monthlySearches} a month (up to ${OB.free.maxCompanies} companies each), and Pro ${OB.pro.monthlySearches} a month (up to ${OB.pro.maxCompanies} companies each), counted over ${OUTBOUND_WINDOW_DAYS} days, with at most 5 a day. Research is never unlimited, and contact details aren't always available.`,
  },
  {
    key: "ai_coworkers", name: "AI coworkers: Nibo, Mika and Zee (AI Team)", status: "live", plan: "all",
    text: `Three AI coworkers in AI Team, who do work in the background through the product's own features, as the signed-in person. Nibo 🔎 (Deal Finder) runs an Client Radar search, checks each company's own website and saves up to ${LEAGUE_LIMITS.leadsPerRun} qualified companies a task to Leads with their evidence and sources; his research always asks first because it uses a search. Mika 💌 (Deal Closer) drafts first emails from verified facts for leads you pick; nothing is sent, you approve the exact text and send it yourself. Zee 🌱 (Business Buddy) briefs you from your own records: which leads are due a follow-up, which are overdue and which drafted messages are waiting for your approval. Each has its own chat; they can ask each other for help, hand work to a teammate (always with your approval) and hold a short team huddle. Tasks keep running if you close the page and can be scheduled daily, on weekdays or weekly. The free plan includes ${LG.free.monthlyRuns} coworker tasks every ${LEAGUE_WINDOW_DAYS} days and Pro ${LG.pro.monthlyRuns}; each task also uses the allowance of the feature it runs. They never send, pay or sign anything.`,
  },
  {
    key: "outreach_drafts", name: "Outreach drafts with approval", status: "live", plan: "all",
    text: "AI drafts a first message from verified facts about the company, or you write it yourself, which doesn't use one of the plan's AI drafts. You edit and approve the exact text, send it yourself from your own email, and mark it sent; a follow-up task is added and the do-not-contact list is checked first.",
  },
  {
    key: "leads", name: "Leads pipeline", status: "live", plan: "all",
    text: "Leads move through stages (new, researching, qualified, contacted, replied, meeting, proposal, won or lost) with next-step tasks, follow-up dates, recorded facts with their sources, a lead score, and a do-not-contact list.",
  },
  {
    key: "deals", name: "Deals", status: "live", plan: "all",
    text: "A deal records the client, the engagement model (retainer, fixed price, hourly, milestones and more), the service, the value in the workspace's currency, dates and deliverables. A won lead becomes a deal in one step. Deals, and everything that follows from them, are free on every plan with no monthly cap.",
  },
  {
    key: "quotations", name: "Quotations", status: "live", plan: "all",
    text: "A professional, versioned quotation generated from the deal, with a link the client can open and accept online, and print or PDF.",
  },
  {
    key: "agreements", name: "Agreements and online signing", status: "live", plan: "all",
    text: "An agreement generated from the deal, with standard and custom terms, and a link the client can sign online. Signing is electronic acceptance with an audit record of who signed and when; it is not a certified digital signature, and DealInSec gives no legal advice.",
  },
  {
    key: "invoices", name: "Invoices", status: "live", plan: "all",
    text: "Invoices drawn from the agreement, single or split (for example an advance and a final payment), with your business and tax registration details printed. App invoices don't calculate tax and are not GST tax invoices.",
  },
  {
    key: "payment_tracking", name: "Payment tracking", status: "live", plan: "all",
    text: "Record when an invoice is paid and see what is paid, pending and overdue. DealInSec records payments; it never collects or moves your clients' money.",
  },
  {
    key: "protection_check", name: "Protection Check", status: "live", plan: "all",
    text: "Flags risky or missing terms in a deal (no advance, unlimited revisions, no payment timeline and similar) and suggests what to ask, before you send anything. It reads the wording only and is not legal advice.",
  },
  {
    key: "assistant", name: "In-app AI assistant (Copilot and Agent mode)", status: "live", plan: "all",
    text: "Ask in plain words to find records, start an Client Radar search, create a deal from a pasted brief, or prepare a quotation, agreement or invoice. It asks you to approve every change before it happens.",
  },
  {
    key: "team", name: "Team members and roles", status: "live", plan: "pro",
    text: `Invite teammates with roles and permissions and see an activity log. Pro includes ${PRO_INCLUDED_SEATS} members; the free plan has one.`,
  },
  {
    key: "gmail", name: "Gmail connection", status: "limited",
    text: "Connecting a Gmail account is in limited early access for selected workspaces while Google's verification is completed, so it isn't available to everyone yet. Where it is switched on, replies to your outreach can be synced into an inbox and sorted by fixed rules (interested, not interested, opt-out, bounce and so on), never by AI: DealInSec never sends Gmail content to an AI model. A reply, opt-out or bounce stops pending follow-ups, and an interested reply can become a deal after you review it.",
  },
  {
    key: "auto_send", name: "Sending email automatically", status: "not_available",
    text: "DealInSec does not send emails, follow-ups or reminders on its own. You approve every message and send it yourself.",
  },
  {
    key: "payment_collection", name: "Collecting client payments", status: "not_available",
    text: "DealInSec doesn't process or collect payments from your clients; they pay you directly and you record it.",
  },
  {
    key: "auto_reminders", name: "Automatic payment reminders", status: "not_available",
    text: "Payment reminders are AI drafts you review, copy and send yourself; nothing is sent on a schedule.",
  },
  {
    key: "not_included", name: "Not included", status: "not_available",
    text: "Time tracking, a client portal, accounting or expense tracking, meeting scheduling, email marketing campaigns, Outlook, WhatsApp, and integrations with other CRMs.",
  },
];

const inr = GLOBAL_PLANS.INR;
const rupees = (n: number) => `₹${n.toLocaleString("en-IN")}`;
/** Extra team seat, per month (server/razorpayClient.ts getExtraSeatPrice default; product-facts.test.ts checks they agree). */
export const EXTRA_SEAT_PRICE_INR = 99;
// There is no free-plan deal cap any more (13 Nov 2026): deals, quotations, agreements, invoices and payment
// tracking are free and unmetered on every plan. users.monthlyDealCredits still exists and still has its old
// default, but nothing spends it — see POST /api/deals in server/routes.ts.

export const PRICING = {
  proMonthlyInr: inr.monthly!.amount,
  extraSeatInr: EXTRA_SEAT_PRICE_INR,
  /** Who can buy a paid plan today. */
  checkout: "India only: paid plans are bought in Indian rupees through Razorpay (UPI, cards, netbanking) by a workspace in India. Outside India, including the United States, paid plans can't be bought yet; the free plan is open everywhere.",
} as const;

export const PRICING_LINES: readonly string[] = [
  `Free plan: the work you have already won costs nothing — deals, quotations, agreements signed online, invoices and payment tracking, with no monthly cap on any of them — plus the leads pipeline, ${OB.free.monthlySearches} Client Radar searches a month (up to ${OB.free.maxCompanies} companies each) and ${OB.free.monthlyDrafts} AI outreach drafts a month. Permanent, no card.`,
  `DealInSec Pro: more of the AI that finds clients — Client Radar with ${OB.pro.monthlySearches} searches a month (up to ${OB.pro.maxCompanies} companies each), ${OB.pro.monthlyDrafts} AI outreach drafts a month, and ${PRO_INCLUDED_SEATS} team members. ${rupees(PRICING.proMonthlyInr)} a month in India, paid once a month: it does not renew or charge automatically, you pay again to extend. The deal-to-invoice flow is free on every plan, so Pro buys research and drafting capacity, not a different product. There is no separate plan for Client Radar or the CRM, and no annual plan. Extra team members are ${rupees(PRICING.extraSeatInr)} each a month.`,
  "Booster packs: one-time credit packs for extra Client Radar searches or extra AI outreach drafts, for when a plan's allowance is used up before it frees up. They are bought in the app under Credits & usage (the prices, pack sizes and validity are listed there), never renew, are spent only after the plan's own allowance, and stay yours if the plan ends. They add capacity to the same features; they do not unlock anything else.",
  PRICING.checkout,
  `Checkout charges exactly the listed price (${rupees(PRICING.proMonthlyInr)} for Pro); DealInSec adds no tax on top of it.`,
  "No platform fee or commission on your deal value.",
];

/** Promises no page, answer or file may make (the tests look for them). */
export const NEVER_CLAIM: readonly string[] = [
  "that DealInSec guarantees a client pays, or recovers money",
  "that DealInSec guarantees new clients, leads, meetings, replies or sales",
  "that DealInSec is a verified contact database or that contact details are verified",
  "that DealInSec is an autonomous sales agent, or replaces every CRM or accounting product",
  "that it sends emails, follow-ups or reminders automatically",
  "that it collects or processes client payments",
  "that AI reads or classifies Gmail messages",
  "that paid plans can be bought outside India",
  "unlimited AI research, unlimited sending, or separate prices for Client Radar or the CRM",
  "that Gmail is available to every workspace",
  "that its agreements are certified digital signatures, or that it is legally or tax compliant in any country",
  "integrations it does not have (Outlook, WhatsApp, Stripe, PayPal, Salesforce, HubSpot)",
  "user numbers, ratings, reviews or customer logos",
  "a free trial of Pro (new accounts start on the free plan; there is no trial)",
  "that DealInSec is a business directory or keeps a database of Google Maps listings",
  "that a business without a website on its listing has no website or needs one",
];

/**
 * Descriptions of DealInSec that are circulating and are WRONG, each paired with what is true.
 *
 * Why this exists: on 13 Nov 2026 Google's AI Overview for "dealinsec" described the product as a "deal-management,
 * sales and quote-to-cash platform" priced "from around ₹199/month", citing a third-party directory entry and the
 * repository's pre-pivot README rather than this site. Answer engines reconstruct an entity from whatever they can
 * find, so the site has to state plainly which older descriptions are stale — otherwise the correction never reaches
 * them. These lines are published in /llms.txt and are part of the assistants' always-included knowledge, so the
 * chatbot can correct a visitor who arrives repeating one of them.
 *
 * Add a line here only for a claim that is actually in circulation, and delete it once it has died out.
 */
export const OUT_OF_DATE_CLAIMS: readonly { wrong: string; correct: string }[] = [
  {
    wrong: "that DealInSec is primarily a deal-management, CRM or quote-to-cash platform",
    correct:
      "finding clients is the product: Client Radar research, AI outreach drafts you approve and send yourself, and a leads pipeline. Deal, quotation, agreement and invoice records exist for work you have already won, behind that.",
  },
  {
    // The stale figure itself is deliberately NOT written here: a refuted price is still a number a crawler or answer
    // engine can lift out of the page as the price, and site-head.test.ts forbids any ₹ amount that can't be charged.
    wrong: "that Pro costs anything other than the price given here, or that plans are priced per signed contract or per deal credit",
    correct: `Pro is ${rupees(inr.monthly!.amount)} a month in India, paid once a month with no auto-renewal. There is no pay-per-contract or pay-per-deal credit model; optional credit packs only add extra Client Radar searches or AI drafts.`,
  },
  {
    wrong: "that DealInSec is built for creators and brand collaborations first",
    correct:
      "freelancers, consultants and small B2B service agencies are the primary audience. Creators doing paid brand collaborations are a secondary audience the product still supports.",
  },
  {
    wrong: "any user count, customer total, rating or named customer",
    correct:
      "DealInSec publishes no user numbers, ratings, reviews or customer logos. Any figure of that kind attributed to it is not from us.",
  },
  {
    wrong: "that payments run through Stripe or PayU, or that the app is hosted on Render",
    correct: "paid plans are charged through Razorpay, and the application and its database run on a VPS in Mumbai.",
  },
];

const STATUS_WORD: Record<CapabilityStatus, string> = { live: "Available now", limited: "Limited availability", not_available: "Not available" };

/**
 * The facts as a markdown document: the assistants' always-included knowledge ("product-facts") and the basis of the
 * llms.txt summary. Written so a model can answer "can it…?" with the status word first.
 */
export function productFactsMarkdown(): string {
  const byStatus = (s: CapabilityStatus) => CAPABILITIES.filter((c) => c.status === s)
    .map((c) => `- **${c.name}** (${STATUS_WORD[s]}${c.plan ? `, ${c.plan === "all" ? "every plan" : "Pro"}` : ""}): ${c.text}`).join("\n");
  return `# ${PRODUCT_NAME}: verified product facts

${ONE_LINER} ${TAGLINE}

${SUMMARY}

## Who it is for
Primary: ${AUDIENCE_LINE}. Secondary (older pages and tools still exist): ${SECONDARY_AUDIENCE.join(" and ")}.
${MARKETS}

## The connected workflow
${WORKFLOW.join(" → ")}. Client Radar is where new clients start; a won lead becomes a deal, and the deal carries through quotation, agreement, invoice and payment tracking.

## Available now
${byStatus("live")}

## Limited availability
${byStatus("limited")}

## Not available
${byStatus("not_available")}

## Pricing and checkout
${PRICING_LINES.map((l) => `- ${l}`).join("\n")}

## Out-of-date descriptions to correct
Some older third-party summaries describe DealInSec wrongly. If someone repeats one, correct it plainly:
${OUT_OF_DATE_CLAIMS.map((c) => `- It is not true ${c.wrong}. In fact, ${c.correct}`).join("\n")}

## Never say
${NEVER_CLAIM.map((l) => `- Never claim ${l}.`).join("\n")}
If something isn't covered here, say you're not sure and point to ${SUPPORT_EMAIL}.
`;
}
