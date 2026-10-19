import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NEST_TEAM_IMAGE, PLUSH_FILES, PLUSH_POSES, plushSrc } from "./plush";

const PUBLIC = join(__dirname, "../../public");

describe("The Nest plush artwork", () => {
  it("every pose and the team picture exist, in both sizes", () => {
    for (const f of PLUSH_FILES) expect(existsSync(join(PUBLIC, f)), f).toBe(true);
  });
  it("each coworker has three different poses", () => {
    for (const poses of Object.values(PLUSH_POSES)) expect(new Set(Object.values(poses)).size).toBe(3);
  });
  it("srcSet offers the small file first and the large one for dense screens", () => {
    expect(plushSrc("zee", "win")).toEqual({
      src: "/ai-league/plush/zee-checklist.webp",
      srcSet: "/ai-league/plush/zee-checklist-sm.webp 160w, /ai-league/plush/zee-checklist.webp 384w",
    });
    expect(NEST_TEAM_IMAGE.width / NEST_TEAM_IMAGE.height).toBeCloseTo(1.5, 1);
  });
});
