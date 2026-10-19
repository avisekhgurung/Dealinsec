/**
 * The Nest's chirps: each coworker's own tiny sounds, made in the browser (Web Audio), never recorded or copied from
 * anywhere. Short, soft and original, in each one's character:
 *   Nibo 🔎  quick, bright triangle blips that rise, like a curious "oh!"
 *   Mika 💌  warm sine notes with a little lift, like a friendly "mm-hm!"
 *   Zee 🌱   lower, slower, rounded tones, calm and reassuring
 * Four moments: hello (a chat opens), start (a task begins), done (work is really finished), needsYou (something waits
 * for an approval). Pure data here (tested); lib/chirp-player.ts plays it, and only when the person has turned sound on.
 */
export type ChirpBot = "nibo" | "mika" | "zee";
export type ChirpKind = "hello" | "start" | "done" | "needsYou";

export interface ChirpNote {
  /** Start frequency in Hz, and where it glides to by the end of the note. */
  freq: number;
  to?: number;
  /** Seconds from the chirp's start, and how long it lasts. */
  at: number;
  dur: number;
  wave: OscillatorType;
  /** Peak loudness, 0–1 (kept soft: everything here is a small UI sound). */
  gain: number;
}

const n = (freq: number, at: number, dur: number, wave: OscillatorType, gain: number, to?: number): ChirpNote => ({ freq, to, at, dur, wave, gain });

export const CHIRPS: Record<ChirpBot, Record<ChirpKind, ChirpNote[]>> = {
  nibo: {
    hello: [n(880, 0, 0.09, "triangle", 0.09, 1320), n(1175, 0.11, 0.12, "triangle", 0.08, 1568)],
    start: [n(660, 0, 0.07, "triangle", 0.08, 990), n(990, 0.08, 0.07, "triangle", 0.08), n(1320, 0.16, 0.1, "triangle", 0.07)],
    done: [n(1047, 0, 0.08, "triangle", 0.08), n(1319, 0.08, 0.08, "triangle", 0.08), n(1568, 0.16, 0.08, "triangle", 0.08), n(2093, 0.24, 0.18, "triangle", 0.07)],
    needsYou: [n(988, 0, 0.1, "triangle", 0.08), n(1175, 0.13, 0.16, "triangle", 0.08, 1397)],
  },
  mika: {
    hello: [n(660, 0, 0.14, "sine", 0.1, 880), n(988, 0.15, 0.2, "sine", 0.09)],
    start: [n(740, 0, 0.12, "sine", 0.09, 988), n(1109, 0.13, 0.16, "sine", 0.08)],
    done: [n(880, 0, 0.12, "sine", 0.09), n(1109, 0.1, 0.12, "sine", 0.09), n(1319, 0.2, 0.28, "sine", 0.09)],
    needsYou: [n(784, 0, 0.14, "sine", 0.09), n(988, 0.17, 0.22, "sine", 0.09, 1047)],
  },
  zee: {
    hello: [n(523, 0, 0.18, "sine", 0.11, 587), n(440, 0.2, 0.26, "sine", 0.1)],
    start: [n(392, 0, 0.16, "sine", 0.1, 523), n(523, 0.18, 0.2, "sine", 0.09)],
    done: [n(523, 0, 0.16, "sine", 0.1), n(659, 0.14, 0.16, "sine", 0.1), n(784, 0.28, 0.34, "sine", 0.1)],
    needsYou: [n(440, 0, 0.18, "sine", 0.1), n(554, 0.22, 0.26, "sine", 0.1)],
  },
};

/** How long a chirp lasts, in seconds (the last note's end). */
export const chirpLength = (notes: readonly ChirpNote[]) => notes.reduce((m, x) => Math.max(m, x.at + x.dur), 0);
