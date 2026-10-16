import { describe, expect, it } from "vitest";
import {
  SUMMARY_ORDER, claimProvenance, duplicateLead, isPastDue, leadSource, listCoverage, lostFromEvents, pipelineSummary, rowNext, stageProgress,
} from "./lead-view";
import { LEAD_SOURCES, LEAD_STATUSES } from "./leads";

describe("leadSource", () => {
  it("names every real source in words", () => {
    expect(leadSource("outbound").label).toBe("AI Outbound");
    expect(leadSource("import").label).toBe("Imported");
    expect(leadSource("manual", { mine: true }).label).toBe("Added by you");
    expect(leadSource("agent").label).toBe("Added by the agent");
    for (const s of LEAD_SOURCES) expect(leadSource(s).key).toBe(s);
  });

  it("only says 'you' when the viewer added it", () => {
    expect(leadSource("manual", { mine: false }).label).toBe("Added by a teammate");
    expect(leadSource("manual").label).toBe("Added by hand");
  });

  it("says where an outbound lead came from without claiming when it was found", () => {
    expect(leadSource("outbound").origin).toBe("Found by AI Outbound, added");
    expect(leadSource("import").origin).toBe("Imported");
  });

  it("falls back for an unknown or missing source", () => {
    expect(leadSource("zapier")).toEqual({ key: "other", label: "Added", origin: "Added" });
    expect(leadSource(null).key).toBe("other");
  });
});

describe("pipelineSummary", () => {
  it("has one segment per stage, funnel order, ends last", () => {
    const p = pipelineSummary({});
    expect(p.segments.map((s) => s.status)).toEqual([...SUMMARY_ORDER]);
    expect([...SUMMARY_ORDER].sort()).toEqual([...LEAD_STATUSES].sort());
    expect(p.segments.at(-2)!.status).toBe("won");
    expect(p.segments.at(-1)!.status).toBe("lost");
    expect(p.total).toBe(0);
    expect(p.segments.every((s) => s.share === 0)).toBe(true);
  });

  it("counts open, won and lost from the server's counts", () => {
    const p = pipelineSummary({ new: 3, qualified: 2, proposal: 1, won: 4, lost: 2 });
    expect(p.total).toBe(12);
    expect(p.open).toBe(6);
    expect(p.won).toBe(4);
    expect(p.lost).toBe(2);
    expect(p.segments.find((s) => s.status === "new")).toMatchObject({ label: "New", count: 3, open: true, share: 0.25 });
    expect(p.segments.find((s) => s.status === "won")!.open).toBe(false);
    expect(p.segments.find((s) => s.status === "meeting")!.count).toBe(0);
  });

  it("ignores unknown keys and junk values", () => {
    const p = pipelineSummary({ new: 2, archived: 9, bogus: 5, replied: -3, meeting: Number.NaN, contacted: 1.7 } as Record<string, number>);
    expect(p.total).toBe(3);
    expect(p.segments.find((s) => s.status === "replied")!.count).toBe(0);
    expect(p.segments.find((s) => s.status === "contacted")!.count).toBe(1);
  });

  it("handles a missing counts object", () => {
    expect(pipelineSummary(undefined).total).toBe(0);
    expect(pipelineSummary(null).segments).toHaveLength(9);
  });
});

describe("listCoverage", () => {
  it("is silent when every matching lead is shown", () => {
    expect(listCoverage(12, 12)).toEqual({ capped: false, note: null });
    expect(listCoverage(0, 0)).toEqual({ capped: false, note: null });
  });
  it("says how many are held back when the page is capped", () => {
    const c = listCoverage(100, 240);
    expect(c.capped).toBe(true);
    expect(c.note).toContain("100");
    expect(c.note).toContain("240");
  });
});

describe("rowNext", () => {
  const NOW = new Date(2026, 9, 16, 12, 0, 0); // local noon, 16 Oct 2026
  const base = { status: "contacted", updatedAt: "2026-10-10T09:00:00.000Z", nextTicket: null };

  it("a won or lost lead has no next, whatever ticket is left open", () => {
    expect(rowNext({ ...base, status: "won", nextTicket: { title: "Call", dueAt: "2026-10-01" } }, NOW)).toEqual({ kind: "closed", label: "Won" });
    expect(rowNext({ ...base, status: "lost" }, NOW)).toEqual({ kind: "closed", label: "Closed" });
  });

  it("shows the open next step and whether it is overdue", () => {
    expect(rowNext({ ...base, nextTicket: { title: "Send proposal", dueAt: new Date(2026, 9, 14).toISOString() } }, NOW))
      .toMatchObject({ kind: "step", title: "Send proposal", overdue: true });
    expect(rowNext({ ...base, nextTicket: { title: "Call", dueAt: new Date(2026, 9, 16, 8).toISOString() } }, NOW))
      .toMatchObject({ kind: "step", overdue: false });
    expect(rowNext({ ...base, nextTicket: { title: "Research", dueAt: null } }, NOW)).toEqual({ kind: "step", title: "Research", due: null, overdue: false });
  });

  it("with no next step, falls back to the last activity", () => {
    expect(rowNext(base, NOW)).toEqual({ kind: "idle", lastActivity: base.updatedAt });
  });
});

describe("isPastDue", () => {
  const NOW = new Date(2026, 9, 16, 12, 0, 0);
  it("is not late on the day it is due", () => {
    expect(isPastDue(new Date(2026, 9, 16, 0, 0).toISOString(), NOW)).toBe(false);
    expect(isPastDue(new Date(2026, 9, 15, 23, 0).toISOString(), NOW)).toBe(true);
  });
  it("is never late without a usable date", () => {
    expect(isPastDue(null, NOW)).toBe(false);
    expect(isPastDue("not a date", NOW)).toBe(false);
  });
});

describe("stageProgress", () => {
  it("an open lead: earlier stages done, later ones upcoming, Won at the end", () => {
    const p = stageProgress("contacted");
    expect(p.steps.map((s) => s.status)).toEqual(["new", "researching", "qualified", "contacted", "replied", "meeting", "proposal", "won"]);
    expect(p.steps.map((s) => s.state)).toEqual(["done", "done", "done", "current", "upcoming", "upcoming", "upcoming", "upcoming"]);
    expect(p.position).toBe(4);
    expect(p.closed).toBeNull();
    expect(p.steps.filter((s) => s.state === "current")).toHaveLength(1);
  });

  it("a new lead starts at step 1", () => {
    const p = stageProgress("new");
    expect(p.position).toBe(1);
    expect(p.steps[0].state).toBe("current");
  });

  it("a won lead has every step done and Won current", () => {
    const p = stageProgress("won");
    expect(p.closed).toBe("won");
    expect(p.position).toBe(8);
    expect(p.steps.slice(0, 7).every((s) => s.state === "done")).toBe(true);
    expect(p.steps[7]).toMatchObject({ status: "won", state: "current" });
  });

  it("a lost lead ends in Lost, done up to the stage it was lost from", () => {
    const p = stageProgress("lost", "replied");
    expect(p.closed).toBe("lost");
    expect(p.steps.at(-1)).toMatchObject({ status: "lost", label: "Lost", state: "current" });
    expect(p.steps.some((s) => s.status === "won")).toBe(false);
    expect(p.steps.map((s) => s.state)).toEqual(["done", "done", "done", "done", "done", "not_reached", "not_reached", "current"]);
  });

  it("a lost lead with no known stage claims nothing was reached", () => {
    const p = stageProgress("lost");
    expect(p.steps.slice(0, 7).every((s) => s.state === "not_reached")).toBe(true);
    expect(stageProgress("lost", "won").steps.slice(0, 7).every((s) => s.state === "not_reached")).toBe(true);
  });

  it("an unknown status is shown as New rather than breaking", () => {
    expect(stageProgress("weird").position).toBe(1);
  });
});

describe("lostFromEvents", () => {
  it("reads the stage from the latest move to lost", () => {
    expect(lostFromEvents([
      { id: 9, kind: "status_changed", data: { from: "lost", to: "new" } },
      { id: 7, kind: "status_changed", data: { from: "meeting", to: "lost" } },
      { id: 3, kind: "status_changed", data: { from: "new", to: "lost" } },
      { id: 2, kind: "note", data: { text: "hi" } },
    ])).toBe("meeting");
  });
  it("is null when there is no such move", () => {
    expect(lostFromEvents([])).toBeNull();
    expect(lostFromEvents([{ id: 1, kind: "status_changed", data: { from: "new", to: "qualified" } }])).toBeNull();
    expect(lostFromEvents([{ id: 1, kind: "status_changed", data: null }])).toBeNull();
  });
});

describe("claimProvenance", () => {
  it("names who recorded it and the page it came from", () => {
    expect(claimProvenance({ source: "agent", evidenceUrl: "https://www.acme.com/about/" }))
      .toEqual({ by: "Recorded by AI", site: "acme.com/about", href: "https://www.acme.com/about/" });
    expect(claimProvenance({ source: "user", evidenceUrl: "https://acme.com/" }).site).toBe("acme.com");
    expect(claimProvenance({ source: "user", evidenceUrl: null }).by).toBe("Recorded by your team");
  });
  it("never links anything that is not http(s)", () => {
    expect(claimProvenance({ source: "agent", evidenceUrl: "javascript:alert(1)" })).toMatchObject({ site: null, href: null });
    expect(claimProvenance({ source: "agent", evidenceUrl: "acme.com" })).toMatchObject({ site: null, href: null });
  });
});

describe("duplicateLead", () => {
  const body = (o: unknown) => new Error(`409: ${JSON.stringify(o)}`);
  it("reads the server's duplicate answer", () => {
    expect(duplicateLead(body({ code: "duplicate", error: "You already have a lead for Acme.", existingId: 42 })))
      .toEqual({ existingId: 42, message: "You already have a lead for Acme." });
  });
  it("is null for anything else", () => {
    expect(duplicateLead(body({ code: "invalid", error: "x" }))).toBeNull();
    expect(duplicateLead(body({ code: "duplicate", error: "x" }))).toBeNull();
    expect(duplicateLead(body({ code: "duplicate", existingId: "42" }))).toBeNull();
    expect(duplicateLead(body({ code: "duplicate", existingId: 0 }))).toBeNull();
    expect(duplicateLead(new Error(`400: ${JSON.stringify({ code: "duplicate", existingId: 4 })}`))).toBeNull();
    expect(duplicateLead(new Error("409: not json"))).toBeNull();
    expect(duplicateLead(new Error("Failed to fetch"))).toBeNull();
    expect(duplicateLead(undefined)).toBeNull();
  });
  it("supplies a message when the server sent none", () => {
    expect(duplicateLead(body({ code: "duplicate", existingId: 5 }))!.message).toMatch(/already/);
  });
});
