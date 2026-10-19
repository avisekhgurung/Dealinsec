/**
 * Neural text-to-speech: one sentence in, audio out, in the voice of whoever is speaking (Agent mode, Nibo, Mika or
 * Zee; shared/voice-profiles.ts).
 *
 * Two providers, chosen on the server:
 *   Sarvam AI (bulbul)  made for Indian voices and code-mixed Hinglish; the default when SARVAM_API_KEY is set
 *   OpenAI              the backup: used when Sarvam isn't set up, or for a sentence Sarvam couldn't make
 * Keys stay on the server; the browser only ever calls our own route. Nothing here logs the text (it is what a
 * person's assistant is about to say aloud) or a key. The network is behind `fetchFn`, so every rule is tested.
 *
 *   SARVAM_API_KEY        Sarvam's key (sent as the api-subscription-key header)
 *   SARVAM_TTS_MODEL      default bulbul:v3
 *   SARVAM_TTS_LANGUAGE   default hi-IN (reads Hindi, English and Hinglish mixed together)
 *   SARVAM_VOICE_<KEY>    a different speaker for AGENT, NIBO, MIKA or ZEE
 *   SARVAM_TTS_BASE_URL   default https://api.sarvam.ai (tests point it at a local fake)
 *   OPENAI_API_KEY        OpenAI's key, for the backup
 *   OPENAI_TTS_MODEL      default gpt-4o-mini-tts (the one that takes spoken-style instructions)
 *   OPENAI_TTS_VOICE      Agent mode's OpenAI voice, default onyx
 *   OPENAI_TTS_BASE_URL   default https://api.openai.com/v1
 *   VOICE_PROVIDER        "sarvam" or "openai" to force one; otherwise Sarvam when it has a key, else OpenAI
 */
import { speakable } from "@shared/voice";
import { sarvamSpeaker, VOICE_PROFILES, type VoiceKey } from "@shared/voice-profiles";

export const MAX_SPOKEN_CHARS = 600;
const TIMEOUT_MS = 15_000;

type Env = NodeJS.ProcessEnv;
export type TtsProvider = "sarvam" | "openai";

const has = (v: string | undefined) => !!v?.trim();

/** Which provider speaks first, or null when neither is set up (the call then uses the browser's voice). */
export function ttsProvider(env: Env = process.env): TtsProvider | null {
  const forced = env.VOICE_PROVIDER?.trim().toLowerCase();
  if (forced === "sarvam" && has(env.SARVAM_API_KEY)) return "sarvam";
  if (forced === "openai" && has(env.OPENAI_API_KEY)) return "openai";
  if (has(env.SARVAM_API_KEY)) return "sarvam";
  if (has(env.OPENAI_API_KEY)) return "openai";
  return null;
}
export const ttsConfigured = (env: Env = process.env): boolean => ttsProvider(env) !== null;
export const ttsVoice = (env: Env = process.env): string => (env.OPENAI_TTS_VOICE?.trim() || "onyx").slice(0, 32);

/** What may be sent: plain text only, spoken-style, bounded. Empty means there is nothing to say. */
export function prepareSpeech(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return speakable(raw, MAX_SPOKEN_CHARS).trim();
}

export type AudioType = "audio/mpeg" | "audio/wav";
export type TtsResult =
  | { ok: true; audio: Uint8Array; contentType: AudioType; provider: TtsProvider }
  | { ok: false; code: "not_configured" | "empty" | "rate_limited" | "upstream" | "timeout"; message: string };

export type FetchFn = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

export function buildRequest(text: string, env: Env = process.env, voice: VoiceKey = "agent") {
  const base = (env.OPENAI_TTS_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
  const p = VOICE_PROFILES[voice].openai;
  return {
    url: `${base}/audio/speech`,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: env.OPENAI_TTS_MODEL?.trim() || "gpt-4o-mini-tts", voice: voice === "agent" ? ttsVoice(env) : p.voice, input: text, instructions: p.instructions, response_format: "mp3" }),
  };
}

export function buildSarvamRequest(text: string, env: Env = process.env, voice: VoiceKey = "agent") {
  const base = (env.SARVAM_TTS_BASE_URL?.trim() || "https://api.sarvam.ai").replace(/\/+$/, "");
  const model = env.SARVAM_TTS_MODEL?.trim() || "bulbul:v3";
  const language = env.SARVAM_TTS_LANGUAGE?.trim() || "hi-IN";
  return {
    url: `${base}/text-to-speech`,
    headers: { "Content-Type": "application/json", "api-subscription-key": String(env.SARVAM_API_KEY ?? "").trim() },
    body: JSON.stringify({
      text, language_code: language, model, speaker: sarvamSpeaker(voice, env), pace: VOICE_PROFILES[voice].sarvam.pace,
      speech_sample_rate: 24000, output_audio_codec: "mp3",
    }),
  };
}

/** What the bytes are: an MP3 (an ID3 tag or a frame sync), a WAV (RIFF…WAVE), or nothing a browser should be given. */
export function audioTypeOf(b: Uint8Array): AudioType | null {
  if (b.length <= 128) return null;
  if ((b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x41 && b[10] === 0x56 && b[11] === 0x45) return "audio/wav";
  return null;
}

type Failure = Extract<TtsResult, { ok: false }>;
const BUSY: Failure = { ok: false, code: "rate_limited", message: "The voice service is busy." };
const BAD: Failure = { ok: false, code: "upstream", message: "The voice service couldn't make that sound." };
const NOT_AUDIO: Failure = { ok: false, code: "upstream", message: "The voice service sent something that isn't audio." };

async function call(fetchFn: FetchFn, req: { url: string; headers: Record<string, string>; body: string }, read: (bytes: Uint8Array) => Uint8Array | null, provider: TtsProvider): Promise<TtsResult> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetchFn(req.url, { method: "POST", headers: req.headers, body: req.body, signal: ac.signal });
    if (res.status === 429) return BUSY;
    if (!res.ok) return BAD;
    const audio = read(new Uint8Array(await res.arrayBuffer()));
    const type = audio ? audioTypeOf(audio) : null;
    if (!audio || !type) return NOT_AUDIO;
    return { ok: true, audio, contentType: type, provider };
  } catch {
    return { ok: false, code: ac.signal.aborted ? "timeout" : "upstream", message: ac.signal.aborted ? "The voice service took too long." : "I couldn't reach the voice service." };
  } finally {
    clearTimeout(timer);
  }
}

/** Sarvam answers JSON: { audios: [base64] }. The first entry is this sentence's audio. */
function sarvamAudio(bytes: Uint8Array): Uint8Array | null {
  try {
    const j = JSON.parse(new TextDecoder().decode(bytes));
    const b64 = Array.isArray(j?.audios) && typeof j.audios[0] === "string" ? j.audios[0] : null;
    return b64 ? new Uint8Array(Buffer.from(b64, "base64")) : null;
  } catch { return null; }
}

export async function synthesize(rawText: unknown, opts: { env?: Env; fetchFn?: FetchFn; voice?: VoiceKey } = {}): Promise<TtsResult> {
  const env = opts.env ?? process.env;
  const voice = opts.voice ?? "agent";
  const first = ttsProvider(env);
  if (!first) return { ok: false, code: "not_configured", message: "Neural voice isn't set up on this server." };
  const text = prepareSpeech(rawText);
  if (!text) return { ok: false, code: "empty", message: "There's nothing to say." };
  const fetchFn: FetchFn = opts.fetchFn ?? ((u, i) => fetch(u, i));
  const viaOpenAi = () => call(fetchFn, buildRequest(text, env, voice), (b) => b, "openai");
  if (first === "openai") return viaOpenAi();
  const r = await call(fetchFn, buildSarvamRequest(text, env, voice), sarvamAudio, "sarvam");
  // A sentence Sarvam couldn't make is tried once with OpenAI when it's set up, so the voice doesn't drop to the browser's.
  if (!r.ok && has(env.OPENAI_API_KEY)) return viaOpenAi();
  return r;
}
