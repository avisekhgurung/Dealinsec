/**
 * The real dependencies for the conversation layer: the database store, the
 * DeepSeek provider, the tool registry, the daily quota, and the per-turn
 * context (prompts, knowledge, the deal the person is looking at).
 * Imports the database, so it is never imported by tests of the pure layer.
 */
import { aiProvider, copilotConfigured } from "../copilot/provider";
import { takeQuota } from "../copilot/quota";
import type { ConversationDeps } from "./conversation";
import { buildTurnContext } from "./context";
import { agentStore } from "./store";
import { AGENT_TOOLS } from "./tools";

export const conversationDeps: ConversationDeps = {
  store: agentStore,
  provider: aiProvider,
  tools: AGENT_TOOLS,
  enabled: copilotConfigured,
  takeQuota,
  // Coworker chats count toward the workspace's 30-day AI spend ceiling (12 Nov 2026). A ceiling that can't be read
  // lets the turn go (the daily message quota still bounds it); every other AI call fails closed on its own.
  async withinBudget(user) {
    try {
      const orgId = user.organizationId as string | undefined;
      if (!orgId) return true;
      const [{ traceStore }, { workspaceMonthlySpendMicroUsd }] = await Promise.all([import("../llm/trace-store"), import("../outbound/limits")]);
      const since = new Date(Date.now() - 30 * 86_400_000);
      return (await traceStore.workspaceSpend(orgId, since)) < workspaceMonthlySpendMicroUsd(process.env, orgId);
    } catch { return true; }
  },
  getSession: async (user, id) => {
    const s = await agentStore.getSession(user, id);
    return s ? { id: s.id, title: s.title, dealId: s.dealId } : null;
  },
  createSession: async (user, channel) => {
    const s = await agentStore.createSession(user, { channel });
    return { id: s.id, title: s.title, dealId: s.dealId };
  },
  async loadContext({ user, session, text, hint, channel }) {
    const [{ systemMessages }, autonomy] = await Promise.all([
      buildTurnContext({ user, sessionDealId: session.dealId, text, hint, channel }),
      agentStore.getAutonomy(user.organizationId as string),
    ]);
    return { systemMessages, autonomy };
  },
};
