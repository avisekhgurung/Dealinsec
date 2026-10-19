import { describe, expect, it } from "vitest";
import { orderSessions, pinBody, renameBody } from "./pins";

const row = (id: string, updated: string) => ({ id, updatedAt: new Date(updated) });

describe("the conversation list order", () => {
  it("pinned first (newest pin on top), then the rest by last activity; nothing listed twice", () => {
    const rows = [row("a", "2026-10-19T10:00Z"), row("b", "2026-10-19T09:00Z"), row("c", "2026-10-01T09:00Z"), row("d", "2026-10-18T09:00Z"), row("a", "2026-10-19T10:00Z")];
    const pins = new Map([["c", new Date("2026-10-19T08:00Z")], ["d", new Date("2026-10-19T09:30Z")]]);
    const out = orderSessions(rows, pins);
    expect(out.map((r) => r.id)).toEqual(["d", "c", "a", "b"]);
    expect(out.map((r) => r.pinned)).toEqual([true, true, false, false]);
  });
  it("no pins: just the most recent first", () => {
    expect(orderSessions([row("x", "2026-10-01T00:00Z"), row("y", "2026-10-02T00:00Z")], new Map()).map((r) => r.id)).toEqual(["y", "x"]);
  });
});

describe("what the routes accept", () => {
  it("a name is trimmed, required and at most 80 characters; nothing else is accepted", () => {
    expect(renameBody.safeParse({ title: "  Acme renewal  " })).toMatchObject({ success: true, data: { title: "Acme renewal" } });
    expect(renameBody.safeParse({ title: "   " }).success).toBe(false);
    expect(renameBody.safeParse({ title: "x".repeat(81) }).success).toBe(false);
    expect(renameBody.safeParse({ title: "ok", userId: "someone-else" }).success).toBe(false);
    expect(pinBody.safeParse({ pinned: "yes" }).success).toBe(false);
  });
});
