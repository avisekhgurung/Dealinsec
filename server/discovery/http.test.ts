/**
 * A refused key (401, 403): what the server keeps of the provider's explanation, and what it writes to its log.
 * The case this exists for: the live site moved to a new server, the map search's key was locked to the old server's
 * address, and every search failed with nothing in the log to say why.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiscoveryError } from "./types";
import { callJson, keyRefused, refusalReason } from "./http";
import { GooglePlacesProvider } from "./google-places";
import { BraveProvider } from "./brave";
import { LangSearchProvider } from "./langsearch";

const KEY = "NotAReal4Key-local_Test0123456789abcdefGH";
const res = (body: unknown, status = 403) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
const GOOGLE_IP = { error: { code: 403, message: "The provided API key has an IP address restriction. The originating IP address of the call (203.0.113.9) violates this restriction.", status: "PERMISSION_DENIED", details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "API_KEY_IP_ADDRESS_BLOCKED", domain: "googleapis.com" }] } };
const fetchOf = (r: Response) => (async () => r) as unknown as typeof fetch;
const logged = () => vi.mocked(console.log).mock.calls.map((c) => String(c[0])).filter((l) => l.includes("provider_key_refused")).map((l) => JSON.parse(l));
const caught = async (p: Promise<unknown>): Promise<DiscoveryError> => { try { await p; } catch (e) { return e as DiscoveryError; } throw new Error("it did not refuse"); };

afterEach(() => vi.restoreAllMocks());

describe("why a provider refused", () => {
  it("keeps the provider's own codes, in order, each once", () => {
    expect(refusalReason(GOOGLE_IP)).toBe("PERMISSION_DENIED/API_KEY_IP_ADDRESS_BLOCKED");
    expect(refusalReason({ error: { status: "PERMISSION_DENIED", details: [{ reason: "ACCESS_DENIED" }, { reason: "ACCESS_DENIED" }] } })).toBe("PERMISSION_DENIED/ACCESS_DENIED");
    expect(refusalReason({ error: { type: "invalid_request_error", code: "invalid_api_key" } })).toBe("invalid_api_key/invalid_request_error");
    expect(refusalReason({ error: "unauthorized" })).toBe("unauthorized");
  });

  it("keeps no prose and nothing shaped like a key", () => {
    expect(refusalReason({ error: { message: "The key " + KEY + " is wrong", status: KEY, code: 403, details: [{ reason: KEY }] } })).toBeUndefined();
    expect(refusalReason({ error: "Invalid API key: " + KEY })).toBeUndefined();
    expect(refusalReason({ error: KEY, code: KEY, type: KEY })).toBeUndefined();
    for (const junk of [null, undefined, "", 7, [], "PERMISSION_DENIED", { error: null }, { error: { details: "x" } }, { error: { details: [null, 3, {}] } }]) expect(refusalReason(junk)).toBeUndefined();
  });
});

describe("a refused key is written to the server log, once, with the reason and never the key", () => {
  it("names the host that refused and the provider's reason", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const e = await caught(callJson(fetchOf(res(GOOGLE_IP)), `https://places.test/v1/places:searchText?key=${KEY}`, { headers: { "X-Goog-Api-Key": KEY } }, { timeoutMs: 1000, what: "The local business search" }));
    expect(e).toBeInstanceOf(DiscoveryError);
    expect(e.code).toBe("auth");
    expect(e.reason).toBe("PERMISSION_DENIED/API_KEY_IP_ADDRESS_BLOCKED");
    expect(e.message).toBe("The local business search didn't accept the configured key.");
    expect(logged()).toEqual([{ kind: "provider_key_refused", host: "places.test", status: 403, reason: "PERMISSION_DENIED/API_KEY_IP_ADDRESS_BLOCKED" }]);
    const everything = vi.mocked(console.log).mock.calls.flat().join(" ");
    expect(everything).not.toContain(KEY);
    expect(everything).not.toContain("203.0.113.9"); // the provider's prose stays out, whatever it says
  });

  it("still refuses cleanly when the provider explains nothing readable", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    for (const body of ["<html>Forbidden</html>", "", "{not json", JSON.stringify({ error: { message: "no codes here" } }), "x".repeat(30_000)]) {
      const e = await caught(callJson(fetchOf(res(body, 401)), "https://api.search.test/q", {}, { timeoutMs: 1000, what: "The search service" }));
      expect(e.code).toBe("auth");
      expect(e.reason).toBeUndefined();
    }
    expect(logged()).toHaveLength(5);
    expect(logged().every((l) => l.host === "api.search.test" && l.status === 401 && l.reason === null)).toBe(true);
  });

  it("a reply with no body to read, or an address that isn't one, still gives the plain refusal", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const bare = { status: 403, ok: false } as unknown as Response;
    const e = await keyRefused(bare, "not a url", "The search service");
    expect(e.code).toBe("auth");
    expect(e.reason).toBeUndefined();
    expect(logged()).toEqual([{ kind: "provider_key_refused", host: "", status: 403, reason: null }]);
  });

  it("other failures are not logged here: a busy provider and a broken one are not a refused key", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    for (const status of [429, 500, 402]) await caught(callJson(fetchOf(res({ error: { status: "RESOURCE_EXHAUSTED" } }, status)), "https://places.test/x", {}, { timeoutMs: 1000, what: "It" }));
    expect(logged()).toHaveLength(0);
  });
});

describe("every search provider reports a refused key the same way", () => {
  it("the map search, with the reason carried on the error", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const p = new GooglePlacesProvider(KEY, "https://places.test/v1/places:searchText", fetchOf(res(GOOGLE_IP)), async () => {});
    const e = await caught(p.searchText("dentists in Pune", { regionCode: "IN", pageSize: 5 }));
    expect([e.code, e.reason]).toEqual(["auth", "PERMISSION_DENIED/API_KEY_IP_ADDRESS_BLOCKED"]);
    expect(logged()).toHaveLength(1); // a refused key is not retried
  });

  it("the two web searches with their own request code", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const brave = new BraveProvider(KEY, "https://brave.test/res/v1/web/search", fetchOf(res({ error: { code: "SUBSCRIPTION_TOKEN_INVALID", status: 401 } }, 401)));
    const lang = new LangSearchProvider(KEY, "https://lang.test/v1/web-search", fetchOf(res({ error: "unauthorized" }, 403)));
    const a = await caught(brave.search("agencies in Pune", {})), b = await caught(lang.search("agencies in Pune", {}));
    expect([a.code, a.reason, a.message]).toEqual(["auth", "SUBSCRIPTION_TOKEN_INVALID", "The search service didn't accept the configured key."]);
    expect([b.code, b.reason, b.message]).toEqual(["auth", "unauthorized", "The search service didn't accept the configured key."]);
    expect(logged().map((l) => l.host)).toEqual(["brave.test", "lang.test"]);
    expect(vi.mocked(console.log).mock.calls.flat().join(" ")).not.toContain(KEY);
  });
});
