/**
 * DealinSec Copilot — the AI deal manager surface.
 *
 * Opens with a DAILY BRIEFING, not "how can I help": deterministic
 * intelligence (Money Radar, next best actions) computed server-side from
 * real rows — the model never invents a number. AI is used only to DRAFT
 * words (Payment Chaser) and to answer conversation, and every draft is
 * copy-only: nothing is ever sent on the user's behalf.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Sparkles, X, SendHorizonal, Loader2, ArrowRight, Check, Bot,
  AlertTriangle, Clock, Receipt, Copy as CopyIcon, RefreshCw, ShieldCheck,
} from "lucide-react";
import { apiRequest, getQueryFn, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

/* ── types mirrored from server/copilot/insights.ts ── */
interface Briefing {
  greetingName: string;
  attentionCount: number;
  radar: {
    overdue: { total: number; count: number; invoices: { id: number; brandName: string; amount: number; daysOverdue: number; invoiceNumber: string }[] };
    dueThisWeek: { total: number; count: number; invoices: { id: number; brandName: string; amount: number; dueDate: string; invoiceNumber: string }[] };
    readyToInvoice: { total: number; count: number; contracts: { id: number; dealId: number; brandName: string; remaining: number; contractName: string }[] };
    collectible: number;
  };
  nextActions: { dealId: number; dealTitle: string; brandName: string; action: string; route: string; urgency: "red" | "yellow" | "green" }[];
}

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
  done?: boolean;
  /** chaser draft card */
  chaser?: { invoiceId: number; tone: string };
}

const TONES = ["Friendly", "Professional", "Firm", "Final reminder", "Hinglish"] as const;

const LOADING_STAGES = [
  "Reviewing your active deals…",
  "Checking payment status…",
  "Totalling what's collectible…",
];

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function pageContext(route: string) {
  const dealMatch = route.match(/^\/deals\/(\d+)/);
  if (dealMatch) return { page: "deal-details", route, entityType: "deal", entityId: Number(dealMatch[1]) };
  const contractMatch = route.match(/^\/contracts\/(\d+)/);
  if (contractMatch) return { page: "agreement-details", route, entityType: "contract", entityId: Number(contractMatch[1]) };
  const invoiceMatch = route.match(/^\/brand-invoices\/(\d+)/);
  if (invoiceMatch) return { page: "invoice-details", route, entityType: "invoice", entityId: Number(invoiceMatch[1]) };
  return { page: route.split("/")[1] || "dashboard", route };
}

/** Rotating staged loading line — intentional, not a generic spinner. */
function StagedLoading() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((x) => (x + 1) % LOADING_STAGES.length), 900);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground py-6 justify-center">
      <Loader2 className="w-3.5 h-3.5 animate-spin" /> {LOADING_STAGES[i]}
    </div>
  );
}

export function Copilot() {
  const { isAuthenticated, user } = useAuth();
  const { toast } = useToast();
  const [location, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const ctx = useMemo(() => pageContext(location), [location]);

  const { data: briefing, isLoading: briefingLoading, refetch: refetchBriefing } = useQuery<Briefing>({
    queryKey: ["/api/copilot/briefing"],
    queryFn: getQueryFn({ on401: "returnNull" }) as any,
    enabled: isAuthenticated && open,
    staleTime: 60_000,
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  if (!isAuthenticated) return null;

  const go = (to: string) => {
    setOpen(false);
    setLocation(to);
  };

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    const next: Msg[] = [...messages, { role: "user", content: trimmed }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const res = await apiRequest("POST", "/api/copilot/chat", {
        messages: next.filter((m) => !m.chaser).map(({ role, content }) => ({ role, content })).slice(-16),
        context: ctx,
      });
      const data = await res.json();
      setMessages((cur) => [...cur, { role: "assistant", content: data.reply, actions: data.actions }]);
    } catch {
      setMessages((cur) => [...cur, { role: "assistant", content: "I couldn't complete that right now. Please try again." }]);
    } finally {
      setBusy(false);
    }
  };

  const draftChaser = async (invoiceId: number, tone: string) => {
    if (busy) return;
    setBusy(true);
    setMessages((cur) => [
      ...cur.filter((m) => !(m.chaser && m.chaser.invoiceId === invoiceId)),
      { role: "user", content: `Prepare a ${tone.toLowerCase()} payment follow-up` },
    ]);
    try {
      const res = await apiRequest("POST", "/api/copilot/chaser", { invoiceId, tone });
      const data = await res.json();
      setMessages((cur) => [...cur, { role: "assistant", content: data.message, chaser: { invoiceId, tone } }]);
    } catch {
      setMessages((cur) => [...cur, { role: "assistant", content: "Couldn't draft that message right now — try again in a moment." }]);
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
      // A confirmed mutation changed real data — refresh the app's views.
      if (data.ok) {
        queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
        queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      }
      setMessages((cur) => {
        const copy = [...cur];
        copy[msgIndex] = { ...copy[msgIndex], done: true };
        return [...copy, {
          role: "assistant",
          content: data.message ?? (data.ok ? "Done!" : "That didn't work."),
          actions: data.ok && data.route ? [{ type: "navigate", label: "Open it", to: data.route }] : undefined,
        }];
      });
    } catch {
      setMessages((cur) => [...cur, { role: "assistant", content: "That didn't work — your role may not allow it." }]);
    } finally {
      setBusy(false);
    }
  };

  const quickPrompts =
    ctx.entityType === "deal"
      ? ["What should I do next on this deal?", "Is this deal healthy?", "Summarise this deal"]
      : ctx.entityType === "invoice"
        ? ["Is this invoice overdue?", "Prepare a payment reminder"]
        : ["Create a deal — I'll paste the client chat", "Which clients owe me money?", "What can I invoice today?", "Show my pending work"];

  const radar = briefing?.radar;
  const allClear = briefing && briefing.attentionCount === 0;
  const worstOverdue = radar?.overdue.invoices[0];

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          data-testid="copilot-button"
          aria-label="Open DealinSec Copilot"
          className="fixed z-40 bottom-20 right-4 lg:bottom-6 lg:right-6 flex items-center gap-2 rounded-full pl-3.5 pr-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-600/30 hover:shadow-emerald-600/45 hover:-translate-y-0.5 transition-all"
          style={{ background: "linear-gradient(135deg, #10B981 0%, #059669 55%, #0D9488 100%)" }}
        >
          <Sparkles className="w-4 h-4 text-amber-300" />
          Ask DealinSec
        </button>
      )}

      {open && (
        <div
          // z-[60] on mobile so the sheet sits ABOVE the fixed bottom nav
          // (z-50) — otherwise the nav covers the composer and there's
          // nowhere visible to type.
          className="fixed z-[60] inset-0 sm:inset-auto sm:bottom-4 sm:right-4 sm:w-[420px] sm:h-[640px] sm:max-h-[calc(100vh-2rem)] flex flex-col sm:rounded-2xl border-0 sm:border sm:border-border bg-background shadow-2xl overflow-hidden animate-fade-in"
          data-testid="copilot-drawer"
          role="dialog"
          aria-label="DealinSec Copilot"
        >
          {/* Header */}
          <div
            className="flex items-center gap-2.5 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:pt-3 text-white shrink-0"
            style={{ background: "linear-gradient(135deg, hsl(160 84% 22%) 0%, hsl(174 70% 26%) 100%)" }}
          >
            <span className="w-8 h-8 rounded-xl bg-white/15 flex items-center justify-center">
              <Bot className="w-[18px] h-[18px]" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold leading-tight">DealinSec Copilot</p>
              <p className="text-[11px] text-emerald-100/80 leading-tight">Your deal intelligence</p>
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

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3.5 py-4 space-y-3">
            {/* ── Daily briefing (deterministic) ── */}
            {briefingLoading && <StagedLoading />}

            {briefing && (
              <div className="space-y-2.5" data-testid="copilot-briefing">
                <p className="text-sm font-semibold px-0.5">
                  {greeting()}, {briefing.greetingName} 👋
                </p>
                <p className="text-xs text-muted-foreground px-0.5 -mt-1.5">
                  {allClear
                    ? "I've reviewed your deals — everything looks protected."
                    : `I've reviewed your active deals. ${briefing.attentionCount} thing${briefing.attentionCount !== 1 ? "s" : ""} need${briefing.attentionCount === 1 ? "s" : ""} your attention.`}
                </p>

                {allClear && (
                  <div className="rounded-xl border border-emerald-300/50 dark:border-emerald-800/50 bg-emerald-500/[0.05] p-3.5 flex items-center gap-3">
                    <ShieldCheck className="w-5 h-5 text-emerald-500 shrink-0" />
                    <p className="text-xs text-muted-foreground">
                      No overdue payments, nothing waiting to be invoiced. Create your next deal and I'll watch it end to end.
                    </p>
                  </div>
                )}

                {radar && radar.overdue.count > 0 && (
                  <div className="rounded-xl border border-rose-300/50 dark:border-rose-900/50 bg-rose-500/[0.05] p-3.5" data-testid="briefing-overdue">
                    <div className="flex items-center gap-2 mb-1">
                      <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
                      <p className="text-sm font-bold text-rose-600 dark:text-rose-400 tabular-nums">{inr(radar.overdue.total)} overdue</p>
                    </div>
                    {worstOverdue && (
                      <p className="text-xs text-muted-foreground mb-2.5">
                        {worstOverdue.brandName} · {worstOverdue.invoiceNumber} · {worstOverdue.daysOverdue} day{worstOverdue.daysOverdue !== 1 ? "s" : ""} overdue
                        {radar.overdue.count > 1 ? ` · +${radar.overdue.count - 1} more` : ""}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      {worstOverdue && (
                        <Button size="sm" className="h-7 text-xs font-bold gradient-btn text-white" onClick={() => draftChaser(worstOverdue.id, "Professional")} data-testid="briefing-chaser">
                          Prepare Follow-up
                        </Button>
                      )}
                      <Button size="sm" variant="outline" className="h-7 text-xs font-semibold" onClick={() => go("/invoices")}>
                        View invoices
                      </Button>
                    </div>
                  </div>
                )}

                {radar && radar.readyToInvoice.count > 0 && (
                  <div className="rounded-xl border border-emerald-300/50 dark:border-emerald-800/50 bg-emerald-500/[0.05] p-3.5" data-testid="briefing-ready">
                    <div className="flex items-center gap-2 mb-1">
                      <Receipt className="w-4 h-4 text-emerald-500 shrink-0" />
                      <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{inr(radar.readyToInvoice.total)} ready to invoice</p>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2.5">
                      {radar.readyToInvoice.count} signed agreement{radar.readyToInvoice.count !== 1 ? "s" : ""} with uninvoiced value
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {radar.readyToInvoice.contracts.slice(0, 2).map((c) => (
                        <Button key={c.id} size="sm" variant="outline" className="h-7 text-xs font-semibold border-emerald-300/60 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-300" onClick={() => go(`/contracts/${c.id}`)}>
                          {c.brandName}: {inr(c.remaining)} <ArrowRight className="w-3 h-3 ml-1" />
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {radar && radar.dueThisWeek.count > 0 && (
                  <div className="rounded-xl border border-amber-300/50 dark:border-amber-900/50 bg-amber-500/[0.05] p-3.5" data-testid="briefing-due">
                    <div className="flex items-center gap-2 mb-1">
                      <Clock className="w-4 h-4 text-amber-500 shrink-0" />
                      <p className="text-sm font-bold text-amber-600 dark:text-amber-400 tabular-nums">{inr(radar.dueThisWeek.total)} due this week</p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {radar.dueThisWeek.invoices.slice(0, 2).map((i) => i.brandName).join(", ")}
                      {radar.dueThisWeek.count > 2 ? ` +${radar.dueThisWeek.count - 2} more` : ""} — watching these for you.
                    </p>
                  </div>
                )}

                {briefing.nextActions.length > 0 && (
                  <div className="rounded-xl border border-border/60 p-3.5">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Next best actions</p>
                    <ul className="space-y-1.5">
                      {briefing.nextActions.slice(0, 3).map((a) => (
                        <li key={a.dealId}>
                          <button type="button" onClick={() => go(a.route)} className="w-full text-left flex items-center gap-2 text-xs rounded-lg px-2 py-1.5 -mx-2 hover:bg-muted/60 transition-colors group">
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${a.urgency === "red" ? "bg-rose-500" : a.urgency === "yellow" ? "bg-amber-500" : "bg-emerald-500"}`} />
                            <span className="flex-1 min-w-0 truncate"><b className="font-semibold">{a.brandName}:</b> {a.action}</span>
                            <ArrowRight className="w-3 h-3 text-muted-foreground/50 group-hover:text-foreground shrink-0" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* ── Conversation ── */}
            {messages.length === 0 && briefing && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {quickPrompts.map((q) => (
                  <button key={q} type="button" onClick={() => send(q)} className="text-xs font-medium px-2.5 py-1.5 rounded-full border border-emerald-300/60 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10 transition-colors">
                    {q}
                  </button>
                ))}
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i}>
                <Bubble msg={m} onCopy={() => {
                  navigator.clipboard?.writeText(m.content).then(() => toast({ title: "Copied — paste it into WhatsApp or email" }), () => {});
                }} onRetone={(tone) => m.chaser && draftChaser(m.chaser.invoiceId, tone)} />
                {m.role === "assistant" && !!m.actions?.length && (
                  <div className="flex flex-wrap gap-1.5 mt-1.5 pl-9">
                    {m.actions.map((a, j) =>
                      a.type === "navigate" && a.to ? (
                        <Button key={j} size="sm" variant="outline" className="h-7 text-xs font-semibold border-emerald-300/60 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-300" onClick={() => go(a.to!)}>
                          {a.label} <ArrowRight className="w-3 h-3 ml-1" />
                        </Button>
                      ) : a.type === "confirm" ? (
                        <Button key={j} size="sm" disabled={m.done || busy} className="h-7 text-xs font-bold gradient-btn text-white" onClick={() => runConfirm(i, a)} data-testid="copilot-confirm">
                          {m.done ? <Check className="w-3 h-3 mr-1" /> : <Sparkles className="w-3 h-3 mr-1 text-amber-300" />}
                          {m.done ? "Done" : a.label}
                        </Button>
                      ) : null,
                    )}
                  </div>
                )}
              </div>
            ))}
            {busy && <StagedLoading />}
          </div>

          {/* Composer */}
          <form
            className="flex items-center gap-2 border-t border-border px-3 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] shrink-0 bg-background"
            onSubmit={(e) => { e.preventDefault(); send(input); }}
          >
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your deals…"
              maxLength={1000}
              data-testid="copilot-input"
              className="flex-1 h-10 rounded-xl border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            />
            <Button type="submit" size="icon" disabled={busy || !input.trim()} aria-label="Send" data-testid="copilot-send" className="h-10 w-10 rounded-xl gradient-btn text-white shrink-0">
              <SendHorizonal className="w-4 h-4" />
            </Button>
          </form>
        </div>
      )}
    </>
  );
}

function Bubble({ msg, onCopy, onRetone }: {
  msg: Msg;
  onCopy: () => void;
  onRetone: (tone: string) => void;
}) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md px-3.5 py-2 text-sm text-white whitespace-pre-wrap" style={{ background: "linear-gradient(135deg, #059669, #0D9488)" }}>
          {msg.content}
        </div>
      </div>
    );
  }
  if (msg.chaser) {
    return (
      <div className="flex items-start gap-2">
        <span className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
          <Sparkles className="w-3.5 h-3.5" />
        </span>
        <div className="flex-1 min-w-0 rounded-2xl rounded-tl-md border border-border/70 overflow-hidden">
          <div className="px-3.5 py-2 bg-muted/50 flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              AI-drafted · {msg.chaser.tone} · review before sending
            </span>
          </div>
          <p className="px-3.5 py-2.5 text-sm whitespace-pre-wrap">{msg.content}</p>
          <div className="px-3.5 pb-2.5 flex flex-wrap items-center gap-1.5">
            <Button size="sm" className="h-7 text-xs font-bold gradient-btn text-white" onClick={onCopy} data-testid="chaser-copy">
              <CopyIcon className="w-3 h-3 mr-1" /> Copy
            </Button>
            {TONES.filter((t) => t !== msg.chaser!.tone).map((t) => (
              <button key={t} type="button" onClick={() => onRetone(t)} className="text-[11px] font-medium px-2 py-1 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors inline-flex items-center gap-1">
                <RefreshCw className="w-2.5 h-2.5" /> {t}
              </button>
            ))}
          </div>
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
        {msg.content.split(/\*\*([^*]+)\*\*/g).map((part, i) => (i % 2 === 1 ? <b key={i}>{part}</b> : part))}
      </div>
    </div>
  );
}
