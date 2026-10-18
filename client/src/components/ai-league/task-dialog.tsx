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

const TASK_OF: Record<Bot, LeagueTask> = { nibo: "nibo.find_clients", mika: "mika.first_messages", zee: "zee.briefing" };
const SCOPE: Record<LeagueTask, string> = {
  "nibo.find_clients": "Runs an AI Outbound search (one of your plan's searches), checks each company's own website, and saves up to the number below of the qualified ones to Leads. No one is contacted.",
  "mika.first_messages": "Drafts first emails from what's verified about each lead. Nothing is sent: every draft waits for your approval in Outreach.",
  "zee.briefing": "Reads your invoices, agreements, deals, follow-ups and outreach and reports what needs you. Nothing is changed.",
  "team.huddle": "Nibo, Mika and Zee each give their view from their own records, twice, then the lead sums up with next steps. About a minute; nothing is changed or sent.",
};

/** A coworker's own task, or (`huddle`) a team huddle that coworker leads. */
export function TaskDialog({ bot, open, onOpenChange, onStarted, initialRequest, huddle = false }: { bot: Bot; open: boolean; onOpenChange: (o: boolean) => void; onStarted: (run: RunView) => void; initialRequest?: string; huddle?: boolean }) {
  const { toast } = useToast();
  const { openUpgradeModal } = useUpgradeModal();
  const [lead, setLead] = useState<Bot>(bot);
  const task: LeagueTask = huddle ? "team.huddle" : TASK_OF[bot], id = BOT_IDENTITY[huddle ? lead : bot];
  const [request, setRequest] = useState(initialRequest ?? "");
  const [saveLeads, setSaveLeads] = useState(true);
  const [max, setMax] = useState(3);
  const start = useMutation({
    mutationFn: () => startTask(task, task === "nibo.find_clients" ? { request, saveLeads, maxLeads: max } : task === "mika.first_messages" ? { max } : task === "team.huddle" ? { topic: request, lead } : {}),
    onSuccess: (r) => { void refreshLeague(); onOpenChange(false); onStarted(r.run); toast({ title: r.existing ? "Already running" : huddle ? "The team is talking it over" : `${id.name} is on it`, description: "Progress shows here. It keeps going if you leave this page." }); },
    onError: (e) => { if (isUpgradeError(parseApiError(e))) { onOpenChange(false); openUpgradeModal({ feature: "outbound" }); } else toast({ title: "Couldn't start the task", description: leadError(e), variant: "destructive" }); },
  });
  const ready = (task !== "nibo.find_clients" && task !== "team.huddle") || request.trim().length >= 8;
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
          {task === "nibo.find_clients" && (
            <>
              <label className="flex flex-col gap-1.5 text-sm font-medium">Who are you looking for, and where?
                <Textarea value={request} onChange={(e) => setRequest(e.target.value)} rows={3} maxLength={LEAGUE_LIMITS.requestChars} placeholder={id.suggestions[0]} data-testid="task-request" />
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
