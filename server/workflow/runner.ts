/**
 * A small durable workflow runner on top of Postgres. The job IS a database row; this code only drives it.
 *
 *   claim   one atomic UPDATE takes a running job whose lease is free or expired (two workers never hold one job)
 *   step    the workflow does one bounded slice of work and writes its checkpoint in the same transaction as its
 *           results, so a crash loses at most the slice in flight, which is redone (steps are idempotent)
 *   release the lease is dropped when the slice ends; the next tick may pick the job up again
 *
 * Nothing here relies on a timer surviving: if the process dies, the lease simply expires and the next tick (at
 * boot, on any request that kicks the runner, or from the loop while work remains) resumes from the checkpoint.
 * The interface (a workflow of idempotent steps over a durable row) is the one Temporal uses, so the steps can move
 * there later without changing the domain code.
 */
/** "more" = work remains, "done" = the job reached an end state, { wait } = nothing can happen until that time (parked, not polled). */
export type StepResult = "more" | "done" | { wait: Date };

export interface Workflow<J> {
  readonly name: string;
  claim(now: Date): Promise<J | null>;
  /** Do one bounded slice. */
  step(job: J, deadline: number): Promise<StepResult>;
  release(job: J): Promise<void>;
  /** Hold the job (its lease) until `until` without touching it, so a job whose only work is waiting costs nothing while it waits. Without it a wait is just a release. */
  park?(job: J, until: Date): Promise<void>;
  /** The next time any job becomes claimable, so a parked job is woken even after a restart with nobody asking. */
  nextWake?(now: Date): Promise<Date | null>;
  /**
   * A step threw unexpectedly. The lease is NOT released: the job waits for it to expire before anyone retries, so a
   * job that keeps failing is retried slowly (and the claim counter eventually gives up), never in a tight loop.
   */
  failed(job: J, err: unknown): Promise<void>;
}

export interface RunnerOptions {
  /** How long one claimed job is worked before it is released for others (also bounds a request-kicked tick). */
  sliceMs?: number;
  now?: () => number;
  log?: (kind: string, fields: Record<string, unknown>) => void;
}

export interface Runner {
  /** Starts the loop if it is not running. Safe to call from anywhere, any number of times. */
  kick(): void;
  /** One claim-and-work pass; true if a job was worked. Exposed for tests and for a request that wants to help. */
  tickOnce(): Promise<boolean>;
  readonly busy: boolean;
  /** Resolves when the current loop (if any) has stopped: for tests. */
  idle(): Promise<void>;
}

export function createRunner<J>(wf: Workflow<J>, opts: RunnerOptions = {}): Runner {
  const sliceMs = opts.sliceMs ?? 25_000;
  const now = opts.now ?? Date.now;
  const log = opts.log ?? ((kind, fields) => console.log(JSON.stringify({ kind, ...fields })));
  let loop: Promise<void> | null = null;
  let wake: ReturnType<typeof setTimeout> | null = null;
  let wakeAt = Infinity;

  /** One timer for the whole runner: the earliest time a parked job can be claimed (a second later: the claim compares strictly). */
  function scheduleWake(at: Date) {
    const t = at.getTime();
    if (wake && t >= wakeAt) return;
    if (wake) clearTimeout(wake);
    wakeAt = t;
    wake = setTimeout(() => { wake = null; wakeAt = Infinity; runner.kick(); }, Math.max(0, t - now()) + 1000);
    wake.unref?.();
  }

  async function tickOnce(): Promise<boolean> {
    const job = await wf.claim(new Date(now()));
    if (!job) return false;
    const deadline = now() + sliceMs;
    let state: StepResult = "more";
    try {
      while (state === "more" && now() < deadline) state = await wf.step(job, deadline);
    } catch (e) {
      log("workflow_error", { workflow: wf.name, errorType: (e as Error)?.name ?? "Error" }); // never the message: it may hold page text
      try { await wf.failed(job, e); } catch { /* the lease expires on its own */ }
      return true;
    }
    try {
      if (typeof state === "object" && wf.park) { await wf.park(job, state.wait); scheduleWake(state.wait); }
      else await wf.release(job);
    } catch { /* the lease expires on its own */ }
    return true;
  }

  const runner: Runner = {
    kick() {
      if (loop) return;
      loop = (async () => {
        try {
          while (await tickOnce()) { /* keep going while jobs remain */ }
          if (wf.nextWake) { const w = await wf.nextWake(new Date(now())); if (w) scheduleWake(new Date(Math.min(w.getTime(), now() + 300_000))); }
        }
        catch (e) { log("workflow_error", { workflow: wf.name, where: "claim", errorType: (e as Error)?.name ?? "Error" }); }
        finally { loop = null; }
      })();
    },
    tickOnce,
    get busy() { return loop !== null; },
    idle: () => loop ?? Promise.resolve(),
  };
  return runner;
}
