import { describe, expect, it } from "vitest";
import { evidenceDateLine } from "./outbound";

const day = (iso: string) => `D(${iso})`;

describe("the date a finding's provenance line carries", () => {
  it("prefers the precision-safe date string the server built, shown as given", () => {
    expect(evidenceDateLine({ kind: "fact", date: "Sep 2026", observedAt: "2026-09-14T00:00:00Z", retrievedAt: "2026-10-01T00:00:00Z" }, day)).toBe("dated Sep 2026");
  });
  it("falls back to the evidence's stated date, then to the day the page was read", () => {
    expect(evidenceDateLine({ kind: "fact", observedAt: "2026-09-14T00:00:00Z", retrievedAt: "2026-10-01T00:00:00Z" }, day)).toBe("dated D(2026-09-14T00:00:00Z)");
    expect(evidenceDateLine({ kind: "fact", observedAt: null, retrievedAt: "2026-10-01T00:00:00Z" }, day)).toBe("seen D(2026-10-01T00:00:00Z)");
  });
  it("shows nothing when nothing is stored: a date is never invented", () => {
    expect(evidenceDateLine({ kind: "fact", observedAt: null, retrievedAt: null }, day)).toBeNull();
  });
  it("a signal names its date in its own header, so its provenance repeats nothing", () => {
    expect(evidenceDateLine({ kind: "signal", date: "14 Sep 2026", observedAt: "2026-09-14T00:00:00Z", retrievedAt: "2026-10-01T00:00:00Z" }, day)).toBeNull();
  });
});
