import { useEffect, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import { cn } from "@/lib/utils";

const MAX_LEN = 4000;

/**
 * The message box. Enter sends, Shift+Enter adds a line (never mid-IME
 * composition), it grows with a pasted conversation, and while the agent works
 * the send button becomes Stop. Text-base keeps iOS from zooming on focus.
 */
export function Composer({
  onSend, onStop, running, disabled, placeholder, autoFocus, seed,
}: {
  onSend: (text: string) => void;
  onStop: () => void;
  running: boolean;
  disabled?: boolean;
  placeholder: string;
  autoFocus?: boolean;
  /** Fills the box (and focuses it) whenever `n` changes — a starter that needs the person's own text. */
  seed?: { text: string; n: number };
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!text) { el.style.height = ""; return; }
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 192)}px`;
  }, [text]);

  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);
  useEffect(() => {
    if (!seed?.n) return;
    setText(seed.text);
    ref.current?.focus();
    // The caret goes to the end, where the pasted message belongs.
    requestAnimationFrame(() => ref.current?.setSelectionRange(seed.text.length, seed.text.length));
  }, [seed?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    const t = text.trim();
    if (!t || running || disabled) return;
    onSend(t);
    setText("");
  };

  const canSend = text.trim().length > 0 && !running && !disabled;
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); submit(); }}
      className="flex items-end gap-2 rounded-2xl border border-neutral-300 bg-white p-2 pl-3.5 transition-shadow focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/40 dark:border-neutral-700 dark:bg-neutral-900"
    >
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, MAX_LEN))}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
        }}
        rows={1}
        disabled={disabled}
        placeholder={placeholder}
        aria-label="Message the agent"
        data-testid="agent-input"
        className="max-h-48 min-w-0 flex-1 resize-none bg-transparent py-2 text-base outline-none placeholder:text-muted-foreground/70 disabled:opacity-60"
      />
      {running ? (
        <button type="button" onClick={onStop} aria-label="Stop" data-testid="agent-stop"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-neutral-900 text-white transition hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900">
          <Square className="h-3.5 w-3.5 fill-current" />
        </button>
      ) : (
        <button type="submit" disabled={!canSend} aria-label="Send" data-testid="agent-send"
          className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white transition", canSend ? "gradient-btn" : "bg-neutral-300 dark:bg-neutral-700")}>
          <ArrowUp className="h-[18px] w-[18px]" />
        </button>
      )}
    </form>
  );
}
