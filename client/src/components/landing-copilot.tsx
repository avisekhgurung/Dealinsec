/**
 * Landing Copilot — the public product guide (marketing funnel).
 *
 * A visitor can interrogate DealInSec before signing up: "can it handle 50%
 * advance?", "is it GST ready?", "what does it cost?". It answers from the
 * same /ai-knowledge base the in-app Copilot uses, so marketing can never
 * drift from the product. It has NO database access and NO tools — it is a
 * product guide, not an account. After a few exchanges it nudges the trial.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sparkles, X, SendHorizonal, Loader2, ArrowRight, MessageSquareText, ShieldAlert, IndianRupee } from "lucide-react";

const OPENER =
  "Ask me anything about DealInSec — how the workflow runs, what it costs, whether it fits how you bill clients.";

const SUGGESTIONS = [
  "How does DealInSec help me get paid faster?",
  "Can I do 50% advance and 50% on delivery?",
  "What does it cost?",
  "Is this useful for an interior designer?",
];

interface Msg { role: "user" | "assistant"; content: string }

/** One chat, two placements: the floating bubble and the inline section on the
 *  landing page. Extracted so the two can never drift apart. */
function useCopilotChat() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    const next: Msg[] = [...messages, { role: "user", content: trimmed }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/copilot/public", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.slice(-8) }),
      });
      const data = await res.json();
      setMessages((cur) => [
        ...cur,
        { role: "assistant", content: data.reply ?? data.error ?? "Sorry — try again in a moment." },
      ]);
    } catch {
      setMessages((cur) => [...cur, { role: "assistant", content: "Sorry — try again in a moment." }]);
    } finally {
      setBusy(false);
    }
  };

  // After a real conversation, put the trial in front of them.
  const showCta = messages.filter((m) => m.role === "assistant").length >= 2;

  return { messages, input, setInput, busy, send, showCta, scrollRef, inputRef };
}

/** The message list + suggestion chips + composer. Layout-agnostic. */
function ChatBody({ chat, onCta, className }: {
  chat: ReturnType<typeof useCopilotChat>;
  onCta: () => void;
  className?: string;
}) {
  const { messages, input, setInput, busy, send, showCta, scrollRef, inputRef } = chat;
  return (
    <>
      <div ref={scrollRef} className={`flex-1 overflow-y-auto px-3.5 py-4 space-y-3 ${className ?? ""}`}>
        <Bubble role="assistant" content={OPENER} />
        {messages.length === 0 && (
          <div className="flex flex-wrap gap-1.5 pl-9">
            {SUGGESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => send(q)}
                className="text-xs font-medium px-2.5 py-1.5 rounded-full border border-emerald-300/60 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10 transition-colors text-left"
              >
                {q}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => <Bubble key={i} role={m.role} content={m.content} />)}
        {busy && (
          <div className="flex items-center gap-2 pl-9 text-xs text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> thinking…
          </div>
        )}
        {showCta && !busy && (
          <div className="ml-9 rounded-xl border border-emerald-300/60 dark:border-emerald-800/60 bg-emerald-500/[0.06] p-3">
            <p className="text-xs text-neutral-700 dark:text-neutral-300 mb-2">
              The quickest way to see it: put your last 3 deals in. 7-day trial, no card.
            </p>
            <Button size="sm" className="h-8 text-xs font-bold gradient-btn text-white" onClick={onCta} data-testid="landing-copilot-cta">
              Start managing deals <ArrowRight className="w-3 h-3 ml-1" />
            </Button>
          </div>
        )}
      </div>

      <form
        className="flex items-center gap-2 border-t border-neutral-200 dark:border-neutral-800 px-3 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] shrink-0"
        onSubmit={(e) => { e.preventDefault(); send(input); }}
      >
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type your question…"
          maxLength={500}
          data-testid="landing-copilot-input"
          className="flex-1 h-10 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
        />
        <Button type="submit" size="icon" disabled={busy || !input.trim()} aria-label="Send" className="h-10 w-10 rounded-xl gradient-btn text-white shrink-0">
          <SendHorizonal className="w-4 h-4" />
        </Button>
      </form>
    </>
  );
}

/**
 * Inline section — the chat sits OPEN in the page instead of hiding behind a
 * button. A visitor who never thinks to click a bubble still sees a live
 * assistant they can type into, which is the whole point of putting it on a
 * marketing page.
 */
/** The three real AI capabilities, stated exactly as the product does them —
 *  each ends with the trust rule because that IS the differentiator. */
const AI_CAPABILITIES = [
  {
    icon: MessageSquareText,
    title: "Paste the chat, get the deal",
    body: "Paste a client's WhatsApp conversation into Copilot — it extracts the client, scope, amount and payment terms, and drafts the deal. You confirm, it exists. It never invents a number that wasn't said.",
  },
  {
    icon: ShieldAlert,
    title: "It reads your terms like a sceptic",
    body: "Protection Check flags risky wording — “unlimited revisions”, “pay when our client pays” — and the protections you forgot: advance, revision limits, exclusions. One tap suggests the missing lines.",
  },
  {
    icon: IndianRupee,
    title: "It chases your money, politely",
    body: "Copilot knows what's overdue and drafts the follow-up — English or Hinglish, your choice of tone, always the real invoice number and amount. You press send, never it.",
  },
];

export function LandingCopilotSection({ onCta }: { onCta: () => void }) {
  const chat = useCopilotChat();
  return (
    <section id="ask" className="py-20 sm:py-28 border-t border-neutral-200 dark:border-neutral-800">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-10">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-emerald-600 dark:text-emerald-400 mb-3">
            <Sparkles className="w-3.5 h-3.5" />
            DealInSec Copilot · AI that acts — with your approval
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Paste the WhatsApp chat. Get the deal.
          </h2>
          <p className="text-neutral-600 dark:text-neutral-400 mt-3 max-w-2xl mx-auto">
            Copilot turns conversations into deals, checks your terms for the gaps that cost money, and
            writes the payment reminders you keep postponing. The numbers are never AI — every ₹ is
            computed from your records. AI writes the words; you approve every action.
          </p>
        </div>

        <div className="grid sm:grid-cols-3 gap-4 mb-12">
          {AI_CAPABILITIES.map((cap) => (
            <div
              key={cap.title}
              className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-5 text-left shadow-sm"
            >
              <span className="inline-flex w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/60 dark:border-emerald-800/60 items-center justify-center mb-3">
                <cap.icon className="w-[18px] h-[18px] text-emerald-600 dark:text-emerald-400" />
              </span>
              <p className="text-sm font-bold mb-1.5">{cap.title}</p>
              <p className="text-[13px] leading-relaxed text-neutral-600 dark:text-neutral-400">{cap.body}</p>
            </div>
          ))}
        </div>

        <div className="text-center mb-6">
          <p className="text-sm font-semibold text-neutral-500 dark:text-neutral-400">
            Not sure it fits how you work? Ask it — no sign-up, no email. It answers from the same
            product knowledge the app uses.
          </p>
        </div>

        <div className="relative">
          {/* Soft glow to pull the eye to the one thing on this page you can use right now. */}
          <div
            className="absolute -inset-3 rounded-[28px] opacity-40 blur-2xl pointer-events-none animate-pulse"
            style={{ background: "linear-gradient(135deg, #10B98133, #0D948833)" }}
            aria-hidden="true"
          />
          <div className="relative flex flex-col h-[520px] rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 shadow-2xl shadow-emerald-900/5 overflow-hidden">
            <div
              className="flex items-center gap-2.5 px-4 py-3 text-white shrink-0"
              style={{ background: "linear-gradient(135deg, hsl(160 84% 22%) 0%, hsl(174 70% 26%) 100%)" }}
            >
              <span className="w-8 h-8 rounded-xl bg-white/15 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-amber-300" />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold leading-tight">Ask DealInSec</p>
                <p className="text-[11px] text-emerald-100/80 leading-tight">Product guide · no account needed</p>
              </div>
            </div>
            <ChatBody chat={chat} onCta={onCta} />
          </div>
        </div>
      </div>
    </section>
  );
}

/** Floating bubble — stays available everywhere else on the page. */
export function LandingCopilot({ onCta }: { onCta: () => void }) {
  const [open, setOpen] = useState(false);
  const chat = useCopilotChat();

  useEffect(() => {
    if (open) setTimeout(() => chat.inputRef.current?.focus(), 150);
  }, [open, chat.inputRef]);

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          data-testid="landing-copilot-button"
          aria-label="Ask DealInSec a question"
          className="fixed z-40 bottom-5 right-5 flex items-center gap-2 rounded-full pl-3.5 pr-4 py-3 text-sm font-semibold text-white shadow-xl shadow-emerald-600/30 hover:shadow-emerald-600/50 hover:-translate-y-0.5 transition-all"
          style={{ background: "linear-gradient(135deg, #10B981 0%, #059669 55%, #0D9488 100%)" }}
        >
          <Sparkles className="w-4 h-4 text-amber-300" />
          Ask about DealInSec
        </button>
      )}

      {open && (
        <div
          className="fixed z-[60] inset-0 sm:inset-auto sm:bottom-5 sm:right-5 sm:w-[400px] sm:h-[560px] sm:max-h-[calc(100vh-2.5rem)] flex flex-col sm:rounded-2xl border-0 sm:border sm:border-neutral-200 dark:sm:border-neutral-800 bg-white dark:bg-neutral-950 shadow-2xl overflow-hidden"
          role="dialog"
          aria-label="Ask about DealInSec"
          data-testid="landing-copilot-panel"
        >
          <div
            className="flex items-center gap-2.5 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:pt-3 text-white shrink-0"
            style={{ background: "linear-gradient(135deg, hsl(160 84% 22%) 0%, hsl(174 70% 26%) 100%)" }}
          >
            <span className="w-8 h-8 rounded-xl bg-white/15 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-amber-300" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold leading-tight">Ask DealInSec</p>
              <p className="text-[11px] text-emerald-100/80 leading-tight">Answers from the real product</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/15 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
          <ChatBody chat={chat} onCta={onCta} />
        </div>
      )}
    </>
  );
}

function Bubble({ role, content }: { role: "user" | "assistant"; content: string }) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md px-3.5 py-2 text-sm text-white whitespace-pre-wrap" style={{ background: "linear-gradient(135deg, #059669, #0D9488)" }}>
          {content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2">
      <span className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
        <Sparkles className="w-3.5 h-3.5" />
      </span>
      <div className="max-w-[85%] rounded-2xl rounded-tl-md px-3.5 py-2 text-sm bg-neutral-100 dark:bg-neutral-900 text-neutral-800 dark:text-neutral-200 whitespace-pre-wrap">
        {content.split(/\*\*([^*]+)\*\*/g).map((p, i) => (i % 2 === 1 ? <b key={i}>{p}</b> : p))}
      </div>
    </div>
  );
}
