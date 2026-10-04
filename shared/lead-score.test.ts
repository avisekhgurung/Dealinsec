import { describe, expect, it } from "vitest";
import { assessFit, type FitResult, type IdealClient } from "./fit";
import { COMPONENTS, FIELD_FAMILIES, TOTAL_MAX, latestPerField, normField, scoreLead, type ScoreClaim } from "./lead-score";

const fit = (verdict: FitResult["verdict"], headline = `fit: ${verdict}`): FitResult => ({ verdict, headline, signals: [], excludedBy: [], missing: [] });
let id = 0;
const claim = (field: string, status: string, value = `${field} value`, at = "2026-10-01T10:00:00Z"): ScoreClaim => ({ id: ++id, field, value, status, evidenceUrl: status === "confirmed" ? "https://x.test" : null, createdAt: at });
const comp = (s: ReturnType<typeof scoreLead>, k: string) => s.components.find((c) => c.key === k)!;

describe("the rubric", () => {
  it("adds up to 100 and has the six components of the brief", () => {
    expect(COMPONENTS.map((c) => [c.key, c.max])).toEqual([["fit", 20], ["need", 25], ["signal", 20], ["budget", 15], ["contact", 10], ["timing", 10]]);
    expect(COMPONENTS.reduce((n, c) => n + c.max, 0)).toBe(TOTAL_MAX);
  });
});

describe("unknown is never guessed", () => {
  it("a lead we know nothing about scores 0 of 100 with everything unknown, low confidence, and says what is missing", () => {
    const s = scoreLead(null, {}, []);
    expect(s.total).toBe(0); expect(s.knownMax).toBe(0); expect(s.unknownPoints).toBe(100); expect(s.confidence).toBe("low");
    expect(s.components.every((c) => c.points === null)).toBe(true);
    expect(s.missing.length).toBeGreaterThanOrEqual(5);
    expect(s.missing.join(" ")).toMatch(/ideal client/i);
  });
  it("an 'unknown' claim earns nothing and counts as not known, for every component", () => {
    const claims = Object.values(FIELD_FAMILIES).flat().map((f) => claim(f, "unknown"));
    const s = scoreLead(fit("unclear"), {}, claims);
    expect(s.total).toBe(0);
    for (const c of s.components) expect(c.points, c.key).toBeNull();
  });
  it("never scores above what could be measured, never above 100, and the parts add up (property check)", () => {
    const statuses = ["confirmed", "inferred", "unknown", "conflicting"];
    const fields = Object.values(FIELD_FAMILIES).flat();
    let seed = 7; const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    for (let i = 0; i < 300; i++) {
      const claims = Array.from({ length: rnd(8) }, () => claim(fields[rnd(fields.length)], statuses[rnd(4)]));
      const verdicts = ["strong", "partial", "weak", "excluded", "unclear", "no_profile"] as const;
      const s = scoreLead(rnd(5) ? fit(verdicts[rnd(6)]) : null, { contactEmail: rnd(2) ? "a@b.co" : null, estValueMinor: rnd(2) ? 5000 : null, doNotContact: rnd(6) === 0 }, claims);
      expect(s.total).toBeLessThanOrEqual(s.knownMax);
      expect(s.total).toBeLessThanOrEqual(100);
      expect(s.knownMax + s.unknownPoints).toBe(100);
      expect(s.total).toBe(s.components.reduce((n, c) => n + (c.points ?? 0), 0));
      for (const c of s.components) { expect(c.points === null || (c.points >= 0 && c.points <= c.max), c.key).toBe(true); }
    }
  });
});

describe("company fit comes only from the rule-based verdict", () => {
  it.each([["strong", 20], ["partial", 12], ["weak", 4], ["excluded", 0], ["unclear", null], ["no_profile", null]] as const)("%s -> %s", (v, pts) => {
    expect(comp(scoreLead(fit(v), {}, []), "fit").points).toBe(pts);
  });
  it("uses the fit headline as the reason, and works with the real fit function", () => {
    const profile: IdealClient = { about: null, services: [], targetIndustries: ["hotels"], targetLocations: ["Portugal"], exclusions: [], minDealMinor: null, currency: null };
    const f = assessFit(profile, { companyName: "Casa Alma", industry: "Boutique hotels", location: "Lisbon, Portugal" });
    const c = comp(scoreLead(f, {}, []), "fit");
    expect(c.points).toBe(20); expect(c.reason).toBe(f.headline);
  });
});

describe("claims: confirmed full, inferred half, conflicting none, and only known fields count", () => {
  it.each(Object.entries(FIELD_FAMILIES).filter(([k]) => k !== "contact"))("%s", (key, fields) => {
    const max = COMPONENTS.find((c) => c.key === key)!.max;
    const f = fields[0];
    expect(comp(scoreLead(null, {}, [claim(f, "confirmed")]), key).points).toBe(max);
    expect(comp(scoreLead(null, {}, [claim(f, "inferred")]), key).points).toBe(Math.floor(max / 2));
    expect(comp(scoreLead(null, {}, [claim(f, "conflicting")]), key).points).toBe(0);
    expect(comp(scoreLead(null, {}, []), key).points).toBeNull();
  });
  it("names the claim it rests on, and says whether it was confirmed or only likely", () => {
    const c = claim("pain_point", "confirmed", "Outdated website");
    const s = comp(scoreLead(null, {}, [c]), "need");
    expect(s.evidenceClaimIds).toEqual([c.id]); expect(s.reason).toBe("Confirmed: Outdated website");
    expect(comp(scoreLead(null, {}, [claim("pain_point", "inferred", "Maybe slow site")]), "need").reason).toMatch(/Likely, not confirmed/);
  });
  it("a claim whose field is not one of the known ones moves nothing, however confident", () => {
    for (const f of ["note", "favourite_colour", "pain", "painpoint", "budget_big", ""]) {
      expect(scoreLead(null, {}, [claim(f, "confirmed")]).total, f).toBe(0);
    }
  });
  it("matches a field however it is spelled (case, spaces, hyphens)", () => {
    expect(normField(" Pain Point ")).toBe("pain_point"); expect(normField("buying-signal")).toBe("buying_signal");
    expect(comp(scoreLead(null, {}, [claim("Pain Point", "confirmed")]), "need").points).toBe(25);
  });
  it("within a family a confirmed field beats an inferred one, which beats a conflicting one", () => {
    expect(comp(scoreLead(null, {}, [claim("need", "conflicting"), claim("pain_point", "inferred"), claim("opportunity", "confirmed")]), "need").points).toBe(25);
    expect(comp(scoreLead(null, {}, [claim("need", "conflicting"), claim("pain_point", "inferred")]), "need").points).toBe(12);
  });
});

describe("a research re-run appends: the newest claim per field wins", () => {
  it("a newer 'unknown' replaces an older 'confirmed' (the earlier finding no longer holds)", () => {
    const s = scoreLead(null, {}, [claim("pain_point", "confirmed", "old", "2026-10-01T00:00:00Z"), claim("pain_point", "unknown", "", "2026-10-05T00:00:00Z")]);
    expect(comp(s, "need").points).toBeNull();
  });
  it("a newer confirmed replaces an older conflicting; ties go to the higher id", () => {
    expect(comp(scoreLead(null, {}, [claim("need", "conflicting", "a", "2026-10-01T00:00:00Z"), claim("need", "confirmed", "b", "2026-10-02T00:00:00Z")]), "need").points).toBe(25);
    const a = claim("need", "confirmed", "a", "2026-10-01T00:00:00Z"), b = claim("need", "unknown", "b", "2026-10-01T00:00:00Z");
    expect(latestPerField([a, b])[0].id).toBe(b.id);
    expect(latestPerField([b, a])[0].id).toBe(b.id);
  });
});

describe("edge cases that would quietly change a score", () => {
  it("an 'unknown' claim in a family does not hide a conflicting one: the disagreement stands (0, not unknown)", () => {
    const s = scoreLead(null, {}, [claim("need", "conflicting"), claim("pain_point", "unknown")]);
    expect(comp(s, "need").points).toBe(0);
    expect(comp(s, "need").reason).toMatch(/Sources disagree/);
  });
  it("the same field spelled two ways is ONE field: a newer entry replaces an older one", () => {
    const s = scoreLead(null, {}, [claim("Pain Point", "confirmed", "old", "2026-10-01T00:00:00Z"), claim("pain_point", "unknown", "", "2026-10-05T00:00:00Z")]);
    expect(comp(s, "need").points).toBeNull();
    expect(latestPerField([claim("Pain Point", "confirmed"), claim("pain_point", "inferred")])).toHaveLength(1);
  });
});

describe("budget", () => {
  it("your own estimate of the deal value counts as likely (half) and says so; a confirmed budget claim outranks it", () => {
    const own = comp(scoreLead(null, { estValueMinor: 500000 }, []), "budget");
    expect(own.points).toBe(7); expect(own.reason).toMatch(/Your own estimate/);
    expect(comp(scoreLead(null, { estValueMinor: 500000 }, [claim("budget", "confirmed")]), "budget").points).toBe(15);
    expect(comp(scoreLead(null, { estValueMinor: 0 }, []), "budget").points).toBeNull();
    expect(comp(scoreLead(null, { estValueMinor: null }, []), "budget").points).toBeNull();
  });
  it("a conflicting budget claim is 0, and your estimate does not paper over it", () => {
    expect(comp(scoreLead(null, { estValueMinor: 500000 }, [claim("budget", "conflicting")]), "budget").points).toBe(0);
  });
});

describe("contactability", () => {
  it("email 6, phone 2, a named person 2, up to 10", () => {
    expect(comp(scoreLead(null, { contactEmail: "a@b.co" }, []), "contact").points).toBe(6);
    expect(comp(scoreLead(null, { contactEmail: "a@b.co", contactName: "Ana" }, [claim("business_phone", "confirmed")]), "contact").points).toBe(10);
    expect(comp(scoreLead(null, {}, [claim("business_email", "confirmed")]), "contact").points).toBe(6);
    expect(comp(scoreLead(null, {}, [claim("contact_form", "confirmed")]), "contact").points).toBe(4);
  });
  it("an email on the lead and a confirmed one are not counted twice", () => {
    expect(comp(scoreLead(null, { contactEmail: "a@b.co" }, [claim("business_email", "confirmed")]), "contact").points).toBe(6);
  });
  it("only CONFIRMED contact claims count (an inferred phone is a guess)", () => {
    expect(comp(scoreLead(null, {}, [claim("business_email", "inferred"), claim("business_phone", "inferred")]), "contact").points).toBeNull();
  });
  it("do-not-contact makes it 0 whatever else is known, and says why", () => {
    const c = comp(scoreLead(null, { doNotContact: true, contactEmail: "a@b.co", contactName: "Ana" }, [claim("business_phone", "confirmed")]), "contact");
    expect(c.points).toBe(0); expect(c.reason).toBe("Marked do not contact");
  });
  it("nothing known: unknown, and the missing list asks for an email or a form", () => {
    const s = scoreLead(null, {}, []);
    expect(comp(s, "contact").points).toBeNull();
    expect(s.missing).toContain("A business email address or contact form");
  });
});

describe("confidence and the score together", () => {
  it("a lead measured on most of the rubric is high confidence; on half, medium; on little, low", () => {
    const rich = scoreLead(fit("strong"), { contactEmail: "a@b.co", estValueMinor: 100 }, [claim("pain_point", "confirmed"), claim("buying_signal", "confirmed"), claim("timing", "inferred")]);
    expect(rich.knownMax).toBe(100); expect(rich.confidence).toBe("high");
    const some = scoreLead(fit("strong"), { contactEmail: "a@b.co" }, [claim("pain_point", "confirmed")]);
    expect(some.knownMax).toBe(55); expect(some.confidence).toBe("medium");
    expect(scoreLead(fit("strong"), {}, []).confidence).toBe("low");
  });
  it("a strong fit with nothing else known is 20 of 20 measured, not a verdict on the rest", () => {
    const s = scoreLead(fit("strong"), {}, []);
    expect(s.total).toBe(20); expect(s.knownMax).toBe(20); expect(s.unknownPoints).toBe(80);
  });
});
