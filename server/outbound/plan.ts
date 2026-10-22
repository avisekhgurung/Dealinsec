/**
 * Which Client Radar allowance a workspace has: its billing owner's plan, read the way every other entitlement is
 * (server/entitlements.ts getBillingUser): paid Pro → "pro", an active trial → "trial", anything else → "free"; a
 * workspace in UNLIMITED_ORG_IDS → "unlimited" (server/unlimited.ts).
 */
import { hasActivePro, hasActiveTrial, type User } from "@shared/schema";
import type { OutboundTier } from "@shared/outbound-plans";
import { getBillingUser } from "../entitlements";
import type { Who } from "../services/leads";
import { isUnlimitedOrg } from "../unlimited";

export async function outboundTier(user: Who): Promise<OutboundTier> {
  // A workspace the server lists as unlimited (UNLIMITED_ORG_IDS), whatever its billing owner's plan.
  if (isUnlimitedOrg(user.organizationId)) return "unlimited";
  const billing = await getBillingUser(user as User);
  if (hasActivePro(billing)) return "pro";
  if (hasActiveTrial(billing)) return "trial";
  return "free";
}

/** AI-written first messages: their prompt version starts with "draft-" (template follow-ups are "followup-…"). What the AI-draft allowance counts. */
export const AI_DRAFT_VERSION_PREFIX = "draft-";
