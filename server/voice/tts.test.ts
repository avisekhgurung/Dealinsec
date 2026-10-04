import { describe, expect, it } from "vitest";
import { MAX_SPOKEN_CHARS, buildRequest, prepareSpeech, synthesize, ttsConfigured, ttsVoice, type FetchFn } from "./tts";
import { createVoiceBudget } from "./budget";

const ENV = { OPENAI_API_KEY: "sk-test-SECRET-123" } as NodeJS.ProcessEnv;
const mp3 = () => { const b = new Uint8Array(300); b.set([0x49, 0x44, 0x33]); return b; };
const reply = (status: number, body: Uint8Array = mp3()) => ({ ok: status >= 200 && status < 300, status, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer });

describe("prepareSpeech", () => {
  it("makes text speakable and bounded; nothing in, nothing out", () => {
    expect(prepareSpeech("**Done.** See [the deal](https://x.test/d/1).")).toBe("Done. See the deal.");
    expect(prepareSpeech("word ".repeat(1000)).length).toBeLessThanOrEqual(MAX_SPOKEN_CHARS);
    for (const v of ["", "   ", null, undefined, 42, {}, [], "***", "```code```"]) expect(prepareSpeech(v as any), JSON.stringify(v)).toBe("");
  });
});

describe("buildRequest", () => {
  it("asks for MP3 in the configured voice with the butler instructions, and sends the key only as a bearer header", () => {
    const r = buildRequest("Good evening.", { ...ENV, OPENAI_TTS_VOICE: "ash", OPENAI_TTS_MODEL: "tts-x" });
    const body = JSON.parse(r.body);
    expect(r.url).toBe("https://api.openai.com/v1/audio/speech");
    expect(body).toMatchObject({ model: "tts-x", voice: "ash", input: "Good evening.", response_format: "mp3" });
    expect(body.instructions).toMatch(/English gentleman/);
    expect(r.headers.Authorization).toBe("Bearer sk-test-SECRET-123");
    expect(r.body).not.toMatch(/SECRET/);
  });
  it("has sane defaults, and a base URL override loses a trailing slash", () => {
    expect(JSON.parse(buildRequest("x", ENV).body)).toMatchObject({ model: "gpt-4o-mini-tts", voice: "onyx" });
    expect(buildRequest("x", { ...ENV, OPENAI_TTS_BASE_URL: "http://127.0.0.1:4010/v1//" }).url).toBe("http://127.0.0.1:4010/v1/audio/speech");
    expect(ttsVoice({ OPENAI_TTS_VOICE: "x".repeat(99) } as any).length).toBe(32);
  });
});

describe("synthesize", () => {
  it("is off without a key, and says nothing about a missing one beyond that", async () => {
    expect(ttsConfigured({} as any)).toBe(false);
    expect(ttsConfigured({ OPENAI_API_KEY: "  " } as any)).toBe(false);
    const r = await synthesize("hello there", { env: {} as any, fetchFn: async () => { throw new Error("must not be called"); } });
    expect(r).toMatchObject({ ok: false, code: "not_configured" });
  });
  it("returns audio for a good answer, calling the provider once with the prepared text", async () => {
    const calls: any[] = [];
    const r = await synthesize("**Hello** there.", { env: ENV, fetchFn: (async (u, i) => { calls.push([u, i]); return reply(200); }) as FetchFn });
    expect(r.ok && r.contentType).toBe("audio/mpeg");
    expect(r.ok && r.audio.length).toBe(300);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0][1].body).input).toBe("Hello there.");
  });
  it("never calls the provider for nothing to say", async () => {
    let called = false;
    const r = await synthesize("   ", { env: ENV, fetchFn: (async () => { called = true; return reply(200); }) as FetchFn });
    expect(r).toMatchObject({ ok: false, code: "empty" }); expect(called).toBe(false);
  });
  it("turns provider failures into plain, key-free messages", async () => {
    for (const [status, code] of [[429, "rate_limited"], [500, "upstream"], [401, "upstream"], [400, "upstream"]] as const) {
      const r = await synthesize("hello there", { env: ENV, fetchFn: (async () => reply(status)) as FetchFn });
      expect(r, String(status)).toMatchObject({ ok: false, code });
      expect(JSON.stringify(r)).not.toMatch(/SECRET|sk-/);
    }
    const down = await synthesize("hello there", { env: ENV, fetchFn: (async () => { throw new Error("connect ECONNREFUSED sk-test-SECRET-123"); }) as FetchFn });
    expect(down).toMatchObject({ ok: false, code: "upstream" });
    expect(JSON.stringify(down)).not.toMatch(/SECRET|ECONNREFUSED/);
  });
  it("refuses a 'successful' answer that is not audio (an error page, JSON, HTML, a tiny body)", async () => {
    for (const body of [new TextEncoder().encode("<html>" + "x".repeat(400)), new TextEncoder().encode(JSON.stringify({ error: "x".repeat(400) })), new Uint8Array(10), new Uint8Array(0)]) {
      const r = await synthesize("hello there", { env: ENV, fetchFn: (async () => reply(200, body)) as FetchFn });
      expect(r.ok).toBe(false);
    }
    const frame = new Uint8Array(300); frame.set([0xff, 0xfb]);
    expect((await synthesize("hello there", { env: ENV, fetchFn: (async () => reply(200, frame)) as FetchFn })).ok).toBe(true);
  });
});

describe("createVoiceBudget", () => {
  it("limits a person's rate per minute and recovers", () => {
    let t = 0; const b = createVoiceBudget({ perMinute: 3, dailyChars: 1000, now: () => t });
    expect([1, 2, 3, 4].map(() => b.allowRate("u"))).toEqual([true, true, true, false]);
    expect(b.allowRate("other")).toBe(true);
    t = 60_001; expect(b.allowRate("u")).toBe(true);
  });
  it("caps a workspace's characters per UTC day, reserving only what fits, and a new day starts fresh", () => {
    let t = Date.UTC(2026, 9, 4, 23, 0); const b = createVoiceBudget({ perMinute: 99, dailyChars: 100, now: () => t });
    expect(b.reserve("o", 60)).toBe(true);
    expect(b.reserve("o", 50)).toBe(false);     // would pass the cap: nothing reserved
    expect(b.remaining("o")).toBe(40);
    expect(b.reserve("o", 40)).toBe(true);
    expect(b.reserve("o", 1)).toBe(false);
    expect(b.reserve("other", 100)).toBe(true); // another workspace is separate
    t = Date.UTC(2026, 9, 5, 0, 1);
    expect(b.reserve("o", 100)).toBe(true);
  });
  it("gives back a reservation when nothing was spoken, never below zero", () => {
    const b = createVoiceBudget({ perMinute: 9, dailyChars: 100 });
    b.reserve("o", 80); b.refund("o", 80); expect(b.remaining("o")).toBe(100);
    b.refund("o", 500); expect(b.remaining("o")).toBe(100);
  });
});
