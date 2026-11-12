import { describe, expect, it } from "vitest";
import { socialLinksFrom, whatsappNumber } from "./social-links";

const L = (...hrefs: string[]) => hrefs.map((href) => ({ href }));

describe("the company's own profiles, from its website's links", () => {
  it("reads footer icons: Instagram, Facebook, LinkedIn company page, X and a WhatsApp chat link", () => {
    expect(socialLinksFrom(L(
      "/contact", "mailto:hi@casa.example",
      "https://www.instagram.com/casacandolim/", "https://www.facebook.com/CasaCandolimGoa",
      "https://www.linkedin.com/company/casa-candolim/", "https://twitter.com/casacandolim", "https://wa.me/919876543210?text=Hi",
    ))).toEqual({ instagram: "casacandolim", facebook: "CasaCandolimGoa", linkedin: "https://www.linkedin.com/company/casa-candolim/", x: "casacandolim", whatsapp: "+919876543210" });
  });
  it("skips share buttons, posts and search pages", () => {
    expect(socialLinksFrom(L(
      "https://www.facebook.com/sharer/sharer.php?u=https://casa.example", "https://twitter.com/intent/tweet?text=hi",
      "https://www.instagram.com/p/Cxyz123/", "https://www.linkedin.com/shareArticle?url=x",
    ))).toEqual({ linkedin: null, instagram: null, x: null, facebook: null, whatsapp: null });
  });
  it("prefers a LinkedIn company page to a person's profile, and keeps the first of each kind", () => {
    const s = socialLinksFrom(L("https://in.linkedin.com/in/ravi-menon", "https://www.linkedin.com/company/casa/", "https://instagram.com/first", "https://instagram.com/second"));
    expect(s.linkedin).toBe("https://www.linkedin.com/company/casa/");
    expect(s.instagram).toBe("first");
  });
  it("reads WhatsApp numbers from both link forms", () => {
    expect(whatsappNumber("https://api.whatsapp.com/send?phone=919876543210&text=hello")).toBe("+919876543210");
    expect(whatsappNumber("https://wa.me/")).toBeNull();
    expect(whatsappNumber("https://example.com/wa.me/91987")).toBeNull();
  });
});
