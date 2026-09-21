/**
 * AI home — the top of the dashboard.
 *
 * One question, "What do you want to do?", with a composer that hands the text
 * to the Copilot drawer. It is an entry point, not a second chat: the answers,
 * cards and confirm buttons all live in the drawer, and nothing here creates or
 * changes a record. The dashboard below it is untouched.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Sparkles, ArrowUp, Plus, FileText, Receipt, AlertTriangle, Sun, ListChecks } from "lucide-react";
import { askCopilot } from "@/lib/copilot-bus";
import { useAuth } from "@/hooks/useAuth";
import { memberCan } from "@shared/permissions";

const PLACEHOLDERS = [
  "Create a deal from a client message…",
  "Create a quotation for Rahul…",
  "Which invoices are overdue?",
  "What should I do today?",
  "Check my active deals for risks…",
];

// The Copilot truncates each message at 4,000 characters (server/copilot/routes.ts).
const MAX_LEN = 4000;

interface Chip {
  label: string;
  icon: typeof Plus;
  perm?: string;
  href?: string;
  ask?: string | null;
}

const CHIPS: Chip[] = [
  { label: "New Deal", icon: Plus, perm: "deals.create", href: "/deals/new" },
  { label: "Create Quotation", icon: FileText, perm: "quotations.create", ask: "Create a quotation for my most recent deal" },
  { label: "Create Invoice", icon: Receipt, perm: "invoices.create", href: "/contracts" },
  { label: "Overdue Payments", icon: AlertTriangle, ask: "Which invoices are overdue?" },
  { label: "What should I do today?", icon: ListChecks, ask: "What should I do today?" },
  { label: "Daily Briefing", icon: Sun, ask: null },
];

export function AiHome() {
  const { user } = useAuth();
  const [text, setText] = useState("");
  const [phIndex, setPhIndex] = useState(0);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // Rotate the example only while the box is empty; a person mid-sentence
  // should never see the hint change under them.
  useEffect(() => {
    if (text) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setPhIndex((i) => (i + 1) % PLACEHOLDERS.length), 4000);
    return () => clearInterval(id);
  }, [text]);

  // Grow with the text (up to ~6 lines) so a pasted chat stays readable.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    // Empty: leave it at its one-row default (measuring an empty box during
    // the first paint can read a stale, oversized scrollHeight).
    if (!text) {
      el.style.height = "";
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    askCopilot(t);
    setText("");
  };

  const chips = CHIPS.filter((c) => !c.perm || memberCan(user as any, c.perm as any));

  return (
    <section
      aria-label="AI workspace"
      data-testid="ai-home"
      className="rounded-2xl border border-emerald-200/70 dark:border-emerald-900/50 bg-gradient-to-br from-emerald-50/80 via-white to-teal-50/50 dark:from-emerald-950/30 dark:via-neutral-900 dark:to-teal-950/20 p-4 sm:p-5 lg:p-6 shadow-sm shadow-emerald-900/5"
    >
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
        <Sparkles className="w-3.5 h-3.5" /> DealInSec AI
      </p>
      <h2 className="text-xl lg:text-2xl font-bold tracking-tight mt-1">What do you want to do?</h2>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="mt-3.5 flex items-end gap-2 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-2 pl-3.5 focus-within:ring-2 focus-within:ring-emerald-500/40 focus-within:border-emerald-500 transition-shadow"
      >
        <textarea
          ref={areaRef}
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX_LEN))}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter is a new line; never send mid-IME composition.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder={PLACEHOLDERS[phIndex]}
          aria-label="Tell DealInSec what you want to do"
          data-testid="ai-home-input"
          // text-base keeps iOS from zooming the page when the box is focused.
          className="flex-1 resize-none bg-transparent py-2 text-base outline-none placeholder:text-muted-foreground/70 max-h-40"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          aria-label="Send to DealInSec AI"
          data-testid="ai-home-send"
          className="shrink-0 w-10 h-10 rounded-lg text-white flex items-center justify-center disabled:opacity-40 transition-opacity"
          style={{ background: "linear-gradient(135deg, #059669 0%, #0D9488 100%)" }}
        >
          <ArrowUp className="w-4 h-4" />
        </button>
      </form>

      <div className="mt-3 flex flex-wrap gap-2" aria-label="Quick actions">
        {chips.map(({ label, icon: Icon, href, ask }) => {
          const cls =
            "inline-flex items-center gap-1.5 rounded-full border border-neutral-200 dark:border-neutral-800 bg-white/80 dark:bg-neutral-900/70 px-3 py-1.5 text-xs font-semibold text-foreground hover:border-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-400 transition-colors";
          const inner = (
            <>
              <Icon className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> {label}
            </>
          );
          return href ? (
            <Link key={label} href={href} className={cls} data-testid={`ai-chip-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
              {inner}
            </Link>
          ) : (
            <button
              key={label}
              type="button"
              className={cls}
              data-testid={`ai-chip-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`}
              onClick={() => askCopilot(ask ?? undefined)}
            >
              {inner}
            </button>
          );
        })}
      </div>

      <p className="mt-3 text-[11px] text-muted-foreground">
        Paste a client message and I&apos;ll draft the deal. Nothing is created until you confirm.
      </p>
    </section>
  );
}
