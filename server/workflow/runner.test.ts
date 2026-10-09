import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRunner, type StepResult, type Workflow } from "./runner";

interface Job { id: string; steps: number; lease: boolean; done: boolean }

function world(jobs: Job[], opts: { failAt?: number } = {}) {
  const log: string[] = [];
  let failed = 0;
  const wf: Workflow<Job> = {
    name: "t",
    async claim() { const j = jobs.find((x) => !x.lease && !x.done); if (j) j.lease = true; return j ?? null; },
    async step(j) {
      j.steps++;
      if (opts.failAt === j.steps && failed++ === 0) throw new Error("boom: secret page text");
      if (j.steps >= 3) { j.done = true; return "done"; }
      return "more";
    },
    async release(j) { j.lease = false; log.push(`release ${j.id}`); },
    async failed(j) { log.push(`failed ${j.id}`); j.lease = false; /* the test's "lease expiry" */ },
  };
  return { wf, log };
}

describe("the workflow runner", () => {
  it("works every job to the end and stops by itself", async () => {
    const jobs = [{ id: "a", steps: 0, lease: false, done: false }, { id: "b", steps: 0, lease: false, done: false }];
    const { wf } = world(jobs);
    const r = createRunner(wf, { log: () => {} });
    r.kick(); r.kick(); // a second kick while running is a no-op
    await r.idle();
    expect(jobs.every((j) => j.done && j.steps === 3)).toBe(true);
    expect(r.busy).toBe(false);
  });
  it("a slice ends at its deadline and the job is picked up again", async () => {
    let t = 0;
    const jobs = [{ id: "a", steps: 0, lease: false, done: false }];
    const { wf, log } = world(jobs);
    const r = createRunner({ ...wf, step: async (j, d) => { t += 1000; return wf.step(j, d); } }, { sliceMs: 1500, now: () => t, log: () => {} });
    r.kick(); await r.idle();
    expect(jobs[0].done).toBe(true);
    expect(log.filter((l) => l.startsWith("release")).length).toBeGreaterThanOrEqual(2);
  });
  it("a step that throws does not release the lease (no tight retry loop), logs no message text, and the job resumes", async () => {
    const jobs = [{ id: "a", steps: 0, lease: false, done: false }];
    const { wf, log } = world(jobs, { failAt: 2 });
    const lines: string[] = [];
    const r = createRunner(wf, { log: (k, f) => lines.push(JSON.stringify({ k, ...f })) });
    r.kick(); await r.idle();
    expect(log).toContain("failed a");
    expect(jobs[0].done).toBe(true);
    expect(lines.join(" ")).toContain("workflow_error");
    expect(lines.join(" ")).not.toContain("secret page text");
  });
});

describe("a job that can only wait is parked, not polled", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-09T10:00:00Z")); });
  afterEach(() => { vi.useRealTimers(); });

  interface PJob { id: string; lease: boolean; done: boolean; waited: boolean }
  function parkable(opts: { withPark?: boolean; nextWake?: () => Promise<Date | null> } = {}) {
    const jobs: PJob[] = [{ id: "a", lease: false, done: false, waited: false }, { id: "b", lease: false, done: false, waited: false }];
    const calls: string[] = [];
    let waitUntil = 0;
    const wf: Workflow<PJob> = {
      name: "p",
      async claim(now) { calls.push("claim"); const j = jobs.find((x) => !x.lease && !x.done); if (j) j.lease = true; return j ?? null; },
      async step(j): Promise<StepResult> {
        calls.push(`step ${j.id}`);
        if (j.id === "a" && !j.waited) { j.waited = true; waitUntil = Date.now() + 30_000; return { wait: new Date(waitUntil) }; }
        j.done = true; return "done";
      },
      async release(j) { calls.push(`release ${j.id}`); j.lease = false; },
      async failed(j) { j.lease = false; },
    };
    if (opts.withPark !== false) wf.park = async (j, until) => { calls.push(`park ${j.id}`); /* the lease stays set until the wake: not claimable */ void until; };
    if (opts.nextWake) wf.nextWake = opts.nextWake;
    return { jobs, calls, wf, wakeAt: () => waitUntil };
  }

  it("a wait parks the job (no release), other jobs are still worked, nothing touches the parked job until its time, then it finishes with no request", async () => {
    const { jobs, calls, wf, wakeAt } = parkable();
    const r = createRunner(wf, { log: () => {} });
    r.kick(); await r.idle();
    expect(calls).toContain("park a");
    expect(calls).not.toContain("release a");
    expect(jobs.find((j) => j.id === "b")!.done).toBe(true); // the other job was not held up
    const before = calls.length;
    await vi.advanceTimersByTimeAsync(20_000); // still waiting
    expect(calls.length).toBe(before); // zero activity while it waits
    jobs[0].lease = false; // (the lease would have expired at its time)
    await vi.advanceTimersByTimeAsync(wakeAt() - Date.now() + 1500);
    await r.idle();
    expect(jobs[0].done).toBe(true);
  });
  it("without a park hook a wait is just a release (nothing is lost)", async () => {
    const { calls, wf } = parkable({ withPark: false });
    const r = createRunner(wf, { log: () => {} });
    r.kick(); await r.idle();
    expect(calls).toContain("release a");
  });
  it("when the loop goes idle it asks when the next job can be claimed, and wakes for exactly that (a restart with nobody asking)", async () => {
    let asked = 0;
    const wake = Date.now() + 40_000;
    const { jobs, wf } = parkable({ nextWake: async () => { asked++; return asked === 1 ? new Date(wake) : null; } });
    jobs.forEach((j) => { j.done = true; }); // nothing to claim now
    const claimed: number[] = [];
    const base = wf.claim.bind(wf);
    wf.claim = async (now) => { claimed.push(Date.now()); return base(now); };
    const r = createRunner(wf, { log: () => {} });
    r.kick(); await r.idle();
    expect(asked).toBe(1);
    await vi.advanceTimersByTimeAsync(39_000);
    expect(claimed).toHaveLength(1); // not before its time
    await vi.advanceTimersByTimeAsync(2_500);
    expect(claimed).toHaveLength(2); // woke once, at its time
  });
});
