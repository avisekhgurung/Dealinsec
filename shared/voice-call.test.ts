import { describe, expect, it } from "vitest";
import { APOLOGY, GOODBYE, NEED_EXPLICIT, STILL_THERE, approvalReadback, classifyConfirmation, initialCall, isPersonTalking, isUtterance, reduceCall, type CallEvent, type CallState, type PendingApproval } from "./voice-call";

/** Run events through the machine, collecting every effect in order. */
function run(events: CallEvent[], from: CallState = initialCall()) {
  let s = from;
  const effects: string[] = [];
  const phases: string[] = [];
  for (const e of events) {
    const r = reduceCall(s, e);
    s = r.state;
    phases.push(s.phase);
    effects.push(...r.effects.map((x) => (x.kind === "send" || x.kind === "speak" ? `${x.kind}:${x.text}` : x.kind === "approve" || x.kind === "reject" ? `${x.kind}:${x.approvalId}` : x.kind)));
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

describe("classifyConfirmation: code, not the model, decides what a spoken answer means", () => {
  const SAFE = "SAFE_MUTATION", BIG = "CONSEQUENTIAL_MUTATION";
  it("a routine change: a short yes approves", () => {
    for (const t of ["yes", "Yes please.", "go ahead", "do it", "okay", "approve", "sure, go for it"]) expect(classifyConfirmation(t, SAFE), t).toBe("approve");
  });
  it("a consequential action needs the explicit word; a bare yes asks for it", () => {
    for (const t of ["yes", "okay", "go ahead", "sure"]) expect(classifyConfirmation(t, BIG), t).toBe("need_explicit");
    for (const t of ["confirm", "I confirm", "approve", "yes, confirmed"]) expect(classifyConfirmation(t, BIG), t).toBe("approve");
  });
  it("no means no, whatever the risk", () => {
    for (const t of ["no", "nope", "don't", "cancel", "wait", "not now", "no, don't approve that"]) {
      expect(classifyConfirmation(t, SAFE), t).toBe("decline");
      expect(classifyConfirmation(t, BIG), t).toBe("decline");
    }
  });
  it("a yes with a change is NOT an approval: it goes to the agent as a new request", () => {
    for (const t of ["yes but make it 60000", "approve it but change the amount", "yes, actually also add a ticket", "confirm with a different title"]) expect(classifyConfirmation(t, SAFE), t).toBe("other");
  });
  it("a long sentence is never read as a yes", () => {
    expect(classifyConfirmation("yes I think that is probably right for now let us see", SAFE)).toBe("other");
  });
  it("asking to hear it again", () => {
    expect(classifyConfirmation("sorry, what was that?", SAFE)).toBe("repeat");
    expect(classifyConfirmation("repeat", BIG)).toBe("repeat");
  });
  it("unrelated words are other", () => {
    expect(classifyConfirmation("show me my leads", SAFE)).toBe("other");
    expect(classifyConfirmation("", SAFE)).toBe("other");
  });
});

describe("approvalReadback", () => {
  const preview = { title: "Create deal: Northwind — Website", lines: [{ label: "Client", value: "Northwind" }, { label: "Amount", value: "₹50,000" }, { label: "Check", value: "Name not found in message" }, { label: "Timeline", value: "30 days" }, { label: "Extra", value: "x" }], effects: ["Uses 1 of your Deal Credits for this month.", "Second effect"] };
  it("reads the server-checked title, up to three facts (not warnings), the first effect, and how to answer", () => {
    expect(approvalReadback(preview, "SAFE_MUTATION")).toBe("Ready for your go-ahead: Create deal: Northwind — Website. Client: Northwind. Amount: ₹50,000. Timeline: 30 days. Uses 1 of your Deal Credits for this month. Say approve to go ahead, or no.");
  });
  it("a consequential action asks for the word confirm", () => {
    expect(approvalReadback(preview, "CONSEQUENTIAL_MUTATION")).toMatch(/say confirm to go ahead, or no\.$/);
  });
  it("copes with a missing or odd preview", () => {
    expect(approvalReadback({}, "SAFE_MUTATION")).toBe("Ready for your go-ahead: this. Say approve to go ahead, or no.");
    expect(approvalReadback({ title: 5, lines: "x", effects: [1] }, "SAFE_MUTATION")).toMatch(/^Ready for your go-ahead: 5\./);
  });
});

describe("approving by voice in the call", () => {
  const A = (id: string, risk = "SAFE_MUTATION"): PendingApproval => ({ approvalId: id, tool: "create_lead", risk, readback: `Readback ${id}. Say approve to go ahead, or no.` });
  const asked = (approvals: PendingApproval[]) => run([{ type: "utterance", text: "add northwind as a lead" }, { type: "reply", text: "I've prepared that.", approvals }, { type: "speech_done" }], live()).s;

  it("the reply is followed by the read-back, then it listens for the answer", () => {
    const r = run([{ type: "utterance", text: "add northwind as a lead" }, { type: "reply", text: "I've prepared that.", approvals: [A("a1")] }], live());
    expect(r.effects.at(-1)).toBe("speak:I've prepared that. Readback a1. Say approve to go ahead, or no.");
    expect(r.s.confirming?.approvalId).toBe("a1");
  });
  it("yes approves, through the approval itself (not a message to the model), then the outcome is spoken", () => {
    const s = asked([A("a1")]);
    const r = run([{ type: "utterance", text: "yes" }], s);
    expect(r.effects).toEqual(["stop_listening", "approve:a1"]);
    const done = run([{ type: "approval_settled", approvalId: "a1", ok: true, message: "Added Northwind as a new lead." }, { type: "speech_done" }], r.s);
    expect(done.effects).toEqual(["stop_listening", "speak:Added Northwind as a new lead.", "listen"]);
    expect(done.s.confirming).toBeNull();
  });
  it("no declines", () => {
    expect(run([{ type: "utterance", text: "no" }], asked([A("a1")])).effects).toEqual(["stop_listening", "reject:a1"]);
  });
  it("a consequential action: yes gets asked for confirm, and only confirm approves", () => {
    const s = asked([A("big", "CONSEQUENTIAL_MUTATION")]);
    const a = run([{ type: "utterance", text: "yes" }, { type: "speech_done" }], s);
    expect(a.effects).toEqual(["stop_listening", `speak:${NEED_EXPLICIT}`, "listen"]);
    expect(a.s.confirming?.approvalId).toBe("big");
    expect(run([{ type: "utterance", text: "confirm" }], a.s).effects).toEqual(["stop_listening", "approve:big"]);
  });
  it("anything else is a new request to the agent; the card stays on screen", () => {
    const r = run([{ type: "utterance", text: "actually make it Northwind Freight" }], asked([A("a1")]));
    expect(r.effects).toEqual(["stop_listening", "send:actually make it Northwind Freight"]);
    expect(r.s.confirming).toBeNull();
  });
  it("several actions are read back one at a time", () => {
    const s = asked([A("a1"), A("a2")]);
    const r = run([{ type: "utterance", text: "yes" }, { type: "approval_settled", approvalId: "a1", ok: true, message: "Done." }], s);
    expect(r.effects.at(-1)).toBe("speak:Done. Readback a2. Say approve to go ahead, or no.");
    expect(r.s.confirming?.approvalId).toBe("a2");
  });
  it("a tap on the card while it is reading back settles it the same way", () => {
    const speaking = run([{ type: "utterance", text: "add it" }, { type: "reply", text: "Prepared.", approvals: [A("a1")] }], live()).s;
    const r = run([{ type: "approval_settled", approvalId: "a1", ok: true, message: "Added." }], speaking);
    expect(r.effects).toEqual(["cancel_speech", "speak:Added."]);
    expect(r.s.confirming).toBeNull();
  });
  it("hanging up approves nothing", () => {
    const r = run([{ type: "end" }], asked([A("a1")]));
    expect(r.effects.some((e) => e.startsWith("approve"))).toBe(false);
    expect(r.s.confirming).toBeNull();
  });
  it("an answer is never taken while the assistant is still speaking (only after it listens)", () => {
    const speaking = run([{ type: "utterance", text: "add it" }, { type: "reply", text: "Prepared.", approvals: [A("a1")] }], live()).s;
    expect(run([{ type: "utterance", text: "yes" }], speaking).effects).toEqual([]);
  });
});

describe("isPersonTalking: the person over the assistant, not its echo", () => {
  const spoken = "I have found three family law firms in Manchester and two of them have their own websites";
  it("the assistant's own words coming back are not the person", () => {
    expect(isPersonTalking("found three family law firms", spoken)).toBe(false);
    expect(isPersonTalking("Manchester and two of them", spoken)).toBe(false);
    expect(isPersonTalking("", spoken)).toBe(false);
  });
  it("new words are the person", () => {
    expect(isPersonTalking("actually show me dentists instead", spoken)).toBe(true);
    expect(isPersonTalking("firms in Leeds please not Manchester", spoken)).toBe(true);
  });
  it("a short stop or wait cuts in at once, unless the assistant itself is saying it", () => {
    expect(isPersonTalking("stop", spoken)).toBe(true);
    expect(isPersonTalking("wait", spoken)).toBe(true);
    expect(isPersonTalking("hold on", spoken)).toBe(true);
    expect(isPersonTalking("wait", "Please wait while I look that up")).toBe(false);
  });
  it("a single stray new word is not enough", () => {
    expect(isPersonTalking("um", spoken)).toBe(false);
    expect(isPersonTalking("firms okay", spoken)).toBe(false);
  });
});
