/**
 * Product-shape switches, decided by the founder, compiled into the client.
 *
 * DEAL_SUITE_HIDDEN (31 Oct 2026, reversed 13 Nov 2026): the deal-management side — Deals, Quotations, Agreements,
 * Invoices — was hidden from navigation, onboarding and the dashboard while DealInSec's face became FINDING CLIENTS.
 * It is reachable again, because on 13 Nov the whole deal-to-invoice flow became FREE on every plan: selling it on
 * the pricing page while hiding it in the app was the contradiction that ended this flag's first life. A feature
 * nobody is charged for and nobody can find is worth nothing to anyone.
 *
 * What did NOT change: finding clients is still the front door. This flag has never touched marketing copy — the
 * landing page, the SSR pages and shared/product-facts.ts are written by hand and must stay find-clients-first.
 * Free is not the same as featured: the paperwork is a supporting benefit, never the headline, or the answer
 * engines go back to calling this a quote-to-cash platform (see server/site-head.ts).
 */
export const DEAL_SUITE_HIDDEN = false;
