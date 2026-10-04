import { describe, expect, it } from "vitest";
import { FOLLOW_UP_AFTER_DAYS, LOW_SCORE, nextAction, type NextActionInput } from "./next-action";

const base: NextActionInput = { status: "qualified", archived: false, doNotContact: false, hasContactEmail: true, researched: true, fit: "strong", score: { total: 60, knownMax: 80, confidence: "high" }, pendingMessage: null, daysSinceContact: null, overdueTicket: false, canConvert: true };
const act = (over: Partial<NextActionInput> = {}) => nextAction({ ...base, ...over });

describe("priority order", () => {
  it("nothing to do for an archived, won or lost lead, and it says why", () => {
    expect(act({ archived: true })).toMatchObject({ action: "none", blockedBy: "archived" });
    expect(act({ status: "won" })).toMatchObject({ action: "none", blockedBy: "closed" });
    expect(act({ status: "lost" })).toMatchObject({ action: "none", blockedBy: "closed" });
  });
  it("do not contact beats every other rule, including a waiting draft, a reply and an overdue step", () => {
    for (const status of ["new", "researching", "qualified", "contacted", "replied", "meeting", "proposal"]) {
      const r = act({ status, doNotContact: true, pendingMessage: "approved", overdueTicket: true, daysSinceContact: 30, researched: false });
      expect(r, status).toMatchObject({ action: "none", blockedBy: "do_not_contact" });
    }
  });
  it("archived and closed outrank do-not-contact (nothing left to say)", () => {
    expect(act({ archived: true, doNotContact: true }).blockedBy).toBe("archived");
    expect(act({ status: "lost", doNotContact: true }).blockedBy).toBe("closed");
  });
  it("an excluded lead is reconsidered before anything is researched or drafted", () => {
    expect(act({ fit: "excluded", researched: false, status: "new" }).action).toBe("reconsider");
    expect(act({ fit: "excluded", pendingMessage: "draft" }).action).toBe("reconsider");
  });
  it("an unresearched new or researching lead is researched first", () => {
    for (const status of ["new", "researching"]) expect(act({ status, researched: false }).action, status).toBe("research");
    expect(act({ status: "qualified", researched: false }).action).not.toBe("research");
  });
  it("a waiting draft is reviewed, and an approved message is sent, before anything else", () => {
    expect(act({ pendingMessage: "draft" }).action).toBe("review_draft");
    expect(act({ pendingMessage: "draft", status: "contacted", daysSinceContact: 10 }).action).toBe("review_draft");
    expect(act({ pendingMessage: "approved" }).action).toBe("send_message");
    expect(act({ pendingMessage: "approved", status: "contacted", daysSinceContact: 10 }).action).toBe("send_message");
    expect(act({ pendingMessage: "approved" }).reason).toMatch(/email app/);
    // ...even for a lead that was never researched: the message exists, so it is what to act on
    for (const status of ["new", "researching"]) {
      expect(act({ status, researched: false, pendingMessage: "draft" }).action).toBe("review_draft");
      expect(act({ status, researched: false, pendingMessage: "approved" }).action).toBe("send_message");
      expect(act({ status, researched: false, pendingMessage: null }).action).toBe("research");
    }
  });
});

describe("the conversation stages", () => {
  it("replied: answer them", () => expect(act({ status: "replied" }).action).toBe("respond"));
  it("meeting or proposal: move it forward when it can become a deal, else follow up", () => {
    for (const status of ["meeting", "proposal"]) {
      expect(act({ status, canConvert: true }).action, status).toBe("move_forward");
      expect(act({ status, canConvert: false }).action, status).toBe("follow_up");
    }
  });
  it("contacted: wait, then follow up after the quiet period, or at once if a step you set is overdue", () => {
    expect(act({ status: "contacted", daysSinceContact: 1 }).action).toBe("wait");
    expect(act({ status: "contacted", daysSinceContact: FOLLOW_UP_AFTER_DAYS - 1 }).action).toBe("wait");
    expect(act({ status: "contacted", daysSinceContact: FOLLOW_UP_AFTER_DAYS }).action).toBe("follow_up");
    expect(act({ status: "contacted", daysSinceContact: 1, overdueTicket: true }).action).toBe("follow_up");
    expect(act({ status: "contacted", daysSinceContact: null }).action).toBe("wait");
  });
  it("states the facts it used: how many days", () => {
    expect(act({ status: "contacted", daysSinceContact: 5 }).reason).toMatch(/5 days ago/);
    expect(act({ status: "contacted", daysSinceContact: 1 }).reason).toMatch(/1 day ago/);
  });
});

describe("not yet contacted", () => {
  it("needs a contact before anything is drafted", () => {
    expect(act({ hasContactEmail: false }).action).toBe("find_contact");
  });
  it("suggests moving on only when the score is low AND measured on enough of the rubric", () => {
    expect(act({ score: { total: LOW_SCORE - 1, knownMax: 80, confidence: "high" } }).action).toBe("reconsider");
    expect(act({ score: { total: LOW_SCORE, knownMax: 80, confidence: "high" } }).action).toBe("draft_outreach");
    for (const confidence of ["low", "medium"] as const) {
      expect(act({ score: { total: 5, knownMax: 30, confidence } }).action, confidence).toBe("draft_outreach"); // a low number from little data is not a bad lead
    }
    expect(act({ score: null }).action).toBe("draft_outreach");
  });
  it("a reachable, researched, uncontacted lead gets a draft", () => {
    for (const status of ["new", "researching", "qualified"]) expect(act({ status }).action, status).toBe("draft_outreach");
  });
  it("the low-score reason quotes the real numbers", () => {
    expect(act({ score: { total: 10, knownMax: 80, confidence: "high" } }).reason).toBe("It scores 10 of 80 on what is known, which is low.");
  });
});

describe("every answer is complete", () => {
  it("has an action, a label and a reason, for a sweep of states", () => {
    const statuses = ["new", "researching", "qualified", "contacted", "replied", "meeting", "proposal", "won", "lost", "odd"];
    for (const status of statuses) for (const researched of [true, false]) for (const pendingMessage of ["draft", "approved", null] as const) for (const hasContactEmail of [true, false]) {
      const r = act({ status, researched, pendingMessage, hasContactEmail, daysSinceContact: 4 });
      expect(r.action && r.label && r.reason, `${status}/${researched}/${pendingMessage}/${hasContactEmail}`).toBeTruthy();
    }
  });
});
