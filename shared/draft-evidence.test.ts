import { describe, expect, it } from "vitest";
import { basisOf, buildDraftEvidence, distinctLeads, type EvidenceClaim, type EvidenceFinding } from "./draft-evidence";

const NOW = new Date("2026-11-12T12:00:00Z");
const DAY = 86_400_000;
const ago = (d: number) => new Date(NOW.getTime() - d * DAY);
const OFFER = { about: "I build Next.js websites and AI integrations for SaaS teams", services: ["Website design", "AI integration"] };
let id = 1;
const claim = (field: string, value: string, status = "confirmed", over: Partial<EvidenceClaim> = {}): EvidenceClaim => ({ id: id++, field, value, status, evidenceUrl: "https://acme.test/about", source: "agent", createdAt: ago(1), ...over });
const finding = (kind: string, type: string, value: string, over: Partial<EvidenceFinding> = {}): EvidenceFinding => ({ id: id++, kind, type, value, status: kind === "signal" ? "confirmed" : "inferred", sourceUrl: "https://acme.test/news", sourceType: "website", observedAt: null, confidence: "medium", meta: {}, ...over });
const build = (claims: EvidenceClaim[], findings: EvidenceFinding[] | null = null, offer = OFFER) => buildDraftEvidence({ claims, findings, offer, now: NOW });

describe("what a draft is built on", () => {
  it("a dated business event leads; news older than a year is dropped; undated boilerplate is never news", () => {
    const e = build([claim("description", "Insurance software for underwriters")], [
      finding("signal", "BLOG_POST" as any, "Blog post", { observedAt: ago(10) }),
      finding("signal", "HIRING", "Opening for an AI product designer", { observedAt: ago(20), meta: { datePrecision: "day" } }),
      finding("signal", "EXPANSION", "Opened an office in Pune", { observedAt: ago(400), meta: { datePrecision: "day" } }),
      finding("signal", "TECH_CHANGE", "We always adopt the latest technology"),
      finding("signal", "HIRING", "Hiring a business analyst"),
    ]);
    expect(e.leads[0]).toMatchObject({ kind: "signal", label: "Hiring", dating: "strong", date: expect.stringMatching(/2026/), grade: "fact", sourceUrl: "https://acme.test/news" });
    const values = e.leads.map((x) => x.value).join(" | ");
    expect(values).not.toMatch(/Pune/);                // stale
    expect(values).not.toMatch(/latest technology/);   // undated standing copy
    expect(values).toMatch(/business analyst/);        // an undated event is kept, lower down
    expect(e.leads.find((x) => /business analyst/.test(x.value))!.dating).toBe("undated");
    expect(e.thin).toBe(false);
  });

  it("an opportunity that matches what the sender offers comes before one that doesn't; a sales tactic or a named person never reaches the writer", () => {
    const e = build([claim("description", "Insurance software")], [
      finding("opportunity", "opportunity", "Possible need for a faster marketing website"),
      finding("opportunity", "opportunity", "Offer AI integration for underwriting evidence"),
      finding("opportunity", "opportunity", "Engage Sam Gomez (Head of AI) with a technical conversation"),
      finding("opportunity", "opportunity", "Use their steady blog output as an opener"),
    ]);
    const opps = e.leads.filter((x) => x.kind === "opportunity");
    expect(opps.map((x) => x.value)).toEqual(["Possible need for AI integration for underwriting evidence", "Possible need for a faster marketing website"]);
    expect(opps[0].grade).toBe("guess");
    expect(opps[0].offerMatch).toBeGreaterThan(0);
  });

  it("a newer guess never hides a confirmed fact about who the company is, and the person's own entry wins", () => {
    const e = build([
      claim("location", "Kolkata", "confirmed", { createdAt: ago(5) }),
      claim("location", "Mumbai (provider guess)", "inferred", { createdAt: ago(1) }),
      claim("description", "Old description", "confirmed", { createdAt: ago(9) }),
      claim("description", "What they really do, as you wrote it", "confirmed", { createdAt: ago(9), source: "user" }),
    ]);
    expect(e.profile.find((x) => x.label === "Based in")!.value).toBe("Kolkata");
    expect(e.profile.find((x) => x.label === "What it does")!.value).toBe("What they really do, as you wrote it");
  });

  it("a claim copied from a dated finding isn't listed twice, and lends the dated item its claim id", () => {
    const f = finding("signal", "EXPANSION", "Opened a data and analytics practice", { observedAt: ago(8), meta: { datePrecision: "day" } });
    const c = claim("recent_news", "Expansion: Opened a data and analytics practice");
    const e = build([c], [f]);
    const hits = e.leads.filter((x) => /analytics practice/.test(x.value));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ key: `f:${f.id}`, claimId: c.id, dating: "strong" });
  });

  it("with only who the company is, the research is thin; one dated item or one offer-matched point is enough", () => {
    expect(build([claim("description", "A bakery"), claim("location", "Siliguri")]).thin).toBe(true);
    expect(build([claim("description", "A bakery")], [finding("signal", "NEW_LOCATION", "Second shop opened", { observedAt: ago(30), meta: { datePrecision: "day" } })]).thin).toBe(false);
    expect(build([claim("description", "A bakery"), claim("opportunity", "Possible need for website design", "inferred")]).thin).toBe(false);
  });

  it("three versions get three different topics: two items sharing two meaningful words are one topic", () => {
    const e = build([claim("description", "Software")], [
      finding("signal", "EXPANSION", "Expanding the data analytics practice", { observedAt: ago(5), meta: { datePrecision: "day" } }),
      finding("opportunity", "opportunity", "Possible need for data analytics specialists"),
      finding("signal", "HIRING", "Opening for an AI product designer", { observedAt: ago(20), meta: { datePrecision: "day" } }),
    ]);
    const picked = distinctLeads(e.leads, 3);
    // Both are strong news; the one that matches what the sender offers (AI) comes first. The analytics opportunity is
    // the same topic as the analytics news, so it isn't a third version.
    expect(picked.map((x) => x.value)).toEqual(["Opening for an AI product designer", "Expanding the data analytics practice"]);
  });

  it("the basis kept for 'Why Mika wrote this' names the point, its date and source, and nothing else", () => {
    const e = build([claim("description", "Insurance software")], [finding("signal", "HIRING", "Opening for an AI product designer", { observedAt: ago(20), meta: { datePrecision: "day" } })]);
    const b = basisOf(e.leads[0], e.profile, e.thin);
    expect(b).toEqual({
      lead: { key: e.leads[0].key, grade: "fact", kind: "signal", label: "Hiring", value: "Opening for an AI product designer", date: expect.any(String), dating: "strong", sourceUrl: "https://acme.test/news", confidence: "medium", offerMatch: expect.any(Number) },
      also: [{ label: "What it does", value: "Insurance software", sourceUrl: "https://acme.test/about" }],
      thin: false,
    });
    expect(basisOf(null, [], true)).toEqual({ lead: null, also: [], thin: true });
  });
});
