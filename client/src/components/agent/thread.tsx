import { useEffect, useRef } from "react";
import { Bot, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ActivityStep } from "@shared/agent";
import type { ApprovalView, ThreadMessage } from "@/hooks/use-agent";
import { ActivityStrip, StepsSummary } from "./activity-strip";
import { CardView } from "./card-view";
import { RichText } from "./rich-text";

/**
 * The conversation. User messages sit on the right; the agent's replies are
 * plain text with its cards (findings, approvals, documents) underneath, so the
 * thread reads as actions rather than as a chat log.
 */
export function Thread({
  messages, approvals, running, steps, onStop, onRetry, onApprove, onDecline, onEditDraft, compact, header, footer,
}: {
  messages: ThreadMessage[];
  approvals: Record<string, ApprovalView>;
  running: boolean;
  steps: ActivityStep[];
  onStop: () => void;
  onRetry: () => void;
  onApprove: (approvalId: string, tool: string) => void;
  onDecline: (approvalId: string, tool: string) => void;
  onEditDraft?: (prefill: Record<string, unknown>) => void;
  compact?: boolean;
  header?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  // Follow the conversation, unless the person has scrolled up to read.
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, steps, running]);

  return (
    <div
      ref={scroller}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
      }}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      data-testid="agent-thread"
    >
      <div className={cn("mx-auto w-full space-y-5 px-3.5 py-5", compact ? "max-w-none" : "max-w-3xl sm:px-6")}>
        {header}
        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.key} className="flex justify-end">
              <div className="max-w-[88%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-emerald-600 px-3.5 py-2.5 text-sm leading-relaxed text-white sm:max-w-[80%]" data-testid="user-message">
                {m.content.length > 1400 ? `${m.content.slice(0, 1400)}…` : m.content}
              </div>
            </div>
          ) : (
            <div key={m.key} className="flex items-start gap-2.5" data-testid="agent-message">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-600/10 text-emerald-700 dark:text-emerald-400" aria-hidden>
                <Bot className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                {m.content && <RichText text={m.content} />}
                {m.error && (
                  <Button size="sm" variant="outline" onClick={onRetry} className="mt-2 h-8 text-xs font-semibold" data-testid="agent-retry">
                    <RefreshCw className="mr-1 h-3 w-3" /> Try again
                  </Button>
                )}
                {m.cards.length > 0 && (
                  <div className="mt-2.5 space-y-2.5">
                    {m.cards.map((c, i) => (
                      <CardView key={`${m.key}-${i}`} card={c} approvals={approvals} onApprove={onApprove} onDecline={onDecline} onEditDraft={onEditDraft} />
                    ))}
                  </div>
                )}
                {m.steps && <StepsSummary steps={m.steps} />}
              </div>
            </div>
          ),
        )}
        {running && (
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-600/10 text-emerald-700 dark:text-emerald-400" aria-hidden><Bot className="h-4 w-4" /></span>
            <div className="min-w-0 flex-1"><ActivityStrip steps={steps} onStop={onStop} /></div>
          </div>
        )}
        {footer}
      </div>
    </div>
  );
}
