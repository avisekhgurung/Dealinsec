import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limit";

describe("createRateLimiter", () => {
  it("allows up to the maximum in a window, then refuses, then recovers as the window slides", () => {
    let t = 0;
    const rl = createRateLimiter(3, 1000, () => t);
    expect([rl.take("a"), rl.take("a"), rl.take("a"), rl.take("a")]).toEqual([true, true, true, false]);
    t = 999; expect(rl.take("a")).toBe(false);
    t = 1001; expect(rl.take("a")).toBe(true);
  });
  it("keeps keys apart, and a refused call is not counted", () => {
    let t = 0;
    const rl = createRateLimiter(1, 1000, () => t);
    expect(rl.take("a")).toBe(true); expect(rl.take("b")).toBe(true);
    for (let i = 0; i < 50; i++) expect(rl.take("a")).toBe(false);
    t = 1001; expect(rl.take("a")).toBe(true);
  });
});
