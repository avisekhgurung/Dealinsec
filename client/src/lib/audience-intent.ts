import { isAudience, type Audience } from "@shared/audience";

/**
 * The work type a visitor picked before signing up (the homepage's two audience
 * cards, or the demo's client/brand selector). Onboarding preselects it, so the
 * question isn't asked twice; the person can still change it. sessionStorage, so
 * it lasts for the tab and no longer.
 */
export const AUDIENCE_INTENT_KEY = "dis_audience_intent";

export function rememberAudienceIntent(audience: Audience): void {
  try {
    sessionStorage.setItem(AUDIENCE_INTENT_KEY, audience);
  } catch {
    /* private mode: onboarding simply asks */
  }
}

export function readAudienceIntent(): Audience | null {
  try {
    const v = sessionStorage.getItem(AUDIENCE_INTENT_KEY);
    return isAudience(v) ? v : null;
  } catch {
    return null;
  }
}
