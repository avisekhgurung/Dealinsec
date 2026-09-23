import { describe, expect, it } from "vitest";
import { guessCountry, regionForCountry, sameRegion } from "./region";

describe("guessCountry — the onboarding picker's pre-fill, never a silent lock", () => {
  it("trusts a real timezone signal, e.g. an Indian clock", () => {
    expect(guessCountry({ timeZone: "Asia/Kolkata", languages: ["en-US"] })).toBe("IN");
  });

  it("trusts an informative language tag when the zone gives nothing", () => {
    expect(guessCountry({ timeZone: "UTC", languages: ["de-DE"] })).toBe("DE");
  });

  it("does not treat en-US as evidence of the US (India's own laptop default)", () => {
    // A real Indian clock still wins even with an en-US language tag.
    expect(guessCountry({ timeZone: "Asia/Kolkata", languages: ["en-US"] })).toBe("IN");
  });

  it("never falls back to India when there is no real signal — the privacy-browser case", () => {
    // UTC + en-US is exactly what Tor/Brave/Firefox resistFingerprinting
    // report, for a visitor of any real country. This used to resolve to
    // "IN" and silently pre-fill the picker with India / INR.
    const guess = guessCountry({ timeZone: "UTC", languages: ["en-US"] });
    expect(guess).not.toBe("IN");
  });

  it("with truly nothing to go on, still resolves to something other than India", () => {
    expect(guessCountry({ timeZone: null, languages: [] })).not.toBe("IN");
  });
});

describe("region lock semantics — explicit confirmation is preserved", () => {
  it("regionForCountry resolves a full, self-consistent settings object for an explicit pick", () => {
    const de = regionForCountry("DE");
    expect(de.country).toBe("DE");
    expect(de.currency).toBe("EUR");

    const inRegion = regionForCountry("IN");
    expect(inRegion.country).toBe("IN");
    expect(inRegion.currency).toBe("INR");
  });

  it("sameRegion correctly distinguishes an explicit India pick from the neutral fallback", () => {
    const guessed = regionForCountry(guessCountry({ timeZone: "UTC", languages: ["en-US"] }));
    const india = regionForCountry("IN");
    expect(sameRegion(guessed, india)).toBe(false);
  });
});
