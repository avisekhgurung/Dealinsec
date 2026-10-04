/**
 * A stand-in for OpenAI's speech endpoint, for local tests only. It checks the bearer key,
 * records what it was asked to say, and answers with about a second of silent but genuinely
 * playable MP3, so the call's real playback path can be exercised without hearing anything.
 *
 *   npx tsx script/fake-openai-tts.mts            (listens on 127.0.0.1:4010)
 * Input containing FAIL500 answers 500; FAIL429 answers 429; SLOW waits 20 s.
 */
import http from "node:http";

export const FAKE_KEY = "sk-fake-local-test";
export function startFakeTts(port = 4010) {
  const log: { input: string; voice: string; model: string; hasInstructions: boolean }[] = [];
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/_log") { res.setHeader("Content-Type", "application/json"); return void res.end(JSON.stringify(log)); }
    if (req.method !== "POST" || req.url !== "/v1/audio/speech") { res.statusCode = 404; return void res.end(); }
    if (req.headers.authorization !== `Bearer ${FAKE_KEY}`) { res.statusCode = 401; return void res.end(JSON.stringify({ error: "bad key" })); }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const j = JSON.parse(body || "{}");
      log.push({ input: j.input, voice: j.voice, model: j.model, hasInstructions: typeof j.instructions === "string" && j.instructions.length > 20 });
      const input = String(j.input ?? "");
      if (input.includes("FAIL500")) { res.statusCode = 500; return void res.end("{}"); }
      if (input.includes("FAIL429")) { res.statusCode = 429; return void res.end("{}"); }
      // 38 silent MPEG-1 Layer III frames (128 kbps, 44.1 kHz, 417 bytes each, about one second): a browser really decodes and plays these.
      const send = () => { const frame = Buffer.alloc(417); frame.set([0xff, 0xfb, 0x90, 0x00]); res.setHeader("Content-Type", "audio/mpeg"); res.end(Buffer.concat(Array.from({ length: 38 }, () => frame))); };
      if (input.includes("SLOW")) setTimeout(send, 20_000); else send();
    });
  });
  return new Promise<{ close(): void; log: typeof log }>((resolve) => server.listen(port, "127.0.0.1", () => resolve({ close: () => server.close(), log })));
}
if (process.argv[1]?.endsWith("fake-openai-tts.mts")) { await startFakeTts(); console.log("fake OpenAI speech on http://127.0.0.1:4010"); }
