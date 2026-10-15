import { describe, expect, it } from "vitest";
import { rejectOutcome, resumeTarget, returnTarget } from "./agent-mode";

describe("switching into the agent resumes the conversation", () => {
  it("opens the last conversation, or a new one", () => {
    expect(resumeTarget("4386d1cb-eab0-4b8b-befe-af53a7837f03")).toBe("/agent/4386d1cb-eab0-4b8b-befe-af53a7837f03");
    expect(resumeTarget(null)).toBe("/agent");
    expect(resumeTarget("")).toBe("/agent");
  });
  it("never builds a route from a tampered value", () => {
    for (const bad of ["../dashboard", "x/y", "a b", "<script>", "x".repeat(65)]) expect(resumeTarget(bad), bad).toBe("/agent");
  });
});

describe("switching back to the workspace returns where you were", () => {
  it("returns to the in-app screen the person left from", () => {
    expect(returnTarget("/deals/42")).toBe("/deals/42");
    expect(returnTarget("/contracts/7?tab=files")).toBe("/contracts/7?tab=files");
  });
  it("falls back to the dashboard for anything else", () => {
    for (const bad of [null, "", "https://evil.test/", "//evil.test", "/agent", "/agent/abc", "/s/token", "/d/token", "/auth", "/", "/deals 42", "/\\evil"]) {
      expect(returnTarget(bad as any), String(bad)).toBe("/dashboard");
    }
  });
});

describe("declining an approval reports only what the server confirmed", () => {
  it("declined on success, expired when the request is gone, otherwise unknown (try again)", () => {
    expect(rejectOutcome(200)).toBe("declined");
    expect(rejectOutcome(404)).toBe("expired");
    expect(rejectOutcome(410)).toBe("expired");
    for (const s of [null, 0, 500, 502, 403, 429]) expect(rejectOutcome(s), String(s)).toBe("retry");
  });
});
