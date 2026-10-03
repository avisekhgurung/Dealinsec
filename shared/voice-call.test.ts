import { describe, expect, it } from "vitest";
import { APOLOGY, GOODBYE, STILL_THERE, initialCall, isUtterance, reduceCall, type CallEvent, type CallState } from "./voice-call";

/** Run events through the machine, collecting every effect in order. */
function run(events: CallEvent[], from: CallState = initialCall()) {
  let s = from;
  const effects: string[] = [];
  const phases: string[] = [];
  for (const e of events) {
    const r = reduceCall(s, e);
    s = r.state;
    phases.push(s.phase);
    effects.push(...r.effects.map((x) => (x.kind === "send" || x.kind === "speak" ? `${x.kind}:${x.text}` : x.kind)));
  }
  return { s, effects, phases };
}
const live = () => run([{ type: "started" }]).s;

describe("a normal call", () => {
  it("listens, hears a sentence, thinks, speaks, and listens again", () => {
    const r = run([
      { type: "started" }, { type: "interim", text: "find me" }, { type: "utterance", text: "find me dentists in Leeds" },
      { type: "reply", text: "Certainly. I've prepared a search for your approval." }, { type: "speech_done" },
    ]);
    expect(r.phases).toEqual(["listening", "listening", "thinking", "speaking", "listening"]);
    expect(r.effects).toEqual(["listen", "stop_listening", "send:find me dentists in Leeds", "speak:Certainly. I've prepared a search for your approval.", "listen"]);
    expect(r.s.turns).toBe(1);
  });
  it("a reply with nothing to say just goes back to listening", () => {
    const r = run([{ type: "utterance", text: "what is due" }, { type: "reply_empty" }], live());
    expect(r.s.phase).toBe("listening");
    expect(r.effects.at(-1)).toBe("listen");
  });
});

describe("the opening", () => {
  it("opens with the greeting, then listens", () => {
    const r = run([{ type: "started", greeting: "Good evening, Una. How may I be of service?" }, { type: "speech_done" }]);
    expect(r.phases).toEqual(["speaking", "listening"]);
    expect(r.effects).toEqual(["speak:Good evening, Una. How may I be of service?", "listen"]);
  });
  it("the person can interrupt the greeting and simply start", () => {
    const r = run([{ type: "started", greeting: "Good evening." }, { type: "interrupt" }]);
    expect(r.s.phase).toBe("listening");
    expect(r.effects).toEqual(["speak:Good evening.", "cancel_speech", "listen"]);
  });
});

describe("what is not a turn", () => {
  it("a cough, a stray letter or silence is not an utterance", () => {
    expect(isUtterance("")).toBe(false);
    expect(isUtterance(" a ")).toBe(false);
    expect(isUtterance("...")).toBe(false);
    expect(isUtterance("ok")).toBe(true);
    expect(isUtterance("नमस्ते")).toBe(true);
    const r = run([{ type: "utterance", text: "a" }], live());
    expect(r.s.phase).toBe("listening");
    expect(r.effects).toEqual([]);
  });
  it("while the agent is thinking or speaking, new speech is ignored (the microphone is off)", () => {
    const thinking = run([{ type: "utterance", text: "one thing" }], live()).s;
    expect(run([{ type: "utterance", text: "another thing" }], thinking).effects).toEqual([]);
    const speaking = run([{ type: "reply", text: "Of course." }], thinking).s;
    expect(run([{ type: "utterance", text: "and another" }], speaking).effects).toEqual([]);
  });
});

describe("interrupting", () => {
  it("a tap while speaking cancels the speech and listens", () => {
    const speaking = run([{ type: "utterance", text: "tell me everything" }, { type: "reply", text: "Well, to begin..." }], live()).s;
    const r = run([{ type: "interrupt" }], speaking);
    expect(r.s.phase).toBe("listening");
    expect(r.effects).toEqual(["cancel_speech", "listen"]);
  });
  it("a tap while thinking stops the run and listens", () => {
    const thinking = run([{ type: "utterance", text: "do a long thing" }], live()).s;
    const r = run([{ type: "interrupt" }], thinking);
    expect(r.effects).toEqual(["stop_run", "listen"]);
    expect(r.s.phase).toBe("listening");
  });
  it("interrupting while already listening does nothing", () => {
    expect(run([{ type: "interrupt" }], live()).effects).toEqual([]);
  });
});

describe("mute", () => {
  it("muting stops listening; nothing is heard or sent while muted; unmuting resumes", () => {
    const r = run([{ type: "mute" }, { type: "utterance", text: "hello there" }, { type: "unmute" }], live());
    expect(r.effects).toEqual(["stop_listening", "listen"]);
    expect(r.s.phase).toBe("listening");
  });
  it("after a reply, a muted call does not start listening", () => {
    const r = run([{ type: "utterance", text: "hello there" }, { type: "mute" }, { type: "reply", text: "Hello." }, { type: "speech_done" }], live());
    expect(r.effects).toEqual(["stop_listening", "send:hello there", "speak:Hello."]);
    expect(r.s.phase).toBe("listening");
    expect(r.s.muted).toBe(true);
  });
});

describe("silence", () => {
  it("first silence checks in; the second says goodbye and ends the call", () => {
    const a = run([{ type: "idle_timeout" }], live());
    expect(a.effects).toEqual(["stop_listening", `speak:${STILL_THERE}`]);
    expect(a.s.phase).toBe("speaking");
    const b = run([{ type: "speech_done" }, { type: "idle_timeout" }], a.s);
    expect(b.effects).toEqual(["listen", "stop_listening", `speak:${GOODBYE}`]);
    expect(b.s.phase).toBe("ended");
    expect(b.s.endReason).toBe("idle");
  });
  it("speaking again resets the check-in", () => {
    const r = run([{ type: "idle_timeout" }, { type: "speech_done" }, { type: "interim", text: "yes I am" }, { type: "idle_timeout" }], live());
    expect(r.s.idlePrompted).toBe(true);
    expect(r.s.phase).toBe("speaking");
  });
});

describe("failures", () => {
  it("a blocked microphone ends the call with a plain message", () => {
    const r = run([{ type: "error", code: "mic_blocked" }], live());
    expect(r.s.phase).toBe("ended");
    expect(r.s.notice).toMatch(/Microphone access is blocked/);
  });
  it("an unsupported browser ends the call at once", () => {
    const r = run([{ type: "error", code: "unsupported" }]);
    expect(r.s.endReason).toBe("unsupported");
    expect(r.s.notice).toMatch(/Chrome, Edge or Safari/);
  });
  it("an agent failure is apologised for aloud, and the call carries on", () => {
    const r = run([{ type: "utterance", text: "do the thing" }, { type: "error", code: "agent_failed" }, { type: "speech_done" }], live());
    expect(r.effects).toEqual(["stop_listening", "send:do the thing", `speak:${APOLOGY}`, "listen"]);
    expect(r.s.phase).toBe("listening");
  });
  it("the recogniser timing out just restarts listening", () => {
    expect(run([{ type: "error", code: "no_speech" }], live()).effects).toEqual(["listen"]);
  });
});

describe("ending", () => {
  it("ending from any phase stops everything, and nothing afterwards does anything", () => {
    const thinking = run([{ type: "utterance", text: "hello there" }], live()).s;
    const r = run([{ type: "end" }, { type: "reply", text: "late" }, { type: "utterance", text: "more words" }, { type: "interrupt" }], thinking);
    expect(r.effects).toEqual(["stop_listening", "cancel_speech", "stop_run"]);
    expect(r.s.phase).toBe("ended");
    expect(r.s.endReason).toBe("user");
  });
  it("a reply arriving after the person interrupted is ignored", () => {
    const r = run([{ type: "utterance", text: "do a thing" }, { type: "interrupt" }, { type: "reply", text: "Done." }], live());
    expect(r.s.phase).toBe("listening");
    expect(r.effects).toEqual(["stop_listening", "send:do a thing", "stop_run", "listen"]);
  });
});
