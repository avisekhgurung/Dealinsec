/**
 * A native <select> must never lose its dropdown arrow on a pointer screen.
 *
 * `appearance: none` was applied to every select at every width, under a comment saying it was an iOS fix, and
 * nothing in this project draws a replacement arrow. The result: a select rendered as a plain box, indistinguishable
 * from the text input beside it. On Client Radar that put a dropdown and a text field side by side looking
 * identical, and the country picker was reported as "an input that doesn't work" — it opened on click, it just no
 * longer looked like it could (13 Nov 2026).
 *
 * The reset is fine on touch, where the tap target and the iOS zoom guard matter. It must stay scoped there.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");

/** The at-rules open at a point in the stylesheet, outermost first. */
function atRulesAt(index: number): string[] {
  const stack: { text: string; isAt: boolean }[] = [];
  for (let i = 0; i < index; i++) {
    if (css[i] === "@") {
      const j = css.indexOf("{", i);
      if (j > 0) { stack.push({ text: css.slice(i, j).trim(), isAt: true }); i = j; continue; }
    }
    if (css[i] === "{") stack.push({ text: "", isAt: false });
    else if (css[i] === "}") stack.pop();
  }
  return stack.filter((s) => s.isAt).map((s) => s.text);
}

describe("native selects keep their dropdown arrow where there is a pointer", () => {
  it("every `appearance: none` on a select is scoped to touch widths", () => {
    const hits = [...css.matchAll(/appearance:\s*none/g)];
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      const open = atRulesAt(h.index!);
      expect(open.some((r) => /@media[^{]*max-width/.test(r)), `unscoped \`appearance: none\` at index ${h.index}; open at-rules: ${JSON.stringify(open)}`).toBe(true);
    }
  });

  it("a select is not forced to full width at every size either", () => {
    // It shares toolbar rows with other controls; 100% wide turns those rows into a stack.
    const shared = /input,\s*textarea,\s*select\s*\{[^}]*width:\s*100%/;
    expect(css).not.toMatch(shared);
  });
});
