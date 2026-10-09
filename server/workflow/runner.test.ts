import { describe, expect, it } from "vitest";
import { createRunner, type Workflow } from "./runner";

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
