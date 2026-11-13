import { describe, expect, it } from "vitest";
import { DEFAULT_WORK_MODE, isWorkMode, modeForPath, resolveWorkMode, WORK_MODES, WORK_MODE_LABELS } from "./work-mode";

describe("the product's two modes", () => {
  it("Client Search is the default: an undecided account lands on the product, not the paperwork", () => {
    expect(DEFAULT_WORK_MODE).toBe("find");
    expect(WORK_MODES).toEqual(["find", "suite"]);
    expect(WORK_MODE_LABELS.find).toBe("Client Search");
  });

  it("owns the finding routes", () => {
    for (const p of ["/outbound", "/outbound/run/9", "/ai-league", "/ai-league/mika"]) {
      expect(modeForPath(p), p).toBe("find");
    }
  });

  it("owns the Deal Suite routes, including the documents that live under another path", () => {
    for (const p of ["/deals", "/deals/5", "/quotations", "/contracts/9", "/invoices", "/brand-invoices/new", "/deals/5/quote"]) {
      expect(modeForPath(p), p).toBe("suite");
    }
  });

  it("LEADS IS THE BRIDGE: it belongs to both, so it is owned by neither and never switches the mode", () => {
    for (const p of ["/leads", "/leads/42"]) expect(modeForPath(p), p).toBeNull();
  });

  it("claims nothing that belongs to both or to neither", () => {
    for (const p of ["/dashboard", "/profile", "/settings", "/pricing", "/", "/wallet", "/agent", "nonsense", ""]) {
      expect(modeForPath(p), p).toBeNull();
    }
  });

  it("where you are wins; otherwise what you last chose; otherwise the default", () => {
    expect(resolveWorkMode("/invoices", "find")).toBe("suite");   // the page decides
    expect(resolveWorkMode("/outbound", "suite")).toBe("find");
    expect(resolveWorkMode("/leads", "suite")).toBe("suite");     // the bridge leaves the choice alone
    expect(resolveWorkMode("/dashboard", "suite")).toBe("suite");
    expect(resolveWorkMode("/dashboard", null)).toBe("find");     // nothing remembered
    expect(resolveWorkMode("/dashboard", "junk")).toBe("find");   // and junk is not a mode
  });

  it("rejects anything that isn't a mode", () => {
    for (const x of ["", "FIND", "suite ", null, undefined, 0, {}, ["find"]]) expect(isWorkMode(x)).toBe(false);
  });
});
