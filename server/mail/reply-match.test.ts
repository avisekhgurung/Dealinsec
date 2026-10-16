import { describe, expect, it } from "vitest";
import type { ParsedMail } from "./mail-parse";
import { decideMatch, type ConversationLink, type MatchContext, type OutreachCandidate } from "./reply-match";

const LINK: ConversationLink = { leadId: 7, leadMessageId: 70, toAddress: "jo@acme.com" };
const OUT: OutreachCandidate = { ...LINK, subject: "A quick idea for Acme", at: new Date("2026-10-14T12:00:00Z") };
const mail = (o: Partial<ParsedMail> = {}): ParsedMail => ({
  id: "m1", threadId: "t1", labels: ["INBOX"], rfcMessageId: "<r@acme.com>", inReplyTo: null, references: [],
  from: "jo@acme.com", fromName: "Jo", to: ["ana@agency.test"], cc: [], subject: "Re: A quick idea for Acme", date: new Date("2026-10-15T10:00:00Z"), receivedAt: new Date("2026-10-15T10:00:01Z"),
  automated: false, bounce: false, ...o,
});
const ctx = (o: Partial<MatchContext> = {}): MatchContext => ({ accountEmail: "ana@agency.test", thread: null, reference: null, outreachTo: () => [], ...o });

describe("decideMatch", () => {
  it("a reply in a linked thread belongs to its conversation", () => {
    expect(decideMatch(mail(), ctx({ thread: LINK }))).toMatchObject({ action: "store", direction: "in", kind: "reply", match: "thread", link: LINK, review: null, adoptThread: false, needBody: true });
  });

  it("a reply whose subject (and so Gmail thread) changed is found by its References, and its thread adopted", () => {
    const d = decideMatch(mail({ subject: "Totally new subject", threadId: "t9", references: ["<dis-70@dealinsec.com>"] }), ctx({ reference: LINK }));
    expect(d).toMatchObject({ action: "store", match: "reference", adoptThread: true, review: null });
  });

  it("a different sender in a linked thread (a colleague, a forward) is linked but flagged for review", () => {
    expect(decideMatch(mail({ from: "boss@acme.com" }), ctx({ thread: LINK }))).toMatchObject({ match: "thread", review: "other_sender" });
  });

  it("a bounce is from the mail system, not someone else: not flagged as another sender", () => {
    expect(decideMatch(mail({ from: "mailer-daemon@googlemail.com", bounce: true }), ctx({ thread: LINK }))).toMatchObject({ kind: "bounce", review: null });
    expect(decideMatch(mail({ automated: true }), ctx({ thread: LINK }))).toMatchObject({ kind: "auto_reply" });
  });

  it("only the sender's address matching outreach: kept for review, never linked silently", () => {
    const d = decideMatch(mail({ subject: "Something else" }), ctx({ outreachTo: (a) => (a === "jo@acme.com" ? [OUT] : []) }));
    expect(d).toMatchObject({ action: "store", match: "address", review: "address_only", adoptThread: false });
  });

  it("picks the most recent outreach when an address was written to more than once", () => {
    const older = { ...OUT, leadMessageId: 60, at: new Date("2026-09-01T00:00:00Z") };
    const d = decideMatch(mail(), ctx({ outreachTo: () => [older, OUT] }));
    expect(d.action === "store" && d.link.leadMessageId).toBe(70);
  });

  it("a display name alone never matches: same name, other address, nothing stored", () => {
    const d = decideMatch(mail({ from: "jo.impostor@other.test", fromName: "Jo" }), ctx({ outreachTo: (a) => (a === "jo@acme.com" ? [OUT] : []) }));
    expect(d).toEqual({ action: "ignore", reason: "no_link" });
  });

  it("unrelated mail is not stored", () => {
    expect(decideMatch(mail({ from: "news@shop.test" }), ctx())).toEqual({ action: "ignore", reason: "no_link" });
    expect(decideMatch(mail({ from: null }), ctx())).toEqual({ action: "ignore", reason: "no_sender" });
  });

  it("drafts, spam, trash and chats are ignored even in a linked thread", () => {
    for (const l of ["DRAFT", "SPAM", "TRASH", "CHAT"]) expect(decideMatch(mail({ labels: [l] }), ctx({ thread: LINK }))).toEqual({ action: "ignore", reason: "label" });
  });

  it("outreach sent by hand: the copy in Sent mail (same address, approved subject) adopts its thread, without keeping the body", () => {
    const copy = mail({ labels: ["SENT"], from: "ana@agency.test", to: ["jo@acme.com"], subject: "A quick idea for Acme" });
    expect(decideMatch(copy, ctx({ outreachTo: (a) => (a === "jo@acme.com" ? [OUT] : []) }))).toMatchObject({ action: "store", direction: "out", kind: "outreach_copy", match: "adopted", adoptThread: true, needBody: false });
    // Another subject to the same person is some other email: not adopted.
    expect(decideMatch({ ...copy, subject: "Lunch?" }, ctx({ outreachTo: () => [OUT] }))).toEqual({ action: "ignore", reason: "no_link" });
  });

  it("the person's own reply from Gmail in a linked thread is part of the conversation", () => {
    expect(decideMatch(mail({ labels: ["SENT"], from: "ana@agency.test", to: ["jo@acme.com"] }), ctx({ thread: LINK }))).toMatchObject({ direction: "out", kind: "own_reply", match: "thread" });
  });
});
