import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, AudioLines, Loader2, Mic, Square } from "lucide-react";
import { useSpeechInput } from "@/hooks/use-voice";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import { DURATION } from "@/lib/motion";
import { loadDraft, saveDraft } from "@/lib/agent-session";
import { composerHeight, enterIntent } from "@/lib/chat/interaction";
import { createSubmitter } from "@/lib/chat/submit";

const MAX_LEN = 4000;
const touchFirst = () => typeof window !== "undefined" && !!window.matchMedia?.("(hover: none) and (pointer: coarse)").matches;

/**
 * The message box. Desktop: Enter sends, Shift+Enter adds a line; a touch keyboard's Enter adds a line and the Send
 * button sends (Ctrl/Cmd+Enter sends everywhere; never mid-IME composition). It grows with its text up to a cap that
 * keeps the conversation visible, and while the agent works Send becomes Stop (Escape stops too).
 *
 * The text is cleared only once the conversation has accepted the message; if it's refused or fails first, it stays.
 * One submission at a time. The unsent text is kept per conversation (sessionStorage), across screens and reloads.
 * Text-base keeps iOS from zooming on focus.
 */
export function Composer({
  onSend, onStop, running, disabled, placeholder, autoFocus, seed, voiceLang, draftFor, label = "Message the agent", onVoiceMode, voiceModeLabel = "Start voice mode",
}: {
  /** Send; call `accepted()` once the message is in the conversation (the box clears then). */
  onSend: (text: string, accepted: () => void) => unknown;
  onStop: () => void;
  running: boolean;
  disabled?: boolean;
  placeholder: string;
  autoFocus?: boolean;
  /** Fills the box (and focuses it) whenever `n` changes — a starter that needs the person's own text. */
  seed?: { text: string; n: number };
  /** BCP-47 language for dictation. When set (and the browser can do it) a microphone button appears. */
  voiceLang?: string;
  /** The conversation this box belongs to: an unsent message is kept for it when the person switches screens or modes. */
  draftFor?: string | null;
  /** The box's accessible name. */
  label?: string;
  /** Voice mode (a voice call): while the box is empty, the round button starts it instead of sending, like a chat app. */
  onVoiceMode?: () => void;
  voiceModeLabel?: string;
}) {
  const [text, setText] = useState(() => (draftFor !== undefined ? loadDraft(draftFor) : ""));
  // Kept as it's typed; cleared when sent; never sent by itself. Opening another conversation shows that one's draft
  // (the box's text must not follow the person into a different conversation).
  const draftKey = useRef(draftFor);
  useEffect(() => {
    if (draftFor === undefined) return;
    if (draftKey.current !== draftFor) { draftKey.current = draftFor; setText(loadDraft(draftFor)); return; }
    saveDraft(draftFor, text);
  }, [draftFor, text]);
  // Dictation fills the box; the person reads it and presses send themselves.
  const base = useRef("");
  const voice = useSpeechInput({ lang: voiceLang ?? "en-US", onTranscript: (t) => setText(`${base.current}${base.current && t ? " " : ""}${t}`.slice(0, MAX_LEN)) });
  const toggleVoice = () => { if (!voice.listening) base.current = text.trim(); voice.toggle(); };
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!text) { el.style.height = ""; return; }
    el.style.height = "auto";
    el.style.height = `${composerHeight(el.scrollHeight, window.innerHeight)}px`;
  }, [text]);

  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);
  useEffect(() => {
    if (!seed?.n) return;
    setText(seed.text);
    ref.current?.focus();
    // The caret goes to the end, where the pasted message belongs.
    requestAnimationFrame(() => ref.current?.setSelectionRange(seed.text.length, seed.text.length));
  }, [seed?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleared only on acceptance, and the draft of the conversation it was sent from goes with it (a new conversation
  // gets its id mid-send, so that may no longer be the box's current one).
  const [pending, setPending] = useState(false);
  const sentFrom = useRef<string | null | undefined>(undefined);
  const sendRef = useRef(onSend);
  sendRef.current = onSend;
  const submitter = useMemo(() => createSubmitter((t, accepted) => sendRef.current(t, accepted), {
    accepted: () => { const from = sentFrom.current; setText(""); if (from !== undefined) saveDraft(from, ""); },
    pending: setPending,
  }), []);
  const submit = () => {
    if (running || disabled || pending) return;
    if (voice.listening) voice.cancel();   // what's in the box is what's sent; no late words land after it
    sentFrom.current = draftFor;
    submitter.submit(text);
  };

  const canSend = text.trim().length > 0 && !running && !disabled && !pending;
  const near = text.length > MAX_LEN - 400;
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
          if (e.key === "Escape" && running) { e.preventDefault(); onStop(); return; }
          const intent = enterIntent({ key: e.key, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, isComposing: e.nativeEvent.isComposing, keyCode: e.nativeEvent.keyCode }, touchFirst());
          if (intent === "send") { e.preventDefault(); submit(); }
        }}
        rows={1}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={label}
        aria-describedby={near ? "composer-count" : undefined}
        enterKeyHint={touchFirst() ? "enter" : "send"}
        data-testid="agent-input"
        className="max-h-60 min-h-10 min-w-0 flex-1 resize-none bg-transparent py-2 text-base outline-none focus-visible:outline-none placeholder:text-muted-foreground/70 disabled:opacity-60"
      />
      {voiceLang && voice.supported && !running && (
        <button type="button" onClick={toggleVoice} disabled={disabled} aria-label={voice.listening ? "Stop dictating" : "Dictate a message"} aria-pressed={voice.listening} data-testid="agent-mic"
          title={voice.error ?? (voice.provider === "sarvam" ? "Dictate. Sarvam AI turns your words into text; the recording isn't kept." : "Dictate. Your browser's speech service may process the audio.")}
          className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition", voice.listening ? "animate-pulse border-rose-400 bg-rose-50 text-rose-600 dark:bg-rose-950/40" : "border-border text-foreground/70 hover:bg-muted/60")}>
          <Mic className="h-[18px] w-[18px]" />
        </button>
      )}
      {/* Send becomes Stop while the agent works: a quick cross-fade so the change is noticed, never a delay. */}
      <AnimatePresence mode="popLayout" initial={false}>
        {running ? (
          <motion.button key="stop" type="button" onClick={onStop} aria-label="Stop generating (Esc)" title="Stop (Esc)" data-testid="agent-stop"
            initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.85 }} transition={{ duration: DURATION.fast }}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-neutral-900 text-white transition-colors hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900">
            <Square className="h-3.5 w-3.5 fill-current" />
          </motion.button>
        ) : onVoiceMode && !text.trim() && !pending ? (
          <motion.button key="voice" type="button" onClick={onVoiceMode} disabled={disabled} aria-label={voiceModeLabel} title={voiceModeLabel} data-testid="voice-mode"
            initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.85 }} transition={{ duration: DURATION.fast }}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-white transition-colors hover:bg-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900">
            <AudioLines className="h-[18px] w-[18px]" />
          </motion.button>
        ) : (
          <motion.button key="send" type="submit" disabled={!canSend} aria-label={pending ? "Sending" : "Send"} aria-busy={pending} data-testid="agent-send"
            initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.85 }} transition={{ duration: DURATION.fast }}
            className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background", canSend || pending ? "gradient-btn" : "bg-neutral-300 dark:bg-neutral-700")}>
            {pending ? <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden /> : <ArrowUp className="h-[18px] w-[18px]" />}
          </motion.button>
        )}
      </AnimatePresence>
      {voice.error && <p role="alert" className="sr-only">{voice.error}</p>}
      {near && <span id="composer-count" className={cn("self-center whitespace-nowrap text-[11px] tabular-nums", text.length >= MAX_LEN ? "text-rose-600" : "text-muted-foreground")} aria-live="polite">{text.length.toLocaleString()}/{MAX_LEN.toLocaleString()}</span>}
    </form>
  );
}
