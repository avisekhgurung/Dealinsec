/**
 * The Studio's channel row: Email, WhatsApp, LinkedIn, Instagram, X and Messenger with their own marks (Simple Icons via
 * react-icons, CC0; the marks stay their owners' trademarks and are shown only as labelled identifiers), one restrained
 * accent each (index.css --ch-*), and the message state as text, never as colour alone. A tablist: arrow keys, Home and
 * End move and select. A channel the server reports as not switched on yet is shown, explained, and can't be selected.
 */
import { useRef, type KeyboardEvent } from "react";
import { motion } from "framer-motion";
import { Mail } from "lucide-react";
import { SiInstagram, SiLinkedin, SiMessenger, SiWhatsapp, SiX } from "react-icons/si";
import { CHANNEL_LABEL, type Channel } from "@shared/channels";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { tSpring, useCalmMotion } from "@/lib/motion";
import { HOW_YOU_SEND } from "@/lib/studio";
import { cn } from "@/lib/utils";

const ICON: Record<Channel, (p: { className?: string; style?: React.CSSProperties }) => JSX.Element> = {
  email: (p) => <Mail {...p} />,
  whatsapp: (p) => <SiWhatsapp {...p} />,
  linkedin: (p) => <SiLinkedin {...p} />,
  instagram: (p) => <SiInstagram {...p} />,
  x: (p) => <SiX {...p} />,
  messenger: (p) => <SiMessenger {...p} />,
};

/** A channel's mark: in its accent ("brand") or in the current text colour ("mono"). Always decorative: a label says the name. */
export function ChannelIcon({ channel, size = 16, tone = "brand", className }: { channel: Channel; size?: number; tone?: "brand" | "mono"; className?: string }) {
  const Icon = ICON[channel];
  return (
    <span aria-hidden className={cn("inline-flex shrink-0", className)} style={{ width: size, height: size }}>
      <Icon className="h-full w-full" style={tone === "brand" ? { color: `hsl(var(--ch-${channel}))` } : undefined} />
    </span>
  );
}

export interface ChannelTabInfo {
  channel: Channel;
  /** A short state ("Draft", "Approved", "Sent", "Replied") or null when there is no message on it. */
  chip: string | null;
  /** The full status line for screen readers and the tooltip. */
  detail: string;
  disabled?: string | null;
}

export function ChannelSelector({ tabs, value, onChange }: { tabs: ChannelTabInfo[]; value: Channel; onChange: (c: Channel) => void }) {
  const calm = useCalmMotion();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const enabled = tabs.filter((t) => !t.disabled);
  const move = (e: KeyboardEvent, from: Channel) => {
    const i = enabled.findIndex((t) => t.channel === from);
    const to = e.key === "ArrowRight" ? enabled[(i + 1) % enabled.length] : e.key === "ArrowLeft" ? enabled[(i - 1 + enabled.length) % enabled.length]
      : e.key === "Home" ? enabled[0] : e.key === "End" ? enabled[enabled.length - 1] : null;
    if (!to) return;
    e.preventDefault();
    onChange(to.channel);
    refs.current[to.channel]?.focus();
    refs.current[to.channel]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };
  return (
    <div role="tablist" aria-label="Channel" className="studio-channels flex gap-1 overflow-x-auto rounded-xl border border-border/70 bg-muted/40 p-1 scrollbar-hide" data-testid="studio-channels">
      {tabs.map((t) => {
        const selected = t.channel === value;
        return (
          <Tooltip key={t.channel} delayDuration={400}>
            <TooltipTrigger asChild>
              <button
                ref={(el) => { refs.current[t.channel] = el; }}
                type="button" role="tab" id={`studio-tab-${t.channel}`} aria-selected={selected} aria-controls="studio-message-panel"
                aria-disabled={t.disabled ? true : undefined} tabIndex={selected ? 0 : -1}
                onClick={() => { if (!t.disabled) onChange(t.channel); }}
                onKeyDown={(e) => move(e, t.channel)}
                className={cn(
                  "relative flex min-h-[44px] shrink-0 items-center gap-2 rounded-lg px-3 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  selected ? "font-semibold text-foreground" : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
                  t.disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
                )}
                data-testid={`studio-tab-${t.channel}`}
              >
                {selected && (
                  <motion.span layoutId={calm ? undefined : "studio-channel-pill"} transition={tSpring} aria-hidden
                    className="absolute inset-0 rounded-lg bg-background shadow-sm ring-1 ring-border/60" />
                )}
                <span className="relative flex items-center gap-2">
                  <ChannelIcon channel={t.channel} tone={selected ? "brand" : "mono"} />
                  <span className={cn(!selected && "hidden sm:inline")}>{CHANNEL_LABEL[t.channel]}</span>
                  {t.chip && <span className={cn("hidden rounded-full border px-1.5 py-0.5 text-[11px] font-medium leading-none text-muted-foreground md:inline", selected && "border-border")}>{t.chip}</span>}
                  <span className="sr-only">{`, ${t.detail}`}</span>
                </span>
                {selected && <span aria-hidden className="absolute bottom-0.5 left-1/2 h-0.5 w-4 -translate-x-1/2 rounded-full" style={{ background: `hsl(var(--ch-${t.channel}))` }} />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-[260px] text-xs">
              <p className="font-semibold">{CHANNEL_LABEL[t.channel]}</p>
              <p className="mt-0.5">{t.disabled ?? t.detail}</p>
              {!t.disabled && <p className="mt-1 text-muted-foreground">{HOW_YOU_SEND[t.channel]}</p>}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
