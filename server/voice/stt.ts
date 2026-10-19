/**
 * Speech to text for voice calls: one short recording in (what the person just said), its words out, through Sarvam
 * AI (saaras), which hears Indian English, Hindi and code-mixed Hinglish. The browser records the microphone itself
 * (louder and cleaner than its built-in recogniser) and sends the clip to our own route; the key stays here.
 *
 * Nothing here logs the audio or the words. The network is behind `fetchFn`, so every rule is tested.
 *
 *   SARVAM_API_KEY          Sarvam's key; without it the call keeps using the browser's own recogniser
 *   SARVAM_STT_MODEL        default saaras:v4
 *   SARVAM_STT_LANGUAGE     default "unknown" (auto-detect, per clip)
 *   SARVAM_STT_BASE_URL     default https://api.sarvam.ai (tests point it at a local fake)
 */
const TIMEOUT_MS = 15_000;
/** The audio a browser can record and Sarvam can read; anything else is refused before it costs anything. */
export const STT_AUDIO_TYPES = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-wav", "audio/aac"] as const;
/** About 30 seconds of compressed speech is far below this; Sarvam's quick endpoint is for clips under 30 s. */
export const STT_MAX_BYTES = 3_000_000;
export const STT_MIN_BYTES = 800;
/** Words a DealInSec call uses that a general model might mishear: they bias recognition, nothing more. */
export const STT_KEYTERMS = ["DealInSec", "Nibo", "Mika", "Zee", "Client Radar", "The Nest", "quotation", "invoice", "GST", "agreement", "lead", "Razorpay"];

type Env = NodeJS.ProcessEnv;
export const sttConfigured = (env: Env = process.env): boolean => !!env.SARVAM_API_KEY?.trim();

/** The base type of a Content-Type header ("audio/webm;codecs=opus" → "audio/webm"), if it's one we accept. */
export function sttAudioType(contentType: string | undefined): (typeof STT_AUDIO_TYPES)[number] | null {
  const base = String(contentType ?? "").split(";")[0].trim().toLowerCase();
  return (STT_AUDIO_TYPES as readonly string[]).includes(base) ? (base as (typeof STT_AUDIO_TYPES)[number]) : null;
}

export type SttResult =
  | { ok: true; text: string; language: string | null }
  | { ok: false; code: "not_configured" | "bad_audio" | "rate_limited" | "upstream" | "timeout"; message: string };

export type SttFetch = (url: string, init: { method: string; headers: Record<string, string>; body: FormData; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const EXT: Record<string, string> = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/aac": "aac" };

export function buildSttForm(audio: Uint8Array, type: string, env: Env = process.env): FormData {
  const form = new FormData();
  form.append("file", new Blob([audio], { type }), `speech.${EXT[type] ?? "webm"}`);
  form.append("model", env.SARVAM_STT_MODEL?.trim() || "saaras:v4");
  form.append("language_code", env.SARVAM_STT_LANGUAGE?.trim() || "unknown");
  form.append("keyterms", JSON.stringify(STT_KEYTERMS));
  return form;
}

export async function transcribe(audio: Uint8Array, contentType: string | undefined, opts: { env?: Env; fetchFn?: SttFetch } = {}): Promise<SttResult> {
  const env = opts.env ?? process.env;
  if (!sttConfigured(env)) return { ok: false, code: "not_configured", message: "Speech recognition isn't set up on this server." };
  const type = sttAudioType(contentType);
  if (!type || audio.length < STT_MIN_BYTES || audio.length > STT_MAX_BYTES) return { ok: false, code: "bad_audio", message: "That recording couldn't be used." };
  const base = (env.SARVAM_STT_BASE_URL?.trim() || "https://api.sarvam.ai").replace(/\/+$/, "");
  const fetchFn: SttFetch = opts.fetchFn ?? ((u, i) => fetch(u, i as any) as any);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetchFn(`${base}/speech-to-text`, { method: "POST", headers: { "api-subscription-key": String(env.SARVAM_API_KEY).trim() }, body: buildSttForm(audio, type, env), signal: ac.signal });
    if (res.status === 429) return { ok: false, code: "rate_limited", message: "Speech recognition is busy." };
    if (res.status === 400 || res.status === 422) return { ok: false, code: "bad_audio", message: "That recording couldn't be used." };
    if (!res.ok) return { ok: false, code: "upstream", message: "Speech recognition didn't answer." };
    const j = (await res.json()) as { transcript?: unknown; language_code?: unknown };
    const text = typeof j?.transcript === "string" ? j.transcript.replace(/\s+/g, " ").trim() : "";
    return { ok: true, text, language: typeof j?.language_code === "string" ? j.language_code : null };
  } catch {
    return { ok: false, code: ac.signal.aborted ? "timeout" : "upstream", message: ac.signal.aborted ? "Speech recognition took too long." : "I couldn't reach speech recognition." };
  } finally {
    clearTimeout(timer);
  }
}
