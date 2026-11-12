/** Campaigns, the pure half: the footer, what may be saved, what a refusal means, pacing, and the numbers. */
import { describe, expect, it } from "vitest";
import {
  addMembersSchema, CAMPAIGN_MAX_MEMBERS, campaignCreateSchema, campaignRates, campaignUpdateSchema, countMembers, DAILY_LIMIT, draftRefusal, GAP_SECONDS, hasOptOutLine,
  memberStage, memberSteps, type MemberStage, OPT_OUT_LINE, reasonLabel, stopLabel, withFooter,
} from "./campaign";
import { LIMITS, checkStructure } from "./outreach-check";

describe("the footer", () => {
  it("is added once, after the message, with the person's own note above the opt-out line", () => {
    const out = withFooter("Hi Asha,\n\nSaw your new store.\n\nRavi", "Ravi Kumar, Pixel Studio, Pune");
    expect(out).toBe(`Hi Asha,\n\nSaw your new store.\n\nRavi\n\nRavi Kumar, Pixel Studio, Pune\n${OPT_OUT_LINE}`);
    expect(withFooter(out, "Ravi Kumar, Pixel Studio, Pune")).toBe(out);
    expect(withFooter(out, "something else")).toBe(out); // already carries the line: never a second footer
    expect(withFooter("Hello there", "")).toBe(`Hello there\n\n${OPT_OUT_LINE}`);
    expect(withFooter("Hello there", null)).toBe(`Hello there\n\n${OPT_OUT_LINE}`);
  });
  it("is recognised whatever the line breaks, and missed when a word of it is gone", () => {
    expect(hasOptOutLine(`Hi\n\n${OPT_OUT_LINE}`)).toBe(true);
    expect(hasOptOutLine(`Hi\r\n\r\n${OPT_OUT_LINE.replace("just tell me", "just\n tell   me")}`)).toBe(true);
    expect(hasOptOutLine("Hi\n\nIf this isn't relevant, just tell me.")).toBe(false);
    expect(hasOptOutLine("")).toBe(false);
    expect(hasOptOutLine(null)).toBe(false);
  });
  it("leaves a message the ordinary checks still accept: plain text, no link, no address, no placeholder", () => {
    const body = withFooter("Hi Asha, I noticed your store launched a new range last month and wanted to say hello.", "Pixel Studio, Pune");
    expect(checkStructure({ subject: "Your new range", body })).toEqual([]);
    expect(OPT_OUT_LINE.length).toBeLessThan(LIMITS.bodyMax / 10);
  });
});

describe("what may be saved", () => {
  const ok = { name: "  Diwali   outreach ", leadIds: [3, 1, 3] };
  it("a campaign needs a name and at least one lead; the rest has safe defaults", () => {
    expect(campaignCreateSchema.parse(ok)).toEqual({ name: "Diwali outreach", leadIds: [3, 1], profileId: null, dailyLimit: DAILY_LIMIT.default, gapSeconds: GAP_SECONDS.default, footerNote: "" });
    expect(campaignCreateSchema.safeParse({ ...ok, name: " " }).success).toBe(false);
    expect(campaignCreateSchema.safeParse({ ...ok, leadIds: [] }).success).toBe(false);
    expect(campaignCreateSchema.safeParse({ ...ok, leadIds: [0] }).success).toBe(false);
    expect(campaignCreateSchema.safeParse({ ...ok, leadIds: Array.from({ length: CAMPAIGN_MAX_MEMBERS + 1 }, (_, i) => i + 1) }).success).toBe(false);
  });
  it("the pace stays inside its limits: nobody can ask for 500 a day or one a second", () => {
    for (const bad of [{ dailyLimit: 0 }, { dailyLimit: DAILY_LIMIT.max + 1 }, { gapSeconds: GAP_SECONDS.min - 1 }, { gapSeconds: GAP_SECONDS.max + 1 }, { dailyLimit: 2.5 }]) {
      expect(campaignCreateSchema.safeParse({ ...ok, ...bad }).success, JSON.stringify(bad)).toBe(false);
      expect(campaignUpdateSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    expect(campaignUpdateSchema.parse({ dailyLimit: DAILY_LIMIT.max, gapSeconds: GAP_SECONDS.min })).toEqual({ dailyLimit: DAILY_LIMIT.max, gapSeconds: GAP_SECONDS.min });
  });
  it("the footer note is short plain text: no link and no email address can ride on every message", () => {
    expect(campaignCreateSchema.parse({ ...ok, footerNote: " Pixel  Studio, Pune " }).footerNote).toBe("Pixel Studio, Pune");
    for (const bad of ["see https://x.example", "www.x.example", "write to me@x.example", "x".repeat(201)]) expect(campaignCreateSchema.safeParse({ ...ok, footerNote: bad }).success, bad).toBe(false);
  });
  it("an update takes only the fields it knows", () => {
    expect(campaignUpdateSchema.safeParse({ sending: true }).success).toBe(false);
    expect(campaignUpdateSchema.safeParse({ status: "archived" }).success).toBe(false);
    expect(addMembersSchema.safeParse({ leadIds: [1], campaignId: 9 }).success).toBe(false);
    expect(addMembersSchema.parse({ leadIds: [2, 2, 5] })).toEqual({ leadIds: [2, 5] });
  });
});

describe("where a lead stands", () => {
  it("follows the member until a draft exists, then the message itself", () => {
    expect(memberStage({ state: "queued", messageStatus: null })).toBe("queued");
    expect(memberStage({ state: "skipped", messageStatus: null })).toBe("skipped");
    expect(memberStage({ state: "failed", messageStatus: null })).toBe("failed");
    for (const [status, stage] of [["draft", "draft"], ["approved", "approved"], ["sending", "sending"], ["sent", "sent"], ["cancelled", "discarded"], [null, "discarded"]] as const)
      expect(memberStage({ state: "drafted", messageStatus: status }), String(status)).toBe(stage);
  });
  it("every reason and every stop has words a person can read", () => {
    for (const code of ["no_address", "no_facts", "do_not_contact", "suppressed", "already_contacted", "closed", "draft_rejected", "footer_too_long", "no_opt_out_line", "changed"]) expect(reasonLabel(code)).toBeTruthy();
    for (const code of ["draft_allowance", "daily_limit", "global_limit", "workspace_budget", "mailbox_reconnect", "daily_cap", "plan_send_limit", "uncertain", "send_failed", "bounce_rate", "queue_off", "done"]) expect(stopLabel(code)).toBeTruthy();
    expect(reasonLabel(null)).toBeNull();
    expect(stopLabel(undefined)).toBeNull();
    expect(reasonLabel("something_new")).toBe("Needs a look"); // an unknown code is never shown raw
  });
});

describe("what a refusal means", () => {
  it("drafting: an allowance stops the job, a lead that can't be written to is skipped, an outage is tried again", () => {
    for (const c of ["draft_allowance", "NO_CREDITS", "daily_limit", "global_limit", "workspace_budget"]) expect(draftRefusal(c), c).toBe("stop");
    for (const c of ["no_address", "no_facts", "do_not_contact", "suppressed", "already_contacted", "closed", "draft_rejected", "not_found", "forbidden"]) expect(draftRefusal(c), c).toBe("skip");
    expect(draftRefusal("model_unavailable")).toBe("retry");
    expect(draftRefusal("draft_exists")).toBe("adopt");
  });
});

describe("the numbers", () => {
  it("are counted from the members, and outcomes only from messages that were sent", () => {
    const c = countMembers([
      { state: "queued", messageStatus: null, outcomes: [] },
      { state: "skipped", messageStatus: null, outcomes: [] },
      { state: "failed", messageStatus: null, outcomes: [] },
      { state: "drafted", messageStatus: "draft", outcomes: [] },
      { state: "drafted", messageStatus: "approved", outcomes: [] },
      { state: "drafted", messageStatus: "cancelled", outcomes: ["replied"] }, // not sent: an outcome here is not counted
      { state: "drafted", messageStatus: "sent", outcomes: ["replied"], interested: true },
      { state: "drafted", messageStatus: "sent", outcomes: ["bounced"] },
      { state: "drafted", messageStatus: "sent", outcomes: ["replied", "opted_out"] },
      { state: "drafted", messageStatus: "sent", outcomes: [] },
    ]);
    expect(c).toEqual({ members: 10, queued: 1, skipped: 1, failed: 1, draft: 1, approved: 1, sending: 0, sent: 4, discarded: 1, replied: 2, interested: 1, bounced: 1, optedOut: 1 });
    expect(campaignRates(c)).toEqual({ reply: 50, bounce: 25, optOut: 25 });
  });
  it("a rate is unknown, not zero, while nothing has been sent", () => {
    expect(campaignRates({ sent: 0, replied: 0, bounced: 0, optedOut: 0 })).toEqual({ reply: null, bounce: null, optOut: null });
    expect(campaignRates({ sent: 3, replied: 1, bounced: 0, optedOut: 0 })).toEqual({ reply: 33.3, bounce: 0, optOut: 0 });
  });
});

describe("working through a campaign one lead after another", () => {
  const m = (leadId: number, stage: MemberStage) => ({ leadId, stage });
  const list = [m(1, "sent"), m(2, "draft"), m(3, "approved"), m(4, "draft"), m(5, "skipped"), m(6, "approved")];

  it("knows where the open lead sits and its neighbours, without wrapping", () => {
    expect(memberSteps(list, 3)).toMatchObject({ position: 3, total: 6, previous: { leadId: 2 }, next: { leadId: 4 } });
    expect(memberSteps(list, 1)).toMatchObject({ position: 1, previous: null, next: { leadId: 2 } });
    expect(memberSteps(list, 6)).toMatchObject({ position: 6, previous: { leadId: 5 }, next: null });
  });
  it("the next draft to read is the next one AFTER the open lead, wrapping round, and never the open lead itself", () => {
    expect(memberSteps(list, 1)).toMatchObject({ nextToReview: { leadId: 2 }, toReview: 2 });
    expect(memberSteps(list, 2)).toMatchObject({ nextToReview: { leadId: 4 }, toReview: 1 });
    expect(memberSteps(list, 4)).toMatchObject({ nextToReview: { leadId: 2 }, toReview: 1 }); // wrapped
    expect(memberSteps(list, 5)).toMatchObject({ nextToReview: { leadId: 2 }, toReview: 2 });
  });
  it("the next message to send by hand works the same way, over approved messages only", () => {
    expect(memberSteps(list, 3)).toMatchObject({ nextToSend: { leadId: 6 }, toSend: 1 });
    expect(memberSteps(list, 6)).toMatchObject({ nextToSend: { leadId: 3 }, toSend: 1 });
    expect(memberSteps(list, 4)).toMatchObject({ nextToSend: { leadId: 6 }, toSend: 2 });
  });
  it("when the open lead is the only one waiting, nothing else is offered", () => {
    const one = [m(1, "sent"), m(2, "draft"), m(3, "sent")];
    expect(memberSteps(one, 2)).toMatchObject({ nextToReview: null, toReview: 0, nextToSend: null, toSend: 0 });
  });
  it("with nothing open (the list itself), it names the first of each in the campaign's order", () => {
    expect(memberSteps(list, null)).toMatchObject({ position: 0, previous: null, next: null, nextToReview: { leadId: 2 }, toReview: 2, nextToSend: { leadId: 3 }, toSend: 2 });
    // A lead that has since been taken out of the campaign is treated the same way.
    expect(memberSteps(list, 99)).toMatchObject({ position: 0, nextToReview: { leadId: 2 }, toReview: 2 });
    expect(memberSteps([], null)).toEqual({ position: 0, total: 0, previous: null, next: null, nextToReview: null, toReview: 0, nextToSend: null, toSend: 0 });
  });
});
