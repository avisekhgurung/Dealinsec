/**
 * The three coworkers' faces everywhere in The Nest. Since The Nest's plush redesign this is a thin adapter over
 * NestCharacter (nest-character.tsx): the existing states, which come from real runs and approvals, map to the plush
 * character's animation states, so every list, card and chat header gets the living characters unchanged.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { BOTS, type Bot } from "@shared/ai-league";
import { NestCharacter, type NestAnimationState } from "./nest-character";

export type MascotState = "idle" | "thinking" | "working" | "waiting" | "done" | "attention";

const ANIMATION: Record<MascotState, NestAnimationState> = {
  idle: "idle", thinking: "thinking", working: "thinking", waiting: "waiting", done: "success", attention: "error",
};

/**
 * `label` gives the image alt text (use it where the mascot stands for the coworker on its own); without one the image
 * is decorative, because the coworker's name is written right next to it. `speaking`: a reply is being written now.
 */
export function Mascot({ bot, state = "idle", size = 48, className, label, eager = false, speaking = false }: { bot: Bot; state?: MascotState; size?: number; className?: string; label?: string; eager?: boolean; speaking?: boolean }) {
  return <NestCharacter bot={bot} size={size} animationState={ANIMATION[state]} isSpeaking={speaking} label={label} eager={eager} className={className} />;
}

/** An empty state with the coworker(s) it belongs to: one mascot, or the three together for the whole team. */
export function MascotEmpty({ bots = BOTS, children, bordered = true }: { bots?: readonly Bot[]; children: ReactNode; bordered?: boolean }) {
  return (
    <div className={cn("flex flex-col items-center gap-3 px-4 py-6 text-center", bordered && "rounded-xl border border-dashed")}>
      <span className="flex items-center -space-x-2" aria-hidden>
        {bots.map((b) => <Mascot key={b} bot={b} size={bots.length > 1 ? 44 : 56} className="ring-2 ring-background" />)}
      </span>
      <p className="max-w-md text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

/** Which mascot state a coworker's real status maps to. */
export const mascotState = (status: string | undefined, running = false): MascotState =>
  running ? "thinking" : status === "working" ? "working" : status === "needs_you" ? "waiting" : status === "attention" ? "attention" : "idle";
