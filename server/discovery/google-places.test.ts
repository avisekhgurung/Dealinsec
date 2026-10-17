/** The Places Text Search client, with fetch mocked: what it asks for, what it keeps from an answer, and when it retries. */
import { describe, expect, it } from "vitest";
import { DiscoveryError } from "./types";
import { GooglePlacesProvider, PLACES_FIELD_MASK, localBusinessProvider } from "./google-places";

const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
function client(answers: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const sleeps: number[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const a = answers.shift();
    if (!a) throw new Error("no more answers");
    if (a instanceof Error) throw a;
    return a;
  }) as unknown as typeof fetch;
  return { p: new GooglePlacesProvider("test-key", "https://places.test/v1/places:searchText", fetchImpl, async (ms) => { sleeps.push(ms); }), calls, sleeps };
}
const PLACE = { id: "ChIJabcdefghij", displayName: { text: "Smile Dental" }, formattedAddress: "12 Road, Siliguri", primaryTypeDisplayName: { text: "Dentist" }, googleMapsUri: "https://maps.google.com/?cid=1", businessStatus: "OPERATIONAL", websiteUri: "https://www.smiledental.in/home", nationalPhoneNumber: "0353 255 0101" };

describe("Google Places Text Search", () => {
  it("asks only for the fields the result list shows (no reviews, photos or ratings), with the key in a header", async () => {
    const { p, calls } = client([ok({ places: [PLACE] })]);
    await p.searchText("dentists in Siliguri", { regionCode: "IN", pageSize: 50 });
    const h = calls[0].init.headers as Record<string, string>;
    expect(h["X-Goog-Api-Key"]).toBe("test-key");
    expect(h["X-Goog-FieldMask"]).toBe(PLACES_FIELD_MASK);
    expect(PLACES_FIELD_MASK).not.toMatch(/review|photo|rating/i);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ textQuery: "dentists in Siliguri", regionCode: "IN", pageSize: 20 });
    expect(calls[0].url).not.toContain("test-key");
  });

  it("reads a listing; drops one without a usable place ID or name, and a website that isn't http(s)", async () => {
    const { p } = client([ok({ places: [PLACE, { ...PLACE, id: "bad id!" }, { ...PLACE, id: "ChIJnoname0000", displayName: {} }, { ...PLACE, id: "ChIJjsweb00000", websiteUri: "javascript:alert(1)", googleMapsUri: undefined }] })]);
    const r = await p.searchText("q", { regionCode: "IN", pageSize: 10 });
    expect(r).toHaveLength(2);
    expect(r[0]).toEqual({ placeId: "ChIJabcdefghij", name: "Smile Dental", address: "12 Road, Siliguri", category: "Dentist", website: "https://www.smiledental.in/home", domain: "smiledental.in", phone: "0353 255 0101", mapsUrl: "https://maps.google.com/?cid=1", status: "OPERATIONAL" });
    expect(r[1]).toMatchObject({ placeId: "ChIJjsweb00000", website: null, domain: null, mapsUrl: "https://www.google.com/maps/place/?q=place_id:ChIJjsweb00000" });
  });

  it("no listings is an empty answer", async () => {
    const { p } = client([ok({})]);
    expect(await p.searchText("q", { regionCode: "IN", pageSize: 10 })).toEqual([]);
  });

  it("retries a temporary failure once, then gives up; a refused key is never retried", async () => {
    const twice = client([ok({}, 503), ok({ places: [PLACE] })]);
    expect(await twice.p.searchText("q", { regionCode: "IN", pageSize: 10 })).toHaveLength(1);
    expect(twice.sleeps).toEqual([800]);
    const down = client([ok({}, 429), ok({}, 503)]);
    await expect(down.p.searchText("q", { regionCode: "IN", pageSize: 10 })).rejects.toMatchObject({ code: "unavailable" });
    expect(down.calls).toHaveLength(2);
    const auth = client([ok({}, 403)]);
    await expect(auth.p.searchText("q", { regionCode: "IN", pageSize: 10 })).rejects.toBeInstanceOf(DiscoveryError);
    expect(auth.calls).toHaveLength(1);
  });

  it("is available only with a key configured", () => {
    expect(localBusinessProvider({})).toBeNull();
    expect(localBusinessProvider({ GOOGLE_PLACES_API_KEY: "k" })?.name).toBe("google_places");
  });
});
