/**
 * What Zee does while the deal suite is hidden (DEAL_SUITE_HIDDEN, shared/flags.ts).
 *
 * The money half of the briefing is not merely empty — it must not be READ. Four of Zee's five sources can only
 * ever return nothing with the suite hidden, so reading them costs four database round-trips to report nothing,
 * and any item they produced would link to a page the product no longer shows. The find-clients half, follow-ups
 * and outreach drafts, must be completely unaffected: it is what Zee is for now.
 *
 * tasks.test.ts holds the mirror of this, with the flag pinned off. Both files pin the flag explicitly, so neither
 * changes meaning if the founder flips the real one.
 */
import { describe, expect, it, vi } from "vitest";
import type { LeagueRunRow } from "@shared/schema";
import { zeeTask, type ZeeDeps } from "./zee";
import type { StepOutcome, TaskCtx } from "./types";

// shared/flags.ts exports exactly one constant; a vi.mock replaces the whole module, so this must cover all of it.
vi.mock("@shared/flags", () => ({ DEAL_SUITE_HIDDEN: true }));

const NOW = new Date("2026-10-18T10:00:00Z");
const finish = (o: StepOutcome) => { if (o.kind !== "finish") throw new Error(`expected finish, got ${o.kind}`); return o; };

function ctx() {
  const events: { kind: string; message: string }[] = [];
  const c: TaskCtx = {
    run: { id: "lr_test", organizationId: "org-1", userId: "u1", bot: "zee", task: "zee.briefing", input: {}, status: "running", stage: "start", checkpoint: {} } as unknown as LeagueRunRow,
    user: { id: "u1", organizationId: "org-1", orgRole: "OWNER" } as any,
    checkpoint: {}, now: () => NOW,
    event: async (kind: string, message: string) => { events.push({ kind, message }); },
    addUsage: () => {},
  } as unknown as TaskCtx;
  return { c, events };
}

/** `briefing` throws: with the suite hidden nothing may call it, so a call fails the test rather than passing quietly. */
function zee(over: Partial<ZeeDeps> = {}) {
  return zeeTask({
    briefing: async () => { throw new Error("briefing() must not be read while the deal suite is hidden"); },
    followUps: async () => ({ ok: true, today: "2026-10-18", overdue: [], dueToday: [] }),
    waitingDrafts: async () => ({ ok: true, items: [] }),
    locale: async () => ({ currency: "INR", locale: "en-IN" }),
    ...over,
  });
}

describe("Zee while the deal suite is hidden", () => {
  it("never reads invoices, deals or agreements", async () => {
    const out = finish(await zee().step(ctx().c, ""));
    expect(out.status).toBe("completed");
    expect(out.report.items).toEqual([]);
  });

  it("reports only the counts that can have a value, so no dead row is shown", async () => {
    const out = finish(await zee().step(ctx().c, ""));
    expect(out.report.counts.map((c) => c.label)).toEqual(["Follow-ups due", "Messages waiting"]);
  });

  it("says it read only what it read", async () => {
    const { c, events } = ctx();
    await zee().step(c, "");
    expect(events.find((e) => e.kind === "records_read")?.message).toBe("Read your follow-ups and outreach");
  });

  it("an empty day does not claim nothing is overdue, because it never looked", async () => {
    const out = finish(await zee().step(ctx().c, ""));
    expect(out.report.summary).toBe("All clear: no follow-up is due and no message is waiting for you.");
  });

  it("still reports follow-ups and messages waiting, with their links", async () => {
    const t = zee({
      followUps: async () => ({ ok: true, today: "2026-10-18", overdue: [{ id: 1, title: "Call back", due: "2026-10-16", leadId: 4, companyName: "Pearl" }], dueToday: [] }),
      waitingDrafts: async () => ({ ok: true, items: [{ message: { id: 7, status: "draft" }, lead: { id: 9, companyName: "Acme" } }] }),
    });
    const out = finish(await t.step(ctx().c, ""));
    expect(out.report.headline).toBe("2 things need you today");
    expect(out.report.items[0]).toMatchObject({ title: "Follow up: Pearl", href: "/leads/4", status: "needs_you" });
    expect(out.report.items[1]).toMatchObject({ title: "Message waiting for you: Acme", href: "/leads/9", status: "needs_you" });
    expect(out.report.summary).toBe("1 follow-up due · 1 message waiting for your approval");
    // Nothing in the briefing may point at a page the product no longer shows.
    expect(out.report.items.every((i) => !/^\/(deals|brand-invoices|invoices|quotes|agreements)\//.test(i.href ?? ""))).toBe(true);
  });
});
