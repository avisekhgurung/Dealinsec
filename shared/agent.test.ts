import { describe, expect, it } from "vitest";
import { activityLabel, approvalStatusFromServer, approveLabel, reduceSteps, toolLabel, type ActivityStep } from "./agent";
import { createSseParser, type SseMessage } from "./sse";

const ev = (type: any, data: Record<string, unknown> = {}) => ({ type, data });
const fold = (events: ReturnType<typeof ev>[]) => events.reduce<ActivityStep[]>((s, e) => reduceSteps(s, e), []);

describe("progress labels come from real events", () => {
  it("names each kind of work in plain words", () => {
    expect(activityLabel(ev("agent.understanding"))).toBe("Understanding your request");
    expect(activityLabel(ev("agent.extracting"))).toBe("Reading the message");
    expect(activityLabel(ev("agent.searching", { tool: "search_invoices" }))).toBe("Looking up your invoices");
    expect(activityLabel(ev("agent.tool_progress", { message: "Running Protection Check…" }))).toBe("Running Protection Check…");
    expect(activityLabel(ev("agent.finding", { title: "No payment deadline" }))).toBe("Found: No payment deadline");
    expect(activityLabel(ev("agent.needs_confirmation"))).toBe("Ready for your approval");
  });
  it("a read's tool_started adds nothing (the 'searching' event already said it); a change does", () => {
    expect(activityLabel(ev("agent.tool_started", { tool: "get_deal", risk: "READ_ONLY" }))).toBeNull();
    expect(activityLabel(ev("agent.tool_started", { tool: "create_deal", risk: "SAFE_MUTATION" }))).toBe("Preparing the deal");
  });
  it("events that aren't steps have no label", () => {
    for (const t of ["agent.tool_completed", "agent.message", "agent.completed", "agent.failed"]) expect(activityLabel(ev(t))).toBeNull();
  });
  it("falls back gracefully for an unknown tool", () => {
    expect(toolLabel("brand_new_tool")).toBe("that");
    expect(approveLabel("brand_new_tool")).toBe("Approve");
    expect(approveLabel("mark_paid")).toBe("Record payment");
  });
});

describe("reduceSteps", () => {
  it("opens a step per labelled event and closes the one before it", () => {
    const steps = fold([ev("agent.started"), ev("agent.understanding"), ev("agent.extracting"), ev("agent.tool_progress", { message: "Running Protection Check…" })]);
    expect(steps.map((s) => [s.label, s.state])).toEqual([
      ["Getting started", "done"], ["Understanding your request", "done"], ["Reading the message", "done"], ["Running Protection Check…", "active"],
    ]);
  });
  it("completing the run closes the open step", () => {
    const steps = fold([ev("agent.understanding"), ev("agent.message"), ev("agent.completed")]);
    expect(steps.every((s) => s.state === "done")).toBe(true);
  });
  it("a failed tool becomes a failed line and the run can go on", () => {
    const steps = fold([ev("agent.searching", { tool: "get_deal" }), ev("agent.tool_failed", { message: "not found" }), ev("agent.understanding")]);
    expect(steps.map((s) => s.state)).toEqual(["failed", "failed", "active"]);
  });
  it("a failed run marks the open step failed", () => {
    const steps = fold([ev("agent.understanding"), ev("agent.failed")]);
    expect(steps[0].state).toBe("failed");
  });
  it("two reads of the same kind in a row are one step", () => {
    const steps = fold([ev("agent.searching", { tool: "search_deals" }), ev("agent.searching", { tool: "search_deals" })]);
    expect(steps).toHaveLength(1);
  });
  it("ids stay unique and increase", () => {
    const steps = fold([ev("agent.started"), ev("agent.understanding"), ev("agent.extracting")]);
    expect(steps.map((s) => s.id)).toEqual([1, 2, 3]);
  });
});

describe("approvalStatusFromServer", () => {
  const future = new Date(Date.now() + 60_000), past = new Date(Date.now() - 60_000);
  it("maps stored statuses to what the card shows", () => {
    expect(approvalStatusFromServer("executed")).toBe("done");
    expect(approvalStatusFromServer("rejected")).toBe("declined");
    expect(approvalStatusFromServer("approved")).toBe("executing");
    expect(approvalStatusFromServer("expired")).toBe("expired");
    expect(approvalStatusFromServer("pending", future)).toBe("pending");
    expect(approvalStatusFromServer("pending", past)).toBe("expired");
  });
});

describe("createSseParser", () => {
  const run = (chunks: string[], flush = false) => {
    const out: SseMessage[] = [];
    const p = createSseParser((m) => out.push(m));
    chunks.forEach((c) => p.push(c));
    if (flush) p.flush();
    return out;
  };
  it("parses events however the stream is chunked", () => {
    const text = 'event: agent.started\ndata: {"a":1}\n\nevent: agent.message\ndata: {"b":2}\n\n';
    for (const size of [1, 3, 7, 1000]) {
      const chunks = text.match(new RegExp(`[\\s\\S]{1,${size}}`, "g")) ?? [];
      expect(run(chunks), `chunk size ${size}`).toEqual([{ event: "agent.started", data: '{"a":1}' }, { event: "agent.message", data: '{"b":2}' }]);
    }
  });
  it("ignores keep-alive comments and handles CRLF", () => {
    expect(run([": keep-alive\n\nevent: x\r\ndata: 1\r\n\r\n"])).toEqual([{ event: "x", data: "1" }]);
  });
  it("joins multi-line data", () => {
    expect(run(["data: a\ndata: b\n\n"])).toEqual([{ event: "message", data: "a\nb" }]);
  });
  it("a trailing event with no blank line is delivered on flush, and never before", () => {
    expect(run(["event: x\ndata: 1"])).toEqual([]);
    expect(run(["event: x\ndata: 1"], true)).toEqual([{ event: "x", data: "1" }]);
  });
});
