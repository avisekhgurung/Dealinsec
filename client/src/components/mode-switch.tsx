/**
 * The switches between the product's two faces: the Workspace (every screen) and Agent mode (one conversation, chat
 * and voice). Switching never loses anything: the conversation you were in reopens, an unsent message stays in its
 * box (lib/agent-session.ts), and "Workspace" takes you back to the screen you left. Switching only changes the view;
 * it never sends a message or starts a run.
 */
import { useEffect, useId, useRef } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { LayoutGrid, MessageSquare, Sparkles } from "lucide-react";
import { setUiMode, useUiMode } from "@/hooks/use-ui-mode";
import { setAgentOrigin } from "@/lib/agent-bus";
import { chatTarget, rememberReturn, workspaceTarget } from "@/lib/agent-session";
import { useAuth } from "@/hooks/useAuth";
import { press, tSpring } from "@/lib/motion";
import { cn } from "@/lib/utils";

type Mode = "app" | "agent";

/**
 * A switch replaces the screen, and with it the switcher the person was using (the top bar gives way to the agent's
 * own header, and back). This flag lets the switcher on the new screen take the keyboard focus, so it isn't lost.
 */
const SWITCHED = "dis_mode_switched";
const markSwitched = () => { try { sessionStorage.setItem(SWITCHED, "1"); } catch { /* focus just stays where it lands */ } };
const takeSwitched = (): boolean => { try { const v = sessionStorage.getItem(SWITCHED); sessionStorage.removeItem(SWITCHED); return v === "1"; } catch { return false; } };

/** The switching itself, shared by every control below. */
export function useModeSwitch() {
  const [location, navigate] = useLocation();
  const { user } = useAuth();
  const mode = useUiMode();
  const onAgentPage = location.startsWith("/agent");
  const toAgent = () => {
    if (!onAgentPage) { rememberReturn(location); setAgentOrigin(location); markSwitched(); }
    setUiMode("agent");
    if (!onAgentPage) navigate(chatTarget(user?.id));
  };
  const toWorkspace = () => {
    setUiMode("app");
    if (onAgentPage) { markSwitched(); navigate(workspaceTarget()); }
  };
  return { mode, onAgentPage, toAgent, toWorkspace, select: (m: Mode) => (m === "agent" ? toAgent() : toWorkspace()) };
}

const OPTIONS: { value: Mode; label: string; Icon: typeof Sparkles; hint: string }[] = [
  { value: "app", label: "Workspace", Icon: LayoutGrid, hint: "Every screen: AI Outbound, pipeline, documents and money" },
  { value: "agent", label: "Agent", Icon: Sparkles, hint: "Ask in plain words: it runs AI Outbound, Leads and Deals for you" },
];

/**
 * Workspace | Agent, as a radio group: the selected mode is always visible, arrow keys move between them, and the
 * indicator slides to the new one. `tone` matches the surface it sits on.
 */
export function ModeSwitcher({ tone = "light", labelsFrom, className }: { tone?: "light" | "dark"; /** Show text labels only from this breakpoint (icons + accessible names below it). "never" keeps the
   *  crowded desktop top bar icon-only at every width. */ labelsFrom?: "sm" | "xl" | "never"; className?: string }) {
  const compact = !!labelsFrom;
  const { mode, select } = useModeSwitch();
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = OPTIONS.findIndex((o) => o.value === mode);
  // Arrived here by switching with this control on the previous screen: keep the keyboard on it.
  useEffect(() => { if (takeSwitched()) refs.current[current]?.focus({ preventScroll: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const move = (i: number) => {
    const next = (i + OPTIONS.length) % OPTIONS.length;
    refs.current[next]?.focus();
    select(OPTIONS[next].value);
  };
  const dark = tone === "dark";
  return (
    <div
      role="radiogroup"
      aria-label="View"
      data-testid="mode-switcher"
      className={cn("relative inline-flex items-center rounded-full p-0.5", dark ? "bg-white/10 ring-1 ring-white/15" : "bg-muted ring-1 ring-border", className)}
    >
      {OPTIONS.map((o, i) => {
        const active = o.value === mode;
        return (
          <button
            key={o.value}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={`${o.label}: ${o.hint}`}
            title={o.hint}
            tabIndex={active ? 0 : -1}
            onClick={() => select(o.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); move(current + 1); }
              if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); move(current - 1); }
            }}
            data-testid={`mode-${o.value}`}
            className={cn(
              "relative z-0 flex h-8 items-center gap-1.5 rounded-full text-xs font-semibold outline-none transition-colors focus-visible:ring-2",
              compact ? "px-2.5" : "px-3",
              dark ? "focus-visible:ring-emerald-300/70" : "focus-visible:ring-emerald-500/60",
              active ? (dark ? "text-emerald-950" : "text-foreground") : (dark ? "text-white/75 hover:text-white" : "text-muted-foreground hover:text-foreground"),
            )}
          >
            {active && (
              <motion.span
                layoutId={`mode-indicator-${id}`}
                transition={tSpring}
                aria-hidden="true"
                className={cn("absolute inset-0 -z-10 rounded-full shadow-sm", dark ? "bg-emerald-300" : "bg-background ring-1 ring-border")}
              />
            )}
            <o.Icon className={cn("h-3.5 w-3.5", active && o.value === "agent" && !dark && "text-emerald-600")} aria-hidden="true" />
            <span className={labelsFrom === "sm" ? "sr-only sm:not-sr-only" : labelsFrom === "xl" ? "sr-only xl:not-sr-only" : labelsFrom === "never" ? "sr-only" : ""}>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

const pillBase = "fixed bottom-[5.25rem] right-4 z-40 flex items-center gap-2 rounded-full text-sm font-semibold text-white shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-background lg:bottom-6 lg:right-6";

/** On a phone in the Workspace: the way into Agent mode (desktop has the switcher in the top bar). */
export function AgentModeFab() {
  const { toAgent } = useModeSwitch();
  return (
    <motion.button
      type="button"
      onClick={toAgent}
      data-testid="agent-mode-fab"
      aria-label="Switch to Agent mode: one conversation, chat and voice"
      {...press}
      className={cn(pillBase, "py-2.5 pl-3.5 pr-4 hover:brightness-110 lg:hidden")}
      style={{ background: "linear-gradient(135deg, #10B981 0%, #059669 55%, #0D9488 100%)" }}
    >
      <Sparkles className="h-4 w-4 text-amber-300" aria-hidden="true" />Agent mode
    </motion.button>
  );
}

/** On a Workspace screen opened from the agent (still in Agent mode): back to the same conversation. */
export function BackToChat() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  return (
    <motion.button
      type="button"
      onClick={() => navigate(chatTarget(user?.id))}
      data-testid="back-to-chat"
      {...press}
      className={cn(pillBase, "border border-emerald-300/70 bg-emerald-600 px-4 py-3 hover:bg-emerald-700")}
    >
      <MessageSquare className="h-4 w-4" aria-hidden="true" />Back to chat
    </motion.button>
  );
}
