import { describe, expect, it, vi } from "vitest";
import { isPlatformAdmin, requirePlatformAdmin } from "./guard";
import { csvCell, toCsv } from "./csv";

const run = (user: unknown) => {
  const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  const next = vi.fn();
  requirePlatformAdmin({ user } as any, res, next);
  return { res, next };
};

describe("platform admin gate", () => {
  it("lets through only an explicit true flag", () => {
    expect(run({ isPlatformAdmin: true }).next).toHaveBeenCalled();
    for (const u of [undefined, null, {}, { isPlatformAdmin: false }, { isPlatformAdmin: "true" }, { isPlatformAdmin: 1 }, { orgRole: "OWNER" }, { email: "founder@example.com" }]) {
      const { res, next } = run(u);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    }
  });
  it("an organization owner is not an operator", () => {
    expect(isPlatformAdmin({ orgRole: "OWNER" } as any)).toBe(false);
  });
});

describe("CSV export is safe to open in a spreadsheet", () => {
  it("defuses formula cells and quotes commas, quotes and newlines", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("+1 555")).toBe("'+1 555");
    expect(csvCell("@sum")).toBe("'@sum");
    expect(csvCell("a,b")).toBe("\"a,b\"");
    expect(csvCell("line\nbreak")).toBe("\"line\nbreak\"");
    expect(csvCell(null)).toBe("");
    expect(csvCell(new Date("2026-11-12T00:00:00Z"))).toBe("2026-11-12T00:00:00.000Z");
    expect(toCsv(["a", "b"], [[1, "x,y"]])).toBe("a,b\r\n1,\"x,y\"\r\n");
  });
});
