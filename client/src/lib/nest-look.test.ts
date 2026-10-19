import { describe, expect, it } from "vitest";
import { nestLook } from "./plush";

describe("The Nest characters follow the app's state, never their own", () => {
  it("rests and floats with its own habit when idle", () => {
    expect(nestLook("idle", { size: 72 })).toEqual({ pose: "rest", motion: "nest-idle", habit: true, prop: null, halo: false });
  });
  it("switches to its working pose, sways and shows the halo and a busy prop while working", () => {
    expect(nestLook("thinking", { size: 72 })).toMatchObject({ pose: "work", motion: "nest-thinking", habit: false, prop: "busy", halo: true });
  });
  it("shows the done pose and a done prop only for success (an unread completed run)", () => {
    expect(nestLook("success", { size: 72 })).toMatchObject({ pose: "win", motion: "nest-success", prop: "done", halo: false });
  });
  it("waiting and error keep the resting pose: nothing that reads as success", () => {
    for (const s of ["waiting", "error"] as const) {
      const l = nestLook(s, { size: 72 });
      expect(l.pose).toBe("rest");
      expect(l.prop).toBeNull();
      expect(l.halo).toBe(false);
    }
  });
  it("talks while a reply is being written, with the halo, and drops its idle habit", () => {
    expect(nestLook("idle", { size: 44, isSpeaking: true })).toMatchObject({ motion: "nest-speak", habit: false, halo: true });
  });
  it("small avatars hold still (no motion, habit or prop) but keep the working pose and halo", () => {
    expect(nestLook("thinking", { size: 28 })).toEqual({ pose: "work", motion: "", habit: false, prop: null, halo: true });
  });
});
