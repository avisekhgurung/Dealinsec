/**
 * Hand-off from anywhere in the app (the dashboard composer, a chip) to the
 * Agent page: the page is code-split and may not be mounted yet, so the
 * message waits here until it takes it.
 */
let pending: string | null = null;

export function setPendingAgentMessage(message: string): void {
  pending = message.trim() || null;
}

export function takePendingAgentMessage(): string | null {
  const p = pending;
  pending = null;
  return p;
}

/**
 * Where the person was when they opened the agent (a deal, an agreement, an invoice), so the
 * agent starts with that in mind. Read at render, cleared on mount (a double render must not lose it).
 */
let origin: string | null = null;
export function setAgentOrigin(route: string): void { origin = route; }
export const peekAgentOrigin = (): string | null => origin;
export const clearAgentOrigin = (): void => { origin = null; };
