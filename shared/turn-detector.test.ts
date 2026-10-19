import { describe, expect, it } from "vitest";
import { TURN, calibrateNoise, freshTurn, turnStep, type TurnEvent, type TurnState } from "./turn-detector";

/** Feeds `ms` of a steady level in 50 ms readings; returns the events seen and the final state. */
function feed(s: TurnState, rms: number, ms: number) {
  const events: TurnEvent[] = [];
  for (let t = 0; t < ms; t += 50) { const r = turnStep(s, rms, 50); s = r.state; if (r.event) events.push(r.event); }
  return { s, events };
}

describe("hearing when the person talks and pauses", () => {
  it("measures a noisy room first and doesn't call its hum speech", () => {
    const noise = calibrateNoise([0.02, 0.021, 0.019, 0.5, 0.02]);   // one bump ignored
    expect(noise).toBeCloseTo(0.02, 3);
    let { s, events } = feed(freshTurn(noise), 0.02, 3000);
    expect(events).toEqual([]);
    ({ s, events } = feed(s, 0.1, 400));
    expect(events).toEqual(["speech_start"]);
  });
  it("a click isn't a turn; real speech is", () => {
    let { s, events } = feed(freshTurn(), 0.2, 100);
    expect(events).toEqual([]);
    ({ s, events } = feed(s, 0.002, 200));
    ({ s, events } = feed(s, 0.2, TURN.startMs + 50));
    expect(events).toEqual(["speech_start"]);
  });
  it("reports one pause after a short silence, and talking again resumes the turn", () => {
    let { s } = feed(freshTurn(), 0.1, 500);
    let r = feed(s, 0.002, TURN.pauseMs + 400);
    expect(r.events).toEqual(["pause"]);
    r = feed(r.s, 0.1, 300);
    expect(r.events).toEqual(["speech_resume"]);
    r = feed(r.s, 0.002, TURN.pauseMs + 100);
    expect(r.events).toEqual(["pause"]);
  });
  it("silence before anyone speaks is never a pause", () => {
    expect(feed(freshTurn(), 0.001, 5000).events).toEqual([]);
  });
});
