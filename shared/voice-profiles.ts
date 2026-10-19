/**
 * Who speaks, and how: Agent mode's own voice and each coworker's (Nibo 🔎 curious and quick, Mika 💌 warm, Zee 🌱
 * calm and unhurried). One table for the server (which voice the provider uses) and the browser (the fallback voice's
 * pitch and rate when the neural voice isn't available), kept apart from the characters' artwork and animation.
 *
 * Sarvam speakers are bulbul names (docs.sarvam.ai, "Voices"). A speaker belongs to one model: bulbul:v3 names are
 * plain ("shubh"), bulbul:v4-flash personas are "<name>_<language>_<style>" ("zarina_en_conversation"), so a voice that
 * uses a v4-flash persona names its model (and the language that persona speaks). Each can be overridden on the server
 * with SARVAM_VOICE_<KEY>, SARVAM_MODEL_<KEY> and SARVAM_LANGUAGE_<KEY>, without a code change.
 */
export const VOICE_KEYS = ["agent", "nibo", "mika", "zee"] as const;
export type VoiceKey = (typeof VOICE_KEYS)[number];
export const isVoiceKey = (x: unknown): x is VoiceKey => typeof x === "string" && (VOICE_KEYS as readonly string[]).includes(x);

export interface VoiceProfile {
  sarvam: {
    speaker: string; pace: number;
    /** The model this speaker belongs to, when not the default (bulbul:v3). */ model?: string;
    /** The language this speaker reads, when not the default (hi-IN). */ language?: string;
    /** Expressiveness (Sarvam's temperature, 0.01–1; higher varies the delivery more): the coworkers are livelier. */ temperature: number;
  };
  /** Short spoken fillers played the moment the person stops talking, while the reply is being prepared. */
  fillers: string[];
  openai: { voice: string; instructions: string };
  /** The browser's own voice, when the neural one isn't available: pitch 0–2, rate 0.1–10 (1 = normal). */
  browser: { pitch: number; rate: number };
}

export const VOICE_PROFILES: Record<VoiceKey, VoiceProfile> = {
  agent: {
    sarvam: { speaker: "shubh", pace: 1.0, temperature: 0.6 },
    fillers: ["Certainly, one moment.", "Let me see."],
    openai: {
      voice: "onyx",
      instructions: "Speak as a refined, warm English gentleman who is a trusted private assistant: calm, measured and unhurried, " +
        "understated and precise, never cheerful or salesy. Natural pauses at commas and full stops. Keep it brief and clear.",
    },
    browser: { pitch: 1, rate: 1 },
  },
  nibo: {
    sarvam: { speaker: "anand", pace: 1.12, temperature: 0.85 },
    fillers: ["Ooh, okay, let me dig into that…", "Hmm, give me a sec…", "Achha, let me check…"],
    openai: { voice: "verse", instructions: "Speak as a curious, quick and cheerful young researcher who has just found something interesting. Light and lively, never loud." },
    browser: { pitch: 1.35, rate: 1.08 },
  },
  mika: {
    sarvam: { speaker: "zarina_en_conversation", model: "bulbul:v4-flash", language: "en-IN", pace: 1.02, temperature: 0.8 },
    fillers: ["Mm-hm, one moment…", "Okay, let me think…", "Ooh, nice, give me a sec…"],
    openai: { voice: "coral", instructions: "Speak warmly and kindly, like a thoughtful friend helping with a message. Gentle, smiling, never pushy." },
    browser: { pitch: 1.25, rate: 1 },
  },
  zee: {
    sarvam: { speaker: "ratan_hi_latenight_warm", model: "bulbul:v4-flash", language: "hi-IN", pace: 0.92, temperature: 0.75 },
    fillers: ["Alright, let me check…", "Hmm, ek second…", "Okay, one moment…"],
    openai: { voice: "sage", instructions: "Speak calmly and reassuringly, like an organised, dependable friend. Unhurried, steady and clear." },
    browser: { pitch: 0.95, rate: 0.92 },
  },
};

/** The Sarvam speaker for a voice, with the server's optional override (a lowercase name only). */
export function sarvamSpeaker(key: VoiceKey, env: Record<string, string | undefined> = {}): string {
  const o = env[`SARVAM_VOICE_${key.toUpperCase()}`]?.trim().toLowerCase();
  return o && /^[a-z][a-z0-9_]{1,40}$/.test(o) ? o : VOICE_PROFILES[key].sarvam.speaker;
}

const MODEL_RE = /^bulbul:v[0-9][a-z0-9-]*$/;
const LANG_RE = /^[a-z]{2}-IN$/;
/** Speaker, model and language for one voice: per-voice overrides, then the profile, then the server-wide defaults. */
export function sarvamVoice(key: VoiceKey, env: Record<string, string | undefined> = {}): { speaker: string; model: string; language: string } {
  const p = VOICE_PROFILES[key].sarvam;
  const K = key.toUpperCase();
  const pick = (v: string | undefined, re: RegExp) => { const t = v?.trim(); return t && re.test(t) ? t : undefined; };
  return {
    speaker: sarvamSpeaker(key, env),
    model: pick(env[`SARVAM_MODEL_${K}`], MODEL_RE) ?? p.model ?? pick(env.SARVAM_TTS_MODEL, MODEL_RE) ?? "bulbul:v3",
    language: pick(env[`SARVAM_LANGUAGE_${K}`], LANG_RE) ?? p.language ?? pick(env.SARVAM_TTS_LANGUAGE, LANG_RE) ?? "hi-IN",
  };
}
