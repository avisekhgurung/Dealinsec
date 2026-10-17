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
import { TRIAL_DAYS } from "./schema";
import { OUTBOUND_ALLOWANCE_DEFAULTS, OUTBOUND_WINDOW_DAYS } from "./outbound-plans";

const OB = OUTBOUND_ALLOWANCE_DEFAULTS;

export const PRODUCT_NAME = "DealInSec";
export const TAGLINE = "Find Clients. Close Deals. Get Paid.";
export const SUPPORT_EMAIL = "support@dealinsec.com";

/** One sentence: what it is. */
export const ONE_LINER =
  "DealInSec is an AI-assisted client acquisition and deal-to-payment workspace for small B2B service businesses.";

/** A short paragraph for summaries, meta descriptions and the top of AI-readable files. */
export const SUMMARY =
  "Use AI to discover relevant prospects, prepare personalized outreach and manage the journey from conversation to payment. DealInSec helps founder-led agencies and consultants research real prospects, approve outreach, manage interested leads, and move each deal through quotations, agreements, invoices and payment tracking in one connected workspace, on one subscription. AI does the research and drafting; you review and approve before anything goes to a client.";

/** The primary audience, in the order the homepage and assistants name it. About 1 to 10 people. */
export const PRIMARY_AUDIENCE = [
  "digital marketing agencies",
  "SEO agencies and SEO consultants",
  "growth and performance marketing agencies",
  "AI automation agencies and AI implementation consultants",
  "web design and development agencies",
  "software development and IT consulting firms",
  "social media and content marketing agencies",
  "lead-generation and sales-development agencies",
  "independent B2B consultants and specialist service providers",
] as const;
export const AUDIENCE_LINE =
  "founder-led B2B service businesses of about 1 to 10 people: digital marketing, SEO, growth, AI automation, web and software development, content and lead-generation agencies, independent B2B consultants, and solo founders starting a B2B service business";
/** Kept, but never the headline: older pages and tools for these still exist. */
export const SECONDARY_AUDIENCE = ["freelancers and independent professionals", "creators who do paid brand collaborations"] as const;

export const MARKETS =
  "Launching first in India: plans are priced and paid in rupees, and onboarding, support and billing are set up for Indian agencies. Indian agencies can find clients in India and abroad: AI Outbound searches the United States, the United Kingdom, Canada, Australia, the UAE, India and other countries, whichever you choose, wherever your own business is. Workspaces in other countries can use the free plan and the trial; documents follow each workspace's country and currency (50 currencies are supported).";

/** The intended connected workflow. Every stage below is live today (see CAPABILITIES for the details and limits). */
export const WORKFLOW = ["Prospect", "Lead", "Deal", "Quotation", "Agreement", "Invoice", "Payment tracking"] as const;

export type CapabilityStatus = "live" | "limited" | "not_available";
export interface Capability {
  key: string;
  name: string;
  status: CapabilityStatus;
  /** Which plan has it: "all" (free plan and trial included), "pro" (Pro or the trial). Not for not_available. */
  plan?: "all" | "pro";
  /** What it does, plainly, including its limits. */
  text: string;
}

export const CAPABILITIES: readonly Capability[] = [
  {
    key: "ai_outbound", name: "AI Outbound (prospect research)", status: "live", plan: "all",
    text: `The hero feature. Describe the companies you want to reach and choose where (any countries, regions or cities: the US, the UK, Canada, Australia, the UAE, India and others, or worldwide); you confirm the profile, then it searches the web, checks each company's own website against your ideal-client profile, looks for recent, dated reasons to reach out and named decision makers, and scores each one. Every finding shows its source and date; guesses and unknowns are labelled, and thin markets are said plainly. Nothing is contacted and no lead is created until you add one. One credit is one search: the free plan includes ${OB.free.monthlySearches} a month (up to ${OB.free.maxCompanies} companies each), the trial ${OB.trial.monthlySearches}, and Pro ${OB.pro.monthlySearches} a month (up to ${OB.pro.maxCompanies} companies each), counted over ${OUTBOUND_WINDOW_DAYS} days, with at most 5 a day. Research is never unlimited, and contact details aren't always available.`,
  },
  {
    key: "outreach_drafts", name: "Outreach drafts with approval", status: "live", plan: "all",
    text: "AI drafts a first message from verified facts about the company. You edit and approve the exact text, send it yourself from your own email, and mark it sent; a follow-up task is added and the do-not-contact list is checked first.",
  },
  {
    key: "leads", name: "Leads pipeline", status: "live", plan: "all",
    text: "Leads move through stages (new, researching, qualified, contacted, replied, meeting, proposal, won or lost) with next-step tasks, follow-up dates, recorded facts with their sources, a lead score, and a do-not-contact list.",
  },
  {
    key: "deals", name: "Deals", status: "live", plan: "all",
    text: "A deal records the client, the engagement model (retainer, fixed price, hourly, milestones and more), the service, the value in the workspace's currency, dates and deliverables. A won lead becomes a deal in one step. The free plan includes 4 deals a month; Pro is unlimited.",
  },
  {
    key: "quotations", name: "Quotations", status: "live", plan: "all",
    text: "A professional, versioned quotation generated from the deal, with a link the client can open and accept online, and print or PDF.",
  },
  {
    key: "agreements", name: "Agreements and online signing", status: "live", plan: "pro",
    text: "An agreement generated from the deal, with standard and custom terms, and a link the client can sign online. Signing is electronic acceptance with an audit record of who signed and when; it is not a certified digital signature, and DealInSec gives no legal advice.",
  },
  {
    key: "invoices", name: "Invoices", status: "live", plan: "pro",
    text: "Invoices drawn from the agreement, single or split (for example an advance and a final payment), with your business and tax registration details printed. App invoices don't calculate tax and are not GST tax invoices.",
  },
  {
    key: "payment_tracking", name: "Payment tracking", status: "live", plan: "pro",
    text: "Record when an invoice is paid and see what is paid, pending and overdue. DealInSec records payments; it never collects or moves your clients' money.",
  },
  {
    key: "protection_check", name: "Protection Check", status: "live", plan: "all",
    text: "Flags risky or missing terms in a deal (no advance, unlimited revisions, no payment timeline and similar) and suggests what to ask, before you send anything. It reads the wording only and is not legal advice.",
  },
  {
    key: "assistant", name: "In-app AI assistant (Copilot and Agent mode)", status: "live", plan: "all",
    text: "Ask in plain words to find records, start an AI Outbound search, create a deal from a pasted brief, or prepare a quotation, agreement or invoice. It asks you to approve every change before it happens.",
  },
  {
    key: "team", name: "Team members and roles", status: "live", plan: "pro",
    text: `Invite teammates with roles and permissions and see an activity log. Pro and the trial include ${PRO_INCLUDED_SEATS} members; the free plan has one.`,
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
/** Free plan deals per month (users.monthlyDealCredits default; checked by the test). */
export const FREE_MONTHLY_DEALS = 4;

export const PRICING = {
  freeMonthlyDeals: FREE_MONTHLY_DEALS,
  trialDays: TRIAL_DAYS,
  proMonthlyInr: inr.monthly!.amount,
  extraSeatInr: EXTRA_SEAT_PRICE_INR,
  /** Who can buy a paid plan today. */
  checkout: "India only: paid plans are bought in Indian rupees through Razorpay (UPI, cards, netbanking) by a workspace in India. Outside India, including the United States, paid plans can't be bought yet; the free plan and the trial are open everywhere.",
} as const;

export const PRICING_LINES: readonly string[] = [
  `Free plan: ${OB.free.monthlySearches} AI Outbound searches a month (up to ${OB.free.maxCompanies} companies each), the leads pipeline, and ${PRICING.freeMonthlyDeals} deals a month, each with its quotation. Agreements, invoices and payment tracking are Pro. Permanent, no card.`,
  `${PRICING.trialDays}-day Pro trial: every new account gets the Pro workflow once it finishes setup (with ${OB.trial.monthlySearches} AI Outbound searches), with no card. It ends on its own and moves you to the free plan; nothing is charged.`,
  `DealInSec Pro: one plan that includes everything — AI Outbound with ${OB.pro.monthlySearches} searches a month (up to ${OB.pro.maxCompanies} companies each), the leads pipeline, unlimited deals, quotations, agreements with online signing, invoices, payment tracking and ${PRO_INCLUDED_SEATS} team members. ${rupees(PRICING.proMonthlyInr)} a month in India, paid once a month: it does not renew or charge automatically, you pay again to extend. There is no separate plan for AI Outbound or the CRM, and no annual plan. Extra team members are ${rupees(PRICING.extraSeatInr)} each a month.`,
  PRICING.checkout,
  "No platform fee or commission on your deal value.",
];

/** Promises no page, answer or file may make (the tests look for them). */
export const NEVER_CLAIM: readonly string[] = [
  "that DealInSec guarantees a client pays, or recovers money",
  "that it sends emails, follow-ups or reminders automatically",
  "that it collects or processes client payments",
  "that AI reads or classifies Gmail messages",
  "that paid plans can be bought outside India",
  "unlimited AI research, unlimited sending, or separate prices for AI Outbound or the CRM",
  "that Gmail is available to every workspace",
  "that its agreements are certified digital signatures, or that it is legally or tax compliant in any country",
  "integrations it does not have (Outlook, WhatsApp, Stripe, PayPal, Salesforce, HubSpot)",
  "user numbers, ratings, reviews or customer logos",
];

const STATUS_WORD: Record<CapabilityStatus, string> = { live: "Available now", limited: "Limited availability", not_available: "Not available" };

/**
 * The facts as a markdown document: the assistants' always-included knowledge ("product-facts") and the basis of the
 * llms.txt summary. Written so a model can answer "can it…?" with the status word first.
 */
export function productFactsMarkdown(): string {
  const byStatus = (s: CapabilityStatus) => CAPABILITIES.filter((c) => c.status === s)
    .map((c) => `- **${c.name}** (${STATUS_WORD[s]}${c.plan ? `, ${c.plan === "all" ? "every plan" : "Pro and trial"}` : ""}): ${c.text}`).join("\n");
  return `# ${PRODUCT_NAME}: verified product facts

${ONE_LINER} ${TAGLINE}

${SUMMARY}

## Who it is for
Primary: ${AUDIENCE_LINE}. Secondary (older pages and tools still exist): ${SECONDARY_AUDIENCE.join(" and ")}.
${MARKETS}

## The connected workflow
${WORKFLOW.join(" → ")}. AI Outbound is where new clients start; a won lead becomes a deal, and the deal carries through quotation, agreement, invoice and payment tracking.

## Available now
${byStatus("live")}

## Limited availability
${byStatus("limited")}

## Not available
${byStatus("not_available")}

## Pricing and checkout
${PRICING_LINES.map((l) => `- ${l}`).join("\n")}

## Never say
${NEVER_CLAIM.map((l) => `- Never claim ${l}.`).join("\n")}
If something isn't covered here, say you're not sure and point to ${SUPPORT_EMAIL}.
`;
}
