/**
 * How fast a voice speaks, under the person's control: a few steps (slower → faster), remembered per voice, changed
 * with the call's speed button or by saying so, in English or Hinglish ("speak faster", "slow down", "jaldi bolo",
 * "dheere bolo", "normal speed").
 */
export const SPEEDS = [0.8, 1, 1.15, 1.3, 1.5] as const;
export type SpeedStep = (typeof SPEEDS)[number];

/** The step after `s` going up or down (stays at the ends); "normal" is 1. */
export function stepSpeed(s: number, dir: "faster" | "slower" | "normal"): SpeedStep {
  if (dir === "normal") return 1;
  const i = Math.max(0, SPEEDS.findIndex((x) => x >= s - 0.001));
  return SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, i + (dir === "faster" ? 1 : -1)))];
}

/** The button: cycles through the steps, back to the slowest after the fastest. */
export const nextSpeed = (s: number): SpeedStep => { const i = SPEEDS.findIndex((x) => Math.abs(x - s) < 0.001); return SPEEDS[(i + 1) % SPEEDS.length]; };

/** A spoken speed request in what the person said, or null. Only clear requests; "a fast reply" is not one. */
export function speedCommand(text: string): "faster" | "slower" | "normal" | null {
  const t = ` ${text.toLowerCase().replace(/[.,!?;:"'()]/g, " ").replace(/\s+/g, " ")} `;
  if (/ (normal|regular|usual) (speed|pace) | speak normally | normal bolo /.test(t)) return "normal";
  if (/ (speak|talk|say it|go) (a bit |a little |little )?(faster|quicker|more quickly) | speed up | (jaldi|tez|fast) (fast )?(bolo|boliye|bol) /.test(t)) return "faster";
  if (/ (speak|talk|say it|go) (a bit |a little |little )?(slower|more slowly|slowly) | slow down | (dheere|dhire|aaram se|slow) (se )?(bolo|boliye|bol) /.test(t)) return "slower";
  return null;
}

export const speedKey = (voice: string) => `dis-voice-speed-${voice}`;
