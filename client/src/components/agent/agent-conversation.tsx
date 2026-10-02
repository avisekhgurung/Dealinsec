import { useState } from "react";
import { Sparkles } from "lucide-react";
import { useLocation } from "wouter";
import { useAudience } from "@/hooks/use-audience";
import type { useAgent } from "@/hooks/use-agent";
import { Composer } from "./composer";
import { starters } from "./starters";
import { Thread } from "./thread";

type Agent = ReturnType<typeof useAgent>;

function Empty({ onPaste, onPrompt, pasteLabel, prompts }: { onPaste: () => void; onPrompt: (p: string) => void; pasteLabel: string; prompts: string[] }) {
  return (
    <div className="px-1 pb-2 pt-6 text-center sm:pt-12" data-testid="agent-empty">
      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-600/10 text-emerald-700 dark:text-emerald-400"><Sparkles className="h-5 w-5" /></span>
      <h2 className="mt-3 text-xl font-bold tracking-tight sm:text-2xl">What should we handle?</h2>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
        Paste a message and I'll read it, flag what's missing, and prepare the deal. I ask before I change anything that matters.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <button type="button" onClick={onPaste} data-testid="starter-paste"
          className="rounded-full border border-emerald-300 bg-emerald-50 px-3.5 py-2 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
          {pasteLabel}
        </button>
        {prompts.map((p) => (
          <button key={p} type="button" onClick={() => onPrompt(p)}
            className="rounded-full border border-border bg-background px-3.5 py-2 text-xs font-medium text-foreground/80 transition hover:bg-muted/60">
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Thread + composer, shared by the /agent page and the compact Copilot drawer.
 * `emptyState` lets the drawer show the daily briefing instead of the starter.
 */
export function AgentConversation({
  agent, compact, emptyState, disabledReason, extraPrompts,
}: {
  agent: Agent;
  compact?: boolean;
  emptyState?: React.ReactNode;
  disabledReason?: string | null;
  extraPrompts?: string[];
}) {
  const audience = useAudience();
  const [, setLocation] = useLocation();
  const [seed, setSeed] = useState({ text: "", n: 0 });
  const s = starters(audience);
  const empty = agent.messages.length === 0 && !agent.running && !agent.loading;

  // Edit hands the validated draft to the ordinary deal form, prefilled.
  const editDraft = (prefill: Record<string, unknown>) => {
    try { sessionStorage.setItem("dis_deal_prefill", JSON.stringify(prefill)); } catch { /* the form just opens empty */ }
    setLocation("/deals/new");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Thread
        messages={agent.messages}
        approvals={agent.approvals}
        running={agent.running}
        steps={agent.steps}
        onStop={agent.stop}
        onRetry={agent.retry}
        onApprove={agent.approve}
        onDecline={agent.reject}
        onEditDraft={editDraft}
        compact={compact}
        header={empty ? (emptyState ?? <Empty onPaste={() => setSeed((x) => ({ text: s.paste, n: x.n + 1 }))} onPrompt={agent.send} pasteLabel={s.pasteLabel} prompts={[...(extraPrompts ?? []), ...s.prompts].slice(0, 4)} />) : agent.loading ? (
          <div className="space-y-3" aria-busy="true"><div className="h-4 w-2/3 animate-pulse rounded bg-muted" /><div className="h-4 w-1/2 animate-pulse rounded bg-muted" /></div>
        ) : null}
      />
      <div className="shrink-0 border-t border-border/70 bg-background/95 px-3.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        <div className={compact ? "" : "mx-auto w-full max-w-3xl sm:px-3"}>
          {disabledReason && <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" role="alert">{disabledReason}</p>}
          <Composer
            onSend={agent.send}
            onStop={agent.stop}
            running={agent.running}
            disabled={!!disabledReason}
            seed={seed}
            placeholder="Paste a message or ask…"
          />
          <p className="mt-1.5 text-center text-[11px] text-muted-foreground">Check what it prepares before you approve it.</p>
        </div>
      </div>
    </div>
  );
}
