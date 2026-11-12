/**
 * Outreach Studio (/leads/:id/outreach): one place to write to a lead on any of six channels and get it out by hand.
 *   left    what DealInSec knows about them (facts and guesses kept apart, dated, with sources)
 *   centre  Mika's message for the chosen channel: write, edit, improve, preview, and why she wrote it
 *   right   where it goes, approve, copy or open the platform, "I sent it", their reply, follow-ups, activity
 * Desktop shows all three; a tablet keeps the research behind a button; a phone stacks them with the message first.
 * The old outreach card on the lead page and the campaign sheets keep working: this page uses the same endpoints.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useRoute, useSearch } from "wouter";
import { ArrowDown, ArrowLeft, BookOpen } from "lucide-react";
import { CHANNEL_LABEL, type Channel } from "@shared/channels";
import { httpErrorKind } from "@shared/http-error-kind";
import { memberCan } from "@shared/permissions";
import { BottomNav } from "@/components/bottom-nav";
import { DetailSkeleton, DetailUnavailable } from "@/components/document/detail-states";
import { useDraftAllowance } from "@/components/leads/draft-allowance-line";
import { useGmailCanSend } from "@/components/leads/gmail-send";
import { ActionsPanel } from "@/components/studio/actions-panel";
import { ChannelSelector, type ChannelTabInfo } from "@/components/studio/channel-selector";
import { Composer } from "@/components/studio/composer";
import { IntelPanel } from "@/components/studio/intel-panel";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/hooks/useAuth";
import { refreshChannels, useChannelMessages, useChannelStatuses } from "@/lib/channels";
import { detailUrl, messagesUrl, refreshLeads, type LeadDetailView } from "@/lib/leads";
import { useCalmMotion } from "@/lib/motion";
import { STUDIO_CHANNELS, basisFor, currentFor, fromChannel, fromEmail, isStudioChannel, type EmailMessages, type StudioMessage } from "@/lib/studio";

const SHORT_STATE: Record<string, string> = { variant: "Versions", draft: "Draft", approved: "Approved", sending: "Sending", sent: "Sent", failed: "Not sent", uncertain: "Check" };

export default function OutreachStudioPage() {
  const [, params] = useRoute("/leads/:id/outreach");
  const id = Number(params?.id ?? 0);
  const search = useSearch();
  const asked = new URLSearchParams(search).get("channel");
  const [channel, setChannel] = useState<Channel>(isStudioChannel(asked) ? asked : "email");
  const [pendingTo, setPendingTo] = useState<Partial<Record<Channel, string>>>({});
  const [dirty, setDirty] = useState(false);
  const [researchOpen, setResearchOpen] = useState(false);
  const calm = useCalmMotion();
  const { user } = useAuth();
  const canEdit = memberCan(user as any, "deals.create");
  const gmail = useGmailCanSend();

  const detail = useQuery<LeadDetailView>({ queryKey: [detailUrl(id)], enabled: id > 0 });
  const email = useQuery<EmailMessages>({ queryKey: [messagesUrl(id)], enabled: id > 0, retry: false });
  const short = useChannelMessages(id);
  const statuses = useChannelStatuses();
  const allowance = useDraftAllowance(canEdit);
  const lead = detail.data?.lead;
  const events = detail.data?.events ?? [];

  const all = useMemo<StudioMessage[]>(() => [
    ...(email.data?.messages ?? []).map((m) => fromEmail(m, events)),
    ...(short.data?.messages ?? []).filter((m) => m.direction === "out").map(fromChannel),
  ], [email.data, short.data, events]);

  const refresh = () => { void refreshLeads(); void refreshChannels(id); };

  const offFor = (c: Channel): string | null => {
    if (c !== "instagram" && c !== "messenger") return null;
    const s = statuses.data?.channels.find((x) => x.channel === c);
    return s && s.state === "not_configured" ? s.note : null;
  };
  const tabs: ChannelTabInfo[] = STUDIO_CHANNELS.map((c) => {
    const cur = currentFor(c, all);
    const versions = c === "email" && !cur && all.some((m) => m.channel === "email" && m.status === "variant");
    const chip = versions ? SHORT_STATE.variant : cur ? (cur.repliedAt ? "Replied" : SHORT_STATE[cur.status] ?? null) : null;
    return { channel: c, chip, detail: versions ? "Versions to choose from" : cur ? cur.stateLabel : "No message yet", disabled: offFor(c) };
  });

  const backBar = (
    <header className="glass-header sticky top-0 z-40 border-b border-border/60">
      <div className="mx-auto max-w-[1480px] px-4 py-3 lg:px-8">
        <Link href={id ? `/leads/${id}` : "/leads"} className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" />Back to the lead</Link>
      </div>
    </header>
  );
  if (detail.isLoading || (id > 0 && !detail.data && !detail.isError)) {
    return <div className="min-h-screen bg-background pb-24 lg:pb-12">{backBar}<main className="mx-auto max-w-[1480px] px-4 py-5 lg:px-8"><DetailSkeleton what="lead" railBlocks={1} mainBlocks={2} /></main><BottomNav /></div>;
  }
  if (!lead) {
    return (
      <div className="min-h-screen bg-background pb-24 lg:pb-12">
        {backBar}
        <main className="mx-auto max-w-3xl px-4 py-5 lg:px-8">
          <DetailUnavailable kind={detail.isError ? httpErrorKind(detail.error) : "not_found"} what="lead" backHref="/leads" backLabel="Back to leads" onRetry={() => void detail.refetch()} retrying={detail.isFetching} />
        </main>
        <BottomNav />
      </div>
    );
  }

  const current = currentFor(channel, all);
  const variants = channel === "email" ? all.filter((m) => m.channel === "email" && m.status === "variant").sort((a, b) => a.id - b.id) : [];
  const writable = canEdit && !lead.archivedAt && !lead.doNotContact;
  const sender = gmail.account ?? (user as any)?.email ?? "you";
  const scrollToActions = () => document.getElementById("studio-actions-col")?.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });

  return (
    <div className="min-h-screen bg-background pb-24 lg:pb-12" data-testid="outreach-studio">
      <header className="glass-header sticky top-0 z-40 border-b border-border/60">
        <div className="mx-auto max-w-[1480px] space-y-2.5 px-4 py-3 lg:px-8">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <Link href={`/leads/${id}`} className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" />{lead.companyName}</Link>
              <h1 className="truncate text-lg font-bold tracking-tight lg:text-xl">Write to {lead.companyName}</h1>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="outline" size="sm" className="xl:hidden" onClick={() => setResearchOpen(true)} data-testid="studio-research-button"><BookOpen className="mr-1.5 h-4 w-4" />Research</Button>
              <Button variant="ghost" size="sm" className="lg:hidden" onClick={scrollToActions} aria-label="Go to send options"><ArrowDown className="h-4 w-4" /><span className="sr-only sm:not-sr-only sm:ml-1.5">Send</span></Button>
            </div>
          </div>
          <ChannelSelector tabs={tabs} value={channel} onChange={(c) => { setChannel(c); setDirty(false); }} />
          {current && <p className="text-xs text-muted-foreground lg:hidden" data-testid="studio-mobile-state">{CHANNEL_LABEL[channel]}: <span className="font-semibold text-foreground">{current.stateLabel}</span></p>}
        </div>
      </header>

      {(lead.archivedAt || lead.doNotContact || !canEdit) && (
        <div className="mx-auto max-w-[1480px] px-4 pt-4 lg:px-8">
          <p className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-sm" role="status">
            {lead.doNotContact ? "This lead is marked do-not-contact, so nothing can be written or sent to them." : lead.archivedAt ? "This lead is archived. Restore it on the lead page to write to them." : "You can read these messages. Writing and sending needs a teammate with permission to work on leads."}
          </p>
        </div>
      )}

      <main className="mx-auto grid max-w-[1480px] gap-6 px-4 py-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:px-8 xl:grid-cols-[300px_minmax(0,1fr)_340px]">
        <aside className="hidden xl:block" aria-label="Research">
          <div className="sticky top-[150px] max-h-[calc(100vh-170px)] overflow-y-auto pr-1 scrollbar-thin">
            <IntelPanel lead={lead} leadId={id} />
          </div>
        </aside>

        <div className="min-w-0 rounded-2xl border border-border/70 bg-card/60 p-4 shadow-sm sm:p-5">
          <Composer
            key={channel}
            leadId={id} company={lead.companyName} sender={sender} channel={channel}
            current={current} variants={variants} basis={current ? basisFor(events, current) : null}
            canEdit={writable} gap={channel === "email" ? email.data?.gap ?? null : null} hasWebsite={!!lead.website}
            allowance={allowance} pendingTo={pendingTo[channel] ?? ""} channelOff={offFor(channel)}
            refresh={refresh} onDirtyChange={setDirty}
          />
        </div>

        <div id="studio-actions-col" className="min-w-0 scroll-mt-40">
          <div className="rounded-2xl border border-border/70 bg-card/60 p-4 shadow-sm lg:sticky lg:top-[150px]">
            <ActionsPanel
              leadId={id} company={lead.companyName} channel={channel} current={current} leadEmail={lead.contactEmail ?? null}
              doNotContact={!!lead.doNotContact} events={events} tickets={detail.data?.tickets ?? []} canEdit={writable} dirty={dirty}
              pendingTo={pendingTo[channel] ?? ""} setPendingTo={(v) => setPendingTo((p) => ({ ...p, [channel]: v }))} refresh={refresh}
            />
          </div>
        </div>
      </main>

      <Sheet open={researchOpen} onOpenChange={setResearchOpen}>
        <SheetContent side="left" className="w-[92vw] max-w-[380px] overflow-y-auto p-5" data-testid="studio-research-sheet">
          <SheetHeader className="sr-only"><SheetTitle>Research on {lead.companyName}</SheetTitle><SheetDescription>What DealInSec found, and where.</SheetDescription></SheetHeader>
          <IntelPanel lead={lead} leadId={id} />
        </SheetContent>
      </Sheet>
      <BottomNav />
    </div>
  );
}
