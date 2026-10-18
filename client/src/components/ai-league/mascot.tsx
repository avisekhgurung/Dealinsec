/**
 * The three coworkers' mascots (client/public/ai-league/*-mascot.webp, transparent): Nibo with his magnifier, Mika with
 * her letter, Zee with his checklist. The image is never animated or distorted: what moves is the halo around it, and
 * only while a task is actually working (or the chat is answering). Reduced motion turns it off.
 *
 * Two files per mascot (192 px and 512 px) and `srcSet`, so a 32 px avatar doesn't download the large one. Lazy by
 * default; pass `eager` where the mascot is visible on first paint (the team cards, the chat header).
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { BOTS, BOT_IDENTITY, type Bot } from "@shared/ai-league";

export type MascotState = "idle" | "thinking" | "working" | "waiting" | "done" | "attention";

const src = (bot: Bot) => ({
  src: `/ai-league/${bot}-mascot.webp`,
  srcSet: `/ai-league/${bot}-mascot-sm.webp 192w, /ai-league/${bot}-mascot.webp 512w`,
});

/**
 * `label` gives the image alt text (use it where the mascot stands for the coworker on its own); without one the image
 * is decorative, because the coworker's name is written right next to it.
 */
export function Mascot({ bot, state = "idle", size = 48, className, label, eager = false }: { bot: Bot; state?: MascotState; size?: number; className?: string; label?: string; eager?: boolean }) {
  const busy = state === "thinking" || state === "working";
  const id = BOT_IDENTITY[bot];
  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center rounded-full", id.accent.soft, className)} style={{ width: size, height: size }}>
      {busy && (
        <>
          <span className={cn("pointer-events-none absolute inset-0 rounded-full ring-2", id.accent.ring)} aria-hidden />
          <span className={cn("pointer-events-none absolute inset-0 rounded-full ring-2 motion-safe:animate-[league-halo_1.8s_ease-out_infinite]", id.accent.ring)} aria-hidden />
        </>
      )}
      <img
        {...src(bot)}
        sizes={`${size}px`}
        width={size}
        height={size}
        alt={label ?? ""}
        aria-hidden={label ? undefined : true}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        draggable={false}
        className="relative h-[92%] w-[92%] select-none object-contain"
      />
      {busy && <span className="sr-only">{id.name} is working</span>}
      {state === "waiting" && <Badge className="bg-amber-500" title="Waiting for you" />}
      {state === "attention" && <Badge className="bg-red-500" title="Needs attention" />}
      {state === "done" && (
        <span className="absolute -bottom-0.5 -right-0.5 flex h-[34%] max-h-6 w-[34%] max-w-6 items-center justify-center rounded-full bg-emerald-600 ring-2 ring-background" title="Done">
          <svg viewBox="0 0 12 12" className="h-[60%] w-[60%]" aria-hidden><path d="M2.5 6.2 5 8.5l4.5-5" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
      )}
    </span>
  );
}

const Badge = ({ className, title }: { className: string; title: string }) => (
  <span className={cn("absolute right-0 top-0 h-[24%] max-h-4 w-[24%] max-w-4 rounded-full ring-2 ring-background", className)} title={title} />
);

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
