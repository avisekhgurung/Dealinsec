import { describe, expect, it } from "vitest";
import { DISCOVERY_PRESETS, filterByWebsite, isPlaceId, localQuery, localSearchSchema, mapsUrlFor, suggestDiscoveryMode } from "./local-discovery";

describe("local or web", () => {
  it("suggests local for a kind of business found on a map in a named place, web otherwise", () => {
    expect(suggestDiscoveryMode({ industry: "dentists", locations: ["Siliguri"] })).toBe("local");
    expect(suggestDiscoveryMode({ industry: "Coaching institutes", locations: ["Kota"] })).toBe("local");
    expect(suggestDiscoveryMode({ industry: "dentists", locations: [] })).toBe("web"); // no place named
    expect(suggestDiscoveryMode({ industry: "B2B SaaS companies", locations: ["London"] })).toBe("web");
    expect(suggestDiscoveryMode({ industry: null, locations: null })).toBe("web");
  });
});

describe("the local search request", () => {
  it("defaults, trims and bounds what the person types", () => {
    expect(localSearchSchema.parse({ category: " dentists ", city: "Siliguri" })).toEqual({ category: "dentists", city: "Siliguri", country: "IN", website: "any", max: 10 });
    expect(localSearchSchema.parse({ category: "cafes", city: "Austin", country: "us", max: "5" })).toMatchObject({ country: "US", max: 5 });
    for (const bad of [{ category: "d", city: "Siliguri" }, { category: "dentists", city: "" }, { category: "dentists", city: "X1", country: "IND" }, { category: "dentists", city: "Siliguri", max: 50 }, { category: "dentists", city: "Siliguri", website: "maybe" }])
      expect(localSearchSchema.safeParse(bad).success).toBe(false);
    expect(localQuery({ category: "dentists", city: "Siliguri" })).toBe("dentists in Siliguri");
  });

  it("builds a Maps link from a place ID alone, and accepts only place-ID-shaped strings", () => {
    expect(mapsUrlFor("ChIJ_abc-123XYZ")).toBe("https://www.google.com/maps/place/?q=place_id:ChIJ_abc-123XYZ");
    expect(isPlaceId("ChIJ_abc-123XYZ")).toBe(true);
    for (const bad of ["short", "has space here", "../../etc/passwd", "a".repeat(301), 42]) expect(isPlaceId(bad)).toBe(false);
  });

  it("filters by whether the listing gives a website", () => {
    const rs = [{ website: "https://a.in" }, { website: null }];
    expect(filterByWebsite(rs, "any")).toHaveLength(2);
    expect(filterByWebsite(rs, "with")).toEqual([{ website: "https://a.in" }]);
    expect(filterByWebsite(rs, "without")).toEqual([{ website: null }]);
  });

  it("presets: each is one mode, local ones never fill in a city, and none promises an outcome", () => {
    expect(new Set(DISCOVERY_PRESETS.map((p) => p.key)).size).toBe(DISCOVERY_PRESETS.length);
    for (const p of DISCOVERY_PRESETS) {
      if (p.mode === "local") { expect(p.local).toBeDefined(); expect(p.local).not.toHaveProperty("city"); } else expect(p.request).toBeTruthy();
      expect(`${p.label} ${p.note}`.replace(/not proof they need a new site/g, "")).not.toMatch(/guarantee|needs? a new (web)?site|will reply/i);
    }
  });
});
