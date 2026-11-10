/** The sender check, the service: whose address is looked up, what is asked of DNS, and what a failed lookup becomes. */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ db: {} }));
let mod: typeof import("./sender-check");
beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgresql://unused:unused@localhost:5432/unused";
  mod = await import("./sender-check");
}, 60_000);
beforeEach(() => mod.clearSenderCache());

const NOW = new Date("2026-11-11T10:00:00Z");
const ana = { id: "ana", organizationId: "org-a", memberStatus: "active", orgRole: "SALES" } as any;
function deps(address: string | null, answers: Record<string, string[] | null | Error> = {}, status = "active") {
  const asked: string[] = [], boxes: string[][] = [];
  return {
    asked, boxes,
    d: {
      now: () => NOW,
      mailbox: async (orgId: string, userId: string) => { boxes.push([orgId, userId]); return address ? { address, status } : null; },
      txt: async (name: string) => { asked.push(name); const a = answers[name]; if (a instanceof Error) throw a; return a === undefined ? [] : a; },
    },
  };
}

describe("the sender check", () => {
  it("looks up the CALLER's own mailbox, and asks DNS for exactly three TXT records of its domain", async () => {
    const x = deps("ravi@acme.example", { "acme.example": ["v=spf1 include:_spf.google.com ~all"], "google._domainkey.acme.example": ["v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A"], "_dmarc.acme.example": ["v=DMARC1; p=none"] });
    const r: any = await mod.senderCheck(ana, x.d);
    expect(r).toMatchObject({ ok: true, mailbox: "active", check: { kind: "custom", domain: "acme.example", ready: true } });
    expect(x.boxes).toEqual([["org-a", "ana"]]);
    expect(x.asked.sort()).toEqual(["_dmarc.acme.example", "acme.example", "google._domainkey.acme.example"]);
  });
  it("makes no lookup at all for a gmail.com address or when no mailbox is connected", async () => {
    const g = deps("not-a-real-address@gmail.com");
    expect(await mod.senderCheck(ana, g.d)).toMatchObject({ ok: true, mailbox: "active", check: { kind: "gmail", ready: true } });
    const none = deps(null);
    expect(await mod.senderCheck(ana, none.d)).toMatchObject({ ok: true, mailbox: "none", check: { kind: "none", ready: false } });
    expect([...g.asked, ...none.asked]).toEqual([]);
  });
  it("a lookup that fails or throws is 'couldn't check', and is not remembered", async () => {
    const x = deps("ravi@acme.example", { "acme.example": null, "google._domainkey.acme.example": new Error("dns down"), "_dmarc.acme.example": ["v=DMARC1; p=reject"] });
    const r: any = await mod.senderCheck(ana, x.d);
    expect(r.check.items.map((i: any) => i.state)).toEqual(["unknown", "unknown", "ok"]);
    await mod.senderCheck(ana, x.d);
    expect(x.asked).toHaveLength(6); // asked again: a failure is never cached
  });
  it("a complete answer is remembered for a while, so opening a campaign doesn't query DNS every time", async () => {
    const x = deps("ravi@acme.example", { "acme.example": [], "_dmarc.acme.example": [] });
    await mod.senderCheck(ana, x.d); await mod.senderCheck(ana, x.d);
    expect(x.asked).toHaveLength(3);
    expect((await mod.senderCheck(ana, x.d) as any).check).toMatchObject({ ready: false });
  });
  it("says when the mailbox needs reconnecting; a mailbox that can't be read is treated as none", async () => {
    expect(await mod.senderCheck(ana, deps("not-a-real-address@gmail.com", {}, "needs_reconnect").d)).toMatchObject({ mailbox: "needs_reconnect" });
    expect(await mod.senderCheck(ana, { ...deps(null).d, mailbox: async () => { throw new Error("db"); } })).toMatchObject({ ok: true, mailbox: "none" });
  });
  it("someone with no workspace is refused", async () => {
    expect(await mod.senderCheck({ id: "x", organizationId: null } as any, deps("not-a-real-address@gmail.com").d)).toMatchObject({ ok: false, status: 403 });
  });
});
