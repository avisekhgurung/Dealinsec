/**
 * DealinSec Copilot — the compact entry to the Agent, on every workspace page.
 *
 * It is the same agent as the /agent page (one backend, one history), in a
 * drawer: it opens with the DAILY BRIEFING — deterministic intelligence
 * computed server-side from real rows, never invented — and becomes a
 * conversation as soon as the user asks for something. Every change the agent
 * proposes arrives as an approval card; nothing is sent to anyone on the user's
 * behalf.
 */
import { useEffect, useMemo, useState } from "react";
import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, X, Bot, Maximize2, RotateCcw } from "lucide-react";
import { getQueryFn } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useMoney } from "@/hooks/use-locale";
import { useAudience } from "@/hooks/use-audience";
import { useAgent } from "@/hooks/use-agent";
import { setUiMode } from "@/hooks/use-ui-mode";
import { COPILOT_EVENT, takePendingCopilot } from "@/lib/copilot-bus";
import { trackEvent } from "@/lib/analytics";
import { AgentConversation } from "@/components/agent/agent-conversation";
import { BriefingPanel, type Briefing } from "./briefing-panel";

function pageContext(route: string) {
  const dealMatch = route.match(/^\/deals\/(\d+)/);
  if (dealMatch) return { page: "deal-details", route, entityType: "deal", entityId: Number(dealMatch[1]) };
  const contractMatch = route.match(/^\/contracts\/(\d+)/);
  if (contractMatch) return { page: "agreement-details", route, entityType: "contract", entityId: Number(contractMatch[1]) };
  const invoiceMatch = route.match(/^\/brand-invoices\/(\d+)/);
  if (invoiceMatch) return { page: "invoice-details", route, entityType: "invoice", entityId: Number(invoiceMatch[1]) };
  return { page: route.split("/")[1] || "dashboard", route };
}

export function Copilot() {
  const { isAuthenticated } = useAuth();
  const account = useAudience();
  const { money } = useMoney();
  const [location, setLocation] = useLocation();
  const [open, setOpen] = useState(false);

  const ctx = useMemo(() => pageContext(location), [location]);
  const agent = useAgent({
    context: { page: ctx.page, route: ctx.route, dealId: ctx.entityType === "deal" ? ctx.entityId : undefined },
  });
  const onAgentPage = location.startsWith("/agent");

  const { data: briefing, isLoading: briefingLoading } = useQuery<Briefing>({
    queryKey: ["/api/copilot/briefing"],
    queryFn: getQueryFn({ on401: "returnNull" }) as any,
    enabled: isAuthenticated && open && agent.messages.length === 0,
    staleTime: 60_000,
  });

  useEffect(() => { if (open) trackEvent("agent_opened", { surface: "drawer" }); }, [open]);

  // The dashboard's "Daily Briefing" chip hands over through copilot-bus. This
  // component is code-split, so a request made before it mounted is waiting
  // there: take it on mount as well as on the event.
  useEffect(() => {
    const take = () => {
      const req = takePendingCopilot();
      if (!req) return;
      setOpen(true);
      if (req.message) void agent.send(req.message);
    };
    take();
    window.addEventListener(COPILOT_EVENT, take);
    return () => window.removeEventListener(COPILOT_EVENT, take);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The full page is the same conversation; two live copies would only confuse.
  useEffect(() => { if (onAgentPage) setOpen(false); }, [onAgentPage]);

  if (!isAuthenticated || onAgentPage) return null;

  const go = (to: string) => {
    setOpen(false);
    setLocation(to);
  };

  const contextPrompts =
    ctx.entityType === "deal"
      ? ["What should I do next on this deal?", "Run the Protection Check on this deal", "What's the payment status?"]
      : ctx.entityType === "invoice"
        ? ["Is this invoice overdue?", "Prepare a payment reminder"]
        : [];

  return (
    <>
      {/* The dashboard already has the big AI composer as its entry point —
          a second floating "Ask" pill next to it competes for the same
          attention, so it's hidden there specifically. Every other page
          (deal details, invoices, etc.) keeps it, since those have no
          composer of their own. */}
      {!open && location !== "/dashboard" && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          data-testid="copilot-button"
          aria-label="Open DealinSec Agent"
          className="fixed z-40 bottom-20 right-4 lg:bottom-6 lg:right-6 flex items-center gap-2 rounded-full pl-3.5 pr-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-600/30 hover:shadow-emerald-600/45 hover:-translate-y-0.5 transition-all"
          style={{ background: "linear-gradient(135deg, #10B981 0%, #059669 55%, #0D9488 100%)" }}
        >
          <Sparkles className="w-4 h-4 text-amber-300" />
          Ask DealinSec
        </button>
      )}

      {open && (
        <div
          // z-[60] on mobile so the sheet sits ABOVE the fixed bottom nav
          // (z-50) — otherwise the nav covers the composer and there's
          // nowhere visible to type.
          className="fixed z-[60] inset-0 sm:inset-auto sm:bottom-4 sm:right-4 sm:w-[420px] sm:h-[640px] sm:max-h-[calc(100vh-2rem)] flex flex-col sm:rounded-2xl border-0 sm:border sm:border-border bg-background shadow-2xl overflow-hidden animate-fade-in"
          data-testid="copilot-drawer"
          role="dialog"
          aria-label="DealinSec Agent"
        >
          <div
            className="flex items-center gap-2.5 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:pt-3 text-white shrink-0"
            style={{ background: "linear-gradient(135deg, hsl(160 84% 22%) 0%, hsl(174 70% 26%) 100%)" }}
          >
            <span className="w-8 h-8 rounded-xl bg-white/15 flex items-center justify-center">
              <Bot className="w-[18px] h-[18px]" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold leading-tight">DealInSec Agent</p>
              <p className="text-[11px] text-emerald-100/80 leading-tight">Your deals, handled in one conversation</p>
            </div>
            {agent.messages.length > 0 && (
              <button type="button" onClick={agent.reset} aria-label="New conversation" data-testid="copilot-new"
                className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/15 transition-colors">
                <RotateCcw className="w-4 h-4" />
              </button>
            )}
            <Link href={agent.sessionId ? `/agent/${agent.sessionId}` : "/agent"} onClick={() => { setOpen(false); setUiMode("agent"); }} aria-label="Switch to agent mode: chat and voice only" data-testid="copilot-expand"
              className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/15 transition-colors">
              <Maximize2 className="w-4 h-4" />
            </Link>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              data-testid="copilot-close"
              className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/15 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <AgentConversation
            agent={agent}
            compact
            extraPrompts={contextPrompts}
            emptyState={
              <div className="space-y-3" data-testid="copilot-empty">
                <BriefingPanel
                  briefing={briefing}
                  loading={briefingLoading}
                  money={money}
                  go={go}
                  onFollowUp={(invoiceNumber) => agent.send(`Prepare a professional payment follow-up for invoice ${invoiceNumber}`)}
                />
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {[...contextPrompts, `Which ${account.partyLower}s owe me money?`, "What can I invoice today?", "Show my pending work"].slice(0, 4).map((q) => (
                    <button key={q} type="button" onClick={() => agent.send(q)}
                      className="text-xs font-medium px-2.5 py-1.5 rounded-full border border-emerald-300/60 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10 transition-colors">
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            }
          />
        </div>
      )}
    </>
  );
}
