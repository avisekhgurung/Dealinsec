/**
 * Plays The Nest's chirps (lib/chirps.ts) with Web Audio, and holds the one switch for The Nest's sound.
 *
 * Sound is OFF until the person turns it on (localStorage "dis_nest_sound"; every tab and component hears a change at
 * once). Nothing plays while the tab is hidden. The audio context is made on first use, from the person's own tap on
 * the switch, which is what browsers require before any sound.
 */
import { useEffect, useState } from "react";
import { CHIRPS, type ChirpBot, type ChirpKind } from "./chirps";

const KEY = "dis_nest_sound";
const EVENT = "dis-nest-sound";

export function nestSoundOn(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}

export function setNestSound(on: boolean) {
  try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* not remembered; still applies to this page */ }
  if (on) unlockAudio();
  window.dispatchEvent(new CustomEvent(EVENT, { detail: on }));
}

/** The switch, kept in step across the page (and other tabs). */
export function useNestSound(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(nestSoundOn);
  useEffect(() => {
    const sync = () => setOn(nestSoundOn());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(EVENT, sync); window.removeEventListener("storage", sync); };
  }, []);
  return [on, setNestSound];
}

let ctx: AudioContext | null = null;
function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext || (window as any).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) { try { ctx = new AC(); } catch { return null; } }
  return ctx;
}
/** Call inside a tap: lets later chirps play (browsers keep audio suspended until a person interacts). */
export function unlockAudio() {
  const c = context();
  if (c && c.state === "suspended") void c.resume().catch(() => {});
}

/** One chirp, if sound is on and the page is visible. Never throws. */
export function playChirp(bot: ChirpBot, kind: ChirpKind) {
  if (!nestSoundOn() || (typeof document !== "undefined" && document.hidden)) return;
  const c = context();
  if (!c) return;
  try {
    if (c.state === "suspended") void c.resume().catch(() => {});
    const t0 = c.currentTime + 0.02;
    for (const note of CHIRPS[bot][kind]) {
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = note.wave;
      const start = t0 + note.at, end = start + note.dur;
      osc.frequency.setValueAtTime(note.freq, start);
      if (note.to) osc.frequency.exponentialRampToValueAtTime(note.to, end);
      // A soft attack and release: no clicks.
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(note.gain, start + Math.min(0.02, note.dur / 3));
      g.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(g).connect(c.destination);
      osc.start(start);
      osc.stop(end + 0.02);
    }
  } catch { /* no sound on this device */ }
}
