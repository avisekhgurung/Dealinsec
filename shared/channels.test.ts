import { describe, expect, it } from "vitest";
import { checkChannelDraft, checkChannelText, externalUrl, isStopReply, linkedinUrl, maxFor, normalPhone, statusLabel, xHandle } from "./channels";

describe("channel rules", () => {
  it("normalizes phone numbers to E.164 and refuses anything else", () => {
    expect(normalPhone("+91 98765-43210")).toBe("+919876543210");
    expect(normalPhone("0091 98765 43210")).toBe("+919876543210");
    expect(normalPhone("09876543210", "91")).toBe("+919876543210");
    for (const bad of ["12345", "+0123456789", "phone", "+91 98765 43210 ext 5", null]) expect(normalPhone(bad)).toBeNull();
  });

  it("accepts only real LinkedIn member/company pages and X handles", () => {
    expect(linkedinUrl("linkedin.com/in/asha-rao")).toBe("https://www.linkedin.com/in/asha-rao/");
    expect(linkedinUrl("https://in.linkedin.com/company/smile-dental/")).toBe("https://www.linkedin.com/company/smile-dental/");
    for (const bad of ["https://evil.com/in/asha", "https://linkedin.com.evil.com/in/a", "http://www.linkedin.com/in/asha", "https://www.linkedin.com/feed/", "javascript:alert(1)"]) expect(linkedinUrl(bad)).toBeNull();
    expect(xHandle("@Smile_Dental")).toBe("Smile_Dental");
    expect(xHandle("https://twitter.com/smile")).toBe("smile");
    for (const bad of ["a b", "@toolonghandle12345", "https://x.com/"]) expect(xHandle(bad)).toBeNull();
    expect(externalUrl("x", "smile")).toBe("https://x.com/smile");
    expect(externalUrl("linkedin", null, "Asha Smile Dental")).toBe("https://www.linkedin.com/search/results/people/?keywords=Asha%20Smile%20Dental");
  });

  it("keeps LinkedIn's note limit (200, 300 with Premium) and each channel's maximum", () => {
    expect(maxFor("connection_note")).toBe(200);
    expect(maxFor("connection_note", true)).toBe(300);
    expect(checkChannelText("x".repeat(201), "connection_note")[0].code).toBe("body_length");
    expect(checkChannelText("x".repeat(201), "connection_note", { premium: true })).toEqual([]);
    expect(checkChannelText("Hi [Name], quick question", "dm")[0].code).toBe("placeholder");
  });

  it("refuses a model draft with a price, a link, false history or the wrong length", () => {
    const ok = "Hello, I saw your clinic offers family dentistry in Siliguri. Would a short chat about your website be useful?";
    expect(checkChannelDraft(ok, "dm", { siteHost: "smiledental.in" })).toEqual([]);
    expect(checkChannelDraft(`${ok} Only $499.`, "dm", { siteHost: "" }).map((i) => i.code)).toContain("price");
    expect(checkChannelDraft(`${ok} See www.example.com`, "dm", { siteHost: "" }).map((i) => i.code)).toContain("link");
    expect(checkChannelDraft(`As we discussed, ${ok}`, "dm", { siteHost: "" }).map((i) => i.code)).toContain("false_history");
    expect(checkChannelDraft("Hi", "message", { siteHost: "" }).map((i) => i.code)).toContain("body_length");
  });

  it("says a manual send is the person's word, and delivery only when reported", () => {
    const base = { status: "sent" as const, delivery: null, repliedAt: null };
    expect(statusLabel({ ...base, sentVia: "manual", channel: "linkedin" })).toBe("You marked it sent on LinkedIn");
    expect(statusLabel({ ...base, sentVia: "api", channel: "whatsapp" })).toBe("Sent");
    expect(statusLabel({ ...base, sentVia: "api", delivery: "delivered", channel: "whatsapp" })).toBe("Delivered");
    expect(statusLabel({ ...base, sentVia: "manual", repliedAt: "2026-10-18", channel: "x" })).toBe("Reply recorded by you");
    expect(statusLabel({ status: "uncertain", sentVia: null, delivery: null, repliedAt: null, channel: "whatsapp" })).toBe("Not confirmed");
  });

  it("recognizes a stop reply only as the whole message", () => {
    for (const s of ["STOP", "stop.", "Unsubscribe", "  opt out "]) expect(isStopReply(s)).toBe(true);
    for (const s of ["don't stop, tell me more", "Stop by our clinic tomorrow", "", null]) expect(isStopReply(s)).toBe(false);
  });
});
