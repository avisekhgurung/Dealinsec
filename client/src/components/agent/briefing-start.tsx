/** The daily briefing the agent page opens with: money to chase, what is ready to invoice, what needs you. Computed server-side from real rows. */
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { getQueryFn } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useMoney } from "@/hooks/use-locale";
import { BriefingPanel, type Briefing } from "@/components/agent/briefing-panel";

export function BriefingStart({ onFollowUp }: { onFollowUp: (invoiceNumber: string) => void }) {
  const { isAuthenticated } = useAuth();
  const { money } = useMoney();
  const [, setLocation] = useLocation();
  const { data, isLoading } = useQuery<Briefing>({
    queryKey: ["/api/copilot/briefing"],
    queryFn: getQueryFn({ on401: "returnNull" }) as any,
    enabled: isAuthenticated,
    staleTime: 60_000,
  });
  return (
    <div className="mx-auto w-full max-w-3xl px-3 pt-4" data-testid="agent-briefing">
      <BriefingPanel briefing={data} loading={isLoading} money={money} go={setLocation} onFollowUp={onFollowUp} />
    </div>
  );
}
