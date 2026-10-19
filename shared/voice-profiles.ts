/**
 * Who speaks, and how: Agent mode's own voice and each coworker's (Nibo 🔎 curious and quick, Mika 💌 warm, Zee 🌱
 * calm and unhurried). One table for the server (which voice the provider uses) and the browser (the fallback voice's
 * pitch and rate when the neural voice isn't available), kept apart from the characters' artwork and animation.
 *
 * Sarvam speakers are bulbul:v3 names (docs.sarvam.ai, "Voices"); each can be overridden on the server with
 * SARVAM_VOICE_<KEY> (for example SARVAM_VOICE_NIBO=kabir) without a code change.
 */
export const VOICE_KEYS = ["agent", "nibo", "mika", "zee"] as const;
export type VoiceKey = (typeof VOICE_KEYS)[number];
export const isVoiceKey = (x: unknown): x is VoiceKey => typeof x === "string" && (VOICE_KEYS as readonly string[]).includes(x);

export interface VoiceProfile {
  sarvam: { speaker: string; pace: number };
  openai: { voice: string; instructions: string };
  /** The browser's own voice, when the neural one isn't available: pitch 0–2, rate 0.1–10 (1 = normal). */
  browser: { pitch: number; rate: number };
}

export const VOICE_PROFILES: Record<VoiceKey, VoiceProfile> = {
  agent: {
    sarvam: { speaker: "shubh", pace: 1.0 },
    openai: {
      voice: "onyx",
      instructions: "Speak as a refined, warm English gentleman who is a trusted private assistant: calm, measured and unhurried, " +
        "understated and precise, never cheerful or salesy. Natural pauses at commas and full stops. Keep it brief and clear.",
    },
    browser: { pitch: 1, rate: 1 },
  },
  nibo: {
    sarvam: { speaker: "aayan", pace: 1.12 },
    openai: { voice: "verse", instructions: "Speak as a curious, quick and cheerful young researcher who has just found something interesting. Light and lively, never loud." },
    browser: { pitch: 1.35, rate: 1.08 },
  },
  mika: {
    sarvam: { speaker: "kavya", pace: 1.02 },
    openai: { voice: "coral", instructions: "Speak warmly and kindly, like a thoughtful friend helping with a message. Gentle, smiling, never pushy." },
    browser: { pitch: 1.25, rate: 1 },
  },
  zee: {
    sarvam: { speaker: "anand", pace: 0.92 },
    openai: { voice: "sage", instructions: "Speak calmly and reassuringly, like an organised, dependable friend. Unhurried, steady and clear." },
    browser: { pitch: 0.95, rate: 0.92 },
  },
};

/** The Sarvam speaker for a voice, with the server's optional override (a lowercase name only). */
export function sarvamSpeaker(key: VoiceKey, env: Record<string, string | undefined> = {}): string {
  const o = env[`SARVAM_VOICE_${key.toUpperCase()}`]?.trim().toLowerCase();
  return o && /^[a-z][a-z0-9_]{1,40}$/.test(o) ? o : VOICE_PROFILES[key].sarvam.speaker;
}
