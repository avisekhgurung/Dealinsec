import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseNotification, verifyChallenge, verifySignature } from "./whatsapp-webhook";

const sig = (raw: string, secret: string) => `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;

describe("WhatsApp webhook", () => {
  it("checks the signature on the exact bytes, in constant time; no secret means nothing is accepted", () => {
    const raw = '{"object":"whatsapp_business_account","entry":[]}';
    expect(verifySignature(Buffer.from(raw), sig(raw, "s3cret"), "s3cret")).toBe(true);
    expect(verifySignature(Buffer.from(raw + " "), sig(raw, "s3cret"), "s3cret")).toBe(false); // re-serialized: different bytes
    expect(verifySignature(Buffer.from(raw), sig(raw, "other"), "s3cret")).toBe(false);
    expect(verifySignature(Buffer.from(raw), sig(raw, "s3cret").toUpperCase().replace("SHA256=", "sha256="), "s3cret")).toBe(true);
    for (const bad of [undefined, "", "sha256=zz", "md5=abc", sig(raw, "s3cret").slice(0, 20)]) expect(verifySignature(Buffer.from(raw), bad, "s3cret")).toBe(false);
    expect(verifySignature(Buffer.from(raw), sig(raw, ""), undefined)).toBe(false);
    expect(verifySignature(undefined, sig(raw, "s3cret"), "s3cret")).toBe(false);
  });

  it("answers the handshake only for our token, with a plain challenge", () => {
    expect(verifyChallenge({ "hub.mode": "subscribe", "hub.verify_token": "tok", "hub.challenge": "12345" }, "tok")).toBe("12345");
    expect(verifyChallenge({ "hub.mode": "subscribe", "hub.verify_token": "tok", "hub.challenge": "<script>" }, "tok")).toBeNull();
    expect(verifyChallenge({ "hub.mode": "unsubscribe", "hub.verify_token": "tok", "hub.challenge": "1" }, "tok")).toBeNull();
    expect(verifyChallenge({ "hub.mode": "subscribe", "hub.verify_token": "tokx", "hub.challenge": "1" }, "tok")).toBeNull();
  });

  it("parses statuses and inbound messages (text, button and interactive titles), skipping anything malformed", () => {
    const n = parseNotification({ object: "whatsapp_business_account", entry: [{ changes: [
      { field: "messages", value: { metadata: { phone_number_id: "111" },
        statuses: [{ id: "wamid.1", status: "delivered", timestamp: "1760781600" }, { id: "wamid.2", status: "failed", timestamp: "1760781601", errors: [{ code: 131026 }] }, { id: "wamid.3", status: "bogus" }, { status: "read" }],
        messages: [{ from: "919876543210", id: "wamid.in", timestamp: "1760781602", type: "text", text: { body: "Yes please" } },
          { from: "919876543210", id: "wamid.btn", timestamp: "1760781603", type: "button", button: { text: "Stop promotions" } },
          { from: "919876543210", id: "wamid.img", timestamp: "1760781604", type: "image", image: { id: "x" } },
          { from: "not-a-number", id: "wamid.bad", type: "text", text: { body: "x" } }] } },
      { field: "account_update", value: {} },
      { field: "messages", value: { statuses: [{ id: "wamid.nometa", status: "read" }] } },
    ] }] });
    expect(n.statuses).toEqual([
      { phoneNumberId: "111", wamid: "wamid.1", status: "delivered", at: new Date(1760781600000), errorCode: null },
      { phoneNumberId: "111", wamid: "wamid.2", status: "failed", at: new Date(1760781601000), errorCode: 131026 },
    ]);
    expect(n.inbound.map((m) => [m.wamid, m.from, m.type, m.text])).toEqual([
      ["wamid.in", "+919876543210", "text", "Yes please"], ["wamid.btn", "+919876543210", "button", "Stop promotions"], ["wamid.img", "+919876543210", "image", null],
    ]);
    expect(parseNotification({ object: "page", entry: [] })).toEqual({ statuses: [], inbound: [] });
    expect(parseNotification("junk")).toEqual({ statuses: [], inbound: [] });
  });
});
