/**
 * The voice call screen: a calm full-screen conversation with DealInSec. An orb
 * that listens, thinks and speaks; live captions; mute, interrupt and end. When
 * something needs approval it is read back and can be approved by voice, or by a
 * tap on the card shown here.
 */
import { useEffect, useRef, useState } from "react";
import { Hand, Mic, MicOff, PhoneOff } from "lucide-react";
import type { AgentCard } from "@shared/agent";
import type { ApprovalView } from "@/hooks/use-agent";
import { useAgent } from "@/hooks/use-agent";
import { useVoiceCall, onPhone } from "@/hooks/use-voice-call";
import { CardView } from "./card-view";
import { cn } from "@/lib/utils";

type Agent = ReturnType<typeof useAgent>;
const BARGE_KEY = "dis-voice-barge";

const timeLabel = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
const hello = (hour: number, name?: string | null) =>
  `${hour < 5 ? "Good evening" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"}${name ? `, ${name}` : ""}. How may I be of service?`;

export function VoiceCall({ agent, lang, firstName, onClose }: { agent: Agent; lang: string; firstName?: string | null; onClose: () => void }) {
  // On by default: the person comes first. Off only if a loudspeaker keeps fooling it.
  const [bargeIn, setBargeIn] = useState(() => { try { return window.localStorage.getItem(BARGE_KEY) !== "0"; } catch { return true; } });
  const toggleBarge = () => setBargeIn((v) => { const n = !v; try { window.localStorage.setItem(BARGE_KEY, n ? "1" : "0"); } catch { /* not remembered */ } return n; });

  // The agent answers in a spoken register for as long as the call is open.
  useEffect(() => { agent.setChannel("voice"); return () => agent.setChannel("web"); }, [agent.setChannel]); // eslint-disable-line react-hooks/exhaustive-deps

  const call = useVoiceCall({ agent, lang, greeting: hello(new Date().getHours(), firstName), bargeIn });
  const { state, level, seconds, finished, dispatch } = call;

  // A call that ended normally closes itself; one that failed stays up to say why.
  useEffect(() => { if (finished && (state.endReason === "user" || state.endReason === "idle")) onClose(); }, [finished, state.endReason, onClose]);

  const phase = state.phase;
  const heard = phase === "listening" ? state.interim : phase === "thinking" ? state.lastUserText : "";
  const label =
    state.muted && phase === "listening" ? "Muted" :
    phase === "connecting" ? "Connecting…" :
    phase === "listening" ? (state.interim ? "Listening…" : state.confirming ? (state.confirming.risk === "CONSEQUENTIAL_MUTATION" ? "Say confirm, or no" : "Say approve, or no") : "Go ahead, I'm listening") :
    phase === "thinking" ? "One moment…" :
    phase === "speaking" ? "Speaking" : "Call ended";

  // Cards from the latest assistant message OF THIS CALL that need a tap (approvals) or are worth seeing.
  const callStart = useRef(agent.messages.length);
  const lastAssistant = [...agent.messages.slice(callStart.current)].reverse().find((m) => m.role === "assistant");
  const cards: AgentCard[] = (lastAssistant?.cards ?? []).filter((c) => c.kind === "approval" || c.kind === "companies" || c.kind === "lead");
  const approvals: Record<string, ApprovalView> = agent.approvals;

  const orbScale = phase === "listening" && !state.muted ? 1 + Math.min(level, 1) * 0.45 : 1;
  const busy = phase === "thinking";

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-gradient-to-b from-[#06302b] via-[#08201f] to-[#070f1a] text-white" role="dialog" aria-label="Voice call with DealInSec" data-testid="voice-call" data-phase={phase}>
      <header className="flex items-center justify-between px-5 pt-[max(1rem,env(safe-area-inset-top))] text-sm">
        <span className="flex items-center gap-2 font-semibold tracking-wide"><span className={cn("h-2 w-2 rounded-full", phase === "ended" ? "bg-neutral-400" : "animate-pulse bg-emerald-400")} />DealInSec</span>
        <span className="tabular-nums text-white/70" data-testid="call-timer">{timeLabel(seconds)}</span>
      </header>

      <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-6">
        <div className="relative flex h-56 w-56 items-center justify-center" aria-hidden="true">
          {phase === "speaking" && <span className="dis-orb-ripple absolute inset-4 rounded-full bg-emerald-400/30" />}
          {busy && <span className="dis-orb-spin absolute inset-0 rounded-full" style={{ background: "conic-gradient(from 0deg, transparent 0 60%, rgba(110,231,183,.9) 100%)", mask: "radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 3px))", WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 3px))" }} />}
          <span
            className={cn("block h-40 w-40 rounded-full shadow-[0_0_80px_rgba(16,185,129,0.45)] transition-transform duration-100", phase === "speaking" && "dis-orb-breathe", state.muted && "opacity-40")}
            style={{ transform: phase === "speaking" ? undefined : `scale(${orbScale})`, background: "radial-gradient(circle at 35% 30%, #a7f3d0 0%, #10b981 45%, #047857 100%)" }}
            data-testid="call-orb"
          />
        </div>

        <div className="text-center">
          <p className="text-lg font-semibold" data-testid="call-status">{label}</p>
          <p className="mx-auto mt-2 min-h-[3.5rem] max-w-md text-balance text-base leading-snug text-white/75" aria-live="polite" data-testid="call-caption">
            {phase === "speaking" ? state.lastReply : heard}
          </p>
          {state.notice && <p role="alert" className="mx-auto mt-3 max-w-sm rounded-xl bg-amber-500/15 px-4 py-2.5 text-sm text-amber-100" data-testid="call-notice">{state.notice}</p>}
        </div>

        {cards.length > 0 && (
          <div className="max-h-[34vh] w-full max-w-md space-y-3 overflow-y-auto rounded-2xl bg-background p-3 text-foreground shadow-xl" data-testid="call-cards">
            {cards.map((c, i) => (
              <CardView key={i} card={c} approvals={approvals} onApprove={agent.approve} onDecline={agent.reject} />
            ))}
          </div>
        )}
      </main>

      <footer className="flex flex-col items-center gap-3 px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2">
        <div className="flex items-center gap-5">
          <button type="button" onClick={() => dispatch({ type: state.muted ? "unmute" : "mute" })} aria-pressed={state.muted} aria-label={state.muted ? "Unmute" : "Mute"} data-testid="call-mute"
            disabled={phase === "ended"}
            className={cn("flex h-14 w-14 items-center justify-center rounded-full transition", state.muted ? "bg-white text-neutral-900" : "bg-white/12 text-white hover:bg-white/20")}>
            {state.muted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
          </button>
          <button type="button" onClick={() => dispatch({ type: "interrupt" })} aria-label="Interrupt" data-testid="call-interrupt"
            disabled={phase !== "speaking" && phase !== "thinking"}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-white/12 text-white transition hover:bg-white/20 disabled:opacity-30">
            <Hand className="h-6 w-6" />
          </button>
          <button type="button" onClick={() => (phase === "ended" ? onClose() : dispatch({ type: "end" }))} aria-label={phase === "ended" ? "Close" : "End call"} data-testid="call-end"
            className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-600 text-white transition hover:bg-rose-500">
            <PhoneOff className="h-6 w-6" />
          </button>
        </div>
        {onPhone() ? (
          // A phone cannot listen while it speaks (it would silence the voice): a tap interrupts instead.
          <p className="max-w-xs text-center text-xs leading-snug text-white/55" data-testid="call-phone-hint">
            Tap the hand to interrupt. No sound? Turn the silent switch off and the volume up.
          </p>
        ) : (
        <button type="button" onClick={toggleBarge} aria-pressed={bargeIn} data-testid="call-barge"
            title="When on, just start talking and the assistant stops to listen. Turn it off if it keeps stopping itself on a loudspeaker."
            className="text-xs text-white/55 underline-offset-2 hover:text-white/80 hover:underline">
            Talk over it to interrupt: {bargeIn ? "on" : "off"}
          </button>
        )}
      </footer>
    </div>
  );
}
