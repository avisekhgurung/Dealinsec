import { motion } from "framer-motion";
import { fadeUp, useCalmMotion } from "@/lib/motion";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown, Bot, ChevronDown, ChevronUp, PencilLine, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isFollowing, isLongMessage, onContentChange } from "@/lib/chat/interaction";
import type { ActivityStep } from "@shared/agent";
import type { ApprovalView, ThreadMessage } from "@/hooks/use-agent";
import { ActivityStrip, StepsSummary } from "./activity-strip";
import { CardView } from "./card-view";
import { CopyButton, RichText } from "./rich-text";

/** Who is answering: Agent mode's own assistant, or an AI League coworker with its mascot. */
export interface AssistantIdentity { name: string; avatar: ReactNode }
const DEFAULT_ASSISTANT: AssistantIdentity = {
  name: "DealInSec",
  avatar: <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-600/10 text-emerald-700 dark:text-emerald-400"><Bot className="h-4 w-4" /></span>,
};

/** Actions under a message: always reachable by keyboard and touch; on a desktop pointer they appear on hover/focus. */
const ACTIONS = "mt-1 flex flex-wrap items-center gap-0.5 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 [@media(hover:none)]:opacity-100";

function UserMessage({ text, canEdit, onEdit }: { text: string; canEdit: boolean; onEdit?: (text: string) => void }) {
  const long = isLongMessage(text);
  const [open, setOpen] = useState(false);
  return (
    <div className="group flex flex-col items-end">
      <div className="max-w-[88%] rounded-2xl rounded-br-md bg-emerald-600 px-3.5 py-2.5 text-sm leading-relaxed text-white sm:max-w-[80%]" data-testid="user-message">
        <div className={cn("whitespace-pre-wrap break-words", long && !open && "line-clamp-[12]")}>{text}</div>
        {long && (
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mt-1.5 inline-flex items-center gap-1 rounded text-xs font-semibold text-white/90 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70" data-testid="user-message-toggle">
            {open ? <><ChevronUp className="h-3 w-3" aria-hidden />Show less</> : <><ChevronDown className="h-3 w-3" aria-hidden />Show more</>}
          </button>
        )}
      </div>
      <div className={ACTIONS}>
        <CopyButton text={text} testId="user-message-copy" />
        {canEdit && onEdit && (
          <button type="button" onClick={() => onEdit(text)} className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 sm:h-7" data-testid="user-message-edit" aria-label="Edit this message and send it again">
            <PencilLine className="h-3.5 w-3.5" aria-hidden />Edit
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The conversation. User messages sit on the right; the assistant's replies are Markdown (headings, lists, code, tables,
 * safe links) with its cards (findings, approvals, documents) underneath, so the thread reads as actions rather than
 * as a chat log.
 *
 * Scrolling: the thread follows new content only while the reader is at the bottom (or has just sent a message, or
 * opened the conversation); reading earlier messages is never interrupted, and "Jump to latest" appears when something
 * new arrives below. Content that grows after it renders (a card, a code block) keeps a following reader at the bottom.
 */
export function Thread({
  messages, approvals, running, steps, live = "", onStop, onRetry, onApprove, onDecline, onEditDraft, onEditLast, compact, header, footer, assistant = DEFAULT_ASSISTANT,
}: {
  messages: ThreadMessage[];
  approvals: Record<string, ApprovalView>;
  running: boolean;
  steps: ActivityStep[];
  /** The reply as it streams in (replaced by the saved message when it arrives). */
  live?: string;
  onStop: () => void;
  onRetry: () => void;
  onApprove: (approvalId: string, tool: string) => void;
  onDecline: (approvalId: string, tool: string) => void;
  onEditDraft?: (prefill: Record<string, unknown>) => void;
  /** Puts the last message back in the box to change and send again (a new message; the old one stays). */
  onEditLast?: (text: string) => void;
  compact?: boolean;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  assistant?: AssistantIdentity;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const programmatic = useRef(false);
  const [jump, setJump] = useState<"none" | "away" | "new">("none");
  const calm = useCalmMotion();

  const toBottom = useCallback((smooth = false) => {
    const el = scroller.current;
    if (!el) return;
    programmatic.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth && !calm ? "smooth" : "auto" });
    following.current = true;
    setJump("none");
    // The scroll event(s) this causes are ours, not the reader's.
    requestAnimationFrame(() => requestAnimationFrame(() => { programmatic.current = false; }));
  }, [calm]);

  // New messages and steps: follow, or offer "Jump to latest". Layout effect, so there's no visible jump.
  const prev = useRef<{ count: number; lastKey: string | null }>({ count: 0, lastKey: null });
  useLayoutEffect(() => {
    const last = messages.at(-1);
    const added = Math.max(0, messages.length - prev.current.count);
    const firstLoad = prev.current.count === 0 && messages.length > 0;
    const lastIsOwnNewMessage = !!last && last.role === "user" && last.key !== prev.current.lastKey;
    prev.current = { count: messages.length, lastKey: last?.key ?? null };
    const what = onContentChange({ following: following.current, added, lastIsOwnNewMessage, firstLoad });
    if (what === "follow") toBottom();
    else if (what === "mark-new") setJump("new");
  }, [messages, toBottom]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { if (following.current) toBottom(); }, [steps.length, running, live.length, toBottom]);

  // Anything that changes height later (cards loading, images, a folded message opening) keeps a follower pinned.
  useEffect(() => {
    const el = content.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => { if (following.current) toBottom(); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [toBottom]);

  // Only messages that arrive during the conversation animate in; a loaded history (many at once) appears as it is.
  // A message keeps its animation props for its whole life: removing `animate` on a later render (a step, a scroll
  // state change) would freeze framer-motion mid-fade, leaving the message invisible.
  const seen = useRef<Set<string> | null>(null);
  const animated = useRef(new Set<string>());
  if (seen.current) {
    const added = messages.filter((m) => !seen.current!.has(m.key));
    if (added.length <= 2) for (const m of added) animated.current.add(m.key);
  }
  useEffect(() => { seen.current = new Set(messages.map((m) => m.key)); }, [messages]);
  const enter = (key: string) => (animated.current.has(key) ? { initial: "hidden" as const, animate: "visible" as const, variants: fadeUp } : {});
  const lastUserKey = [...messages].reverse().find((m) => m.role === "user")?.key;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        onScroll={(e) => {
          if (programmatic.current) return;
          const now = isFollowing(e.currentTarget);
          following.current = now;
          setJump((j) => (now ? "none" : j === "new" ? "new" : "away"));
        }}
        className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain"
        role="log"
        aria-label={`Conversation with ${assistant.name}`}
        aria-busy={running}
        data-testid="agent-thread"
      >
        <div ref={content} className={cn("mx-auto w-full space-y-5 px-3.5 py-5", compact ? "max-w-none" : "max-w-3xl sm:px-6")}>
          {header}
          {messages.map((m) =>
            m.role === "user" ? (
              <motion.div key={m.key} {...enter(m.key)}>
                <UserMessage text={m.content} canEdit={m.key === lastUserKey && !running} onEdit={onEditLast} />
              </motion.div>
            ) : (
              <motion.div key={m.key} className="group flex items-start gap-2.5" data-testid="agent-message" {...enter(m.key)}>
                <span className="mt-0.5 shrink-0" aria-hidden>{assistant.avatar}</span>
                <div className="min-w-0 flex-1">
                  <span className="sr-only">{assistant.name}:</span>
                  {m.content && <RichText text={m.content} />}
                  {m.error && (
                    <Button size="sm" variant="outline" onClick={onRetry} disabled={running} className="mt-2 h-8 text-xs font-semibold" data-testid="agent-retry">
                      <RefreshCw className="mr-1 h-3 w-3" aria-hidden /> Try again
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
                  {m.content && !m.error && <div className={ACTIONS}><CopyButton text={m.content} label="Copy reply" testId="agent-message-copy" /></div>}
                </div>
              </motion.div>
            ),
          )}
          {running && (
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 shrink-0" aria-hidden>{assistant.avatar}</span>
              <div className="min-w-0 flex-1">
                {/* The reply as it is written. aria-busy on the log keeps screen readers from reading every piece;
                    the finished message is announced once it arrives. */}
                {live && <div className="dis-streaming" data-testid="agent-live"><RichText text={live} /></div>}
                {(!live || steps.some((s) => s.state === "active")) && (
                  <div className={live ? "mt-2" : undefined}><ActivityStrip steps={steps} onStop={onStop} who={assistant.name} /></div>
                )}
              </div>
            </div>
          )}
          {footer}
        </div>
      </div>
      {jump !== "none" && (
        <button type="button" onClick={() => toBottom(true)}
          className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border bg-background/95 px-3 py-1.5 text-xs font-semibold shadow-md backdrop-blur transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          data-testid="jump-to-latest">
          <ArrowDown className="h-3.5 w-3.5" aria-hidden />{jump === "new" ? "New messages · Jump to latest" : "Jump to latest"}
        </button>
      )}
    </div>
  );
}
