/**
 * A tiny hand-off between anything on the page (the dashboard composer, a
 * quick-action chip) and the Copilot drawer. The drawer is code-split, so it
 * may not have mounted when the request is made: the request waits here until
 * the drawer takes it, instead of being lost to an event nobody heard.
 */
export const COPILOT_EVENT = "dealinsec:copilot";

interface CopilotRequest {
  /** Sent as the user's first message. Omit to just open the drawer (briefing). */
  message?: string;
}

let pending: CopilotRequest | null = null;

export function askCopilot(message?: string): void {
  pending = { message: message?.trim() || undefined };
  window.dispatchEvent(new Event(COPILOT_EVENT));
}

export function takePendingCopilot(): CopilotRequest | null {
  const p = pending;
  pending = null;
  return p;
}
