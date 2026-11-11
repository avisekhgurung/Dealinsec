/**
 * Sending account emails: a send counts only when the email service accepted it. The service's library never throws,
 * so each way it can say no is pinned here, together with what the log may and may not carry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();
vi.mock("resend", () => ({ Resend: class { emails = { send }; } }));

import { resetEmailClientForTests, sendEmail, sendProblem } from "./emails";

const MAIL = { to: "Priya.Sharma@Example-Client.in", subject: "Reset your password, Priya", html: "<p>secret link</p>" };
let lines: string[] = [];
let log: ReturnType<typeof vi.spyOn>;
const KEY = process.env.RESEND_API_KEY;

beforeEach(() => {
  lines = [];
  log = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { lines.push(a.map(String).join(" ")); });
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { lines.push(a.map(String).join(" ")); });
  vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => { lines.push(a.map(String).join(" ")); });
  send.mockReset();
  process.env.RESEND_API_KEY = "local-test-key-not-real";
  resetEmailClientForTests();
});
afterEach(() => { vi.restoreAllMocks(); if (KEY === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = KEY; });

describe("what the email service answered", () => {
  it("an id back and no error is a send", () => {
    expect(sendProblem({ data: { id: "abc" }, error: null, headers: {} })).toBeNull();
  });

  it("a refusal carries the service's reason code and status", () => {
    expect(sendProblem({ data: null, error: { name: "invalid_api_key", statusCode: 403, message: "API key is invalid" } })).toEqual({ reason: "invalid_api_key", status: 403 });
    expect(sendProblem({ data: null, error: { name: "rate_limit_exceeded", statusCode: 429, message: "Too many requests" } })).toEqual({ reason: "rate_limit_exceeded", status: 429 });
    // No connection at all: the library still answers with a value, and no status.
    expect(sendProblem({ data: null, error: { name: "application_error", statusCode: null, message: "Unable to fetch data." }, headers: null })).toEqual({ reason: "application_error", status: null });
  });

  it("a reason that isn't a short code is never repeated, and an empty answer is not a send", () => {
    expect(sendProblem({ data: null, error: { name: "You can only send to owner@example.com", statusCode: 403 } })).toEqual({ reason: "unknown_error", status: 403 });
    expect(sendProblem({ data: null, error: "nope" })).toEqual({ reason: "unknown_error", status: null });
    expect(sendProblem({ data: null, error: null })).toEqual({ reason: "no_answer", status: null });
    expect(sendProblem(undefined)).toEqual({ reason: "no_answer", status: null });
  });
});

describe("sending an email", () => {
  it("answers true when the service accepted it, and writes nothing to the log", async () => {
    send.mockResolvedValue({ data: { id: "abc" }, error: null });
    expect(await sendEmail(MAIL)).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ to: MAIL.to, subject: MAIL.subject, html: MAIL.html });
    expect(lines).toEqual([]);
  });

  it("answers false when the service refused it, though nothing was thrown", async () => {
    send.mockResolvedValue({ data: null, error: { name: "validation_error", statusCode: 403, message: "The example-client.in domain is not verified. Sent to Priya.Sharma@Example-Client.in" } });
    expect(await sendEmail(MAIL)).toBe(false);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual({ kind: "email_send_failed", reason: "validation_error", status: 403, toDomain: "example-client.in" });
  });

  it("answers false when the library throws, and never throws itself", async () => {
    send.mockRejectedValue(new Error("socket hang up while sending to Priya.Sharma@Example-Client.in"));
    expect(await sendEmail(MAIL)).toBe(false);
    expect(JSON.parse(lines[0])).toEqual({ kind: "email_send_failed", reason: "threw", status: null, toDomain: "example-client.in" });
  });

  it("the log never carries the person's address, the subject, the text or the service's message", async () => {
    send.mockResolvedValue({ data: null, error: { name: "validation_error", statusCode: 422, message: "Invalid `to` field: Priya.Sharma@Example-Client.in" } });
    await sendEmail(MAIL);
    send.mockRejectedValue(new Error("Priya.Sharma@Example-Client.in"));
    await sendEmail(MAIL);
    const all = lines.join("\n");
    for (const secret of ["Priya", "priya", "Reset your password", "secret link", "Invalid", "local-test-key"]) expect(all).not.toContain(secret);
  });

  it("without a key nothing is attempted, and the log says so without naming anyone", async () => {
    delete process.env.RESEND_API_KEY;
    expect(await sendEmail(MAIL)).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(JSON.parse(lines[0])).toEqual({ kind: "email_skipped", reason: "no_key", status: null, toDomain: "example-client.in" });
  });

  it("with no address there is nothing to send and nothing to log", async () => {
    expect(await sendEmail({ ...MAIL, to: "" })).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(lines).toEqual([]);
  });
});
