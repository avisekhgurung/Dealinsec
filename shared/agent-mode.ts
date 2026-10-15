/**
 * The rules behind switching between the Workspace (every screen) and Agent mode (one conversation), kept pure so
 * they're tested: where each switch lands, and what a decline's answer means. The UI (components/mode-switch.tsx,
 * hooks/use-agent.ts) only applies them.
 */
const SESSION_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Where "Agent" (or "Back to chat") goes: the conversation the person was in, or a new one. */
export function resumeTarget(lastSessionId: string | null | undefined): string {
  return lastSessionId && SESSION_ID.test(lastSessionId) ? `/agent/${lastSessionId}` : "/agent";
}

/**
 * Where "Workspace" goes from the agent: back to the screen the person left for the agent, or the dashboard. Only a
 * plain in-app path counts (no other origin, no protocol-relative URL, never the agent itself or a public document).
 */
export function returnTarget(stored: string | null | undefined): string {
  if (!stored || typeof stored !== "string" || stored.length > 300) return "/dashboard";
  if (!stored.startsWith("/") || stored.startsWith("//") || /[\s\\]/.test(stored)) return "/dashboard";
  if (/^\/(agent|auth|onboarding|s|d)(\/|\?|$)/.test(stored) || stored === "/") return "/dashboard";
  return stored;
}

/**
 * What declining an approval did, from the server's answer: "declined" (it's recorded), "expired" (the request is
 * gone: 404/410), or "retry" (we don't know: a network failure or server error, so nothing is assumed and the person
 * can decline again).
 */
export function rejectOutcome(status: number | null): "declined" | "expired" | "retry" {
  if (status !== null && status >= 200 && status < 300) return "declined";
  if (status === 404 || status === 410) return "expired";
  return "retry";
}
