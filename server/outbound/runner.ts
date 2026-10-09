/**
 * The process-wide driver for prospect runs (server/workflow/runner.ts over prospect_runs). Kicked at boot, when a
 * run starts, and whenever someone looks at a run; it stops by itself when no run is left to work.
 */
import { createRunner } from "../workflow/runner";
import { checkpoint, pipelineDeps, stepRun } from "./pipeline";
import { outboundStore, prospectsTablesReady } from "./store";
import type { ProspectRunRow } from "@shared/schema";

const LEASE_MS = 90_000;
/** A run claimed this many times without finishing is stuck (a bug or a hostile input): it is failed, not retried forever. */
const MAX_CLAIMS = 200;

export const outboundRunner = createRunner<ProspectRunRow>({
  name: "prospect_runs",
  async claim(now) {
    if (!(await prospectsTablesReady().catch(() => false))) return null;
    const run = await outboundStore.claimRun(now, LEASE_MS);
    if (run && run.attempts > MAX_CLAIMS) {
      await outboundStore.setRunStatus(run.organizationId, run.id, "running", "failed", now, "stuck");
      return null;
    }
    return run;
  },
  async step(run, deadline) {
    const deps = pipelineDeps();
    const fresh = await outboundStore.getRun(run.organizationId, run.id);
    if (!fresh || fresh.status !== "running") return "done"; // cancelled by the person
    Object.assign(run, fresh);
    const state = await stepRun(run, deadline, deps);
    if (state === "more") await checkpoint(run, deps);
    return state;
  },
  release: (run) => outboundStore.releaseRun(run.id),
  async failed() { /* the claim counter on the row is the record; the lease expires and it is tried again */ },
});
