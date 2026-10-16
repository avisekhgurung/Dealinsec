import { describe, expect, it } from "vitest";
import { flowState, type FlowInput } from "./outbound-flow";

const base: FlowInput = { view: "searches", composing: null, run: null, results: null, anyInLeads: false, queue: null };
const labels = { verify: "Checking each company" };

describe("AI Outbound flow: only real state moves it", () => {
  it("starts at describing; typing and confirming are steps 1 and 2", () => {
    expect(flowState(base).current).toBe(1);
    expect(flowState(base).done.every((d) => !d)).toBe(true);
    const reading = flowState({ ...base, composing: "reading" });
    expect(reading).toMatchObject({ current: 1, working: true });
    expect(reading.notes[0]).toBe("Reading your description");
    expect(flowState({ ...base, composing: "confirming" })).toMatchObject({ current: 2, done: [true, false, false, false, false, false] });
  });

  it("a running search is research, labelled with its real stage", () => {
    const s = flowState({ ...base, run: { status: "running", stage: "verify" } }, labels);
    expect(s).toMatchObject({ current: 3, working: true });
    expect(s.notes[2]).toBe("Checking each company");
    expect(s.done.slice(0, 3)).toEqual([true, true, false]);
  });

  it("a stopped, failed or empty search stays on research with a warning; results move to review", () => {
    for (const [status, note] of [["cancelled", "Stopped"], ["failed", "Couldn't finish"]] as const) {
      const s = flowState({ ...base, run: { status, stage: "x" }, results: 3 });
      expect(s.notes[2]).toBe(note);
      expect(s.warn[2]).toBe(true);
    }
    const none = flowState({ ...base, run: { status: "done", stage: "done" }, results: 0 });
    expect(none).toMatchObject({ current: 3 });
    expect(none.notes[2]).toBe("Nothing passed the checks");
    expect(flowState({ ...base, run: { status: "done", stage: "done" }, results: 4 })).toMatchObject({ current: 4, done: [true, true, true, false, false, false] });
  });

  it("outreach: nothing yet is step 5; messages make it step 6; sent is only ticked when something was sent", () => {
    expect(flowState({ ...base, view: "outreach", queue: { waiting: 0, sent: 0 } }).current).toBe(5);
    const waiting = flowState({ ...base, view: "outreach", queue: { waiting: 2, sent: 0 } });
    expect(waiting.current).toBe(6);
    expect(waiting.done[5]).toBe(false);
    expect(flowState({ ...base, view: "outreach", queue: { waiting: 0, sent: 1 } }).done[5]).toBe(true);
  });

  it("adding a prospect to Leads ticks review; never anything on a timer or from unloaded data", () => {
    expect(flowState({ ...base, run: { status: "done", stage: "done" }, results: 2, anyInLeads: true }).done[3]).toBe(true);
    expect(flowState({ ...base, view: "outreach", queue: null }).done.slice(3)).toEqual([false, false, false]);
  });
});
