/**
 * The Agent workspace: one conversation, the app's own tools, and a human
 * decision wherever it matters. Built beside the dashboard, not instead of it —
 * every existing screen keeps working exactly as before.
 *
 * Phones get a chat-style full screen (its own header, no bottom tab bar, so the
 * composer owns the bottom edge); desktop gets the conversation history beside
 * the thread.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, History, LayoutDashboard, Phone, Plus, Sparkles, Volume2, VolumeX } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AgentConversation } from "@/components/agent/agent-conversation";
import { BriefingStart } from "@/components/agent/briefing-start";
import { AutonomyControl } from "@/components/agent/autonomy-control";
import { HistoryList } from "@/components/agent/history-list";
import { useAgent } from "@/hooks/use-agent";
import { useMoney } from "@/hooks/use-locale";
import { setUiMode, useUiMode } from "@/hooks/use-ui-mode";
import { useSpeechOutput } from "@/hooks/use-voice";
import { voiceCallSupported } from "@/hooks/use-voice-call";
import { VoiceCall } from "@/components/agent/voice-call";
import { useAuth } from "@/hooks/useAuth";
import { clearAgentOrigin, peekAgentOrigin, takePendingAgentMessage } from "@/lib/agent-bus";
import { contextPrompts, pageContext } from "@shared/page-context";
import { trackEvent } from "@/lib/analytics";

interface AgentStatus { enabled: boolean; tablesReady: boolean; providerConfigured: boolean }

export default function AgentPage() {
  const params = useParams<{ id?: string }>();
  const [, navigate] = useLocation();
  const [historyOpen, setHistoryOpen] = useState(false);
  // Agent mode: this page IS the app (no navigation bars). App mode: the same page inside the dashboard shell.
  const focus = useUiMode() === "agent";
  const { locale } = useMoney();
  const speech = useSpeechOutput(locale);
  const { user } = useAuth();
  const [callOpen, setCallOpen] = useState(false);
  const canCall = voiceCallSupported();
  const toDashboard = () => { setUiMode("app"); navigate("/dashboard"); };

  // Where the person was when they opened the agent (a deal, an invoice): it starts with that in mind.
  const [origin] = useState(() => peekAgentOrigin());
  useEffect(() => { clearAgentOrigin(); }, []);
  const ctx = useMemo(() => (origin ? pageContext(origin) : null), [origin]);

  const agent = useAgent({
    sessionId: params.id ?? null,
    context: ctx ? { page: ctx.page, route: ctx.route, dealId: ctx.entityType === "deal" ? ctx.entityId : undefined } : { page: "agent", route: "/agent" },
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

  // Read the agent's finished reply aloud (when the person has turned that on).
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !agent.running && speech.enabled && !callOpen) {
      const last = [...agent.messages].reverse().find((m) => m.role === "assistant");
      if (last?.content) speech.speak(last.content);
    }
    wasRunning.current = agent.running;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.running]);

  const open = (id: string) => { setHistoryOpen(false); navigate(`/agent/${id}`); };
  const fresh = () => { setHistoryOpen(false); agent.reset(); };

  return (
    <div className={focus ? "flex h-[100dvh] min-h-0 bg-background" : "flex h-[100dvh] min-h-0 bg-background lg:h-[calc(100dvh-var(--dis-topnav-h))]"} data-testid="agent-page" data-mode={focus ? "agent" : "app"}>
      <aside className="hidden w-72 shrink-0 border-r border-border/70 bg-muted/20 lg:block">
        <HistoryList activeId={agent.sessionId} onOpen={open} onNew={fresh} onDeleted={(id) => { if (id === agent.sessionId) agent.reset(); }} />
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-2 border-b border-border/70 px-3 py-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] sm:px-5 lg:pt-2.5">
          {focus ? (
            <button type="button" onClick={toDashboard} aria-label="Open the dashboard" data-testid="agent-to-dashboard"
              className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-semibold text-foreground/80 transition hover:bg-muted/60">
              <LayoutDashboard className="h-4 w-4" /><span className="hidden sm:inline">Dashboard</span>
            </button>
          ) : (
            <Link href="/dashboard" aria-label="Back to the dashboard" className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted lg:hidden">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          )}
          <span className="hidden h-8 w-8 items-center justify-center rounded-lg bg-emerald-600/10 text-emerald-700 dark:text-emerald-400 sm:flex"><Sparkles className="h-4 w-4" /></span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-bold leading-tight">DealInSec Agent</h1>
            <p className="hidden truncate text-xs text-muted-foreground sm:block">Your deals, handled in one conversation</p>
          </div>
          {canCall && (
            <button type="button" onClick={() => setCallOpen(true)} aria-label="Start a voice call" data-testid="agent-call"
              className="flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white transition hover:bg-emerald-700">
              <Phone className="h-4 w-4" /><span className="hidden sm:inline">Call</span>
            </button>
          )}
          {speech.supported && (
            <button type="button" onClick={() => speech.setEnabled(!speech.enabled)} aria-pressed={speech.enabled} aria-label={speech.enabled ? "Stop reading replies aloud" : "Read replies aloud"} data-testid="agent-voice-out"
              className={`flex h-9 w-9 items-center justify-center rounded-lg border transition ${speech.enabled ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" : "border-border text-foreground/70 hover:bg-muted/60"}`}>
              {speech.enabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </button>
          )}
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

        <AgentConversation
          agent={agent} disabledReason={unavailable} voiceLang={locale} onCall={canCall ? () => setCallOpen(true) : undefined}
          extraPrompts={ctx ? contextPrompts(ctx) : undefined}
          beforeEmpty={unavailable ? undefined : <BriefingStart onFollowUp={(n) => void agent.send(`Prepare a professional payment follow-up for invoice ${n}`)} />}
        />
      </main>

      {callOpen && <VoiceCall agent={agent} lang={locale} firstName={(user as { firstName?: string | null } | undefined)?.firstName} onClose={() => setCallOpen(false)} />}

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
