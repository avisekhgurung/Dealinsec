/**
 * Neural text-to-speech: one sentence in, MP3 out, through OpenAI's speech endpoint.
 *
 * The key stays on the server (OPENAI_API_KEY); the browser only ever calls our own route.
 * Nothing here logs the text (it is what a person's assistant is about to say aloud) or the key.
 * The network is behind `fetchFn` so every rule is tested without one.
 *
 *   OPENAI_API_KEY        required; without it the feature is simply off and the call uses the browser voice
 *   OPENAI_TTS_MODEL      default gpt-4o-mini-tts (the one that takes spoken-style instructions)
 *   OPENAI_TTS_VOICE      default onyx
 *   OPENAI_TTS_BASE_URL   default https://api.openai.com/v1 (tests point it at a local fake)
 */
import { speakable } from "@shared/voice";

export const MAX_SPOKEN_CHARS = 600;
const TIMEOUT_MS = 15_000;

const INSTRUCTIONS =
  "Speak as a refined, warm English gentleman who is a trusted private assistant: calm, measured and unhurried, " +
  "understated and precise, never cheerful or salesy. Natural pauses at commas and full stops. Keep it brief and clear.";

export const ttsConfigured = (env: NodeJS.ProcessEnv = process.env): boolean => !!env.OPENAI_API_KEY?.trim();
export const ttsVoice = (env: NodeJS.ProcessEnv = process.env): string => (env.OPENAI_TTS_VOICE?.trim() || "onyx").slice(0, 32);

/** What may be sent: plain text only, spoken-style, bounded. Empty means there is nothing to say. */
export function prepareSpeech(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return speakable(raw, MAX_SPOKEN_CHARS).trim();
}

export type TtsResult =
  | { ok: true; audio: Uint8Array; contentType: "audio/mpeg" }
  | { ok: false; code: "not_configured" | "empty" | "rate_limited" | "upstream" | "timeout"; message: string };

export type FetchFn = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

export function buildRequest(text: string, env: NodeJS.ProcessEnv = process.env) {
  const base = (env.OPENAI_TTS_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
  return {
    url: `${base}/audio/speech`,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: env.OPENAI_TTS_MODEL?.trim() || "gpt-4o-mini-tts", voice: ttsVoice(env), input: text, instructions: INSTRUCTIONS, response_format: "mp3" }),
  };
}

export async function synthesize(rawText: unknown, opts: { env?: NodeJS.ProcessEnv; fetchFn?: FetchFn } = {}): Promise<TtsResult> {
  const env = opts.env ?? process.env;
  if (!ttsConfigured(env)) return { ok: false, code: "not_configured", message: "Neural voice isn't set up on this server." };
  const text = prepareSpeech(rawText);
  if (!text) return { ok: false, code: "empty", message: "There's nothing to say." };
  const fetchFn: FetchFn = opts.fetchFn ?? ((u, i) => fetch(u, i));
  const req = buildRequest(text, env);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetchFn(req.url, { method: "POST", headers: req.headers, body: req.body, signal: ac.signal });
    if (res.status === 429) return { ok: false, code: "rate_limited", message: "The voice service is busy." };
    if (!res.ok) return { ok: false, code: "upstream", message: "The voice service couldn't make that sound." };
    const audio = new Uint8Array(await res.arrayBuffer());
    // An MP3 starts with an ID3 tag or a frame sync (0xFF 0xE0+); anything else is not audio we should hand a browser.
    const looksMp3 = audio.length > 128 && ((audio[0] === 0x49 && audio[1] === 0x44 && audio[2] === 0x33) || (audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0));
    if (!looksMp3) return { ok: false, code: "upstream", message: "The voice service sent something that isn't audio." };
    return { ok: true, audio, contentType: "audio/mpeg" };
  } catch {
    return { ok: false, code: ac.signal.aborted ? "timeout" : "upstream", message: ac.signal.aborted ? "The voice service took too long." : "I couldn't reach the voice service." };
  } finally {
    clearTimeout(timer);
  }
}
