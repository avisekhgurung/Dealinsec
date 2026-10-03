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
 * lets that be detected reliably. Approvals are never given by voice.
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
}

export type CallEvent =
  | { type: "started"; greeting?: string }
  | { type: "interim"; text: string }
  | { type: "utterance"; text: string }
  | { type: "reply"; text: string }
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
  | { kind: "stop_run" };

export const initialCall = (): CallState => ({
  phase: "connecting", muted: false, interim: "", lastUserText: "", lastReply: "", idlePrompted: false, turns: 0, endReason: null, notice: null,
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

    case "utterance":
      if (s.phase !== "listening" || s.muted || !isUtterance(e.text)) return keep(s);
      return keep({ ...s, phase: "thinking", interim: "", lastUserText: e.text.trim(), idlePrompted: false, turns: s.turns + 1 },
        [{ kind: "stop_listening" }, { kind: "send", text: e.text.trim() }]);

    case "reply":
      if (s.phase !== "thinking") return keep(s);
      return keep({ ...s, phase: "speaking", lastReply: e.text }, [{ kind: "speak", text: e.text }]);

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
      return keep({ ...s, phase: "ended", endReason: s.endReason ?? "user" }, [{ kind: "stop_listening" }, { kind: "cancel_speech" }, { kind: "stop_run" }]);
  }
}
