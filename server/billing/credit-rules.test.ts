import { describe, expect, it } from "vitest";
import { resolveSku } from "./purchase-rules";

describe("expiryFrom (no database)", () => {
  it("adds calendar months and clamps month ends", async () => {
    const expiryFrom = (await import("./expiry")).expiryFrom;
    expect(expiryFrom(new Date("2026-01-31T10:00:00Z"), 1)?.toISOString()).toBe("2026-02-28T10:00:00.000Z");
    expect(expiryFrom(new Date("2028-01-31T10:00:00Z"), 1)?.toISOString()).toBe("2028-02-29T10:00:00.000Z");
    expect(expiryFrom(new Date("2026-11-12T00:00:00Z"), 12)?.toISOString()).toBe("2027-11-12T00:00:00.000Z");
    expect(expiryFrom(new Date("2026-11-12T00:00:00Z"), null)).toBeNull();
    expect(expiryFrom(new Date("2026-11-12T00:00:00Z"), 0)).toBeNull();
  });
});

describe("resolveSku for credit packs", () => {
  it("a credit pack can be bought by any workspace, free or Pro, and is still one-time", () => {
    expect(resolveSku({ plan: "credit_pack" }, false)).toEqual({ ok: true, sku: "credit_pack" });
    expect(resolveSku({ plan: "credit_pack" }, true)).toEqual({ ok: true, sku: "credit_pack" });
  });
  it("retired plans stay refused", () => {
    expect(resolveSku({ plan: "pro_yearly" }, true)).toMatchObject({ ok: false, status: 410 });
  });
});
