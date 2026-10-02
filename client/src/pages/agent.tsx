/**
 * The Agent workspace: one conversation, the app's own tools, and a human
 * decision wherever it matters. Built beside the dashboard, not instead of it —
 * every existing screen keeps working exactly as before.
 *
 * Phones get a chat-style full screen (its own header, no bottom tab bar, so the
 * composer owns the bottom edge); desktop gets the conversation history beside
 * the thread.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, History, Plus, Sparkles } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AgentConversation } from "@/components/agent/agent-conversation";
import { AutonomyControl } from "@/components/agent/autonomy-control";
import { HistoryList } from "@/components/agent/history-list";
import { useAgent } from "@/hooks/use-agent";
import { takePendingAgentMessage } from "@/lib/agent-bus";
import { trackEvent } from "@/lib/analytics";

interface AgentStatus { enabled: boolean; tablesReady: boolean; providerConfigured: boolean }

export default function AgentPage() {
  const params = useParams<{ id?: string }>();
  const [, navigate] = useLocation();
  const [historyOpen, setHistoryOpen] = useState(false);

  const agent = useAgent({
    sessionId: params.id ?? null,
    context: { page: "agent", route: "/agent" },
    // The URL follows the conversation, so a reload or a shared tab reopens it.
    onSessionChange: (id) => navigate(id ? `/agent/${id}` : "/agent", { replace: true }),
  });

  const { data: status } = useQuery<AgentStatus>({ queryKey: ["/api/agent/status"], staleTime: 60_000 });
  const unavailable = status && !status.enabled
    ? status.providerConfigured === false
      ? "The AI service isn't set up on this server yet."
      : "The agent isn't switched on for this server yet."
    : null;

  useEffect(() => { trackEvent("agent_opened", { surface: "page" }); }, []);

  // A message handed over from the dashboard composer: send it once.
  const taken = useRef(false);
  useEffect(() => {
    if (taken.current) return;
    taken.current = true;
    const pending = takePendingAgentMessage();
    if (pending) void agent.send(pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = (id: string) => { setHistoryOpen(false); navigate(`/agent/${id}`); };
  const fresh = () => { setHistoryOpen(false); agent.reset(); };

  return (
    <div className="flex h-[100dvh] min-h-0 bg-background lg:h-[calc(100dvh-var(--dis-topnav-h))]" data-testid="agent-page">
      <aside className="hidden w-72 shrink-0 border-r border-border/70 bg-muted/20 lg:block">
        <HistoryList activeId={agent.sessionId} onOpen={open} onNew={fresh} onDeleted={(id) => { if (id === agent.sessionId) agent.reset(); }} />
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-2 border-b border-border/70 px-3 py-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] sm:px-5 lg:pt-2.5">
          <Link href="/dashboard" aria-label="Back to the dashboard" className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted lg:hidden">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <span className="hidden h-8 w-8 items-center justify-center rounded-lg bg-emerald-600/10 text-emerald-700 dark:text-emerald-400 sm:flex"><Sparkles className="h-4 w-4" /></span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-bold leading-tight">DealInSec Agent</h1>
            <p className="hidden truncate text-xs text-muted-foreground sm:block">Your deals, handled in one conversation</p>
          </div>
          <AutonomyControl />
          <button type="button" onClick={() => setHistoryOpen(true)} aria-label="Conversations" data-testid="agent-history-open"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-foreground/80 transition hover:bg-muted/60 lg:hidden">
            <History className="h-4 w-4" />
          </button>
          <button type="button" onClick={fresh} aria-label="New conversation" data-testid="agent-new-header"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-foreground/80 transition hover:bg-muted/60 lg:hidden">
            <Plus className="h-4 w-4" />
          </button>
        </header>

        <AgentConversation agent={agent} disabledReason={unavailable} />
      </main>

      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent side="left" className="w-[min(20rem,88vw)] p-0">
          <SheetHeader className="border-b px-4 py-3"><SheetTitle className="text-base">Conversations</SheetTitle></SheetHeader>
          <div className="h-[calc(100%-3.25rem)]">
            <HistoryList activeId={agent.sessionId} onOpen={open} onNew={fresh} onDeleted={(id) => { if (id === agent.sessionId) agent.reset(); }} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
