import { describe, expect, it } from "vitest";
import { LIMITS, chunkText, cleanText, imageCaptionSchema, noteInputSchema, queryTerms, sniffFileKind, titleFromUrl } from "./knowledge";

describe("cleanText", () => {
  it("normalises line endings, strips control characters and collapses space", () => {
    expect(cleanText("a\r\nb\u0000c\t\td   e\n\n\n\nf")).toBe("a\nb c d e\n\nf");
  });
});

describe("chunkText", () => {
  it("returns nothing for empty input and one passage for short input", () => {
    expect(chunkText("   \n ")).toEqual([]);
    expect(chunkText("Short note.")).toEqual(["Short note."]);
  });
  it("cuts long text into bounded passages and loses nothing", () => {
    const para = (n: number) => `Paragraph ${n}. ` + "We design logos and brand systems for small studios. ".repeat(6);
    const text = Array.from({ length: 30 }, (_, i) => para(i)).join("\n\n");
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) { expect(c.length).toBeLessThanOrEqual(LIMITS.chunkChars); expect(c.trim()).toBe(c); expect(c).not.toBe(""); }
    for (let i = 0; i < 30; i++) expect(chunks.some((c) => c.includes(`Paragraph ${i}.`)), `paragraph ${i}`).toBe(true);
  });
  it("terminates on text with no spaces at all, and moves forward every time", () => {
    const chunks = chunkText("x".repeat(5000));
    expect(chunks.length).toBeGreaterThan(4);
    expect(chunks.join("").length).toBeGreaterThanOrEqual(5000);
  });
  it("overlaps neighbouring passages so a split fact is still found", () => {
    const text = "alpha ".repeat(400);
    const [a, b] = chunkText(text, 500, 100);
    expect(a.slice(-40)).toBeTruthy();
    expect(b.startsWith("alpha")).toBe(true);
  });
  it("is deterministic", () => {
    const t = "Sentence one. Sentence two! Sentence three? ".repeat(80);
    expect(chunkText(t)).toEqual(chunkText(t));
  });
});

describe("queryTerms", () => {
  it("keeps the words that matter, once each, lowercase", () => {
    expect(queryTerms("Find me the Design agencies in Berlin that hire designers, design!")).toEqual(["design", "agencies", "berlin", "hire", "designers"]);
  });
  it("is capped, and safe against punctuation that would break a search expression", () => {
    const terms = queryTerms("a&b | (c) !d :e 'quote' " + Array.from({ length: 40 }, (_, i) => `word${i}`).join(" "));
    expect(terms.length).toBe(12);
    for (const t of terms) expect(t).toMatch(/^[a-z0-9À-￿]+$/);
    expect(queryTerms("the of to a")).toEqual([]);
  });
});

describe("sniffFileKind", () => {
  const b = (...n: number[]) => new Uint8Array(n);
  it("reads the real type from the bytes", () => {
    expect(sniffFileKind(new TextEncoder().encode("%PDF-1.7\n"))).toBe("pdf");
    expect(sniffFileKind(b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe("png");
    expect(sniffFileKind(b(0xff, 0xd8, 0xff, 0xe0))).toBe("jpeg");
    expect(sniffFileKind(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("webp");
  });
  it("refuses everything else, including a script wearing a .pdf name, and short or empty input", () => {
    for (const s of ["<script>alert(1)</script>", "MZ\x90\x00", "GIF89a", "PK\x03\x04", ""]) expect(sniffFileKind(new TextEncoder().encode(s)), s).toBeNull();
    expect(sniffFileKind(new Uint8Array(0))).toBeNull();
    expect(sniffFileKind(new TextEncoder().encode("RIFF\0\0\0\0WAVEfmt "))).toBeNull();
  });
});

describe("inputs", () => {
  it("a note needs a title and a sentence, and is cleaned", () => {
    expect(noteInputSchema.safeParse({ title: "x", text: "short" }).success).toBe(false);
    expect(noteInputSchema.safeParse({ title: " ", text: "A long enough note about us." }).success).toBe(false);
    expect(noteInputSchema.parse({ title: "Who we help", text: "We help studios.\r\n\r\n\r\n\r\nFast." }).text).toBe("We help studios.\n\nFast.");
    expect(noteInputSchema.safeParse({ title: "t", text: "x".repeat(LIMITS.noteChars + 1) }).success).toBe(false);
  });
  it("a picture must be described, or it can never be found", () => {
    expect(imageCaptionSchema.safeParse({ title: "Logo", description: "logo" }).success).toBe(false);
    expect(imageCaptionSchema.safeParse({ title: "Logo", description: "Our logo: a green leaf above the word Una." }).success).toBe(true);
  });
  it("rejects fields it does not know", () => {
    expect(noteInputSchema.safeParse({ title: "t", text: "A long enough note.", organizationId: "other" }).success).toBe(false);
  });
  it("titles a link from its host and last path piece", () => {
    expect(titleFromUrl(new URL("https://www.acme.com/about-us/our-story.html"))).toBe("acme.com: our story");
    expect(titleFromUrl(new URL("https://acme.com/"))).toBe("acme.com");
  });
});
