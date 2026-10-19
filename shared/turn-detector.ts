/**
 * Hearing when the person talks and pauses, from the microphone's level alone (the call records the mic itself and
 * sends each turn to speech recognition). Pure, so the rules are tested:
 *
 *  - The room's noise floor is learned while nobody is talking, so a fan or traffic isn't "speech".
 *  - Speech starts only after the level stays clearly above that floor for a moment (a click or a cough isn't a turn).
 *  - A pause is reported once, after a short silence: the call then reads what was said so far and decides, from the
 *    words, how much longer to wait (shared/voice-call.ts endpointDelay). Talking again clears it.
 */
export interface TurnState {
  noise: number;
  /** Time spent above the speech threshold in a row (ms), and below it since the last speech (ms). */
  loud: number;
  quiet: number;
  /** The person has started talking in this turn. */
  started: boolean;
  /** A pause has been reported and not yet cleared by more speech. */
  paused: boolean;
}

export const TURN = { minLevel: 0.012, overNoise: 3, startMs: 140, pauseMs: 900, noiseEase: 0.05 } as const;

export const freshTurn = (noise = 0.004): TurnState => ({ noise, loud: 0, quiet: 0, started: false, paused: false });

export type TurnEvent = "speech_start" | "speech_resume" | "pause" | null;

/** One level reading (RMS, 0–1) after `dt` ms. */
export function turnStep(s: TurnState, rms: number, dt: number): { state: TurnState; event: TurnEvent } {
  const threshold = Math.max(TURN.minLevel, s.noise * TURN.overNoise);
  if (rms >= threshold) {
    const loud = s.loud + dt;
    const n: TurnState = { ...s, loud, quiet: 0 };
    if (!s.started && loud >= TURN.startMs) return { state: { ...n, started: true }, event: "speech_start" };
    if (s.started && s.paused && loud >= TURN.startMs) return { state: { ...n, paused: false }, event: "speech_resume" };
    return { state: n, event: null };
  }
  // Below the threshold: learn the room while nobody is talking.
  const noise = s.started ? s.noise : s.noise + (rms - s.noise) * TURN.noiseEase;
  const quiet = s.quiet + dt;
  const n: TurnState = { ...s, noise: Math.max(0.0005, noise), loud: 0, quiet };
  if (s.started && !s.paused && quiet >= TURN.pauseMs) return { state: { ...n, paused: true }, event: "pause" };
  return { state: n, event: null };
}

/** The room's level from readings taken while nobody talks (the call measures it when the mic opens): the median,
 *  so a single bump doesn't count. */
export function calibrateNoise(levels: readonly number[]): number {
  if (!levels.length) return 0.004;
  const sorted = [...levels].sort((a, b) => a - b);
  return Math.max(0.0005, Math.min(0.08, sorted[Math.floor(sorted.length / 2)]));
}
