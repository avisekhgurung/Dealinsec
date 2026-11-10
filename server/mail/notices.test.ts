/** The activity-log entries written by the mail jobs: a real user or none, never a placeholder the database refuses. */
import { describe, expect, it } from "vitest";
import { followupNotice, replyNotice } from "./notices";

describe("notices written with nobody at the keyboard", () => {
  it("a follow-up notice belongs to no user: 'Follow-ups' is who wrote it", () => {
    expect(followupNotice({ orgId: "org-a", leadId: 7, companyName: "Asha Organics" })).toEqual({
      organizationId: "org-a", userId: null, userName: "Follow-ups", action: "follow-up ready for review", entityType: "lead", entityId: "7", detail: "Asha Organics",
    });
  });
  it("a reply notice carries the person it is for when there is one, and nobody otherwise", () => {
    expect(replyNotice({ orgId: "org-a", leadId: 7, userId: "u-1", companyName: "Asha", what: "replied" })).toMatchObject({ userId: "u-1", userName: "Gmail", action: "replied to your outreach", entityId: "7" });
    for (const userId of [null, "", "  ", "system", undefined as any]) expect(replyNotice({ orgId: "org-a", leadId: 7, userId, companyName: "Asha", what: "review" }).userId, String(userId)).toBeNull();
  });
  it("says what happened in the person's words, for each kind of reply", () => {
    const action = (what: any) => replyNotice({ orgId: "o", leadId: 1, userId: null, companyName: "A", what }).action;
    expect([action("replied"), action("opted_out"), action("bounced"), action("review")]).toEqual(["replied to your outreach", "asked not to be contacted", "outreach bounced", "a reply needs your review"]);
  });
  it("no entry ever carries the old placeholder id, which the users foreign key refuses", () => {
    const all = [followupNotice({ orgId: "o", leadId: 1, companyName: "A" }), replyNotice({ orgId: "o", leadId: 1, userId: "system", companyName: "A", what: "bounced" })];
    expect(JSON.stringify(all)).not.toContain("system");
    // No message text, address or subject is part of a notice: only the company's name.
    expect(Object.keys(all[0]).sort()).toEqual(["action", "detail", "entityId", "entityType", "organizationId", "userId", "userName"]);
  });
});
