/**
 * Start a coworker's task from the page: a short form with the task's own fields, the scope stated up front, and the
 * same server checks as the chat (input validation, the plan's limits, one run per click).
 */
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useUpgradeModal } from "@/components/upgrade-modal";
import { isUpgradeError, parseApiError } from "@/lib/api-error";
import { leadError } from "@/lib/leads";
import { BOTS, BOT_IDENTITY, LEAGUE_LIMITS, TASK_LABEL, type Bot, type LeagueTask } from "@shared/ai-league";
import { cn } from "@/lib/utils";
import { refreshLeague, startTask, type RunView } from "@/lib/ai-league";
import { Mascot } from "./mascot";
import { campaignTimes, campaignTimesProblem, fromLocal, showTime } from "@shared/league-campaign";

const TASK_OF: Record<Bot, LeagueTask> = { nibo: "nibo.find_clients", mika: "mika.first_messages", zee: "zee.briefing" };
const SCOPE: Record<LeagueTask, string> = {
  "nibo.find_clients": "Uses one AI Outbound search from your plan, checks each company's own website, and saves up to the number above of the qualified ones to Leads, with evidence and sources. Nobody is contacted.",
  "mika.first_messages": "Drafts first emails from what's verified about each lead. Nothing is sent: every draft waits for your approval in Outreach. Mika can prepare the draft. Copy it and send it through your email or messaging app.",
  "zee.briefing": "Reads your own invoices, agreements, deals, follow-ups and outreach in DealInSec and reports what needs attention. Nothing is changed.",
  "team.huddle": "Nibo, Mika and Zee each give their view from your workspace records, twice, then the lead sums up with suggested next steps. Nothing is changed or sent.",
  "nibo.campaign": "Runs on DealInSec's server, so you can close this page: one AI Outbound search at a time (each from your plan, up to 10 companies), qualified companies saved to Leads with evidence, and a report at the time you choose. Nobody is contacted.",
};

/** A coworker's own task, or (`huddle`) a team huddle that coworker leads. */
export function TaskDialog({ bot, open, onOpenChange, onStarted, initialRequest, huddle = false }: { bot: Bot; open: boolean; onOpenChange: (o: boolean) => void; onStarted: (run: RunView) => void; initialRequest?: string; huddle?: boolean }) {
  const { toast } = useToast();
  const { openUpgradeModal } = useUpgradeModal();
  const [lead, setLead] = useState<Bot>(bot);
  const [request, setRequest] = useState(initialRequest ?? "");
  // Nibo: one quick search, or a campaign that runs on the server for hours and reports at a set time.
  const [mode, setMode] = useState<"quick" | "campaign">("quick");
  const task: LeagueTask = huddle ? "team.huddle" : bot === "nibo" && mode === "campaign" ? "nibo.campaign" : TASK_OF[bot], id = BOT_IDENTITY[huddle ? lead : bot];
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata";
  const [target, setTarget] = useState(10);
  const [searches, setSearches] = useState(3);
  const [deliverLocal, setDeliverLocal] = useState("");
  const [startLocal, setStartLocal] = useState("");
  const campaign = (() => {
    if (task !== "nibo.campaign") return null;
    const deliverAt = deliverLocal ? fromLocal(deliverLocal, tz) : null;
    const startAt = startLocal ? fromLocal(startLocal, tz) : null;
    const input = { request, target, maxSearches: searches, saveLeads: true, startAt: startAt?.toISOString() ?? null, workUntil: null, deliverAt: deliverAt?.toISOString() ?? null, timezone: tz };
    const problem = campaignTimesProblem(input, new Date());
    return { input, problem, times: problem ? null : campaignTimes(input, new Date()) };
  })();
  const [saveLeads, setSaveLeads] = useState(true);
  const [max, setMax] = useState(3);
  const start = useMutation({
    mutationFn: () => startTask(task, task === "nibo.campaign" ? campaign!.input : task === "nibo.find_clients" ? { request, saveLeads, maxLeads: max } : task === "mika.first_messages" ? { max } : task === "team.huddle" ? { topic: request, lead } : {}),
    onSuccess: (r) => { void refreshLeague(); onOpenChange(false); onStarted(r.run); toast({ title: r.existing ? "Already running" : huddle ? "The team is talking it over" : `${id.name} is on it`, description: "Progress shows here. It keeps going if you leave this page." }); },
    onError: (e) => { if (isUpgradeError(parseApiError(e))) { onOpenChange(false); openUpgradeModal({ feature: "outbound" }); } else toast({ title: "Couldn't start this task", description: leadError(e), variant: "destructive" }); },
  });
  const ready = ((task !== "nibo.find_clients" && task !== "team.huddle" && task !== "nibo.campaign") || request.trim().length >= 8) && !campaign?.problem;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="task-dialog">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <Mascot bot={huddle ? lead : bot} size={40} />
            <div className="text-left">
              <DialogTitle>{TASK_LABEL[task]}</DialogTitle>
              <DialogDescription className="text-left">{huddle ? `Led by ${id.name}, with the whole team` : `${id.name} · ${id.role}`}</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <form id="task-form" className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (ready && !start.isPending) start.mutate(); }}>
          {bot === "nibo" && !huddle && (
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="How Nibo should work">
              {([["quick", "Quick search", "One search, starting now"], ["campaign", "Research campaign", "Several searches over hours, with a report at a time you choose"]] as const).map(([m, label, hint]) => (
                <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} data-testid={`nibo-mode-${m}`}
                  className={cn("rounded-lg border px-3 py-2 text-left text-sm transition-colors", mode === m ? cn("border-transparent ring-2", id.accent.ring, id.accent.soft) : "hover:bg-muted/60")}>
                  <span className="block font-semibold">{label}</span><span className="block text-xs text-muted-foreground">{hint}</span>
                </button>
              ))}
            </div>
          )}
          {task === "nibo.campaign" && (
            <>
              <label className="flex flex-col gap-1.5 text-sm font-medium">Describe the type of client you're looking for, and where
                <Textarea value={request} onChange={(e) => setRequest(e.target.value)} rows={3} maxLength={LEAGUE_LIMITS.requestChars} placeholder="For example: Indian digital marketing agencies that may need web development" data-testid="campaign-request" />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1.5 text-sm font-medium">Qualified companies
                  <Input type="number" min={1} max={LEAGUE_LIMITS.campaignTarget} value={target} onChange={(e) => setTarget(Math.max(1, Math.min(LEAGUE_LIMITS.campaignTarget, Number(e.target.value) || 1)))} className="h-9" data-testid="campaign-target" />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium">Searches, at most
                  <Input type="number" min={1} max={LEAGUE_LIMITS.campaignSearches} value={searches} onChange={(e) => setSearches(Math.max(1, Math.min(LEAGUE_LIMITS.campaignSearches, Number(e.target.value) || 1)))} className="h-9" data-testid="campaign-searches" />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium">Report by (optional)
                  <Input type="datetime-local" value={deliverLocal} onChange={(e) => setDeliverLocal(e.target.value)} className="h-9" data-testid="campaign-deliver" />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium">Start at (optional)
                  <Input type="datetime-local" value={startLocal} onChange={(e) => setStartLocal(e.target.value)} className="h-9" data-testid="campaign-start" />
                </label>
              </div>
              <p className={cn("rounded-lg px-3 py-2 text-xs", campaign?.problem ? "bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300" : "bg-muted/60 text-muted-foreground")} role="status" data-testid="campaign-times">
                {campaign?.problem ?? (campaign?.times && `Starts ${startLocal ? showTime(campaign.times.startAt, tz) : "now"} · researches until ${showTime(campaign.times.workUntil, tz)} at the latest · report ${campaign.times.deliverAt ? showTime(campaign.times.deliverAt, tz) : "when it ends"} (${tz})`)}
              </p>
            </>
          )}
          {task === "nibo.find_clients" && (
            <>
              <label className="flex flex-col gap-1.5 text-sm font-medium">Describe the type of client you're looking for, and where
                <Textarea value={request} onChange={(e) => setRequest(e.target.value)} rows={3} maxLength={LEAGUE_LIMITS.requestChars} placeholder="For example: small businesses in Bengaluru that could use a website redesign" data-testid="task-request" />
              </label>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
                <label className="flex items-center gap-2 text-sm"><Switch checked={saveLeads} onCheckedChange={setSaveLeads} aria-label="Save qualified companies to Leads" />Save qualified companies to Leads</label>
                {saveLeads && (
                  <label className="flex items-center gap-2 text-sm">Up to
                    <Input type="number" min={1} max={LEAGUE_LIMITS.leadsPerRun} value={max} onChange={(e) => setMax(Math.max(1, Math.min(LEAGUE_LIMITS.leadsPerRun, Number(e.target.value) || 1)))} className="h-8 w-16" aria-label="How many to save" />
                  </label>
                )}
              </div>
            </>
          )}
          {task === "team.huddle" && (
            <>
            <label className="flex flex-col gap-1.5 text-sm font-medium">What should the team think about?
              <Textarea value={request} onChange={(e) => setRequest(e.target.value)} rows={3} maxLength={LEAGUE_LIMITS.requestChars} placeholder="How do we land 3 new clients this month?" data-testid="huddle-topic" />
            </label>
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">Who leads and sums up?</legend>
              <div className="grid grid-cols-3 gap-2">
                {BOTS.map((b) => (
                  <button key={b} type="button" onClick={() => setLead(b)} aria-pressed={lead === b} className={cn("flex items-center gap-2 rounded-lg border px-2 py-1.5 text-sm transition-colors", lead === b ? cn("border-transparent ring-2", BOT_IDENTITY[b].accent.ring, BOT_IDENTITY[b].accent.soft) : "hover:bg-muted/60")} data-testid={`huddle-lead-${b}`}>
                    <Mascot bot={b} size={26} />{BOT_IDENTITY[b].name}
                  </button>
                ))}
              </div>
            </fieldset>
            </>
          )}
          {task === "mika.first_messages" && (
            <label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm">Draft for up to
              <Input type="number" min={1} max={LEAGUE_LIMITS.draftsPerRun} value={max} onChange={(e) => setMax(Math.max(1, Math.min(LEAGUE_LIMITS.draftsPerRun, Number(e.target.value) || 1)))} className="h-8 w-16" aria-label="How many drafts" />
            </label>
          )}
          <p className="text-xs text-muted-foreground">{SCOPE[task]}</p>
        </form>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="task-form" disabled={!ready || start.isPending} className="gradient-btn text-white" data-testid="task-start">
            {start.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Start
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
