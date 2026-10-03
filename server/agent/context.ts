/**
 * What the model is told on one turn: the system prompt (identity, rules, the
 * account's money voice, the channel's style), the product knowledge for this
 * message, and the facts block (date, user, page, the deal being looked at).
 *
 * Everything is derived on the server. Shared by the real wiring (wiring.ts)
 * and the live evaluation harness, so a prompt change is measured on exactly
 * what production sends. Needs storage for the account's locale and audience
 * (replaced by the in-memory world in evaluations), but not the agent tables.
 */
import { normalizeAudience } from "@shared/audience";
import { retrieveKnowledge } from "../copilot/knowledge";
import { readDenial } from "../copilot/readAccess";
import { copilotSettings, getDealJourney } from "../copilot/workflow";
import { storage } from "../storage";
import type { ContextHint } from "./conversation";
import { agentContextBlock, agentSystemPrompt } from "./prompt";
import type { AgentUser, Channel } from "./types";

export async function buildTurnContext(args: {
  user: AgentUser & Record<string, any>;
  /** The conversation's bound deal, if any. */
  sessionDealId: number | null;
  text: string;
  hint: ContextHint;
  channel: Channel;
}): Promise<{ systemMessages: string[] }> {
  const { user, text, hint, channel } = args;
  const [settings, org] = await Promise.all([
    copilotSettings(user as any),
    user.organizationId ? storage.getOrganization(user.organizationId) : undefined,
  ]);
  const audience = normalizeAudience(org?.audience);

  // The conversation's deal, or the page's: advisory, and re-authorised here
  // (the journey itself is organization-checked, and the member must be allowed
  // to read deals).
  const dealId = args.sessionDealId ?? hint.dealId;
  const journey = dealId && !readDenial("get_workflow_status", user)
    ? await getDealJourney(dealId, user as any, settings)
    : null;

  return {
    systemMessages: [
      agentSystemPrompt(settings, audience, channel),
      `PRODUCT KNOWLEDGE (authoritative):\n${retrieveKnowledge(text)}`,
      agentContextBlock({
        today: new Date().toISOString().slice(0, 10),
        firstName: user.firstName,
        role: user.orgRole,
        customRole: !!user.customPermissions,
        page: hint.page, route: hint.route, journey,
      }),
    ],
  };
}
