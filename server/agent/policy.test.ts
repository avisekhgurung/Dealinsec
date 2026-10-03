import { describe, expect, it } from "vitest";
import { allOf, authorizeCall, decide, needsPermission, needsRead, normalizeAutonomy } from "./policy";
import { safeFields, summarizeArgs } from "./log";
import { fenceUntrusted } from "./untrusted";
import { readTool } from "./testing";

const custom = (perms: string[]) => ({ id: "u", organizationId: "o", orgRole: "CUSTOM", customPermissions: perms });
const owner = { id: "u", organizationId: "o", orgRole: "OWNER" };

describe("decide", () => {
  it("reads always run; consequential changes always ask; safe changes run only at level 1", () => {
    expect(decide("READ_ONLY", 0)).toBe("run");
    expect(decide("SAFE_MUTATION", 0)).toBe("approve");
    expect(decide("SAFE_MUTATION", 1)).toBe("run");
    expect(decide("SAFE_MUTATION", 1, true)).toBe("approve");
    expect(decide("CONSEQUENTIAL_MUTATION", 0)).toBe("approve");
    expect(decide("CONSEQUENTIAL_MUTATION", 1)).toBe("approve");
  });
  it("normalizeAutonomy only ever yields level 0 or 1", () => {
    for (const bad of [2, 3, -1, "x", null, undefined, NaN]) expect(normalizeAutonomy(bad)).toBe(0);
    expect(normalizeAutonomy(1)).toBe(1);
    expect(normalizeAutonomy("1")).toBe(1);
  });
});

describe("authorization building blocks", () => {
  it("module reads follow the same rules as the REST routes: custom roles are narrowed, built-in roles are not", () => {
    expect(needsRead("deals")(owner)).toBeNull();
    expect(needsRead("deals")(custom(["invoices.create"]))).toMatch(/viewing deals/);
    expect(needsRead("invoices")(custom(["invoices.create"]))).toBeNull();
    expect(needsRead("deals", "invoices")(custom(["invoices.create"]))).toMatch(/deals/);
  });
  it("permission checks name what is not allowed", () => {
    expect(needsPermission("deals.create", "creating deals")(custom([]))).toMatch(/creating deals/);
    expect(needsPermission("deals.create", "creating deals")(custom(["deals.create"]))).toBeNull();
  });
  it("allOf returns the first failure", () => {
    expect(allOf(() => null, () => "no", () => "later")(owner)).toBe("no");
    expect(allOf(() => null)(owner)).toBeNull();
  });
  it("authorizeCall refuses a user without an organization before asking the tool", () => {
    const t = readTool({ name: "t", authorize: () => null }, () => ({ ok: true, summary: "" }));
    expect(authorizeCall(t, { id: "u", organizationId: null }, {})).toMatch(/no organization/);
    expect(authorizeCall(t, null, {})).toMatch(/no organization/);
    expect(authorizeCall(t, owner, {})).toBeNull();
  });
});

describe("logging redaction", () => {
  it("drops anything that could be personal text or a credential", () => {
    const out = safeFields({
      runId: "r1", tool: "create_deal", latencyMs: 12, tokensIn: 100, status: "ok",
      email: "a@b.com", message: "hi", authToken: "x", brandName: "Acme", password: "p", apiKey: "k",
      note: "x".repeat(200),
    });
    expect(out).toMatchObject({ runId: "r1", tool: "create_deal", latencyMs: 12, tokensIn: 100, status: "ok" });
    for (const k of ["email", "message", "authToken", "brandName", "password", "apiKey"]) expect(out).not.toHaveProperty(k);
    expect((out.note as string).length).toBeLessThanOrEqual(81);
  });
  it("stores argument shapes, not free text", () => {
    expect(summarizeArgs({ dealId: 3, brandName: "Priya Sharma", customTerms: "x".repeat(300), deliverables: [1, 2], status: "Paid" }))
      .toEqual({ dealId: 3, brandName: "[text:12]", customTerms: "[text:300]", deliverables: "[list:2]", status: "Paid" });
    expect(summarizeArgs("nope")).toBeNull();
  });
});

describe("fenceUntrusted", () => {
  it("wraps text and caps its length", () => {
    const f = fenceUntrusted("tool:x", "hello", 3);
    expect(f).toBe('<untrusted source="tool:x">\nhel\n</untrusted>');
  });
  it("sanitises the source label", () => {
    expect(fenceUntrusted('a"> evil', "x")).toContain('source="a___evil"');
  });
});

import { validateRegistry } from "./registry";
import { mutationTool } from "./testing";
import { z } from "zod";

describe("validateRegistry", () => {
  const read = (name: string) => readTool({ name, description: "a perfectly good description" }, () => ({ ok: true, summary: "" }));
  it("accepts a well-formed registry", () => {
    const tools = [read("get_thing"), mutationTool({ name: "create_thing", description: "a perfectly good description" })];
    expect(validateRegistry(tools)).toBe(tools);
  });
  it("rejects duplicates, bad names and thin descriptions", () => {
    expect(() => validateRegistry([read("get_thing"), read("get_thing")])).toThrow(/duplicate/);
    expect(() => validateRegistry([read("GetThing")])).toThrow(/lower_snake_case/);
    expect(() => validateRegistry([readTool({ name: "get_thing", description: "short" }, () => ({ ok: true, summary: "" }))])).toThrow(/real description/);
  });
  it("a read tool can't carry a write path, and a mutation needs both steps", () => {
    expect(() => validateRegistry([{ ...read("get_thing"), prepare: async () => ({ ok: false as const, code: "x", message: "y" }) }])).toThrow(/can't write/);
    expect(() => validateRegistry([{ ...mutationTool({ name: "create_thing", description: "a perfectly good description" }), execute: undefined }])).toThrow(/prepare\(\) and execute\(\)/);
  });
  it("refuses a schema the model can't be shown", () => {
    expect(() => validateRegistry([read("get_thing")].map((t) => ({ ...t, input: z.date() })))).toThrow(/unsupported zod type/);
  });
});

describe("changesNothing", () => {
  it("lets a safe call that changes nothing run at level 0, but never a consequential or a forced one", async () => {
    const { decide } = await import("./policy");
    expect(decide("SAFE_MUTATION", 0, false, true)).toBe("run");
    expect(decide("SAFE_MUTATION", 0, false, false)).toBe("approve");
    expect(decide("SAFE_MUTATION", 1, true, true)).toBe("approve");
    expect(decide("CONSEQUENTIAL_MUTATION", 1, false, true)).toBe("approve");
  });
});
