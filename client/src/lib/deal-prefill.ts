/**
 * The sessionStorage key that hands a draft deal from one page to another —
 * the anonymous landing demo hands off to signup, and the authenticated
 * Copilot chat-to-deal flow hands off to the create-deal form. Same key, same
 * shape, on purpose: "continue the deal I already started" is one mechanism
 * regardless of where the draft came from.
 */
import { hasPendingOutboundPrefill } from "./outbound-prefill";

export const DEAL_PREFILL_KEY = "dis_deal_prefill";

export function hasPendingDealPrefill(): boolean {
  try {
    return !!sessionStorage.getItem(DEAL_PREFILL_KEY);
  } catch {
    return false;
  }
}

/** Where a successful auth (signup, login, or onboarding completion) should
 *  land: the create-deal form (which will consume and clear the prefill) if a
 *  demo deal is waiting, AI Outbound if the demo's client search is waiting,
 *  otherwise the ordinary dashboard. */
export function postAuthDestination(): "/deals/new" | "/outbound" | "/dashboard" {
  if (hasPendingDealPrefill()) return "/deals/new";
  return hasPendingOutboundPrefill() ? "/outbound" : "/dashboard";
}
