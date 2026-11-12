/**
 * How the message will look where it is sent: a light hint of each platform (a mail header, a chat bubble, a DM card),
 * drawn with DealInSec's own tokens. Previews only: nothing here is the platform's inbox, and nothing is sent from it.
 */
import { CHANNEL_LABEL, type Channel } from "@shared/channels";
import { ChannelIcon } from "./channel-selector";
import { cn } from "@/lib/utils";

const initials = (s: string) => s.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

function Body({ text, className }: { text: string; className?: string }) {
  return <p className={cn("whitespace-pre-wrap break-words text-[15px] leading-relaxed", className)}>{text || "Your message will appear here."}</p>;
}

export function ChannelPreview({ channel, kind, company, to, subject, body, sender }: {
  channel: Channel; kind: string; company: string; to: string | null; subject: string | null; body: string; sender: string;
}) {
  const header = (
    <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
      <ChannelIcon channel={channel} size={14} />
      <span>Preview on {CHANNEL_LABEL[channel]} · not sent</span>
    </div>
  );
  if (channel === "email") {
    return (
      <div data-testid="studio-preview" data-channel="email">
        {header}
        <div className="overflow-hidden rounded-xl border border-border/70 bg-card">
          <dl className="grid grid-cols-[4.5rem_1fr] gap-y-1 border-b border-border/60 px-4 py-3 text-sm">
            <dt className="text-muted-foreground">From</dt><dd className="truncate">{sender}</dd>
            <dt className="text-muted-foreground">To</dt><dd className="truncate">{to ?? <span className="text-muted-foreground">No address yet</span>}</dd>
            <dt className="text-muted-foreground">Subject</dt><dd className="truncate font-semibold">{subject || <span className="font-normal text-muted-foreground">No subject yet</span>}</dd>
          </dl>
          <div className="px-4 py-4"><Body text={body} /></div>
        </div>
      </div>
    );
  }
  if (channel === "whatsapp") {
    return (
      <div data-testid="studio-preview" data-channel="whatsapp">
        {header}
        <div className="rounded-xl border border-border/70 bg-[hsl(var(--ch-whatsapp)/0.06)] p-3">
          <p className="mb-3 text-center text-xs text-muted-foreground">{to ?? company}</p>
          <div className="ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-[hsl(var(--ch-whatsapp)/0.16)] px-3 py-2 shadow-sm">
            <Body text={body} className="text-sm" />
            <p className="mt-1 text-right text-[11px] text-muted-foreground">You send this</p>
          </div>
        </div>
      </div>
    );
  }
  const title = channel === "linkedin" ? (kind === "connection_note" ? "Connection request note" : "LinkedIn message") : channel === "x" ? "Direct message" : `${CHANNEL_LABEL[channel]} message`;
  return (
    <div data-testid="studio-preview" data-channel={channel}>
      {header}
      <div className="overflow-hidden rounded-xl border border-border/70 bg-card">
        <div className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-semibold">{initials(company)}</span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{company}</p>
            <p className="truncate text-xs text-muted-foreground">{to ? (channel === "x" || channel === "instagram" ? `@${to}` : to) : title}</p>
          </div>
        </div>
        <div className="px-4 py-4">
          <div className={cn("max-w-[90%] rounded-2xl px-3 py-2", channel === "linkedin" ? "rounded-tl-sm bg-muted/60" : "ml-auto rounded-tr-sm bg-[hsl(var(--ch-messenger)/0.10)]")}
            style={channel === "instagram" ? { background: "hsl(var(--ch-instagram) / 0.08)" } : channel === "x" ? { background: "hsl(var(--muted))" } : undefined}>
            <Body text={body} className="text-sm" />
          </div>
        </div>
      </div>
    </div>
  );
}
