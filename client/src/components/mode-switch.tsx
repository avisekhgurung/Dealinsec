/** The two switches between the product's faces: into the chat-only agent mode, and back to the chat from an app page. */
import { useLocation } from "wouter";
import { MessageSquare, Sparkles } from "lucide-react";
import { setUiMode } from "@/hooks/use-ui-mode";
import { setAgentOrigin } from "@/lib/agent-bus";

/** Top-bar button (desktop, app mode): turn the whole product into the chat. */
export function AgentModeButton() {
  const [, setLocation] = useLocation();
  return (
    <button
      type="button"
      onClick={() => { setUiMode("agent"); setLocation("/agent"); }}
      data-testid="mode-to-agent"
      aria-label="Switch to agent mode: chat and voice only"
      title="Agent mode"
      className="dis-topnav-icon flex h-9 items-center gap-1.5 rounded-[10px] px-2.5 text-[13px] font-semibold text-white/85 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300/70"
    >
      <Sparkles className="h-4 w-4" /><span className="hidden xl:inline">Agent mode</span>
    </button>
  );
}

/** Floating pill shown on app pages while the person is in agent mode: one tap back to the chat. */
export function BackToChat() {
  const [, setLocation] = useLocation();
  return (
    <button
      type="button"
      onClick={() => setLocation("/agent")}
      data-testid="back-to-chat"
      className="fixed bottom-[5.25rem] right-4 z-40 flex items-center gap-2 rounded-full border border-emerald-300/70 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-emerald-700 lg:bottom-6 lg:right-6"
    >
      <MessageSquare className="h-4 w-4" />Back to chat
    </button>
  );
}

/** Floating button on every app page (app mode): turn the product into the agent, keeping where you were. */
export function AgentModeFab() {
  const [location, setLocation] = useLocation();
  return (
    <button
      type="button"
      onClick={() => { setAgentOrigin(location); setUiMode("agent"); setLocation("/agent"); }}
      data-testid="agent-mode-fab"
      aria-label="Switch to agent mode: chat and voice only"
      className="fixed bottom-[5.25rem] right-4 z-40 flex items-center gap-2 rounded-full py-2.5 pl-3.5 pr-4 text-sm font-semibold text-white shadow-lg transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300 lg:bottom-6 lg:right-6"
      style={{ background: "linear-gradient(135deg, #10B981 0%, #059669 55%, #0D9488 100%)" }}
    >
      <Sparkles className="h-4 w-4 text-amber-300" />Agent mode
    </button>
  );
}
