/**
 * Neural voice for the call: HTTP surface (authenticated, needs a workspace).
 *
 *   GET  /api/voice/status   { neural: boolean }: whether the call should use the neural voice
 *   POST /api/voice/speak    { text } -> audio/mpeg: one sentence, spoken
 *
 * Without OPENAI_API_KEY, status says neural:false and the call keeps using the browser's voice.
 * Any failure answers a JSON error and the call speaks that sentence with the browser's voice,
 * so a call never goes silent.
 */
import type { Express, Request, Response } from "express";
import { isAuthenticated } from "../auth";
import { agentLog } from "../agent/log";
import { createVoiceBudget } from "./budget";
import { prepareSpeech, synthesize, ttsConfigured } from "./tts";

const intEnv = (k: string, d: number) => { const n = Number(process.env[k]); return Number.isInteger(n) && n > 0 ? n : d; };
// 50,000 characters is about 55 minutes of speech a day per workspace; at OpenAI's list price that is under a dollar.
const budget = createVoiceBudget({ perMinute: intEnv("VOICE_PER_MINUTE", 40), dailyChars: intEnv("VOICE_DAILY_CHARS", 50_000) });

export function registerVoiceRoutes(app: Express) {
  const gate = (req: Request, res: Response, next: () => void) => {
    if (!(req as any).user?.organizationId) return res.status(403).json({ code: "no_organization", error: "Finish setting up your workspace first." });
    next();
  };

  app.get("/api/voice/status", isAuthenticated, gate, (req: any, res: Response) => {
    res.json({ neural: ttsConfigured(), remainingChars: ttsConfigured() ? budget.remaining(req.user.organizationId) : 0 });
  });

  app.post("/api/voice/speak", isAuthenticated, gate, async (req: any, res: Response) => {
    try {
      if (!ttsConfigured()) return res.status(503).json({ code: "VOICE_NOT_CONFIGURED", error: "Neural voice isn't set up on this server." });
      const text = prepareSpeech(req.body?.text);
      if (!text) return res.status(400).json({ code: "empty", error: "There's nothing to say." });
      if (!budget.allowRate(String(req.user.id))) return res.status(429).json({ code: "rate_limited", error: "Too many requests. The browser voice will be used." });
      if (!budget.reserve(req.user.organizationId, text.length)) return res.status(429).json({ code: "daily_cap", error: "Today's neural voice allowance is used up. The browser voice will be used." });
      const r = await synthesize(text);
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
}
