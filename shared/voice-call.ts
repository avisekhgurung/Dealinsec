/**
 * The turn-taking of a voice call, as a pure state machine. The browser's
 * microphone and speech are noisy, asynchronous things; this is the part that
 * must never get stuck, so it is plain data in and plain data out:
 *
 *   reduce(state, event) -> { state, effects }
 *
 * A hook feeds events in (the person finished speaking, the agent replied, the
 * speech ended...) and carries out the effects (listen, speak, send...).
 *
 *   listening -> (person finishes an utterance) -> thinking -> (reply) -> speaking -> listening
 *
 * Half-duplex by design: the microphone is off while the agent speaks (it would
 * hear itself); the person interrupts with a tap, or by voice where the device
 * lets that be detected reliably.
 *
 * Approving by voice: the read-back is built from the server-checked approval
 * card, the answer is classified by code (classifyConfirmation), never by the
 * model, and the approval goes through the same single-use endpoint as a tap.
 */
export type CallPhase = "connecting" | "listening" | "thinking" | "speaking" | "ended";
export type EndReason = "user" | "idle" | "mic_blocked" | "unsupported" | "error";

export interface CallState {
  phase: CallPhase;
  muted: boolean;
  /** What the person is saying right now (live caption). */
  interim: string;
  lastUserText: string;
  lastReply: string;
  /** Has "are you still there?" been said since the person last spoke? */
  idlePrompted: boolean;
  turns: number;
  endReason: EndReason | null;
  notice: string | null;
  /** An action read back and waiting for a spoken yes or no. */
  confirming: PendingApproval | null;
  /** Further actions from the same reply, read back one at a time. */
  queue: PendingApproval[];
}

export type CallEvent =
  | { type: "started"; greeting?: string }
  | { type: "interim"; text: string }
  | { type: "utterance"; text: string }
  | { type: "reply"; text: string; approvals?: PendingApproval[] }
  | { type: "approval_settled"; approvalId: string; ok: boolean; message: string }
  | { type: "reply_empty" }
  | { type: "speech_done" }
  | { type: "interrupt" }
  | { type: "mute" }
  | { type: "unmute" }
  | { type: "idle_timeout" }
  | { type: "error"; code: "mic_blocked" | "unsupported" | "agent_failed" | "no_speech" }
  | { type: "end" };

export type CallEffect =
  | { kind: "listen" }
  | { kind: "stop_listening" }
  | { kind: "send"; text: string }
  | { kind: "speak"; text: string }
  | { kind: "cancel_speech" }
  | { kind: "stop_run" }
  | { kind: "approve"; approvalId: string; tool: string }
  | { kind: "reject"; approvalId: string; tool: string };

export const initialCall = (): CallState => ({
  phase: "connecting", muted: false, interim: "", lastUserText: "", lastReply: "", idlePrompted: false, turns: 0, endReason: null, notice: null, confirming: null, queue: [],
});

export const STILL_THERE = "Are you still there?";
export const GOODBYE = "I'll end the call here. Do ring again whenever you like.";
export const APOLOGY = "I do apologise, something went wrong on my side. Nothing was changed. Shall we try that again?";

/** A heard sentence worth acting on: not a cough or a single stray letter. */
export const isUtterance = (t: string) => t.toLowerCase().replace(/[^a-z0-9\u00c0-\uffff]/g, "").length >= 2;

export function reduceCall(s: CallState, e: CallEvent): { state: CallState; effects: CallEffect[] } {
  const keep = (state: CallState, effects: CallEffect[] = []) => ({ state, effects });
  if (s.phase === "ended") return keep(s);

  switch (e.type) {
    case "started":
      if (s.phase !== "connecting") return keep(s);
      // The call opens with the assistant's greeting (as a voice mode does), then listens.
      if (e.greeting) return keep({ ...s, phase: "speaking", lastReply: e.greeting }, [{ kind: "speak", text: e.greeting }]);
      return keep({ ...s, phase: "listening" }, s.muted ? [] : [{ kind: "listen" }]);

    case "interim":
      if (s.phase !== "listening") return keep(s);
      return keep({ ...s, interim: e.text, idlePrompted: false });

    case "utterance": {
      if (s.phase !== "listening" || s.muted || !isUtterance(e.text)) return keep(s);
      const text = e.text.trim();
      const heard = { ...s, interim: "", lastUserText: text, idlePrompted: false };
      if (s.confirming) {
        const c = s.confirming;
        const answer = classifyConfirmation(text, c.risk);
        if (answer === "approve") return keep({ ...heard, phase: "thinking" }, [{ kind: "stop_listening" }, { kind: "approve", approvalId: c.approvalId, tool: c.tool }]);
        if (answer === "decline") return keep({ ...heard, phase: "thinking" }, [{ kind: "stop_listening" }, { kind: "reject", approvalId: c.approvalId, tool: c.tool }]);
        if (answer === "repeat") return keep({ ...heard, phase: "speaking", lastReply: c.readback }, [{ kind: "stop_listening" }, { kind: "speak", text: c.readback }]);
        if (answer === "need_explicit") return keep({ ...heard, phase: "speaking", lastReply: NEED_EXPLICIT }, [{ kind: "stop_listening" }, { kind: "speak", text: NEED_EXPLICIT }]);
        // Anything else is a new request: the read-back is dropped (the card stays on screen to tap) and the agent hears it.
        return keep({ ...heard, phase: "thinking", confirming: null, queue: [], turns: s.turns + 1 }, [{ kind: "stop_listening" }, { kind: "send", text }]);
      }
      return keep({ ...heard, phase: "thinking", turns: s.turns + 1 }, [{ kind: "stop_listening" }, { kind: "send", text }]);
    }

    case "reply": {
      if (s.phase !== "thinking") return keep(s);
      const [first, ...rest] = e.approvals ?? [];
      if (first) {
        const say = `${e.text} ${first.readback}`.trim();
        return keep({ ...s, phase: "speaking", lastReply: say, confirming: first, queue: rest }, [{ kind: "speak", text: say }]);
      }
      return keep({ ...s, phase: "speaking", lastReply: e.text }, [{ kind: "speak", text: e.text }]);
    }

    case "approval_settled": {
      // Settled by voice OR by a tap on the card: either way, say how it went and read back the next one.
      const wasActive = s.confirming?.approvalId === e.approvalId;
      const queue = wasActive ? s.queue : s.queue.filter((q) => q.approvalId !== e.approvalId);
      if (!wasActive) return keep({ ...s, queue });
      const [next, ...rest] = queue;
      const say = [e.message, next?.readback].filter(Boolean).join(" ");
      if (s.phase === "speaking") return keep({ ...s, confirming: next ?? null, queue: rest, lastReply: say }, [{ kind: "cancel_speech" }, { kind: "speak", text: say }]);
      return keep({ ...s, phase: "speaking", confirming: next ?? null, queue: rest, lastReply: say }, [{ kind: "stop_listening" }, { kind: "speak", text: say }]);
    }

    case "reply_empty":
      if (s.phase !== "thinking") return keep(s);
      return keep({ ...s, phase: "listening" }, s.muted ? [] : [{ kind: "listen" }]);

    case "speech_done":
      if (s.phase !== "speaking") return keep(s);
      return keep({ ...s, phase: "listening" }, s.muted ? [] : [{ kind: "listen" }]);

    case "interrupt":
      if (s.phase === "speaking") return keep({ ...s, phase: "listening" }, s.muted ? [{ kind: "cancel_speech" }] : [{ kind: "cancel_speech" }, { kind: "listen" }]);
      if (s.phase === "thinking") return keep({ ...s, phase: "listening", interim: "" }, s.muted ? [{ kind: "stop_run" }] : [{ kind: "stop_run" }, { kind: "listen" }]);
      return keep(s);

    case "mute":
      if (s.muted) return keep(s);
      return keep({ ...s, muted: true, interim: "" }, s.phase === "listening" ? [{ kind: "stop_listening" }] : []);

    case "unmute":
      if (!s.muted) return keep(s);
      return keep({ ...s, muted: false }, s.phase === "listening" ? [{ kind: "listen" }] : []);

    case "idle_timeout":
      if (s.phase !== "listening" || s.muted) return keep(s);
      // First silence: check in. Second silence: say goodbye and end.
      if (!s.idlePrompted) return keep({ ...s, phase: "speaking", idlePrompted: true, lastReply: STILL_THERE }, [{ kind: "stop_listening" }, { kind: "speak", text: STILL_THERE }]);
      return keep({ ...s, phase: "ended", endReason: "idle", lastReply: GOODBYE }, [{ kind: "stop_listening" }, { kind: "speak", text: GOODBYE }]);

    case "error":
      if (e.code === "mic_blocked") return keep({ ...s, phase: "ended", endReason: "mic_blocked", notice: "Microphone access is blocked. Allow it in your browser's site settings and ring again." }, [{ kind: "stop_listening" }, { kind: "cancel_speech" }]);
      if (e.code === "unsupported") return keep({ ...s, phase: "ended", endReason: "unsupported", notice: "This browser can't do voice calls. Chrome, Edge or Safari will." }, []);
      if (e.code === "agent_failed") {
        if (s.phase !== "thinking") return keep(s);
        return keep({ ...s, phase: "speaking", lastReply: APOLOGY, notice: null }, [{ kind: "speak", text: APOLOGY }]);
      }
      // no_speech: the recogniser timed out; just carry on listening.
      return keep(s, s.phase === "listening" && !s.muted ? [{ kind: "listen" }] : []);

    case "end":
      // Anything still waiting stays on screen to tap; nothing is approved by hanging up.
      return keep({ ...s, phase: "ended", endReason: s.endReason ?? "user", confirming: null, queue: [] }, [{ kind: "stop_listening" }, { kind: "cancel_speech" }, { kind: "stop_run" }]);
  }
}

/* ── approving by voice ─────────────────────────────────────────────────── */

export type ApprovalRisk = "SAFE_MUTATION" | "CONSEQUENTIAL_MUTATION" | string;
export interface PendingApproval { approvalId: string; tool: string; risk: ApprovalRisk; readback: string }
export type Confirmation = "approve" | "decline" | "repeat" | "need_explicit" | "other";

const norm = (t: string) => ` ${t.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim()} `;
const has = (t: string, words: string[]) => words.some((w) => t.includes(` ${w} `));
const NEGATIVE = ["no", "nope", "nah", "don't", "dont", "do not", "cancel", "stop", "wait", "hold on", "decline", "reject", "not now", "never mind", "nevermind", "not yet", "leave it"];
const EXPLICIT = ["confirm", "confirmed", "i confirm", "approve", "approved", "i approve"];
const CASUAL = ["yes", "yeah", "yep", "yup", "ok", "okay", "sure", "go ahead", "do it", "go for it", "proceed", "please do", "sounds good", "carry on", "go on", "absolutely", "of course", "correct", "that's right", "right"];
const REPEAT = ["repeat", "say that again", "what was that", "pardon", "come again", "read it again", "sorry what"];
/** Words that mean "do something different", not "yes" or "no". */
const CHANGE = ["but", "change", "instead", "make it", "amount", "rather", "except", "edit", "update", "different", "actually", "also"];

/**
 * What a spoken answer to a read-back means. Deterministic code, not a model:
 * a short, unambiguous answer only. Anything longer, or that asks for a change,
 * is "other" and goes to the agent as an ordinary message. A consequential
 * action needs the explicit word ("confirm" / "approve"); a bare "yes" asks for it.
 */
export function classifyConfirmation(text: string, risk: ApprovalRisk): Confirmation {
  const t = norm(text);
  const words = t.trim().split(" ").filter(Boolean);
  if (!words.length) return "other";
  if (words.length <= 6 && has(t, REPEAT)) return "repeat";
  if (words.length > 6 || has(t, CHANGE)) return "other";
  if (has(t, NEGATIVE)) return "decline";
  const explicit = has(t, EXPLICIT);
  if (explicit) return "approve";
  if (has(t, CASUAL)) return risk === "CONSEQUENTIAL_MUTATION" ? "need_explicit" : "approve";
  return "other";
}

export const NEED_EXPLICIT = "This one matters, so I'd like you to say confirm, or no.";

/** The exact words read back before a spoken approval, built from the server-checked preview on the card. */
export function approvalReadback(preview: { title?: unknown; lines?: unknown; effects?: unknown }, risk: ApprovalRisk): string {
  const title = String(preview?.title ?? "this").trim().replace(/[.:]+$/, "");
  const lines = Array.isArray(preview?.lines) ? (preview.lines as { label?: unknown; value?: unknown }[]) : [];
  const facts = lines
    .filter((l) => typeof l?.label === "string" && typeof l?.value === "string" && !/check|warning/i.test(String(l.label)))
    .slice(0, 3)
    .map((l) => `${String(l.label)}: ${String(l.value).slice(0, 80)}`);
  const effects = Array.isArray(preview?.effects) ? (preview.effects as unknown[]).filter((e) => typeof e === "string").slice(0, 1) as string[] : [];
  const ask = risk === "CONSEQUENTIAL_MUTATION" ? "This one matters, so say confirm to go ahead, or no." : "Say approve to go ahead, or no.";
  return [`Ready for your go-ahead: ${title}.`, facts.length ? `${facts.join(". ")}.` : "", effects[0] ?? "", ask].filter(Boolean).join(" ");
}

/* ── the person talking over the assistant ──────────────────────────────── */

const wordsOf = (t: string) => t.toLowerCase().replace(/[^a-z0-9À-￿' ]+/g, " ").split(" ").filter((w) => w.length >= 2);
const STOP_WORDS = ["stop", "wait", "hold on", "hang on", "sorry", "excuse me", "no no", "pause", "enough"];

/**
 * While the assistant speaks, the microphone also hears the assistant (through
 * the speaker). Is what it heard the PERSON? It is, if it has words the
 * assistant isn't saying, or a short "stop" / "wait" the assistant isn't saying.
 * Words that are mostly the assistant's own are its echo, and are ignored.
 */
export function isPersonTalking(heard: string, spoken: string): boolean {
  const h = wordsOf(heard);
  if (!h.length) return false;
  const said = new Set(wordsOf(spoken));
  const fresh = h.filter((w) => !said.has(w));
  const t = ` ${h.join(" ")} `;
  if (STOP_WORDS.some((s) => t.includes(` ${s} `) && !` ${wordsOf(spoken).join(" ")} `.includes(` ${s} `))) return true;
  return fresh.length >= 2 && fresh.length / h.length >= 0.5;
}
