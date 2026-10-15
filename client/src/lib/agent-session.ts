/**
 * What Agent mode remembers on this device, so switching modes never loses anything:
 *   - the conversation the person was in (localStorage, per user): "Back to chat" and the switcher reopen it;
 *   - an unsent message per conversation (sessionStorage): survives a trip to another screen, not a closed tab;
 *   - the screen they left for the agent (sessionStorage): "Workspace" returns there.
 * Every read and write is guarded: private browsing or a full storage just means nothing is remembered.
 */
import { resumeTarget, returnTarget } from "@shared/agent-mode";

const LAST = (userId: string) => `dis_agent_last:${userId}`;
const DRAFT = (sessionId: string | null) => `dis_agent_draft:${sessionId ?? "new"}`;
const RETURN = "dis_agent_return";

const get = (s: Storage | undefined, k: string): string | null => { try { return s?.getItem(k) ?? null; } catch { return null; } };
const set = (s: Storage | undefined, k: string, v: string | null) => { try { if (v === null) s?.removeItem(k); else s?.setItem(k, v); } catch { /* not remembered */ } };
const local = () => (typeof window === "undefined" ? undefined : window.localStorage);
const session = () => (typeof window === "undefined" ? undefined : window.sessionStorage);

export function rememberConversation(userId: string | undefined, sessionId: string | null): void {
  if (userId) set(local(), LAST(userId), sessionId);
}
export const chatTarget = (userId: string | undefined): string => resumeTarget(userId ? get(local(), LAST(userId)) : null);

export const loadDraft = (sessionId: string | null): string => get(session(), DRAFT(sessionId)) ?? "";
export const saveDraft = (sessionId: string | null, text: string): void => set(session(), DRAFT(sessionId), text.trim() ? text : null);

/** Remember the screen the person is leaving for the agent (never the agent itself). */
export function rememberReturn(path: string): void {
  if (!path.startsWith("/agent")) set(session(), RETURN, path);
}
export const workspaceTarget = (): string => returnTarget(get(session(), RETURN));
