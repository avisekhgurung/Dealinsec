/**
 * "Ask DealInSec", the landing page's product guide: what it opens with and the questions it suggests. Shared so the
 * chatbot's tests and its answer check (script/eval-ask-dealinsec.ts) ask exactly what visitors see.
 */
export const ASK_OPENER =
  "Ask me anything about DealInSec — how it helps an agency find clients, how a prospect becomes a paid deal, what it costs and what's available today.";

export const ASK_SUGGESTIONS = [
  "How can DealInSec help my SEO agency find clients?",
  "How does AI Outbound work?",
  "Can I turn a prospect into a quotation and invoice?",
  "Does DealInSec send emails automatically?",
  "Can I use DealInSec from the US or India?",
  "Which payment methods are currently supported?",
] as const;

/** Shown after a couple of answers: a real next step, true for every visitor. */
export const ASK_CTA_TEXT = "The quickest way to see it: research a few prospects and run one deal through. Free plan, no card.";
export const ASK_CTA_LABEL = "Start free";
