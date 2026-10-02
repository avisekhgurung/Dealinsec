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
