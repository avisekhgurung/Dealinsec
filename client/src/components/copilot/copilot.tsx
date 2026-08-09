/**
 * DealinSec Copilot — floating "✨ Ask DealinSec" button + chat drawer.
 *
 * Native to the design system: emerald identity, glass surfaces, dark-mode
 * aware, mobile sheet / desktop panel. Conversation lives in component state
 * (v1): scoped to this tab, capped, sent with each request; the server is
 * authoritative for org/permissions on every turn. Mutations only happen
 * through explicit confirm buttons ([Cancel][Create]) — never silently.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Sparkles, X, SendHorizonal, Loader2, ArrowRight, Check, Bot,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";

interface CopilotAction {
  type: "navigate" | "confirm";
  label: string;
  to?: string;
  tool?: string;
  args?: Record<string, unknown>;
}

interface Msg {
  role: "user" | "assistant";
  content: string;
  actions?: CopilotAction[];
  /** set after a confirm action resolves */
  done?: boolean;
}

const QUICK_ACTIONS = [
  "What should I do next?",
  "Show me my pending work",
  "Find something",
  "How does DealInSec work?",
];

const WELCOME =
  "Hi 👋 I'm DealinSec Copilot.\nI can explain DealInSec, find your deals, quotations, agreements or invoices, and guide you through your workflow.";

/** Derive page context from the current route — advisory only; the server
 *  re-authorizes everything. */
function pageContext(route: string) {
  const dealMatch = route.match(/^\/deals\/(\d+)/);
  if (dealMatch) return { page: "deal-details", route, entityType: "deal", entityId: Number(dealMatch[1]) };
  const contractMatch = route.match(/^\/contracts\/(\d+)/);
  if (contractMatch) return { page: "agreement-details", route, entityType: "contract", entityId: Number(contractMatch[1]) };
  const invoiceMatch = route.match(/^\/brand-invoices\/(\d+)/);
  if (invoiceMatch) return { page: "invoice-details", route, entityType: "invoice", entityId: Number(invoiceMatch[1]) };
  const page = route.split("/")[1] || "dashboard";
  return { page, route };
}

export function Copilot() {
  const { isAuthenticated } = useAuth();
  const [location, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const ctx = useMemo(() => pageContext(location), [location]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy, open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 120);
  }, [open]);

  if (!isAuthenticated) return null;

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    const next: Msg[] = [...messages, { role: "user", content: trimmed }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const res = await apiRequest("POST", "/api/copilot/chat", {
        messages: next.map(({ role, content }) => ({ role, content })).slice(-16),
        context: ctx,
      });
      const data = await res.json();
      setMessages((cur) => [...cur, { role: "assistant", content: data.reply, actions: data.actions }]);
    } catch (err: any) {
      setMessages((cur) => [
        ...cur,
        { role: "assistant", content: err?.message?.includes("429") ? "You've reached today's Copilot limit — back tomorrow!" : "I couldn't complete that right now. Please try again." },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const runConfirm = async (msgIndex: number, action: CopilotAction) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await apiRequest("POST", "/api/copilot/execute", { tool: action.tool, args: action.args });
      const data = await res.json();
      setMessages((cur) => {
        const copy = [...cur];
        copy[msgIndex] = { ...copy[msgIndex], done: true };
        const followUp: Msg = {
          role: "assistant",
          content: data.message ?? (data.ok ? "Done!" : "That didn't work."),
          actions: data.ok && data.route ? [{ type: "navigate", label: "Open it", to: data.route }] : undefined,
        };
        return [...copy, followUp];
      });
    } catch (err: any) {
      setMessages((cur) => [...cur, { role: "assistant", content: "That didn't work — your role may not allow it." }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* Floating trigger — above the mobile bottom nav, corner on desktop */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          data-testid="copilot-button"
          aria-label="Ask DealinSec Copilot"
          className="fixed z-40 bottom-20 right-4 lg:bottom-6 lg:right-6 flex items-center gap-2 rounded-full pl-3.5 pr-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-600/30 hover:shadow-emerald-600/45 hover:-translate-y-0.5 transition-all"
          style={{ background: "linear-gradient(135deg, #10B981 0%, #059669 55%, #0D9488 100%)" }}
        >
          <Sparkles className="w-4 h-4 text-amber-300" />
          Ask DealinSec
        </button>
      )}

      {/* Drawer */}
      {open && (
        <div
          className="fixed z-50 inset-x-0 bottom-0 top-16 sm:inset-auto sm:bottom-4 sm:right-4 sm:w-[400px] sm:h-[600px] sm:max-h-[calc(100vh-2rem)] flex flex-col rounded-t-2xl sm:rounded-2xl border border-border bg-background shadow-2xl overflow-hidden animate-fade-in"
          data-testid="copilot-drawer"
          role="dialog"
          aria-label="DealinSec Copilot"
        >
          {/* Header */}
          <div
            className="flex items-center gap-2.5 px-4 py-3 text-white"
            style={{ background: "linear-gradient(135deg, hsl(160 84% 22%) 0%, hsl(174 70% 26%) 100%)" }}
          >
            <span className="w-8 h-8 rounded-xl bg-white/15 flex items-center justify-center">
              <Bot className="w-4.5 h-4.5 w-[18px] h-[18px]" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold leading-tight">DealinSec Copilot</p>
              <p className="text-[11px] text-emerald-100/80 leading-tight">Product help · find · guide</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close Copilot"
              data-testid="copilot-close"
              className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/15 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3.5 py-4 space-y-3">
            <Bubble role="assistant" content={WELCOME} />
            {messages.length === 0 && (
              <div className="flex flex-wrap gap-1.5 pl-9">
                {QUICK_ACTIONS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => send(q)}
                    className="text-xs font-medium px-2.5 py-1.5 rounded-full border border-emerald-300/60 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10 transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i}>
                <Bubble role={m.role} content={m.content} />
                {m.role === "assistant" && !!m.actions?.length && (
                  <div className="flex flex-wrap gap-1.5 mt-1.5 pl-9">
                    {m.actions.map((a, j) =>
                      a.type === "navigate" && a.to ? (
                        <Button
                          key={j}
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs font-semibold border-emerald-300/60 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-300"
                          onClick={() => {
                            setLocation(a.to!);
                          }}
                        >
                          {a.label} <ArrowRight className="w-3 h-3 ml-1" />
                        </Button>
                      ) : a.type === "confirm" ? (
                        <Button
                          key={j}
                          size="sm"
                          disabled={m.done || busy}
                          className="h-7 text-xs font-bold gradient-btn text-white"
                          onClick={() => runConfirm(i, a)}
                          data-testid="copilot-confirm"
                        >
                          {m.done ? <Check className="w-3 h-3 mr-1" /> : <Sparkles className="w-3 h-3 mr-1 text-amber-300" />}
                          {m.done ? "Done" : a.label}
                        </Button>
                      ) : null,
                    )}
                  </div>
                )}
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2 pl-9 text-muted-foreground text-xs">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> thinking…
              </div>
            )}
          </div>

          {/* Composer */}
          <form
            className="flex items-center gap-2 border-t border-border px-3 py-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask anything about DealInSec…"
              maxLength={1000}
              data-testid="copilot-input"
              className="flex-1 h-10 rounded-xl border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            />
            <Button
              type="submit"
              size="icon"
              disabled={busy || !input.trim()}
              aria-label="Send"
              data-testid="copilot-send"
              className="h-10 w-10 rounded-xl gradient-btn text-white shrink-0"
            >
              <SendHorizonal className="w-4 h-4" />
            </Button>
          </form>
        </div>
      )}
    </>
  );
}

/** Minimal safe formatting: only **bold** spans (the model's house style).
 *  Everything is plain text — no HTML from the model is ever rendered. */
function renderInline(text: string) {
  const parts = text.split(/\*\*([^*]+)\*\*/g);
  return parts.map((part, i) => (i % 2 === 1 ? <b key={i}>{part}</b> : part));
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
      <div className="max-w-[85%] rounded-2xl rounded-tl-md px-3.5 py-2 text-sm bg-muted/70 text-foreground whitespace-pre-wrap">
        {renderInline(content)}
      </div>
    </div>
  );
}
