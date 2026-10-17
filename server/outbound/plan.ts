/**
 * Which AI Outbound allowance a workspace has: its billing owner's plan, read the way every other entitlement is
 * (server/entitlements.ts getBillingUser): paid Pro → "pro", an active trial → "trial", anything else → "free".
 */
import { hasActivePro, hasActiveTrial, type User } from "@shared/schema";
import type { OutboundTier } from "@shared/outbound-plans";
import { getBillingUser } from "../entitlements";
import type { Who } from "../services/leads";

export async function outboundTier(user: Who): Promise<OutboundTier> {
  const billing = await getBillingUser(user as User);
  if (hasActivePro(billing)) return "pro";
  if (hasActiveTrial(billing)) return "trial";
  return "free";
}
