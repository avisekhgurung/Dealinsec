import { DEAL_SUITE_HIDDEN } from "./flags";
/**
 * The "Get started" checklist: what a new account does first, in the order that
 * fits what the person said they want to do (their first goal, asked during
 * onboarding).
 *
 * Pure: no React, no DOM, no storage. The goal itself lives in the browser
 * (client/src/lib/first-goal.ts); whether each step is done is DERIVED from the
 * account's real records every time, so the list resumes by itself on any
 * device and can never claim progress that didn't happen.
 *
 * Copy rule: DealInSec does not send email and does not collect payments. A
 * step may say the person sends a message from their own email app, or that
 * DealInSec tracks a payment's status; never more than that.
 */

export const FIRST_GOALS = ["find_clients", "manage_deals", "get_paid"] as const;
export type FirstGoal = (typeof FIRST_GOALS)[number];

export function isFirstGoal(x: unknown): x is FirstGoal {
  return typeof x === "string" && (FIRST_GOALS as readonly string[]).includes(x);
}

export const FIRST_GOAL_META: Record<FirstGoal, { label: string; description: string }> = {
  find_clients: {
    label: "Find new clients",
    description: "Research companies that fit, with evidence, and prepare first messages you approve.",
  },
  manage_deals: {
    label: "Manage active deals",
    description: "Keep every lead and deal in one pipeline with a clear next step.",
  },
  get_paid: {
    label: "Send quotations and get paid",
    description: "Quote, agree terms, invoice and track payment for work you've already won.",
  },
};

/** Counts from the account's records. null = unknown (the query failed or
 *  isn't available), which is never read as zero. */
export interface Facts {
  outboundRuns: number | null;
  leads: number | null;
  /** Leads at stage "contacted" or later. */
  contactedLeads: number | null;
  deals: number | null;
  quotations: number | null;
  agreements: number | null;
  invoices: number | null;
  paidInvoices: number | null;
}

/** Which modules the person can reach (the nav's canSeeModule answers).
 *  `quotations` falls back to `deals`: a quotation is made from a deal. */
export interface ChecklistAccess {
  outbound: boolean;
  leads: boolean;
  deals: boolean;
  quotations?: boolean;
  agreements: boolean;
  invoices: boolean;
}

export type StepId =
  | "run_search" | "add_lead" | "first_message" | "first_deal" | "quote_flow"
  | "add_pipeline" | "send_quote" | "agreement" | "invoice" | "record_payment";

export interface ChecklistStep {
  id: StepId;
  title: string;
  detail: string;
  href: string;
  /** true / false from real records; null when a fact is unknown. */
  done: boolean | null;
  /** The last step of each list points at the rest of the product. It is a
   *  suggestion, not part of getting started. */
  discovery: boolean;
}

const has = (n: number | null): boolean | null => (n === null ? null : n > 0);

/** Either count above zero is enough; unknown only when neither says yes and
 *  at least one is unknown. */
const either = (a: number | null, b: number | null): boolean | null => {
  if ((a ?? 0) > 0 || (b ?? 0) > 0) return true;
  return a === null || b === null ? null : false;
};

type Draft = Omit<ChecklistStep, "discovery"> & { module: keyof ChecklistAccess; discovery?: boolean };

export function checklistFor(goal: FirstGoal | null, facts: Facts, can: ChecklistAccess): ChecklistStep[] {
  const firstDeal = (title: string, detail: string): Draft => ({
    id: "first_deal", module: "deals", href: "/deals/new", done: has(facts.deals), title, detail,
  });
  const sendQuote: Draft = {
    id: "send_quote", module: "quotations", href: "/quotations", done: has(facts.quotations),
    title: "Send a quotation",
    detail: "Share a quotation your client can open and accept from a link.",
  };
  const discoverSearch: Draft = {
    id: "run_search", module: "outbound", href: "/outbound", done: has(facts.outboundRuns), discovery: true,
    title: "Find new clients with Client Radar",
    detail: "Research companies that fit what you do, with evidence for why now.",
  };

  let drafts: Draft[];
  if (goal === "find_clients" || goal === null) {
    // Finding clients is the product's face, so it is also the default when no goal was chosen.
    drafts = [
      {
        id: "run_search", module: "outbound", href: "/outbound", done: has(facts.outboundRuns),
        title: "Run your first client search",
        detail: "Describe who you want to work with. Client Radar finds companies that fit and shows the evidence.",
      },
      {
        id: "add_lead", module: "leads", href: "/leads", done: has(facts.leads),
        title: "Add a company to Leads",
        detail: "Save a company from a search, or add one you already know.",
      },
      {
        id: "first_message", module: "leads", href: "/leads", done: has(facts.contactedLeads),
        title: "Approve and send a first message",
        detail: "Review the drafted message, send it from your own email app, then mark it sent.",
      },
      // With the deal suite hidden (shared/flags.ts), finding and winning the conversation IS the journey.
      ...(DEAL_SUITE_HIDDEN ? [] : [
        firstDeal("Turn a reply into a deal", "When a company is interested, create a deal for the work."),
        {
          id: "quote_flow", module: "quotations", href: "/deals", done: has(facts.quotations), discovery: true,
          title: "Then quote, agree terms and get paid",
          detail: "From a deal you can send a quotation, get the agreement signed and track the invoice.",
        } as Draft,
      ]),
    ];
  } else if (goal === "manage_deals") {
    drafts = [
      {
        id: "add_pipeline", module: "leads", href: "/leads", done: either(facts.leads, facts.deals),
        title: "Add your first lead or deal",
        detail: "Put a company you're talking to in your pipeline, so its next step isn't lost.",
      },
      firstDeal("Create a deal", "Record the client, the work and the amount."),
      sendQuote,
      discoverSearch,
    ];
  } else {
    // get_paid.
    drafts = [
      firstDeal("Create a deal for work you've won", "Add the client, the work and the amount. Everything else starts from here."),
      sendQuote,
      {
        id: "agreement", module: "agreements", href: "/contracts", done: has(facts.agreements),
        title: "Get the agreement signed",
        detail: "Turn the deal into an agreement your client signs online.",
      },
      {
        id: "invoice", module: "invoices", href: "/invoices", done: has(facts.invoices),
        title: "Create an invoice",
        detail: "Raise it from the deal, with your payment details on it, ready to share.",
      },
      {
        id: "record_payment", module: "invoices", href: "/invoices", done: has(facts.paidInvoices),
        title: "Record a payment",
        detail: "Mark the invoice paid when the money arrives. DealInSec tracks payment status; your client pays you directly.",
      },
      discoverSearch,
    ];
  }

  const allowed = (m: keyof ChecklistAccess) => (m === "quotations" ? can.quotations ?? can.deals : can[m]);
  return drafts
    .filter((d) => allowed(d.module))
    .map(({ module: _m, discovery, ...s }) => ({ ...s, discovery: !!discovery }));
}

export interface ChecklistState {
  total: number;
  done: number;
  /** Every step known and done. An unknown step is never complete. */
  complete: boolean;
  anyUnknown: boolean;
}

export function checklistState(steps: ChecklistStep[]): ChecklistState {
  const done = steps.filter((s) => s.done === true).length;
  const anyUnknown = steps.some((s) => s.done === null);
  return { total: steps.length, done, complete: !anyUnknown && done === steps.length, anyUnknown };
}

/** Where onboarding lands someone who chose this goal. No goal lands on Client Radar: the product's first promise.
 *  With the deal suite hidden, the deal-first goals can't be chosen and everything lands on finding clients. */
export function destinationFor(goal: FirstGoal | null): "/outbound" | "/deals/new" | "/leads" {
  if (DEAL_SUITE_HIDDEN) return goal === "manage_deals" ? "/leads" : "/outbound";
  switch (goal) {
    case "get_paid": return "/deals/new";
    case "manage_deals": return "/leads";
    default: return "/outbound";
  }
}
