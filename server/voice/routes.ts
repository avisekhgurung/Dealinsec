/**
 * Neural voice for the call: HTTP surface (authenticated, needs a workspace).
 *
 *   GET  /api/voice/status   { neural: boolean }: whether the call should use the neural voice
 *   POST /api/voice/speak    { text } -> audio/mpeg: one sentence, spoken
 *   POST /api/voice/transcribe   raw audio (audio/webm, audio/mp4…) -> { text, language }: what the person just said
 *                                (Sarvam speech to text; status says stt:true when it is set up)
 *
 * POST /api/voice/speak also takes { voice: "agent" | "nibo" | "mika" | "zee" } (shared/voice-profiles.ts).
 * Without SARVAM_API_KEY or OPENAI_API_KEY, status says neural:false and the browser's voice is used.
 * Any failure answers a JSON error and the call speaks that sentence with the browser's voice,
 * so a call never goes silent.
 */
import express, { type Express, type Request, type Response } from "express";
import { isAuthenticated } from "../auth";
import { agentLog } from "../agent/log";
import { createVoiceBudget } from "./budget";
import { prepareSpeech, synthesize, ttsConfigured, ttsProvider } from "./tts";
import { isVoiceKey } from "@shared/voice-profiles";
import { STT_MAX_BYTES, sttAudioType, sttConfigured, transcribe } from "./stt";

const intEnv = (k: string, d: number) => { const n = Number(process.env[k]); return Number.isInteger(n) && n > 0 ? n : d; };
// 50,000 characters is about 55 minutes of speech a day per workspace; at OpenAI's list price that is under a dollar.
const budget = createVoiceBudget({ perMinute: intEnv("VOICE_PER_MINUTE", 40), dailyChars: intEnv("VOICE_DAILY_CHARS", 50_000) });
// Listening: a clip every few seconds while someone talks. Counted in kilobytes of audio per workspace per day
// (60,000 KB is several hours of compressed speech), and a per-person rate against a runaway loop.
const listenBudget = createVoiceBudget({ perMinute: intEnv("VOICE_STT_PER_MINUTE", 90), dailyChars: intEnv("VOICE_STT_DAILY_KB", 60_000) });

export function registerVoiceRoutes(app: Express) {
  const gate = (req: Request, res: Response, next: () => void) => {
    if (!(req as any).user?.organizationId) return res.status(403).json({ code: "no_organization", error: "Finish setting up your workspace first." });
    next();
  };

  app.get("/api/voice/status", isAuthenticated, gate, (req: any, res: Response) => {
    const stt = sttConfigured() && listenBudget.remaining(req.user.organizationId) > 0;
    res.json({ neural: ttsConfigured(), provider: ttsProvider(), remainingChars: ttsConfigured() ? budget.remaining(req.user.organizationId) : 0, stt });
  });

  app.post("/api/voice/speak", isAuthenticated, gate, async (req: any, res: Response) => {
    try {
      if (!ttsConfigured()) return res.status(503).json({ code: "VOICE_NOT_CONFIGURED", error: "Neural voice isn't set up on this server." });
      const text = prepareSpeech(req.body?.text);
      if (!text) return res.status(400).json({ code: "empty", error: "There's nothing to say." });
      if (!budget.allowRate(String(req.user.id))) return res.status(429).json({ code: "rate_limited", error: "Too many requests. The browser voice will be used." });
      if (!budget.reserve(req.user.organizationId, text.length)) return res.status(429).json({ code: "daily_cap", error: "Today's neural voice allowance is used up. The browser voice will be used." });
      // Whose voice: Agent mode's by default, or a coworker's (only the four known names; anything else is Agent mode).
      const voice = isVoiceKey(req.body?.voice) ? req.body.voice : "agent";
      const r = await synthesize(text, { voice });
      if (!r.ok) {
        budget.refund(req.user.organizationId, text.length);
        agentLog("error", { errorType: r.code, where: "voice_speak" }); // never the text
        return res.status(r.code === "rate_limited" ? 429 : 502).json({ code: r.code, error: r.message });
      }
      res.set({ "Content-Type": r.contentType, "Content-Length": String(r.audio.length), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
      return res.send(Buffer.from(r.audio));
    } catch (err) {
      agentLog("error", { errorType: (err as Error)?.name ?? "Error", where: "voice_speak" });
      res.status(500).json({ code: "internal", error: "Something went wrong on our side." });
    }
  });

  // Raw audio only (a cross-site form can't send an audio/* body without a preflight), bounded in size.
  app.post("/api/voice/transcribe", isAuthenticated, gate, express.raw({ type: (req) => !!sttAudioType(req.headers["content-type"]), limit: STT_MAX_BYTES }), async (req: any, res: Response) => {
    try {
      if (!sttConfigured()) return res.status(503).json({ code: "STT_NOT_CONFIGURED", error: "Speech recognition isn't set up on this server." });
      const body: unknown = req.body;
      if (!sttAudioType(req.headers["content-type"]) || !Buffer.isBuffer(body)) return res.status(415).json({ code: "bad_audio", error: "Send the recording as audio." });
      const kb = Math.max(1, Math.ceil(body.length / 1000));
      if (!listenBudget.allowRate(String(req.user.id))) return res.status(429).json({ code: "rate_limited", error: "Too many recordings. The browser's recogniser will be used." });
      if (!listenBudget.reserve(req.user.organizationId, kb)) return res.status(429).json({ code: "daily_cap", error: "Today's speech recognition allowance is used up. The browser's recogniser will be used." });
      const r = await transcribe(new Uint8Array(body), req.headers["content-type"]);
      if (!r.ok) {
        listenBudget.refund(req.user.organizationId, kb);
        agentLog("error", { errorType: r.code, where: "voice_transcribe" }); // never the audio or the words
        return res.status(r.code === "rate_limited" ? 429 : r.code === "bad_audio" ? 422 : 502).json({ code: r.code, error: r.message });
      }
      res.set({ "Cache-Control": "private, no-store" });
      return res.json({ text: r.text, language: r.language });
    } catch (err) {
      agentLog("error", { errorType: (err as Error)?.name ?? "Error", where: "voice_transcribe" });
      res.status(500).json({ code: "internal", error: "Something went wrong on our side." });
    }
  });
}
