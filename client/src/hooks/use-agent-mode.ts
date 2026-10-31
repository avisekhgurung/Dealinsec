/**
 * Is the old single-agent chat ("Agent mode", /agent) switched on for this server? The Nest's coworkers are the
 * product's AI surface; Agent mode is hidden unless the server sets AGENT_MODE_ENABLED=true (server/agent/routes.ts).
 *
 * Tri-state on purpose: `undefined` while the answer isn't known yet. Entry points show only on `true` (no flash of
 * a button that then vanishes), but a /agent deep link is bounced only on a definite `false`, so a slow network
 * never throws a legitimate visitor off the page.
 */
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";

export function useAgentModeEnabled(): boolean | undefined {
  const { isAuthenticated } = useAuth();
  const { data } = useQuery<{ enabled: boolean }>({ queryKey: ["/api/agent/status"], staleTime: 5 * 60_000, enabled: isAuthenticated });
  return data ? data.enabled === true : undefined;
}
