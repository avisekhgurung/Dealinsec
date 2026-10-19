/**
 * The Nest's plush coworkers, alive: Nibo 🔎 (brown bear-ear hat), Mika 💌 (pink heart hat) and Zee 🌱 (green sprout
 * hat). The artwork is the supplied character sheet, cropped into three poses each (client/src/lib/plush.ts); the
 * life comes from CSS (index.css, "The Nest"): a soft float and breath, each character's own small habit, a pose for
 * real work, and a one-off hop when work is really done.
 *
 * The state always comes from the app, never invented here:
 *   idle      resting pose, floating; Nibo tilts his head now and then, Mika gives a little bounce, Zee bobs calmly
 *   thinking  working pose (Nibo's map, Mika's laptop, Zee's journal), a gentle sway, a moving halo and a busy prop
 *   success   the "done" pose (Nibo's notebook, Mika's ticked notes, Zee's ticked checklist), one hop, a prop pops up;
 *             only pass it once the server has confirmed the work (an unread completed run)
 *   waiting   resting pose, still and leaning in, amber dot: something is waiting for the person's approval
 *   error     resting pose, still, a little muted and drooped, red dot: never anything that reads as success
 * `isSpeaking` is a quick talking bob while a reply is being written (the chat's live text today; voice can drive the
 * same prop later without touching the artwork or the animation).
 *
 * Small avatars (under 40 px) stay still apart from the halo and badges, so lists don't wobble. Everything holds still
 * for people who prefer reduced motion: the pose and the badge still say what is going on. If a picture fails to load,
 * the coworker's initial and emoji show instead. The picture never takes pointer events or text selection.
 */
import { useState } from "react";
import { cn } from "@/lib/utils";
import { BOT_IDENTITY, type Bot } from "@shared/ai-league";
import { nestLook, plushSrc, type NestAnimationState } from "@/lib/plush";

export type { NestAnimationState };

export interface NestCharacterProps {
  bot: Bot;
  /** Diameter in px; fixed, so nothing shifts while pictures load. */
  size?: number;
  animationState?: NestAnimationState;
  /** A reply is being written out right now (chat stream today, voice later). */
  isSpeaking?: boolean;
  /** Alt text, where the character stands for the coworker on its own; otherwise the picture is decorative. */
  label?: string;
  /** Load at once (visible on first paint); otherwise lazy. */
  eager?: boolean;
  className?: string;
}

/** The small prop beside a large character: what they're busy with, or what they finished. */
const PROP: Record<Bot, { busy: string; done: string }> = {
  nibo: { busy: "🔎", done: "✨" },
  mika: { busy: "✉️", done: "💌" },
  zee: { busy: "📝", done: "✅" },
};

const STATUS_TEXT: Record<NestAnimationState, string | null> = {
  idle: null, thinking: "is working", success: "has finished", waiting: "is waiting for your approval", error: "needs attention",
};

/** Each coworker's yarn colour, for the rim and the halo. */
const RIM: Record<Bot, string> = {
  nibo: "ring-amber-800/25 dark:ring-amber-300/25",
  mika: "ring-rose-400/35 dark:ring-rose-300/30",
  zee: "ring-lime-600/30 dark:ring-lime-300/25",
};

export function NestCharacter({ bot, size = 48, animationState = "idle", isSpeaking = false, label, eager = false, className }: NestCharacterProps) {
  const [failed, setFailed] = useState(false);
  const id = BOT_IDENTITY[bot];
  const look = nestLook(animationState, { size, isSpeaking });
  const { pose, motion } = look;
  const animated = size >= 40;
  const showProp = look.prop !== null;
  const status = STATUS_TEXT[isSpeaking ? "thinking" : animationState];
  const busy = look.halo;

  return (
    <span className={cn("nest-char relative inline-flex shrink-0", className)} style={{ width: size, height: size }} data-bot={bot} data-state={animationState}>
      {busy && <span className={cn("pointer-events-none absolute inset-0 rounded-full ring-2 motion-safe:animate-[league-halo_1.8s_ease-out_infinite]", id.accent.ring)} aria-hidden />}
      <span className={cn("nest-body relative block h-full w-full rounded-full", motion)}>
        <span className={cn("nest-face relative block h-full w-full overflow-hidden rounded-full bg-[#f3e9dc] shadow-[0_6px_14px_-8px_rgba(60,40,20,0.55)] ring-2 dark:bg-neutral-800", RIM[bot], look.habit && `nest-habit-${bot}`)}>
          {failed ? (
            <span className={cn("flex h-full w-full items-center justify-center font-bold", id.accent.soft, id.accent.fg)} style={{ fontSize: Math.max(10, size * 0.32) }} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
              {id.name[0]}<span className="text-[0.7em]">{id.emoji}</span>
            </span>
          ) : (
            <img
              key={pose}
              {...plushSrc(bot, pose)}
              sizes={`${size}px`}
              width={size}
              height={size}
              alt={label ?? ""}
              aria-hidden={label ? undefined : true}
              loading={eager ? "eager" : "lazy"}
              decoding="async"
              draggable={false}
              onError={() => setFailed(true)}
              className={cn("pointer-events-none h-full w-full select-none object-cover", animated && "nest-pose-in")}
            />
          )}
          {/* A soft top light and a rim shade: depth on a flat picture. */}
          <span className="pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(120%_80%_at_30%_15%,rgba(255,255,255,0.22),transparent_55%)] shadow-[inset_0_-6px_12px_-6px_rgba(60,40,20,0.35)]" aria-hidden />
        </span>
      </span>
      {showProp && (
        <span key={animationState} className={cn("nest-prop pointer-events-none absolute -right-1 -top-1 flex items-center justify-center rounded-full bg-background shadow-md ring-1 ring-border", animationState === "thinking" ? "nest-prop-busy" : "nest-prop-pop")}
          style={{ width: Math.round(size * 0.34), height: Math.round(size * 0.34), fontSize: Math.round(size * 0.19) }} aria-hidden>
          {animationState === "thinking" ? PROP[bot].busy : PROP[bot].done}
        </span>
      )}
      {animationState === "waiting" && <Dot className="bg-amber-500" title="Waiting for your approval" />}
      {animationState === "error" && <Dot className="bg-red-500" title="Needs attention" />}
      {animationState === "success" && !showProp && (
        <span className="absolute -bottom-0.5 -right-0.5 flex h-[34%] max-h-6 w-[34%] max-w-6 items-center justify-center rounded-full bg-emerald-600 ring-2 ring-background" title="Done">
          <svg viewBox="0 0 12 12" className="h-[60%] w-[60%]" aria-hidden><path d="M2.5 6.2 5 8.5l4.5-5" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
      )}
      {status && <span className="sr-only">{id.name} {status}</span>}
    </span>
  );
}

const Dot = ({ className, title }: { className: string; title: string }) => (
  <span className={cn("absolute right-0 top-0 h-[24%] max-h-4 w-[24%] max-w-4 rounded-full ring-2 ring-background", className)} title={title} />
);

type CharacterProps = Omit<NestCharacterProps, "bot">;
export const NiboCharacter = (p: CharacterProps) => <NestCharacter bot="nibo" {...p} />;
export const MikaCharacter = (p: CharacterProps) => <NestCharacter bot="mika" {...p} />;
export const ZeeCharacter = (p: CharacterProps) => <NestCharacter bot="zee" {...p} />;
