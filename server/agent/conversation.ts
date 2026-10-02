/**
 * The channel-agnostic conversation layer.
 *
 * One function, `converse`, takes a person, some text and a channel adapter, and
 * runs the agent. It knows nothing about HTTP, Server-Sent Events, a phone call
 * or an inbox: those are adapters that supply the text and decide how each event
 * reaches the user. The web is the first adapter (routes.ts); a voice adapter
 * would add speech-to-text before `converse` and text-to-speech on
 * `agent.message`; an email adapter would turn a message into a session and
 * queue the reply as a draft for approval. None of that touches the loop, the
 * policy or the tools.
 *
 * Everything with side effects is injected (ConversationDeps), so this module is
 * pure and tested with fakes; wiring.ts supplies the real database, model and
 * tools.
 */
import type { AIProvider } from "../copilot/provider";
import { agentLog } from "./log";
import { runAgent, type RunResult } from "./loop";
import type { AgentEvent, AgentStore, AgentTool, AgentUser, AutonomyLevel, Channel } from "./types";

/** How one channel talks to the user. */
export interface ChannelAdapter {
  readonly channel: Channel;
  /** Deliver one event in this channel's way: an SSE frame, a spoken sentence, a queued draft. */
  emit(event: AgentEvent): void;
  /** Aborts when the user has gone: a closed tab, a hung-up call. */
  readonly signal?: AbortSignal;
}

export interface SessionRef { id: string; title: string | null; dealId: number | null }

/** What the page or surface the person is on, as a hint. Advisory only: it is
 *  re-authorised wherever it is used. */
export interface ContextHint { page?: string; route?: string; dealId?: number }

export interface ConversationDeps {
  store: AgentStore;
  provider: AIProvider;
  tools: readonly AgentTool[];
  enabled(): boolean;
  takeQuota(userId: string): boolean;
  getSession(user: AgentUser, id: string): Promise<SessionRef | null>;
  createSession(user: AgentUser, channel: Channel): Promise<SessionRef>;
  /** The system prompts and the autonomy level for this turn — all derived on the server. */
  loadContext(args: { user: AgentUser & Record<string, any>; session: SessionRef; text: string; hint: ContextHint; channel: Channel }): Promise<{ systemMessages: string[]; autonomy: AutonomyLevel }>;
  /** One run at a time per conversation. Shared across calls. */
  locks?: Set<string>;
}

export type ConverseFailure = {
  ok: false;
  code: "unavailable" | "not_found" | "busy" | "quota" | "empty" | "too_long";
  message: string;
};
export type ConverseSuccess = { ok: true; sessionId: string; result: RunResult };

export const MAX_TEXT = 4000;
const defaultLocks = new Set<string>();

export const titleFrom = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 60);

const MESSAGES: Record<ConverseFailure["code"], string> = {
  unavailable: "The agent isn't available right now.",
  not_found: "Conversation not found",
  busy: "I'm still working on your last message.",
  quota: "Daily AI limit reached — try again tomorrow.",
  empty: "Type a message",
  too_long: "That message is too long",
};
const fail = (code: ConverseFailure["code"]): ConverseFailure => ({ ok: false, code, message: MESSAGES[code] });

/**
 * Run one turn of a conversation. Failures that happen BEFORE the agent starts
 * (no such conversation, still busy, over quota) come back as a typed failure
 * with no events emitted, so each adapter can report them its own way. Once the
 * agent has started, everything — including an unexpected error — is delivered
 * as events and the result is ok.
 */
export async function converse(
  deps: ConversationDeps,
  input: { user: AgentUser & Record<string, any>; text: string; adapter: ChannelAdapter; sessionId?: string | null; context?: ContextHint },
): Promise<ConverseSuccess | ConverseFailure> {
  const { user, adapter } = input;
  const text = input.text.trim();
  if (!text) return fail("empty");
  if (text.length > MAX_TEXT) return fail("too_long");
  if (!deps.enabled()) return fail("unavailable");

  const session = input.sessionId
    ? await deps.getSession(user, input.sessionId)
    : await deps.createSession(user, adapter.channel);
  if (!session) return fail("not_found");

  const locks = deps.locks ?? defaultLocks;
  if (locks.has(session.id)) return fail("busy");
  if (!deps.takeQuota(user.id)) return fail("quota");

  locks.add(session.id);
  try {
    const { systemMessages, autonomy } = await deps.loadContext({ user, session, text, hint: input.context ?? {}, channel: adapter.channel });
    if (!session.title) await deps.store.setSessionState(session.id, "UNDERSTANDING", titleFrom(text));
    const result = await runAgent(
      { provider: deps.provider, store: deps.store, tools: deps.tools, systemMessages, autonomy },
      { sessionId: session.id, user, text, channel: adapter.channel },
      adapter.emit,
      adapter.signal,
    );
    return { ok: true, sessionId: session.id, result };
  } catch (err) {
    agentLog("error", { errorType: (err as Error)?.name ?? "Error", where: "converse" });
    const message = "Something went wrong on our side. Nothing was changed.";
    adapter.emit({ type: "agent.failed", runId: "", seq: 0, at: new Date().toISOString(), data: { code: "internal", message } });
    return { ok: true, sessionId: session.id, result: { runId: "", status: "failed", reply: message, cards: [], approvalIds: [] } };
  } finally {
    locks.delete(session.id);
  }
}
