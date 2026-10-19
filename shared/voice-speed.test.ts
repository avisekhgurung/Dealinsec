import { describe, expect, it } from "vitest";
import { nextSpeed, speedCommand, stepSpeed } from "./voice-speed";

describe("the person controls how fast a voice speaks", () => {
  it("hears clear requests in English and Hinglish, and nothing else", () => {
    expect(speedCommand("Can you speak faster please")).toBe("faster");
    expect(speedCommand("talk a bit quicker")).toBe("faster");
    expect(speedCommand("speed up")).toBe("faster");
    expect(speedCommand("thoda jaldi bolo")).toBe("faster");
    expect(speedCommand("please slow down")).toBe("slower");
    expect(speedCommand("dheere bolo yaar")).toBe("slower");
    expect(speedCommand("aaram se bolo")).toBe("slower");
    expect(speedCommand("back to normal speed")).toBe("normal");
    expect(speedCommand("I need a fast reply to Acme")).toBeNull();
    expect(speedCommand("what's slowing my deals down")).toBeNull();
  });
  it("steps up and down within the range, and the button cycles", () => {
    expect(stepSpeed(1, "faster")).toBe(1.15);
    expect(stepSpeed(1.5, "faster")).toBe(1.5);
    expect(stepSpeed(1, "slower")).toBe(0.8);
    expect(stepSpeed(0.8, "slower")).toBe(0.8);
    expect(stepSpeed(1.3, "normal")).toBe(1);
    expect(nextSpeed(1.5)).toBe(0.8);
    expect(nextSpeed(1)).toBe(1.15);
  });
});
