/**
 * The real dependencies for the conversation layer: the database store, the
 * DeepSeek provider, the tool registry, the daily quota, and the per-turn
 * context (prompts, knowledge, the deal the person is looking at).
 * Imports the database, so it is never imported by tests of the pure layer.
 */
import { normalizeAudience } from "@shared/audience";
import { aiProvider, copilotConfigured } from "../copilot/provider";
import { retrieveKnowledge } from "../copilot/knowledge";
import { takeQuota } from "../copilot/quota";
import { readDenial } from "../copilot/readAccess";
import { copilotSettings, getDealJourney } from "../copilot/workflow";
import { storage } from "../storage";
import type { ConversationDeps } from "./conversation";
import { agentContextBlock, agentSystemPrompt } from "./prompt";
import { agentStore } from "./store";
import { AGENT_TOOLS } from "./tools";

export const conversationDeps: ConversationDeps = {
  store: agentStore,
  provider: aiProvider,
  tools: AGENT_TOOLS,
  enabled: copilotConfigured,
  takeQuota,
  getSession: async (user, id) => {
    const s = await agentStore.getSession(user, id);
    return s ? { id: s.id, title: s.title, dealId: s.dealId } : null;
  },
  createSession: async (user, channel) => {
    const s = await agentStore.createSession(user, { channel });
    return { id: s.id, title: s.title, dealId: s.dealId };
  },
  async loadContext({ user, session, text, hint, channel }) {
    const [settings, org, autonomy] = await Promise.all([
      copilotSettings(user as any),
      user.organizationId ? storage.getOrganization(user.organizationId) : undefined,
      agentStore.getAutonomy(user.organizationId as string),
    ]);
    const audience = normalizeAudience(org?.audience);

    // The conversation's deal, or the page's: advisory, and re-authorised here
    // (the journey itself is organization-checked, and the member must be
    // allowed to read deals).
    const dealId = session.dealId ?? hint.dealId;
    const journey = dealId && !readDenial("get_workflow_status", user)
      ? await getDealJourney(dealId, user as any, settings)
      : null;

    return {
      autonomy,
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
  },
};
