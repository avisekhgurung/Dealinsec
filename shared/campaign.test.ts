/** Campaigns, the pure half: the footer, what may be saved, what a refusal means, pacing, and the numbers. */
import { describe, expect, it } from "vitest";
import {
  addMembersSchema, CAMPAIGN_MAX_MEMBERS, campaignCreateSchema, campaignRates, campaignUpdateSchema, countMembers, DAILY_LIMIT, draftRefusal, GAP_SECONDS, hasOptOutLine,
  memberStage, nextSendAt, OPT_OUT_LINE, reasonLabel, sendRefusal, stopLabel, tooManyBounces, withFooter,
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
  it("sending: a problem with one message holds that message; anything about the mailbox, a limit or the server pauses everything", () => {
    for (const c of ["changed", "not_approved", "in_flight", "invalid_content", "no_address", "do_not_contact", "suppressed", "followup_stopped", "not_found"]) expect(sendRefusal(c), c).toBe("hold");
    for (const c of ["mailbox_reconnect", "no_mailbox", "missing_send_scope", "not_allowed", "not_member", "daily_cap", "plan_send_limit", "unavailable", "sending_disabled", "outreach_not_setup", "a_code_from_the_future"]) expect(sendRefusal(c), c).toBe("pause");
    for (const c of ["provider_unavailable", "suppression_unavailable"]) expect(sendRefusal(c), c).toBe("later");
  });
});

describe("pacing", () => {
  const now = new Date("2026-11-10T10:00:00Z");
  it("the next send is the gap away, stretched by up to half again, never sooner", () => {
    expect(nextSendAt(now, 180, 0).getTime() - now.getTime()).toBe(180_000);
    expect(nextSendAt(now, 180, 1).getTime() - now.getTime()).toBe(270_000);
    expect(nextSendAt(now, 180, 0.5).getTime() - now.getTime()).toBe(225_000);
  });
  it("a gap outside the limits is brought inside them", () => {
    expect(nextSendAt(now, 1, 0).getTime() - now.getTime()).toBe(GAP_SECONDS.min * 1000);
    expect(nextSendAt(now, 999_999, 0).getTime() - now.getTime()).toBe(GAP_SECONDS.max * 1000);
    expect(nextSendAt(now, NaN, 0).getTime() - now.getTime()).toBe(GAP_SECONDS.default * 1000);
    expect(nextSendAt(now, 180, 7).getTime() - now.getTime()).toBe(270_000);
  });
  it("two bounces that are a tenth or more of what was sent stop the queue; one bounce, or two in thirty, do not", () => {
    expect(tooManyBounces({ sent: 3, bounced: 2 })).toBe(true);
    expect(tooManyBounces({ sent: 20, bounced: 2 })).toBe(true);
    expect(tooManyBounces({ sent: 30, bounced: 2 })).toBe(false);
    expect(tooManyBounces({ sent: 1, bounced: 1 })).toBe(false);
    expect(tooManyBounces({ sent: 0, bounced: 0 })).toBe(false);
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
