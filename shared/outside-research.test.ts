import { describe, expect, it } from "vitest";
import { mentionPatterns, outsideFindings, outsideQuery, outsideType } from "./outside-research";

const NOW = new Date("2026-11-10T12:00:00Z");
const hit = (url: string, title: string, snippet = "") => ({ url, title, snippet });
const find = (results: ReturnType<typeof hit>[], name = "Acme Robotics", domain = "acmerobotics.com") => outsideFindings(results, { name, domain, now: NOW });

describe("what kind of event a headline describes", () => {
  it("recognises the events worth following up", () => {
    expect(outsideType("Acme Robotics raises $12 million Series A")).toBe("FUNDING");
    expect(outsideType("Acme Robotics appoints Jane Doe as CTO")).toBe("LEADERSHIP");
    expect(outsideType("Acme Robotics acquires Widget Co")).toBe("EXPANSION");
    expect(outsideType("Acme opens a new office in Pune")).toBe("EXPANSION");
    expect(outsideType("Acme Robotics partners with Globex")).toBe("PARTNERSHIP");
    expect(outsideType("Acme Robotics is hiring 40 engineers")).toBe("HIRING");
    expect(outsideType("Acme Robotics launches a warehouse robot")).toBe("LAUNCH");
  });
  it("the more specific event wins: money raised to launch something is funding", () => {
    expect(outsideType("Acme raises $5M seed round to launch its new platform")).toBe("FUNDING");
  });
  it("a page that is merely about the company is not an event", () => {
    for (const t of ["Acme Robotics | LinkedIn", "Acme Robotics reviews and ratings", "Top 10 robotics companies in India", "Acme Robotics — Crunchbase Company Profile"]) expect(outsideType(t)).toBeNull();
  });
});

describe("is this result about THIS company?", () => {
  const named = (text: string, name: string, domain: string) => mentionPatterns(name, domain).some((re) => re.test(text));
  it("the name, without its legal tail, as whole words", () => {
    expect(named("Acme Robotics raises funding", "Acme Robotics Pvt Ltd", "acmerobotics.com")).toBe(true);
    expect(named("ACME  ROBOTICS raises funding", "Acme Robotics", "acmerobotics.com")).toBe(true);
    expect(named("PacMe Robotics raises funding", "Acme Robotics", "acmerobotics.com")).toBe(false);
    expect(named("Acme Roboticsville opens", "Acme Robotics", "acmerobotics.com")).toBe(false);
  });
  it("or its domain", () => {
    expect(named("acmerobotics.com announces a round", "acmerobotics.com", "acmerobotics.com")).toBe(true);
    expect(named("notacmerobotics.com announces a round", "acmerobotics.com", "acmerobotics.com")).toBe(false);
  });
  // A short name is an ordinary word; matching on it would attach other companies' news to this one.
  it("a name too short to be told from a word is matched by the domain only", () => {
    expect(mentionPatterns("Go", "go.dev")).toHaveLength(1);
    expect(named("Go raises $10M", "Go", "go.dev")).toBe(false);
    expect(named("go.dev raises $10M", "Go", "go.dev")).toBe(true);
  });
});

describe("search results as outside findings", () => {
  it("keeps a result that names the company and describes an event, with the page and the words it rests on", () => {
    const [f] = find([hit("https://technews.example/acme-raises", "Acme Robotics raises $12 million Series A", "Published 3 November 2026 — The Pune-based startup said the round was led by…")]);
    expect(f).toMatchObject({ type: "FUNDING", label: "Funding", value: "Acme Robotics raises $12 million Series A", url: "https://technews.example/acme-raises", publisher: "technews.example", datePrecision: "day" });
    expect(f.observedAt?.toISOString().slice(0, 10)).toBe("2026-11-03");
    expect(f.quote).toContain("round was led by");
  });
  it("a date is only ever one the result states — never the day of the search", () => {
    expect(find([hit("https://a.example/1", "Acme Robotics launches a new robot", "The company said the product is available now.")])[0]).toMatchObject({ observedAt: null, datePrecision: null });
  });
  // The classic failure of this kind of research: someone else's news.
  it("drops a result that doesn't name the company, however related the search engine thought it", () => {
    expect(find([
      hit("https://a.example/1", "Robotics startup raises $12 million Series A", "A Pune robotics company closed its round."),
      hit("https://a.example/2", "Acme Corp partners with Globex", "Acme Corp, the anvil maker, …"),
    ])).toEqual([]);
  });
  it("drops the company's own pages, pages that aren't events, and anything that isn't a web address", () => {
    expect(find([
      hit("https://acmerobotics.com/news/series-a", "Acme Robotics raises $12 million Series A"),
      hit("https://blog.acmerobotics.com/launch", "Acme Robotics launches a robot"),
      hit("https://www.linkedin.com/company/acme-robotics", "Acme Robotics | LinkedIn", "Acme Robotics builds robots."),
      hit("javascript:alert(1)", "Acme Robotics launches a robot"),
      hit("https://a.example/empty", "", "Acme Robotics launches a robot"),
    ])).toEqual([]);
  });
  it("one per page, six at most, in the order the search returned them", () => {
    const many = Array.from({ length: 10 }, (_, i) => hit(`https://n${i}.example/x`, `Acme Robotics launches product ${i}`));
    const got = find([many[0], hit("https://n0.example/x/", "Acme Robotics launches product 0 (again)"), ...many.slice(1)]);
    expect(got).toHaveLength(6);
    expect(got.map((f) => f.publisher)).toEqual(["n0.example", "n1.example", "n2.example", "n3.example", "n4.example", "n5.example"]);
  });
  it("a company known only by a domain nobody could tell from a word finds nothing rather than guess", () => {
    expect(outsideFindings([hit("https://a.example/1", "Launches new product")], { name: "", domain: "localhost", now: NOW })).toEqual([]);
  });
});

describe("the search", () => {
  it("asks for the company by its name in quotes, or by its domain when that is all we have", () => {
    expect(outsideQuery("Acme Robotics Pvt Ltd", "acmerobotics.com")).toBe('"Acme Robotics" funding OR hiring OR launches OR partnership OR acquires OR appoints');
    expect(outsideQuery("acmerobotics.com", "acmerobotics.com")).toMatch(/^"acmerobotics\.com" /);
    expect(outsideQuery('Ac"me', "acme.io")).toMatch(/^"Acme" /);
  });
});
