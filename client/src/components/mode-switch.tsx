/** The two switches between the product's faces: into the chat-only agent mode, and back to the chat from an app page. */
import { useLocation } from "wouter";
import { MessageSquare, Sparkles } from "lucide-react";
import { setUiMode } from "@/hooks/use-ui-mode";

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
      <Sparkles className="h-4 w-4" /><span className="hidden 2xl:inline">Agent mode</span>
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
