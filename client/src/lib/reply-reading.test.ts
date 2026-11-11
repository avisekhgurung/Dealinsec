import { describe, expect, it } from "vitest";
import { followUpEnds, repliesAreRead } from "./reply-reading";

const sync = (over: Record<string, unknown> = {}) => ({ available: true, granted: true, state: "ok", lastSyncedAt: null, ...over }) as any;
const mailbox = (status = "active") => ({ status, accountEmail: "me@example.com", capabilities: { identify: true, send: true, read: true } }) as any;

describe("whether a reply is noticed without the person recording it", () => {
  it("yes only with reading switched on for the workspace and a working mailbox that allows it", () => {
    expect(repliesAreRead({ connection: mailbox(), replySync: sync() })).toBe(true);
  });

  it("no when Gmail isn't offered here, isn't connected, or the status couldn't be read", () => {
    expect(repliesAreRead(undefined)).toBe(false);
    expect(repliesAreRead(null)).toBe(false);
    expect(repliesAreRead({ connection: null, replySync: sync({ granted: false }) })).toBe(false);
  });

  it("no when reading is switched off for the workspace, even with an older mailbox that still allows it", () => {
    expect(repliesAreRead({ connection: mailbox(), replySync: sync({ available: false, state: "off" }) })).toBe(false);
  });

  it("no for a sending-only mailbox, or one that needs reconnecting", () => {
    expect(repliesAreRead({ connection: mailbox(), replySync: sync({ granted: false, state: "needs_permission" }) })).toBe(false);
    expect(repliesAreRead({ connection: mailbox("needs_reconnect"), replySync: sync({ state: "needs_reconnect" }) })).toBe(false);
  });
});

describe("what the page says ends a planned follow-up", () => {
  it("promises a reply cancels it only where replies are read", () => {
    expect(followUpEnds(true)).toBe("a reply cancels it");
    expect(followUpEnds(false)).not.toMatch(/a reply cancels/);
    expect(followUpEnds(false)).toMatch(/move the lead to Replied/);
  });
});
