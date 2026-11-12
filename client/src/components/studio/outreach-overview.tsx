/**
 * Outreach overview (Radar → Outreach): honest counts over 7, 30 or 90 days. What DealInSec saw itself (sent from the
 * connected Gmail, replies found in Gmail) is kept apart from what the person recorded ("you marked it sent", "you
 * recorded a reply"). There are no delivery, open or read rates: DealInSec can't see them on manual channels.
 * A number the server couldn't count shows as a dash, never as 0.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CHANNEL_LABEL } from "@shared/channels";
import { Skeleton } from "@/components/ui/skeleton";
import { STUDIO_CHANNELS, overviewUrl, type OverviewNumbers } from "@/lib/studio";
import { ChannelIcon } from "./channel-selector";
import { cn } from "@/lib/utils";

const RANGES = [7, 30, 90] as const;
const n = (v: number | null) => (v === null ? "–" : v.toLocaleString());

function Kpi({ label, value, note, testId }: { label: string; value: number | null; note: string; testId: string }) {
  return (
    <div className="rounded-xl border border-border/70 bg-card p-3" data-testid={testId}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight">{n(value)}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{value === null ? "Couldn't count this right now." : note}</p>
    </div>
  );
}

export function OutreachOverview() {
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const q = useQuery<{ overview: OverviewNumbers }>({ queryKey: [overviewUrl(days)], retry: false, staleTime: 30_000 });
  const o = q.data?.overview;
  if (q.isError) return null; // not set up on this server: the queue below still works
  const sentNote = o ? [o.markedSentByYou ? `${o.markedSentByYou} marked sent by you` : null, o.sentFromGmail ? `${o.sentFromGmail} sent from your Gmail` : null].filter(Boolean).join(" · ") || "Nothing sent yet." : "";
  const replyNote = o ? [o.repliesRecordedByYou ? `${o.repliesRecordedByYou} recorded by you` : null, o.repliesFoundInGmail ? `${o.repliesFoundInGmail} found in your Gmail` : null].filter(Boolean).join(" · ") || "No replies recorded yet." : "";
  const sent = o ? (o.markedSentByYou === null && o.sentFromGmail === null ? null : (o.markedSentByYou ?? 0) + (o.sentFromGmail ?? 0)) : null;
  const replies = o ? (o.repliesRecordedByYou === null && o.repliesFoundInGmail === null ? null : (o.repliesRecordedByYou ?? 0) + (o.repliesFoundInGmail ?? 0)) : null;
  const channels = (o?.byChannel ?? []).filter((c) => c.drafts + c.markedSent + c.replies > 0).sort((a, b) => STUDIO_CHANNELS.indexOf(a.channel) - STUDIO_CHANNELS.indexOf(b.channel));

  return (
    <section aria-labelledby="outreach-overview-h" className="space-y-3" data-testid="outreach-overview">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="outreach-overview-h" className="text-base font-semibold">Your outreach</h2>
          <p className="text-xs text-muted-foreground">Counts only. DealInSec can't see deliveries or opens on channels you send from yourself.</p>
        </div>
        <div role="radiogroup" aria-label="Period" className="inline-flex rounded-lg border border-border/70 bg-muted/40 p-0.5">
          {RANGES.map((d) => (
            <button key={d} type="button" role="radio" aria-checked={days === d} onClick={() => setDays(d)}
              className={cn("min-h-[32px] rounded-md px-2.5 text-xs", days === d ? "bg-background font-semibold shadow-sm" : "text-muted-foreground hover:text-foreground")} data-testid={`overview-days-${d}`}>
              {d} days
            </button>
          ))}
        </div>
      </div>

      {!o ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">{Array.from({ length: 7 }, (_, i) => <Skeleton key={i} className="h-[92px]" />)}</div>
      ) : (
        <div className={cn("grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7", q.isFetching && "opacity-70")}>
          <Kpi label="Leads ready" value={o.readyToContact} note="Open leads with an email address." testId="kpi-ready" />
          <Kpi label="Drafts ready" value={o.draftsWaiting} note="Written, not sent yet (all channels)." testId="kpi-drafts" />
          <Kpi label="Sent" value={sent} note={sentNote} testId="kpi-sent" />
          <Kpi label="Replies" value={replies} note={replyNote} testId="kpi-replies" />
          <Kpi label="Follow-ups due" value={o.followUpsDue} note="Due today or earlier." testId="kpi-followups" />
          <Kpi label="Interested" value={o.interested} note="Leads you recorded as interested." testId="kpi-interested" />
          <Kpi label="Meetings" value={o.meetings} note="Moved to Meeting, or wanted to meet." testId="kpi-meetings" />
        </div>
      )}

      {channels.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border/70">
          <table className="w-full min-w-[420px] text-sm" data-testid="overview-by-channel">
            <caption className="sr-only">Outreach by channel, last {days} days</caption>
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr><th scope="col" className="px-3 py-2 text-left font-medium">Channel</th><th scope="col" className="px-3 py-2 text-right font-medium">Drafts now</th><th scope="col" className="px-3 py-2 text-right font-medium">Sent</th><th scope="col" className="px-3 py-2 text-right font-medium">Replies</th></tr>
            </thead>
            <tbody>
              {channels.map((c) => (
                <tr key={c.channel} className="border-t border-border/60">
                  <th scope="row" className="px-3 py-2 text-left font-medium"><span className="inline-flex items-center gap-2"><ChannelIcon channel={c.channel} size={14} />{CHANNEL_LABEL[c.channel]}</span></th>
                  <td className="px-3 py-2 text-right tabular-nums">{c.drafts}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.markedSent}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.replies}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
