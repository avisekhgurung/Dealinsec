import { describe, expect, it } from "vitest";
import { BOTS, BOT_IDENTITY, LEAGUE_LIMITS, TASK_INPUT, isTerminal, nextRunAt, scheduleInput, validTimeZone, zonedInstant } from "./ai-league";

describe("schedules in the person's timezone", () => {
  it("a daily 09:00 in India is 03:30 UTC, the next one strictly after now", () => {
    const s = { frequency: "daily" as const, timeOfDay: "09:00", weekday: null, timezone: "Asia/Kolkata" };
    expect(nextRunAt(s, new Date("2026-10-18T02:00:00Z")).toISOString()).toBe("2026-10-18T03:30:00.000Z"); // 07:30 IST → today 09:00
    expect(nextRunAt(s, new Date("2026-10-18T03:30:00Z")).toISOString()).toBe("2026-10-19T03:30:00.000Z"); // exactly at it → tomorrow
    expect(nextRunAt(s, new Date("2026-10-18T05:00:00Z")).toISOString()).toBe("2026-10-19T03:30:00.000Z");
  });

  it("weekdays skip Saturday and Sunday in the local calendar; weekly keeps its day", () => {
    const fri = new Date("2026-10-23T06:00:00Z"); // Friday afternoon in India
    expect(nextRunAt({ frequency: "weekdays", timeOfDay: "09:00", weekday: null, timezone: "Asia/Kolkata" }, fri).toISOString()).toBe("2026-10-26T03:30:00.000Z"); // Monday
    expect(nextRunAt({ frequency: "weekly", timeOfDay: "10:15", weekday: 3, timezone: "Asia/Kolkata" }, fri).toISOString()).toBe("2026-10-28T04:45:00.000Z"); // Wednesday
  });

  it("keeps the local time across a daylight-saving change (New York, 1 Nov 2026)", () => {
    const s = { frequency: "daily" as const, timeOfDay: "08:00", weekday: null, timezone: "America/New_York" };
    expect(nextRunAt(s, new Date("2026-10-31T13:00:00Z")).toISOString()).toBe("2026-11-01T13:00:00.000Z"); // EST after the change
    expect(nextRunAt(s, new Date("2026-10-30T11:00:00Z")).toISOString()).toBe("2026-10-30T12:00:00.000Z"); // EDT before it
    expect(zonedInstant(2026, 7, 1, 8, 0, "America/New_York").toISOString()).toBe("2026-07-01T12:00:00.000Z");
  });

  it("validates the schedule form and the timezone", () => {
    expect(scheduleInput.safeParse({ task: "zee.briefing", frequency: "weekdays", timeOfDay: "09:00", timezone: "Asia/Kolkata" }).success).toBe(true);
    for (const bad of [{ task: "zee.briefing", frequency: "hourly", timeOfDay: "09:00", timezone: "UTC" }, { task: "zee.briefing", frequency: "daily", timeOfDay: "25:00", timezone: "UTC" }, { task: "send.email", frequency: "daily", timeOfDay: "09:00", timezone: "UTC" }])
      expect(scheduleInput.safeParse(bad).success).toBe(false);
    expect(validTimeZone("Asia/Kolkata")).toBe(true);
    expect(validTimeZone("Mars/Base")).toBe(false);
  });
});

describe("tasks: the server's bounds, whatever is asked", () => {
  it("Nibo saves at most 5 leads a run and needs a real request; Mika drafts at most 5; Zee takes nothing", () => {
    expect(TASK_INPUT["nibo.find_clients"].safeParse({ request: "dentists in Siliguri", maxLeads: 50 }).success).toBe(false);
    expect(TASK_INPUT["nibo.find_clients"].parse({ request: "10 dentists in Siliguri" })).toEqual({ request: "10 dentists in Siliguri", saveLeads: true, maxLeads: 3 });
    expect(TASK_INPUT["nibo.find_clients"].safeParse({ request: "x" }).success).toBe(false);
    expect(TASK_INPUT["nibo.find_clients"].safeParse({ request: "10 dentists in Siliguri", sendEmails: true }).success).toBe(false); // strict: no smuggled options
    expect(TASK_INPUT["mika.first_messages"].safeParse({ max: 9 }).success).toBe(false);
    expect(TASK_INPUT["mika.first_messages"].safeParse({ leadIds: [1, 2, 3, 4, 5, 6] }).success).toBe(false);
    expect(TASK_INPUT["zee.briefing"].safeParse({ anything: 1 }).success).toBe(false);
    expect(LEAGUE_LIMITS).toEqual({ leadsPerRun: 5, draftsPerRun: 5, requestChars: 500, huddleRounds: 2, consultsPerReply: 2 });
  });

  it("three distinct coworkers; terminal states are terminal", () => {
    expect(BOTS.map((b) => BOT_IDENTITY[b].name)).toEqual(["Nibo", "Mika", "Zee"]);
    expect(new Set(BOTS.map((b) => BOT_IDENTITY[b].accent.bg)).size).toBe(3);
    for (const s of ["completed", "partial", "failed", "cancelled"]) expect(isTerminal(s)).toBe(true);
    for (const s of ["queued", "running", "waiting"]) expect(isTerminal(s)).toBe(false);
  });
});
