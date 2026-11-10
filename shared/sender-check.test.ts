/** The sender check, the pure half: reading SPF, DKIM and DMARC records, and never calling "couldn't check" a failure. */
import { describe, expect, it } from "vitest";
import { assessSender, domainOfAddress } from "./sender-check";

const GOOD = { spf: ["v=spf1 include:_spf.google.com ~all"], dkim: ["v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA"], dmarc: ["v=DMARC1; p=quarantine; rua=mailto:d@acme.example"] };
const states = (address: string, r: any) => assessSender(address, r).items.map((i) => `${i.key}:${i.state}`);

describe("which address is being checked", () => {
  it("reads the domain of a real address and nothing else", () => {
    expect(domainOfAddress("Ravi@Pixel-Studio.co.in")).toBe("pixel-studio.co.in");
    for (const bad of ["", null, "ravi", "ravi@", "ravi@localhost", "ravi@-bad.com", "a b@x.com", "ravi@x..com", "ravi@x.com/evil"]) expect(domainOfAddress(bad as any), String(bad)).toBeNull();
  });
  it("with no mailbox there is nothing to check, and it isn't called ready", () => {
    expect(assessSender(null, null)).toMatchObject({ kind: "none", items: [], ready: false });
    expect(assessSender("not-an-address", GOOD)).toMatchObject({ kind: "none", ready: false });
  });
  it("a gmail.com address needs nothing set up, and says a business address is safer for regular outreach", () => {
    const c = assessSender("not-a-real-address@gmail.com", null);
    expect(c).toMatchObject({ kind: "gmail", domain: "gmail.com", ready: true });
    expect(c.items.map((i) => i.state)).toEqual(["ok", "ok", "ok"]);
    expect(c.summary).toMatch(/personal Gmail address/);
  });
});

describe("a business domain", () => {
  it("everything in place", () => {
    const c = assessSender("ravi@acme.example", GOOD);
    expect(c).toMatchObject({ kind: "custom", domain: "acme.example", ready: true, summary: "acme.example is set up for sending: SPF, DKIM and DMARC are all in place." });
    expect(c.items.map((i) => i.state)).toEqual(["ok", "ok", "ok"]);
    expect(c.items[2].detail).toBe("Found (policy: quarantine).");
  });
  it("SPF: missing, more than one, one that lets anyone in, one that leaves Google out", () => {
    expect(states("a@acme.example", { ...GOOD, spf: [] })[0]).toBe("spf:missing");
    expect(states("a@acme.example", { ...GOOD, spf: ["google-site-verification=abc"] })[0]).toBe("spf:missing");
    expect(states("a@acme.example", { ...GOOD, spf: ["v=spf1 include:_spf.google.com ~all", "v=spf1 include:mail.zoho.in ~all"] })[0]).toBe("spf:warn");
    expect(states("a@acme.example", { ...GOOD, spf: ["v=spf1 +all"] })[0]).toBe("spf:warn");
    expect(states("a@acme.example", { ...GOOD, spf: ["v=spf1 include:mail.zoho.in -all"] })[0]).toBe("spf:warn");
    expect(states("a@acme.example", { ...GOOD, spf: ["V=SPF1   include:_spf.google.com   -all"] })[0]).toBe("spf:ok");
    expect(assessSender("a@acme.example", { ...GOOD, spf: [] }).items[0].detail).toContain("v=spf1 include:_spf.google.com ~all");
  });
  it("DMARC: missing, without a policy, monitoring only is enough to start", () => {
    expect(states("a@acme.example", { ...GOOD, dmarc: [] })[2]).toBe("dmarc:missing");
    expect(states("a@acme.example", { ...GOOD, dmarc: ["v=DMARC1; rua=mailto:x@acme.example"] })[2]).toBe("dmarc:warn");
    expect(states("a@acme.example", { ...GOOD, dmarc: ["v=DMARC1; p=none", "v=DMARC1; p=reject"] })[2]).toBe("dmarc:warn");
    const none = assessSender("a@acme.example", { ...GOOD, dmarc: ["v=DMARC1; p=none"] });
    expect(none.items[2]).toMatchObject({ state: "ok", detail: "Found (policy: none, which only monitors). That is enough to start with." });
    expect(none.ready).toBe(true);
  });
  it("DKIM not found at Google's usual name is 'not confirmed', never 'missing': the key may sit under another name", () => {
    const c = assessSender("a@acme.example", { ...GOOD, dkim: [] });
    expect(c.items[1]).toMatchObject({ state: "unknown" });
    expect(c.items[1].detail).toMatch(/another name/);
    expect(c.ready).toBe(true);
    expect(c.summary).toBe("DKIM couldn't be confirmed for acme.example. The rest is in place.");
  });
  it("a lookup that failed is 'couldn't check', not a missing record", () => {
    const c = assessSender("a@acme.example", { spf: null, dkim: null, dmarc: null });
    expect(c.items.map((i) => i.state)).toEqual(["unknown", "unknown", "unknown"]);
    expect(c.ready).toBe(true); // nothing is KNOWN to be missing
    expect(c.summary).toBe("SPF and DKIM and DMARC couldn't be confirmed for acme.example. The rest is in place.");
    expect(assessSender("a@acme.example", null).items.map((i) => i.state)).toEqual(["unknown", "unknown", "unknown"]);
  });
  it("what is missing is named, and missing outranks warnings in the summary", () => {
    const c = assessSender("a@acme.example", { spf: [], dkim: GOOD.dkim, dmarc: [] });
    expect(c).toMatchObject({ ready: false, summary: "SPF and DMARC are not set up for acme.example. Mail from it is more likely to land in spam until they are." });
    expect(assessSender("a@acme.example", { ...GOOD, dmarc: [] }).summary).toBe("DMARC is not set up for acme.example. Mail from it is more likely to land in spam until it is.");
    expect(assessSender("a@acme.example", { ...GOOD, spf: ["v=spf1 +all"] }).summary).toBe("SPF for acme.example needs a look.");
  });
});
