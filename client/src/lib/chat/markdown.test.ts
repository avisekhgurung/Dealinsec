/**
 * The chat's Markdown: what models actually write renders as structure, unsafe links never become links, and
 * half-finished text (a stream cut off, a long reply mid-way) never throws or loses words.
 */
import { describe, expect, it } from "vitest";
import { inlineText, parseInline, parseMarkdown, safeHref, type Block } from "./markdown";

const kinds = (b: Block[]) => b.map((x) => x.t);

describe("links are links only when safe", () => {
  it("allows http(s) to another site and paths inside the app", () => {
    expect(safeHref("https://bluebird.in/careers")).toEqual({ href: "https://bluebird.in/careers", external: true });
    expect(safeHref("/leads/12?run=lr_1")).toEqual({ href: "/leads/12?run=lr_1", external: false });
  });
  it.each(["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,<script>", "//evil.com/x", "https://user:pw@bank.com", "vbscript:x", "https://localhost/x", "https://a.com/x\" onmouseover=\"x", "file:///etc/passwd", ""])("refuses %s", (u) => {
    expect(safeHref(u)).toBeNull();
  });
  it("an unsafe Markdown link keeps its words and loses the link", () => {
    expect(parseInline("[click me](javascript:alert(1))")).not.toContainEqual(expect.objectContaining({ t: "link" }));
    expect(inlineText(parseInline("[click me](javascript:alert)"))).toContain("click me");
  });
  it("HTML in the text stays text: there is no HTML node at all", () => {
    const b = parseMarkdown("<img src=x onerror=alert(1)> and <script>alert(1)</script>");
    expect(b).toEqual([{ t: "p", c: [{ t: "text", v: "<img src=x onerror=alert(1)> and <script>alert(1)</script>" }] }]);
  });
  it("bare URLs become links without swallowing the trailing punctuation", () => {
    const c = parseInline("See https://bluebird.in/careers.");
    expect(c).toEqual([{ t: "text", v: "See " }, { t: "link", href: "https://bluebird.in/careers", external: true, c: [{ t: "text", v: "https://bluebird.in/careers" }] }, { t: "text", v: "." }]);
  });
});

describe("what models write", () => {
  it("headings, bold, italic and inline code", () => {
    const b = parseMarkdown("## Next steps\nCall **Bluebird Dental** about the *booking* page and the `/careers` link.");
    expect(b[0]).toEqual({ t: "heading", level: 2, c: [{ t: "text", v: "Next steps" }] });
    expect(b[1].t).toBe("p");
    const p = (b[1] as Extract<Block, { t: "p" }>).c;
    expect(p).toContainEqual({ t: "strong", c: [{ t: "text", v: "Bluebird Dental" }] });
    expect(p).toContainEqual({ t: "em", c: [{ t: "text", v: "booking" }] });
    expect(p).toContainEqual({ t: "code", v: "/careers" });
  });

  it("snake_case and arithmetic aren't mistaken for italics", () => {
    expect(inlineText(parseInline("set max_leads_per_run to 5"))).toBe("set max_leads_per_run to 5");
    expect(parseInline("set max_leads_per_run")).toEqual([{ t: "text", v: "set max_leads_per_run" }]);
  });

  it("numbered lists keep their start; loose lists stay one list", () => {
    const b = parseMarkdown("Plan:\n\n3. Search\n\n4. Qualify\n\n5. Draft");
    expect(kinds(b)).toEqual(["p", "list"]);
    const l = b[1] as Extract<Block, { t: "list" }>;
    expect(l).toMatchObject({ ordered: true, start: 3 });
    expect(l.items.map((it) => inlineText(it.c))).toEqual(["Search", "Qualify", "Draft"]);
  });

  it("nested lists by indentation, with continuation lines", () => {
    const b = parseMarkdown("- Nibo\n  - finds companies\n  - checks websites\n- Mika\n  writes first messages");
    const l = b[0] as Extract<Block, { t: "list" }>;
    expect(l.items).toHaveLength(2);
    expect(l.items[0].children[0]).toMatchObject({ t: "list", ordered: false });
    expect((l.items[0].children[0] as Extract<Block, { t: "list" }>).items.map((it) => inlineText(it.c))).toEqual(["finds companies", "checks websites"]);
    expect(inlineText(l.items[1].c)).toBe("Mika\nwrites first messages");
  });

  it("a number inside a sentence doesn't start a list", () => {
    expect(kinds(parseMarkdown("We grew in\n2024. Then we hired."))).toEqual(["p"]);
  });

  it("GitHub tables with alignment, ragged rows padded", () => {
    const b = parseMarkdown("| Company | Score | Stage |\n|:--|--:|:-:|\n| Bluebird | 82 | New |\n| Harbor | 61 |");
    const t = b[0] as Extract<Block, { t: "table" }>;
    expect(t.t).toBe("table");
    expect(t.align).toEqual(["left", "right", "center"]);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[1]).toHaveLength(3);
    expect(inlineText(t.rows[1][2])).toBe("");
  });

  it("fenced code keeps whitespace and its language", () => {
    const b = parseMarkdown("```ts\nconst a = 1;\n    indented();\n```\nafter");
    expect(b[0]).toEqual({ t: "code", lang: "ts", v: "const a = 1;\n    indented();", open: false });
    expect(b[1].t).toBe("p");
  });

  it("blockquotes and rules", () => {
    expect(kinds(parseMarkdown("> quoted\n> more\n\n---\n\nend"))).toEqual(["quote", "hr", "p"]);
  });
});

describe("half-finished text never breaks", () => {
  it("an unclosed code fence is an open code block with everything after it", () => {
    const b = parseMarkdown("Here:\n```python\nprint('hi')\n\nprint('still code')");
    expect(b[1]).toEqual({ t: "code", lang: "python", v: "print('hi')\n\nprint('still code')", open: true });
  });
  it("a table without its separator row yet is a paragraph", () => {
    expect(kinds(parseMarkdown("| Company | Score |\n"))).toEqual(["p"]);
  });
  it("half a link, half a bold, a stray backtick: plain text, nothing lost", () => {
    const src = "See [Bluebird](https://blue and **bold and `code";
    expect(inlineText(parseInline(src))).toBe(src);
  });
  it.each(["", "\n\n", "#", "-", "1.", "|", "```", "> ", "**", "[", "![x](", "- [ ] ", "|-|"])("survives %j", (s) => {
    expect(() => parseMarkdown(s)).not.toThrow();
  });
  it("a long reply parses quickly", () => {
    const big = Array.from({ length: 400 }, (_, i) => `- **Item ${i}** with a [link](https://example.com/${i}) and \`code\``).join("\n");
    const t0 = performance.now();
    const b = parseMarkdown(big);
    expect(performance.now() - t0).toBeLessThan(200);
    expect((b[0] as Extract<Block, { t: "list" }>).items).toHaveLength(400);
  });
});
