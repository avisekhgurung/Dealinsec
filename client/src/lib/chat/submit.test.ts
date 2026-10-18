import { describe, expect, it, vi } from "vitest";
import { createSubmitter } from "./submit";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("sending from the message box", () => {
  it("clears only once the message is accepted, not when Send is pressed", async () => {
    let accept!: () => void;
    const accepted = vi.fn(), pending = vi.fn();
    const s = createSubmitter((_t, a) => { accept = a; return new Promise(() => {}); }, { accepted, pending });
    expect(s.submit("  Find 5 dental clinics  ")).toBe(true);
    expect(accepted).not.toHaveBeenCalled(); // still in the box while the conversation is being reached
    expect(pending).toHaveBeenLastCalledWith(true);
    accept();
    expect(accepted).toHaveBeenCalledWith("Find 5 dental clinics");
    expect(pending).toHaveBeenLastCalledWith(false);
  });

  it("a second Enter while the first is on its way is ignored (no duplicate message)", async () => {
    const send = vi.fn(() => new Promise(() => {}));
    const s = createSubmitter(send, { accepted: vi.fn(), pending: vi.fn() });
    s.submit("hello");
    expect(s.submit("hello")).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("refused or failed before acceptance: the text stays and sending works again", async () => {
    const accepted = vi.fn();
    const failing = createSubmitter(() => Promise.reject(new Error("offline")), { accepted, pending: vi.fn() });
    failing.submit("hello");
    await tick();
    expect(accepted).not.toHaveBeenCalled();
    expect(failing.pending).toBe(false);
    const refused = createSubmitter(() => Promise.resolve(false), { accepted, pending: vi.fn() });
    refused.submit("hello");
    await tick();
    expect(accepted).not.toHaveBeenCalled();
    expect(refused.submit("hello")).toBe(true);
  });

  it("a send that throws synchronously doesn't lock the box", () => {
    const s = createSubmitter(() => { throw new Error("boom"); }, { accepted: vi.fn(), pending: vi.fn() });
    expect(s.submit("hello")).toBe(false);
    expect(s.pending).toBe(false);
  });

  it("blank text is never sent", () => {
    const send = vi.fn();
    expect(createSubmitter(send, { accepted: vi.fn(), pending: vi.fn() }).submit("   \n ")).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});
