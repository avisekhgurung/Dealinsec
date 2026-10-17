/**
 * Wording that must not appear in any product description a person or an AI reads: the assistants' knowledge, the
 * chatbot prompt, /llms.txt, the homepage copy and FAQ, and structured data. Each pattern is a stale positioning or a
 * capability DealInSec doesn't have (shared/product-facts.ts NEVER_CLAIM). Used by the content-consistency tests.
 */
export const STALE_OR_UNSUPPORTED: RegExp[] = [
  /deal-management software for India's freelancers/i,
  /\bIndia's freelancers\b(?! use)/,
  /Solo professionals who quote, sign and bill/i,
  /\b(automatically|auto-?)\s?(send|sends|sending|emails?)\b/i,
  /\bsends? (your )?(emails?|follow-?ups?|reminders) automatically\b/i,
  /AI (reads|classifies|sorts|labels) (your |the )?(gmail|email|replies)/i,
  // An integration claimed, not denied: "integrates with HubSpot", "pay with Stripe" (but not "doesn't integrate with HubSpot").
  /(?<!(?:n't|not|never|no)\s)\b(?:integrates? with|connects? (?:to|with)|syncs? with|pay(?:s|ments)? (?:with|via|through)|checkout (?:with|via|through))\s(?:stripe|paypal|hubspot|salesforce|outlook|whatsapp)\b/i,
  /guaranteed payment|we guarantee/i,
  /coming soon/i,
];
