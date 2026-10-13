import { describe, expect, it } from "vitest";
import { employmentOf, QUOTED_BLOCK, roleAffiliation, STAFF_BLOCK } from "./staff";

// The pattern of one live team page (names here are invented): a leadership grid, a quote from the agency's own
// co-founder, and client testimonials whose cards read "Name / Role / at / Client". The model called the clients staff.
const T = { site: "brighttiger.com", companyName: "BrightTiger" };
const TEAM = {
  url: "https://www.brighttiger.com/team",
  text: [
    "Meet the BrightTiger Leadership. The best marketing team in SaaS.",
    "",
    STAFF_BLOCK, "Mara Quill, CEO", "Owen Vance, CSO", "Lena Brook, Chief of Staff", "Tom Reyes, SEO Manager",
    "",
    QUOTED_BLOCK, "Owen Vance, BrightTiger Co-founder", "Priya Holt, CEO at StandupHive", "Gil Navarro, Cofounder at VolunteerNest",
    "Rosa Kemp, VP of Ops at Outpost.ai", "Ivan Petrov, Head of Marketing at Harbor Logistics", "Hugo Lane, Founder",
  ].join("\n"),
};
const job = (name: string, title: string, pages = [TEAM], t = T) => employmentOf({ name, title }, pages, t);

describe("employment: does this person work at THIS company?", () => {
  it("keeps the real leaders: listed on the team page, or named with the company itself", () => {
    expect(job("Mara Quill", "CEO")).toEqual({ verdict: "staff", why: "team_listing" });
    expect(job("Lena Brook", "Chief of Staff")).toEqual({ verdict: "staff", why: "team_listing" });
    expect(job("Owen Vance", "CSO")).toEqual({ verdict: "staff", why: "explicit" }); // also quoted, as "BrightTiger Co-founder"
    expect(job("Owen Vance", "Co-founder")).toEqual({ verdict: "staff", why: "explicit" });
  });
  it("refuses client testimonial authors, whatever their title and whatever employer the model claimed", () => {
    expect(job("Priya Holt", "CEO")).toEqual({ verdict: "not_staff", why: "works_elsewhere" });
    expect(job("Gil Navarro", "Cofounder")).toEqual({ verdict: "not_staff", why: "works_elsewhere" });
    expect(job("Rosa Kemp", "VP of Ops")).toEqual({ verdict: "not_staff", why: "works_elsewhere" });
    expect(job("Ivan Petrov", "Head of Marketing")).toEqual({ verdict: "not_staff", why: "works_elsewhere" }); // a client whose name looks like a person's
    expect(job("Hugo Lane", "Founder")).toEqual({ verdict: "not_staff", why: "quoted_only" }); // quoted, no employer: still not staff
    expect(job("Priya Holt", "CEO at StandupHive")).toEqual({ verdict: "not_staff", why: "works_elsewhere" }); // the title itself says so
  });
  it("a senior title or a name somewhere on the site is not evidence: unknown, and unknown is not kept", () => {
    const home = { url: "https://brighttiger.com/", text: "Strategy sessions with Nora Fell, Founder, every quarter. We grow SaaS brands." };
    expect(job("Nora Fell", "Founder", [home])).toEqual({ verdict: "unknown", why: "no_evidence" });
    expect(job("Zed Moss", "CEO", [home])).toEqual({ verdict: "unknown", why: "no_evidence" }); // not on any page at all
  });
  it("an ambiguous affiliation is not resolved by guessing", () => {
    const quote = { url: "https://brighttiger.com/", text: '"They doubled our pipeline in a quarter." - Dana Ortiz, CEO' };
    expect(job("Dana Ortiz", "CEO", [quote])).toEqual({ verdict: "not_staff", why: "quoted_only" });
    const trailing = { url: "https://brighttiger.com/about", text: "Our people. Tess Harlow, Head of Marketing, Brightline" };
    expect(job("Tess Harlow", "Head of Marketing", [trailing])).toEqual({ verdict: "not_staff", why: "works_elsewhere" });
    // listed on the team page AND credited to another company elsewhere: conflicting, so not kept
    const listed = { url: "https://brighttiger.com/team", text: `${STAFF_BLOCK}\nDana Ortiz, Founder` };
    const press = { url: "https://brighttiger.com/news", text: "Panel: Dana Ortiz, CEO at Brightline, on SaaS growth." };
    expect(job("Dana Ortiz", "Founder", [listed, press]).verdict).toBe("not_staff");
    // the same name with another surname is a different person
    expect(job("Rhys Morgan", "CEO", [{ url: "https://brighttiger.com/team", text: `${STAFF_BLOCK}\nRhys Morganson, CEO` }])).toEqual({ verdict: "unknown", why: "no_evidence" });
  });
  it("a previous role elsewhere does not count against a current role here; a past role here is not a current one", () => {
    const about = { url: "https://brighttiger.com/about", text: "Meet the team. Dana Ortiz, Founder. Previously Head of SEO at Brightline for six years." };
    expect(job("Dana Ortiz", "Founder", [about])).toEqual({ verdict: "staff", why: "team_listing" });
    const block = { url: "https://brighttiger.com/team", text: `${STAFF_BLOCK}\nLee Park, Head of Growth, formerly VP of Growth at Brightline` };
    expect(job("Lee Park", "Head of Growth", [block])).toEqual({ verdict: "staff", why: "team_listing" });
    expect(job("Lee Park", "Former CEO", [block])).toEqual({ verdict: "not_staff", why: "former_role" });
    const alumni = { url: "https://brighttiger.com/team", text: `${STAFF_BLOCK}\nRuth Cole, Former Managing Director` };
    expect(job("Ruth Cole", "Managing Director", [alumni])).toEqual({ verdict: "not_staff", why: "former_role" });
  });
  it("explicit current employment in the company's own words", () => {
    const home = { url: "https://brighttiger.com/", text: "Our founder, Dana Ortiz, started BrightTiger in 2015. BrightTiger was founded in 2015 by Lee Park and two friends." };
    expect(job("Dana Ortiz", "Founder", [home])).toEqual({ verdict: "staff", why: "explicit" });
    expect(job("Lee Park", "Co-founder", [home])).toEqual({ verdict: "staff", why: "explicit" });
    expect(job("Kim Ade", "CEO", [{ url: "https://brighttiger.com/", text: "Kim Ade, CEO of BrightTiger, spoke at GrowthCon." }])).toEqual({ verdict: "staff", why: "explicit" });
    expect(job("Kim Ade", "Founder", [{ url: "https://brighttiger.com/team", text: "Meet the team. Kim Ade, Founder, speaks at conferences." }])).toEqual({ verdict: "staff", why: "team_listing" }); // "at" a non-name is no employer
  });
  it("roleAffiliation reads the employer out of the role", () => {
    expect(roleAffiliation("CEO at StandupHive", T)).toMatchObject({ here: false, elsewhere: "StandupHive" });
    expect(roleAffiliation("Head of Growth, BrightTiger", T)).toMatchObject({ here: true, elsewhere: null });
    expect(roleAffiliation("BrightTiger Co-founder", T)).toMatchObject({ here: true, elsewhere: null });
    expect(roleAffiliation("Founder, CEO", T)).toMatchObject({ here: false, elsewhere: null }); // two roles, no company
    expect(roleAffiliation("VP of Customer Acquisition", T)).toMatchObject({ here: false, elsewhere: null }); // "of" a department
    expect(roleAffiliation("Founder & CEO @ Lumen Labs", T)).toMatchObject({ elsewhere: "Lumen Labs" });
    expect(roleAffiliation("Former CEO", T)).toMatchObject({ former: true });
  });
});
