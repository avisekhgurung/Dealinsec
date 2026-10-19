import { describe, expect, it } from "vitest";
import { STT_KEYTERMS, STT_MAX_BYTES, buildSttForm, sttAudioType, sttConfigured, transcribe, type SttFetch } from "./stt";

const ENV = { SARVAM_API_KEY: "sv-test-SECRET-7" } as NodeJS.ProcessEnv;
const clip = (n = 4000) => new Uint8Array(n).fill(7);
const answer = (status: number, body: unknown = { request_id: "r", transcript: "  Aaj ke   overdue invoices batao ", language_code: "hi-IN" }) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body });

describe("Sarvam speech to text", () => {
  it("is on only with a key", () => {
    expect(sttConfigured(ENV)).toBe(true);
    expect(sttConfigured({ SARVAM_API_KEY: " " } as any)).toBe(false);
  });
  it("accepts only audio a browser records, by its base type", () => {
    expect(sttAudioType("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(sttAudioType("audio/mp4")).toBe("audio/mp4");
    expect(sttAudioType("text/plain")).toBeNull();
    expect(sttAudioType(undefined)).toBeNull();
  });
  it("sends the clip with saaras:v4, auto language and the product's words, the key only in its header", async () => {
    const form = buildSttForm(clip(), "audio/webm", ENV);
    expect(form.get("model")).toBe("saaras:v4");
    expect(form.get("language_code")).toBe("unknown");
    expect(JSON.parse(String(form.get("keyterms")))).toEqual(STT_KEYTERMS);
    expect((form.get("file") as File).name).toBe("speech.webm");
    const calls: any[] = [];
    const r = await transcribe(clip(), "audio/webm;codecs=opus", { env: ENV, fetchFn: (async (u, i) => { calls.push([u, i]); return answer(200); }) as SttFetch });
    expect(r).toEqual({ ok: true, text: "Aaj ke overdue invoices batao", language: "hi-IN" });
    expect(calls[0][0]).toBe("https://api.sarvam.ai/speech-to-text");
    expect(calls[0][1].headers["api-subscription-key"]).toBe("sv-test-SECRET-7");
  });
  it("refuses bad audio before calling, and maps failures to plain, key-free messages", async () => {
    let called = false;
    const never = (async () => { called = true; return answer(200); }) as SttFetch;
    expect(await transcribe(clip(10), "audio/webm", { env: ENV, fetchFn: never })).toMatchObject({ ok: false, code: "bad_audio" });
    expect(await transcribe(clip(STT_MAX_BYTES + 1), "audio/webm", { env: ENV, fetchFn: never })).toMatchObject({ ok: false, code: "bad_audio" });
    expect(await transcribe(clip(), "video/mp4", { env: ENV, fetchFn: never })).toMatchObject({ ok: false, code: "bad_audio" });
    expect(called).toBe(false);
    for (const [status, code] of [[429, "rate_limited"], [422, "bad_audio"], [500, "upstream"], [403, "upstream"]] as const) {
      const r = await transcribe(clip(), "audio/webm", { env: ENV, fetchFn: (async () => answer(status)) as SttFetch });
      expect(r, String(status)).toMatchObject({ ok: false, code });
      expect(JSON.stringify(r)).not.toMatch(/SECRET/);
    }
    const down = await transcribe(clip(), "audio/webm", { env: ENV, fetchFn: (async () => { throw new Error("ECONNREFUSED sv-test-SECRET-7"); }) as SttFetch });
    expect(down).toMatchObject({ ok: false, code: "upstream" });
    expect(JSON.stringify(down)).not.toMatch(/SECRET|ECONNREFUSED/);
  });
  it("an answer without words is an empty transcript, not an error", async () => {
    const r = await transcribe(clip(), "audio/webm", { env: ENV, fetchFn: (async () => answer(200, { transcript: null })) as SttFetch });
    expect(r).toEqual({ ok: true, text: "", language: null });
  });
});
