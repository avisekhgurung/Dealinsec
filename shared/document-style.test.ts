import { describe, expect, it } from "vitest";
import { ACCENTS, DEFAULT_DOCUMENT_STYLE, MAX_FOOTER_NOTE, cleanFooterNote, documentStyleInput, normalizeStyle, styleVars } from "./document-style";

describe("styles", () => {
  it("any stored value becomes a valid style; unknown keys fall back to the defaults", () => {
    expect(normalizeStyle(null)).toEqual(DEFAULT_DOCUMENT_STYLE);
    expect(normalizeStyle({ accent: "blue", font: "serif", footerNote: "  Thank you  " })).toEqual({ accent: "blue", font: "serif", footerNote: "Thank you" });
    expect(normalizeStyle({ accent: "javascript:alert(1)", font: "comic" })).toEqual(DEFAULT_DOCUMENT_STYLE);
    for (const k of ["__proto__", "constructor", "toString", "hasOwnProperty"]) expect(normalizeStyle({ accent: k, font: 5 }), k).toEqual(DEFAULT_DOCUMENT_STYLE);
  });
  it("only a KEY into the tables ever becomes a CSS value: nothing typed reaches CSS", () => {
    const v = styleVars(normalizeStyle({ accent: "red; background:url(x)", font: "serif" }));
    expect(v["--doc-brand"]).toBe(ACCENTS.emerald.brand);
    expect(v["--doc-font"]).toContain("Georgia");
    for (const val of Object.values(v)) expect(val).not.toMatch(/url\(|;/);
  });
  it("every accent is dark enough to carry white text (WCAG AA, 4.5:1)", () => {
    const lum = (hex: string) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    for (const [k, a] of Object.entries(ACCENTS)) {
      expect((1.05) / (lum(a.brand) + 0.05), k).toBeGreaterThanOrEqual(4.5);
      // The far end of the header band carries only large white text: the standard for large text is 3:1.
      expect((1.05) / (lum(a.end) + 0.05), `${k} band end`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("the footer note", () => {
  it("is one plain line, capped, with markup and control characters removed", () => {
    expect(cleanFooterNote("Pay within 7 days\n<script>alert(1)</script> thanks")).toBe("Pay within 7 days script alert(1) /script thanks");
    expect(cleanFooterNote("x".repeat(500))!.length).toBe(MAX_FOOTER_NOTE);
    expect(cleanFooterNote("   ")).toBeNull();
    expect(cleanFooterNote(null)).toBeNull();
  });
});

describe("the input schema", () => {
  it("accepts only known accents and fonts, and a null footer to remove it", () => {
    expect(documentStyleInput.safeParse({ accent: "teal", font: "serif", footerNote: null }).success).toBe(true);
    expect(documentStyleInput.safeParse({ accent: "hotpink" }).success).toBe(false);
    expect(documentStyleInput.safeParse({ font: "comic-sans" }).success).toBe(false);
  });
});
