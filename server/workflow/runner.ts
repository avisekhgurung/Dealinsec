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
export interface Workflow<J> {
  readonly name: string;
  claim(now: Date): Promise<J | null>;
  /** Do one bounded slice. Return "more" while work remains, "done" when the job reached an end state. */
  step(job: J, deadline: number): Promise<"more" | "done">;
  release(job: J): Promise<void>;
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

  async function tickOnce(): Promise<boolean> {
    const job = await wf.claim(new Date(now()));
    if (!job) return false;
    const deadline = now() + sliceMs;
    try {
      let state: "more" | "done" = "more";
      while (state === "more" && now() < deadline) state = await wf.step(job, deadline);
    } catch (e) {
      log("workflow_error", { workflow: wf.name, errorType: (e as Error)?.name ?? "Error" }); // never the message: it may hold page text
      try { await wf.failed(job, e); } catch { /* the lease expires on its own */ }
      return true;
    }
    try { await wf.release(job); } catch { /* the lease expires on its own */ }
    return true;
  }

  const runner: Runner = {
    kick() {
      if (loop) return;
      loop = (async () => {
        try { while (await tickOnce()) { /* keep going while jobs remain */ } }
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
