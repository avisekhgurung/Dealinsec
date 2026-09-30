import { describe, expect, it } from "vitest";
import { MAX_PARAM_STRING, sanitizeEventParams } from "./analyticsParams";

describe("sanitizeEventParams", () => {
  it("passes counts, flags and short labels through unchanged", () => {
    expect(sanitizeEventParams({ audience: "brand_collaboration", deal_type: "Brand Collaboration", flags: 3, ok: true, tool: "deal-risk-checker" })).toEqual({
      audience: "brand_collaboration",
      deal_type: "Brand Collaboration",
      flags: 3,
      ok: true,
      tool: "deal-risk-checker",
    });
  });

  it("drops any parameter named like free text, whatever its value", () => {
    const out = sanitizeEventParams({ text: "hi", message: "x", body: "y", terms: "z", email: "a@b.c", client: "Acme", brand_name: "Glow", usage_rights: "ads", audience: "client_work" });
    expect(out).toEqual({ audience: "client_work" });
  });

  it("matches those names case-insensitively", () => {
    expect(sanitizeEventParams({ Message: "x", TEXT: "y", Email: "z" })).toEqual({});
  });

  it("drops a string long enough to be pasted text, under any name", () => {
    const pasted = "Hey! We'd love 2 Instagram Reels and 3 stories for $800. We'd also like to use the content for ads.";
    expect(pasted.length).toBeGreaterThan(MAX_PARAM_STRING);
    expect(sanitizeEventParams({ label: pasted, audience: "brand_collaboration" })).toEqual({ audience: "brand_collaboration" });
    expect(sanitizeEventParams({ label: "x".repeat(MAX_PARAM_STRING) })).toEqual({ label: "x".repeat(MAX_PARAM_STRING) });
  });

  it("never sends objects, arrays, null, undefined or non-finite numbers", () => {
    expect(sanitizeEventParams({ a: { b: 1 }, c: [1, 2], d: null, e: undefined, f: NaN, g: Infinity, h: 0 })).toEqual({ h: 0 });
  });

  it("returns undefined when there is nothing to send", () => {
    expect(sanitizeEventParams(undefined)).toBeUndefined();
    expect(sanitizeEventParams(null)).toBeUndefined();
  });
});
