import { describe, expect, it } from "vitest";
import { composerHeight, distanceFromBottom, enterIntent, isFollowing, isLongMessage, onContentChange } from "./interaction";

const key = (over: Partial<Parameters<typeof enterIntent>[0]> = {}) => ({ key: "Enter", shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, ...over });

describe("following the conversation", () => {
  it("near the bottom follows; scrolled up to read does not", () => {
    expect(isFollowing({ scrollTop: 900, scrollHeight: 1500, clientHeight: 560 })).toBe(true); // 40px away
    expect(isFollowing({ scrollTop: 300, scrollHeight: 1500, clientHeight: 560 })).toBe(false);
    expect(distanceFromBottom({ scrollTop: 2000, scrollHeight: 1500, clientHeight: 560 })).toBe(0); // overscroll bounce
  });

  it("new content follows only a reader at the bottom; otherwise it offers Jump to latest", () => {
    expect(onContentChange({ following: true, added: 1, lastIsOwnNewMessage: false, firstLoad: false })).toBe("follow");
    expect(onContentChange({ following: false, added: 1, lastIsOwnNewMessage: false, firstLoad: false })).toBe("mark-new");
    expect(onContentChange({ following: false, added: 0, lastIsOwnNewMessage: false, firstLoad: false })).toBe("none");
  });

  it("sending a message or opening a conversation always shows the latest", () => {
    expect(onContentChange({ following: false, added: 1, lastIsOwnNewMessage: true, firstLoad: false })).toBe("follow");
    expect(onContentChange({ following: false, added: 30, lastIsOwnNewMessage: false, firstLoad: true })).toBe("follow");
  });

  it("a card growing while the reader follows keeps them at the bottom", () => {
    expect(onContentChange({ following: true, added: 0, lastIsOwnNewMessage: false, firstLoad: false })).toBe("follow");
  });
});

describe("Enter in the message box", () => {
  it("desktop: Enter sends, Shift+Enter is a new line", () => {
    expect(enterIntent(key(), false)).toBe("send");
    expect(enterIntent(key({ shiftKey: true }), false)).toBe("newline");
  });
  it("touch keyboards: Enter is a new line, Ctrl/Cmd+Enter sends", () => {
    expect(enterIntent(key(), true)).toBe("newline");
    expect(enterIntent(key({ metaKey: true }), true)).toBe("send");
    expect(enterIntent(key({ ctrlKey: true }), false)).toBe("send");
  });
  it("never during IME composition, and other keys do nothing", () => {
    expect(enterIntent(key({ isComposing: true }), false)).toBe("none");
    expect(enterIntent(key({ keyCode: 229 }), false)).toBe("none");
    expect(enterIntent(key({ key: "a" }), false)).toBe("none");
  });
});

describe("sizes", () => {
  it("the composer grows with its text, capped so the conversation stays visible", () => {
    expect(composerHeight(20, 800)).toBe(40);
    expect(composerHeight(120, 800)).toBe(120);
    expect(composerHeight(900, 800)).toBe(240);
    expect(composerHeight(900, 500)).toBe(200); // 40% of a short (keyboard-open) viewport
  });
  it("long messages fold (never cut)", () => {
    expect(isLongMessage("short")).toBe(false);
    expect(isLongMessage("x".repeat(1300))).toBe(true);
    expect(isLongMessage(Array.from({ length: 20 }, () => "line").join("\n"))).toBe(true);
  });
});
