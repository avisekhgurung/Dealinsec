/**
 * The process-wide driver for prospect runs (server/workflow/runner.ts over prospect_runs). Kicked at boot, when a
 * run starts, and whenever someone looks at a run; it stops by itself when no run is left to work.
 *
 * Ownership: a claim returns the run with a fence (its claim number). Every write to the run is fenced, the lease is
 * renewed while a step works (so a long slice isn't taken over), and a worker that finds it lost the run stops.
 * When everything left is waiting for a retry, the run is parked (its lease held until then): no polling.
 */
import { createRunner, type StepResult, type Workflow } from "../workflow/runner";
import { LeaseLost, checkpoint, pipelineDeps, stepRun, type PipelineDeps } from "./pipeline";
import { outboundStore, prospectsTablesReady, type ClaimedRun, type OutboundStore } from "./store";

export const LEASE_MS = 90_000;
const RENEW_MS = LEASE_MS / 3;
/** A run claimed this many times without finishing is stuck (a bug or a hostile input): it is failed, not retried forever. Parking and slicing count as claims. */
export const MAX_CLAIMS = 500;

export interface WorkflowOptions { store?: OutboundStore; leaseMs?: number; renewMs?: number; maxClaims?: number; ready?: () => Promise<boolean>; log?: (kind: string, fields: Record<string, unknown>) => void }

export function outboundWorkflow(deps: () => PipelineDeps, o: WorkflowOptions = {}): Workflow<ClaimedRun> {
  const store = o.store ?? outboundStore;
  const leaseMs = o.leaseMs ?? LEASE_MS, renewMs = o.renewMs ?? (o.leaseMs ? o.leaseMs / 3 : RENEW_MS), maxClaims = o.maxClaims ?? MAX_CLAIMS;
  const ready = o.ready ?? prospectsTablesReady;
  const log = o.log ?? ((kind, fields) => console.log(JSON.stringify({ kind, ...fields })));
  return {
    name: "prospect_runs",
    async claim(now) {
      if (!(await ready().catch(() => false))) return null;
      const run = await store.claimRun(now, leaseMs);
      if (run && run.attempts > maxClaims) {
        await store.setRunStatus(run.organizationId, run.id, "running", "failed", now, "stuck");
        return null;
      }
      return run;
    },
    async step(run, deadline): Promise<StepResult> {
      // Keep the lease while this step works. A renewal that finds the run taken over stops the work; one that merely
      // errors does not (the next one tries again).
      let lost = false;
      const timer = setInterval(() => {
        store.setLease(run.id, run.fence, new Date(Date.now() + leaseMs)).then((ok) => { if (!ok) lost = true; }).catch(() => {});
      }, renewMs);
      timer.unref?.();
      try {
        const d: PipelineDeps = { ...deps(), leaseHeld: () => !lost };
        const fresh = await store.getRun(run.organizationId, run.id);
        if (!fresh || fresh.status !== "running") return "done"; // cancelled by the person
        Object.assign(run, fresh); // the fence is not a column, so a refreshed row keeps this worker's claim number
        const state = await stepRun(run, deadline, d);
        if (state === "more") await checkpoint(run, d);
        return state;
      } catch (e) {
        if (e instanceof LeaseLost) { log("lease_lost", { workflow: "prospect_runs", runId: run.id }); return "done"; }
        throw e;
      } finally {
        clearInterval(timer);
      }
    },
    park: async (run, until) => { await store.setLease(run.id, run.fence, until); },
    release: async (run) => { await store.setLease(run.id, run.fence, null); },
    nextWake: (now) => store.nextLeaseExpiry(now),
    async failed() { /* the claim counter on the row is the record; the lease expires and it is tried again */ },
  };
}

export const outboundRunner = createRunner<ClaimedRun>(outboundWorkflow(pipelineDeps));
